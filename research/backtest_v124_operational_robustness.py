from pathlib import Path
import hashlib
import io
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

import numpy as np
import pandas as pd

# Reuse corrected v1.21/v1.19/v1.17 definitions without executing its top-level run.
p=Path('research/backtest_v121_500_margin_reserve.py')
s=p.read_text(encoding='utf-8')
prefix=s.split("print('V121_BEGIN')",1)[0]
ns={'__name__':'v121defs','__file__':str(p)}
exec(compile(prefix,str(p),'exec'),ns)

START=ns['START']; END=ns['END']; START_CAPITAL=ns['START_CAPITAL']
COMM=ns['COMM']; POINT=ns['POINT']; TAX=ns['TAX']
TAIFEX=ns['TAIFEX']; HEADERS=ns['HEADERS']; req=ns['req']; chunks=ns['chunks']
fetch_margin_events=ns['fetch_margin_events']; load_signal=ns['load_signal']
roll_map=ns['roll_map']; active_expiry=ns['active_expiry']; desired_contracts=ns['desired_contracts']; margin_state=ns['margin_state']

ANNUAL_YIELD=0.015
FLOOR=5.0
EXPECTED_ROWS=30065
DL_START=pd.Timestamp('2016-10-01')


def pct(v): return f'{100*v:.2f}%'
def money(v): return f'{v:,.0f}'


def fetch_fut_chunk_open(prod,st,en):
    form={'down_type':'1','commodity_id':prod,'queryStartDate':st.strftime('%Y/%m/%d'),
          'queryEndDate':en.strftime('%Y/%m/%d'),'MarketCode':'0'}
    r=req('POST',TAIFEX+'/cht/3/futDataDown',data=form)
    txt=r.content.decode('cp950',errors='replace').strip()
    if not txt or '交易日期' not in txt:
        return pd.DataFrame()
    try:
        df=pd.read_csv(io.StringIO(txt),dtype=str)
    except Exception:
        return pd.DataFrame()
    if df.empty: return df
    df.columns=[str(c).strip() for c in df.columns]
    need=['交易日期','契約','到期月份(週別)','開盤價','收盤價','最低價','結算價','交易時段']
    if any(c not in df.columns for c in need): return pd.DataFrame()
    z=df[need].copy(); z.columns=['date','product','expiry','open','close','low','settle','session']
    z['product']=z['product'].astype(str).str.strip(); z['expiry']=z['expiry'].astype(str).str.strip(); z['session']=z['session'].astype(str).str.strip()
    z=z[(z['product']==prod)&(z['session']=='一般')&z['expiry'].str.match(r'^\d{6}$',na=False)]
    z['date']=pd.to_datetime(z['date'],errors='coerce')
    for c in ['open','close','low','settle']:
        z[c]=pd.to_numeric(z[c].replace('-',np.nan),errors='coerce')
    z=z.dropna(subset=['date','open','close']).drop_duplicates(['date','product','expiry'],keep='last')
    return z


def fetch_futures_open():
    jobs=[]
    for prod,st in [('TX',DL_START),('MTX',DL_START),('TMF',pd.Timestamp('2024-07-01'))]:
        for a,b in chunks(st,END): jobs.append((prod,a,b))
    out=[]
    with ThreadPoolExecutor(max_workers=4) as ex:
        fut={ex.submit(fetch_fut_chunk_open,*j):j for j in jobs}
        done=0
        for f in as_completed(fut):
            j=fut[f]; done+=1
            try:
                x=f.result()
                if not x.empty: out.append(x)
            except Exception as e:
                print('DOWNLOAD_ERROR',j,repr(e)); raise
            if done%50==0: print('download chunks',done,'/',len(jobs))
    z=pd.concat(out,ignore_index=True).sort_values(['date','product','expiry'])
    z=z[(z['date']>=START)&(z['date']<=END)].reset_index(drop=True)
    return z


def data_hash(px):
    cols=['date','product','expiry','open','close','low','settle','session']
    z=px[cols].copy().sort_values(['date','product','expiry'])
    z['date']=z['date'].dt.strftime('%Y-%m-%d')
    txt=z.to_csv(index=False,float_format='%.10g',lineterminator='\n')
    return hashlib.sha256(txt.encode('utf-8')).hexdigest()


