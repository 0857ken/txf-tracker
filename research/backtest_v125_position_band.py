from pathlib import Path
import numpy as np
import pandas as pd

# Load v1.24 definitions with the already-diagnosed TAIFEX helper/parser fixes,
# but do not execute the v1.24 top-level run.
p=Path('research/backtest_v124_operational_robustness.py')
s=p.read_text(encoding='utf-8')
old="TAIFEX=ns['TAIFEX']; HEADERS=ns['HEADERS']; req=ns['req']; chunks=ns['chunks']"
new=r'''import requests
TAIFEX='https://www.taifex.com.tw'
HEADERS={'User-Agent':'Mozilla/5.0 (compatible; research-backtest/1.0)'}
requests.packages.urllib3.disable_warnings()

def req(method,url,**kw):
    for k in range(5):
        try:
            r=requests.request(method,url,headers=HEADERS,timeout=45,verify=False,**kw)
            r.raise_for_status(); return r
        except Exception:
            if k==4: raise
            time.sleep(0.5*(2**k))

def chunks(st,en,days=28):
    x=st
    while x<=en:
        y=min(x+pd.Timedelta(days=days),en)
        yield x,y
        x=y+pd.Timedelta(days=1)
'''
s=s.replace(old,new,1)
old_parse="""    try:\n        df=pd.read_csv(io.StringIO(txt),dtype=str)\n    except Exception:\n        return pd.DataFrame()\n    if df.empty: return df\n"""
new_parse="""    try:\n        import csv\n        rr=list(csv.reader(io.StringIO(txt)))\n        if not rr: return pd.DataFrame()\n        header=[str(c).strip() for c in rr[0]]\n        data=[]\n        for row in rr[1:]:\n            if len(row)<len(header): row=row+['']*(len(header)-len(row))\n            elif len(row)>len(header): row=row[:len(header)]\n            data.append(row)\n        df=pd.DataFrame(data,columns=header,dtype=str)\n    except Exception:\n        return pd.DataFrame()\n    if df.empty: return df\n"""
s=s.replace(old_parse,new_parse,1)
prefix=s.split("print('V124_BEGIN')",1)[0]
ns={'__name__':'v124defs','__file__':str(p)}
exec(compile(prefix,str(p),'exec'),ns)

START=ns['START']; END=ns['END']; START_CAPITAL=ns['START_CAPITAL']
COMM=ns['COMM']; POINT=ns['POINT']; TAX=ns['TAX']; ANNUAL_YIELD=ns['ANNUAL_YIELD']
fetch_futures_open=ns['fetch_futures_open']; data_hash=ns['data_hash']; EXPECTED_ROWS=ns['EXPECTED_ROWS']
fetch_margin_events=ns['fetch_margin_events']; load_signal=ns['load_signal']
roll_map=ns['roll_map']; active_expiry=ns['active_expiry']; desired_contracts=ns['desired_contracts']; margin_state=ns['margin_state']
metrics=ns['metrics']; open_gap_audit=ns['open_gap_audit']

SLIP=1.0
RESERVE=5.0
BANDS=[0.0,0.025,0.05,0.075,0.10]

def pct(v): return f'{100*v:.3f}%'
def money(v): return f'{v:,.0f}'


def run_band(px,sig,events,band):
    price={(r.product,r.expiry,r.date):float(r.close) for r in px.itertuples()}
    rolls=roll_map(px); exps=sorted(rolls)
    tmf_rows=px[px['product']=='TMF']; tmf_first=tmf_rows['date'].min() if len(tmf_rows) else pd.Timestamp.max
    dates=sorted(set(px.loc[px['product']=='TX','date']) & set(sig.loc[(sig.index>=START)&(sig.index<=END)].index))
    fut_cash=START_CAPITAL; external=0.0; holdings={}; prev_close={}; last_target=2.0
    prev_date=None; prev_month=None; first=True
    cum_interest=0.0; total_cost=0.0; total_sides=0; trade_days=0; signal_resize_days=0; band_resize_days=0; roll_days=0
    rows=[]
    scale={'TX':1.0,'MTX':0.25,'TMF':0.05}

    for d in dates:
        interest=0.0
        if prev_date is not None and external>0:
            gap=max((d-prev_date).days,0)
            interest=external*((1.0+ANNUAL_YIELD)**(gap/365.25)-1.0)
            external += interest; cum_interest += interest

        held=dict(holdings)
        pnl=0.0
        for (prod,exp0),q in held.items():
            cur=price[(prod,exp0,d)]; prv=prev_close[(prod,exp0)]
            pnl += q*POINT[prod]*(cur-prv)
        fut_cash += pnl

        new_target=float(sig.loc[d,'target_x']) if d in sig.index else last_target
        signal_changed=(not first and abs(new_target-last_target)>1e-12)
        last_target=new_target
        exp=active_expiry(d,rolls,exps)
        if exp is None: continue
        combined_pre=fut_cash+external

        held_expiries={e for (p0,e),q in held.items() if q>0}
        roll_needed=bool(held_expiries and (held_expiries!={exp}))
        current_notional=0.0
        current_valid=True
        for (prod,ex0),q in held.items():
            k=(prod,ex0,d)
            if k not in price:
                current_valid=False; break
            current_notional += q*POINT[prod]*price[k]
        current_x=current_notional/combined_pre if (combined_pre and current_valid) else np.nan
        deviation=abs(current_x-last_target) if pd.notna(current_x) else np.inf

        force=first or signal_changed or roll_needed or not current_valid
        if force or deviation>band+1e-12:
            desired=desired_contracts(last_target,combined_pre,d,exp,price,tmf_first)
            if signal_changed: signal_resize_days+=1
            elif roll_needed: roll_days+=1
            elif not first: band_resize_days+=1
        else:
            desired=held

        allk=set(held)|set(desired); cost=0.0; sides=0
        for k in allk:
            oldq=held.get(k,0); newq=desired.get(k,0); delta=newq-oldq
            if delta==0: continue
            prod,ex0=k; px0=price[(prod,ex0,d)]
            n=abs(delta); notion=px0*POINT[prod]*n
            cost += n*COMM[prod]+notion*TAX+n*SLIP*POINT[prod]
            sides += n
        if sides: trade_days += 1
        total_cost += cost; total_sides += sides; fut_cash -= cost
        holdings=desired
        prev_close={(prod,ex0):price[(prod,ex0,d)] for prod,ex0 in holdings}

        ms=margin_state(events,d); tx_i=float(ms['initial']); tx_m=float(ms['maint'])
        im=sum(q*tx_i*scale[prod] for (prod,ex0),q in holdings.items())
        mm=sum(q*tx_m*scale[prod] for (prod,ex0),q in holdings.items())

        before=fut_cash+external
        is_first_month_day=(prev_month is None or (d.year,d.month)!=prev_month)
        transfer=0.0
        if im>0:
            target_cash=RESERVE*im
            if is_first_month_day:
                desired_fut=min(before,target_cash); transfer=desired_fut-fut_cash
            elif fut_cash<target_cash:
                transfer=min(external,target_cash-fut_cash)
            if transfer>external: transfer=external
            if transfer<0 and -transfer>fut_cash: transfer=-fut_cash
            fut_cash+=transfer; external-=transfer

        combined=fut_cash+external
        notional=sum(q*POINT[prod]*price[(prod,ex0,d)] for (prod,ex0),q in holdings.items())
        realized_x=notional/combined if combined else np.nan
        rows.append(dict(date=d,total_equity=combined,futures_equity=fut_cash,external_cash=external,
                         interest=interest,cum_interest=cum_interest,cost=cost,sides=sides,target_x=last_target,
                         realized_x=realized_x,abs_track_error=abs(realized_x-last_target),initial_margin=im,
                         maint_margin=mm,broker_ratio=(fut_cash/im if im>0 else np.nan),call_equiv_ratio=(mm/im if im>0 else np.nan),
                         TX=sum(q for (p0,e),q in holdings.items() if p0=='TX'),
                         MTX=sum(q for (p0,e),q in holdings.items() if p0=='MTX'),
                         TMF=sum(q for (p0,e),q in holdings.items() if p0=='TMF'),expiry=exp,
                         external_share=external/combined if combined else np.nan))
        prev_date=d; prev_month=(d.year,d.month); first=False

    z=pd.DataFrame(rows).set_index('date')
    z.attrs.update(total_cost=total_cost,total_sides=total_sides,trade_days=trade_days,
                   signal_resize_days=signal_resize_days,band_resize_days=band_resize_days,roll_days=roll_days)
    return z


print('V125_BEGIN')
px=fetch_futures_open(); print('data_rows',len(px))
if len(px)!=EXPECTED_ROWS: raise RuntimeError(f'DATA_INTEGRITY_FAIL {len(px)} != {EXPECTED_ROWS}')
print('data_sha256',data_hash(px))
events,missing=fetch_margin_events(); sig=load_signal(); print('margin_events',len(events),'missing_margin_csv',len(missing))
for band in BANDS:
    x=run_band(px,sig,events,band); m=metrics(x); o=open_gap_audit(x,px,events); ae=x.abs_track_error.dropna()
    print('BAND',band,
          'terminal',money(m['terminal']),'cagr',pct(m['cagr']),'mdd',pct(m['mdd']),'calmar',f"{m['calmar']:.3f}",
          'sides',x.attrs['total_sides'],'cost',money(x.attrs['total_cost']),'trade_days',x.attrs['trade_days'],
          'signal_resize_days',x.attrs['signal_resize_days'],'band_resize_days',x.attrs['band_resize_days'],'roll_days',x.attrs['roll_days'],
          'mae_x',f"{ae.mean():.4f}",'p95_x',f"{ae.quantile(.95):.4f}",'max_x',f"{ae.max():.4f}",
          'min_close',pct(x.broker_ratio.dropna().min()),'min_open',pct(o.open_ratio.min()),
          'interest',money(x.cum_interest.iloc[-1]))
print('V125_END')