def run_policy(px,sig,events,reset=5.0,slip=1.0,delay_t1=False):
    price={(r.product,r.expiry,r.date):float(r.close) for r in px.itertuples()}
    low={(r.product,r.expiry,r.date):float(r.low) if pd.notna(r.low) else float(r.close) for r in px.itertuples()}
    rolls=roll_map(px); exps=sorted(rolls)
    tmf_rows=px[px['product']=='TMF']; tmf_first=tmf_rows['date'].min() if len(tmf_rows) else pd.Timestamp.max
    dates=sorted(set(px.loc[px['product']=='TX','date']) & set(sig.loc[(sig.index>=START)&(sig.index<=END)].index))

    fut_cash=START_CAPITAL; external=0.0; pending=0.0
    holdings={}; prev_close={}; last_target=2.0
    prev_date=None; prev_month=None
    cum_interest=0.0; transfer_count=0; emergency_count=0; monthly_count=0; transfer_gross=0.0
    rows=[]

    for d in dates:
        interest=0.0
        if prev_date is not None and external>0:
            gap=max((d-prev_date).days,0)
            interest=external*((1.0+ANNUAL_YIELD)**(gap/365.25)-1.0)
            external += interest; cum_interest += interest

        held=dict(holdings); fut_start=fut_cash
        pnl=0.0; intraday_pnl=0.0
        for (prod,exp),q in held.items():
            key=(prod,exp,d)
            if key not in price: raise RuntimeError(f'held close missing {key}')
            cur=price[key]; prv=prev_close[(prod,exp)]
            pnl += q*POINT[prod]*(cur-prv)
            intraday_pnl += q*POINT[prod]*(low[key]-prv)
        fut_cash += pnl
        intraday_fut_equity=fut_start+intraday_pnl

        if d in sig.index: last_target=float(sig.loc[d,'target_x'])
        exp=active_expiry(d,rolls,exps)
        if exp is None: continue
        combined_pre_trade=fut_cash+external+pending
        desired=desired_contracts(last_target,combined_pre_trade,d,exp,price,tmf_first)

        allk=set(held)|set(desired); cost=0.0; sides=0
        for k in allk:
            old=held.get(k,0); new=desired.get(k,0); delta=new-old
            if delta==0: continue
            prod,ex=k; key=(prod,ex,d)
            if key not in price: raise RuntimeError(f'trade close missing {key}')
            n=abs(delta); notion=price[key]*POINT[prod]*n
            cost += n*COMM[prod] + notion*TAX + n*slip*POINT[prod]
            sides += n
        fut_cash -= cost
        holdings=desired
        prev_close={(prod,ex):price[(prod,ex,d)] for prod,ex in holdings}

        # Historical margins at this general-session close.
        ms=margin_state(events,d); tx_i=float(ms['initial']); tx_m=float(ms['maint'])
        scale={'TX':1.0,'MTX':0.25,'TMF':0.05}
        im=sum(q*tx_i*scale[prod] for (prod,ex),q in holdings.items())
        mm=sum(q*tx_m*scale[prod] for (prod,ex),q in holdings.items())
        intraday_im=sum(q*tx_i*scale[prod] for (prod,ex),q in held.items())
        intraday_mm=sum(q*tx_m*scale[prod] for (prod,ex),q in held.items())

        # T+1 emergency transfer requested last close becomes usable only now, after today's close.
        pending_arrival=0.0
        if delay_t1 and pending>0:
            pending_arrival=pending; fut_cash += pending; pending=0.0

        before_total=fut_cash+external+pending
        is_first_month_day=(prev_month is None or (d.year,d.month)!=prev_month)
        transfer=0.0; emergency=False; monthly=False

        if im>0:
            reset_target=reset*im
            floor_target=FLOOR*im
            if is_first_month_day:
                # Scheduled month-boundary rebalance is assumed planned/liquid at this close.
                desired_fut=min(before_total,reset_target)
                transfer=desired_fut-fut_cash
                if transfer>external: transfer=external
                if transfer<0 and -transfer>fut_cash: transfer=-fut_cash
                fut_cash += transfer; external -= transfer
                if abs(transfer)>0.5: monthly=True
            elif fut_cash < floor_target:
                emergency=True
                need=max(0.0,reset_target-fut_cash)
                amt=min(external,need)
                if delay_t1:
                    external -= amt; pending += amt; transfer=amt  # scheduled, not yet in futures equity
                else:
                    fut_cash += amt; external -= amt; transfer=amt

        if abs(transfer)>0.5:
            transfer_count += 1; transfer_gross += abs(transfer)
            if emergency: emergency_count += 1
            if monthly: monthly_count += 1

        combined=fut_cash+external+pending
        notional=sum(q*POINT[prod]*price[(prod,ex,d)] for (prod,ex),q in holdings.items())
        close_ratio=(fut_cash/im) if im>0 else np.nan
        intraday_ratio=(intraday_fut_equity/intraday_im) if intraday_im>0 else np.nan
        call_equiv=(mm/im) if im>0 else np.nan
        intraday_call_equiv=(intraday_mm/intraday_im) if intraday_im>0 else np.nan

        rows.append(dict(
            date=d,total_equity=combined,futures_equity=fut_cash,external_cash=external,pending_cash=pending,
            pnl=pnl,interest=interest,cum_interest=cum_interest,cost=cost,sides=sides,
            target_x=last_target,realized_x=notional/combined if combined else np.nan,notional=notional,
            initial_margin=im,maint_margin=mm,broker_ratio=close_ratio,call_equiv_ratio=call_equiv,
            intraday_futures_equity=intraday_fut_equity,intraday_initial_margin=intraday_im,
            intraday_maint_margin=intraday_mm,intraday_broker_ratio=intraday_ratio,
            intraday_call_equiv_ratio=intraday_call_equiv,transfer=transfer,pending_arrival=pending_arrival,
            external_share=external/combined if combined else np.nan,
            TX=sum(q for (p,e),q in holdings.items() if p=='TX'),
            MTX=sum(q for (p,e),q in holdings.items() if p=='MTX'),
            TMF=sum(q for (p,e),q in holdings.items() if p=='TMF'),expiry=exp
        ))
        prev_date=d; prev_month=(d.year,d.month)

    z=pd.DataFrame(rows).set_index('date')
    z.attrs.update(transfer_count=transfer_count,emergency_count=emergency_count,monthly_count=monthly_count,transfer_gross=transfer_gross)
    return z


def metrics(x):
    eq=x.total_equity
    total=eq.iloc[-1]/START_CAPITAL-1
    days=max((eq.index[-1]-START).days,1)
    cagr=(eq.iloc[-1]/START_CAPITAL)**(365.25/days)-1
    eqs=pd.concat([pd.Series([START_CAPITAL],index=[START-pd.Timedelta(days=1)]),eq])
    dd=eqs/eqs.cummax()-1; mdd=dd.min()
    return dict(terminal=float(eq.iloc[-1]),total=float(total),cagr=float(cagr),mdd=float(mdd),calmar=float(cagr/abs(mdd)))


def open_gap_audit(x,px,events):
    op={(r.product,r.expiry,r.date):float(r.open) for r in px.itertuples()}
    cl={(r.product,r.expiry,r.date):float(r.close) for r in px.itertuples()}
    scale={'TX':1.0,'MTX':0.25,'TMF':0.05}
    dates=list(x.index); rows=[]
    for i in range(1,len(dates)):
        d=dates[i]; pd0=dates[i-1]; pr=x.loc[pd0]
        exp=str(pr.expiry)
        qs={'TX':int(pr.TX),'MTX':int(pr.MTX),'TMF':int(pr.TMF)}
        if sum(qs.values())==0: continue
        pnl=0.0; notional=0.0; missing=False
        for prod,q in qs.items():
            if q<=0: continue
            k0=(prod,exp,pd0); k1=(prod,exp,d)
            if k0 not in cl or k1 not in op:
                missing=True; break
            pnl += q*POINT[prod]*(op[k1]-cl[k0])
            notional += q*POINT[prod]*cl[k0]
        if missing: continue
        # Margin effective at today's open is the state after prior regular-session close.
        ms=margin_state(events,pd0); tx_i=float(ms['initial']); tx_m=float(ms['maint'])
        im=sum(q*tx_i*scale[prod] for prod,q in qs.items())
        mm=sum(q*tx_m*scale[prod] for prod,q in qs.items())
        eq=float(pr.futures_equity)+pnl
        ratio=eq/im if im>0 else np.nan; call=mm/im if im>0 else np.nan
        rows.append(dict(date=d,prior_date=pd0,open_equity=eq,open_pnl=pnl,prior_notional=notional,
                         effective_gap=pnl/notional if notional else np.nan,initial_margin=im,maint_margin=mm,
                         open_ratio=ratio,call_equiv=call,TX=qs['TX'],MTX=qs['MTX'],TMF=qs['TMF'],expiry=exp,
                         prior_futures_equity=float(pr.futures_equity),prior_total_equity=float(pr.total_equity)))
    return pd.DataFrame(rows).set_index('date')


def print_open(name,o):
    r=o.loc[o.open_ratio.idxmin()]
    print('OPEN_AUDIT',name,'n',len(o),'min_ratio',pct(r.open_ratio),'date',r.name.date(),
          'effective_gap',pct(r.effective_gap),'open_pnl',money(r.open_pnl),'open_equity',money(r.open_equity),
          'initial',money(r.initial_margin),'maint',money(r.maint_margin),'call_equiv',pct(r.call_equiv),
          'holdings',int(r.TX),int(r.MTX),int(r.TMF),'expiry',r.expiry)
    for mult in [1.0,1.2,1.5,2.0]:
        rr=o.open_ratio/mult
        print('OPEN_SHOCK',name,mult,'min',pct(rr.min()),rr.idxmin().date(),
              'below250',int((rr<2.5).sum()),'below200',int((rr<2.0).sum()),'below150',int((rr<1.5).sum()),
              'below100',int((rr<1.0).sum()),'below_call',int((rr<o.call_equiv).sum()))


print('V124_BEGIN')
px=fetch_futures_open()
print('data_rows',len(px))
if len(px)!=EXPECTED_ROWS:
    raise RuntimeError(f'DATA_INTEGRITY_FAIL rows={len(px)} expected={EXPECTED_ROWS}')
print('data_sha256',data_hash(px))
events,missing=fetch_margin_events(); sig=load_signal()
print('margin_events',len(events),'missing_margin_csv',len(missing),'annual_external_yield',ANNUAL_YIELD)

# A + B: buffer candidates, all with 1pt slippage and same-day close rescue.
print('BUFFER_TABLE')
buf={}
for reset in [5.0,5.25,5.5,5.75,6.0]:
    x=run_policy(px,sig,events,reset=reset,slip=1.0,delay_t1=False); buf[reset]=x
    m=metrics(x); o=open_gap_audit(x,px,events)
    print('BUFFER',reset,'terminal',money(m['terminal']),'cagr',pct(m['cagr']),'mdd',pct(m['mdd']),'calmar',f"{m['calmar']:.3f}",
          'interest',money(x.cum_interest.iloc[-1]),'transfers',x.attrs['transfer_count'],'emergency',x.attrs['emergency_count'],
          'monthly',x.attrs['monthly_count'],'gross_transfer',money(x.attrs['transfer_gross']),
          'min_close',pct(x.broker_ratio.dropna().min()),'min_open',pct(o.open_ratio.min()),
          'avg_external',pct(x.external_share.mean()))

# Detailed opening-gap audit on frozen 500% baseline.
base=buf[5.0]; openbase=open_gap_audit(base,px,events); print_open('BASE500',openbase)

# C: slippage robustness.
print('SLIPPAGE_TABLE')
for slip in [1.0,3.0,5.0]:
    x=base if slip==1.0 else run_policy(px,sig,events,reset=5.0,slip=slip,delay_t1=False)
    m=metrics(x); o=open_gap_audit(x,px,events)
    print('SLIP',slip,'terminal',money(m['terminal']),'cagr',pct(m['cagr']),'mdd',pct(m['mdd']),'calmar',f"{m['calmar']:.3f}",
          'interest',money(x.cum_interest.iloc[-1]),'transfers',x.attrs['transfer_count'],'min_close',pct(x.broker_ratio.dropna().min()),'min_open',pct(o.open_ratio.min()))

# D: conservative T+1 emergency liquidity.
print('LIQUIDITY_TABLE')
for delay in [False,True]:
    x=base if not delay else run_policy(px,sig,events,reset=5.0,slip=1.0,delay_t1=True)
    m=metrics(x); o=open_gap_audit(x,px,events)
    bc=x.broker_ratio.dropna(); ce=x.call_equiv_ratio.reindex(bc.index)
    print('LIQUIDITY','T1' if delay else 'INSTANT','terminal',money(m['terminal']),'cagr',pct(m['cagr']),'mdd',pct(m['mdd']),'calmar',f"{m['calmar']:.3f}",
          'interest',money(x.cum_interest.iloc[-1]),'transfers',x.attrs['transfer_count'],'emergency',x.attrs['emergency_count'],
          'min_close',pct(bc.min()),'close_below500',int((bc<5.0).sum()),'close_below_call',int((bc<ce).sum()),
          'min_open',pct(o.open_ratio.min()),'open_below_call',int((o.open_ratio<o.call_equiv).sum()),'max_pending',money(x.pending_cash.max()))

print('REFERENCE 00685L terminal=31,700,514 CAGR=44.1% MDD=-36.8% Calmar=1.20')
print('DEFINITION 500% floor remains fixed. Buffer candidates only change monthly/refill reset target.')
print('OPEN_DEFINITION prior close-held position marked to next regular-session actual open; no pre-open external rescue.')
print('V124_END')
