from pathlib import Path
import numpy as np
import pandas as pd

# Reuse corrected v1.19/v1.17 definitions without executing the top-level v1.19 run.
p=Path('research/backtest_v119_cash_yield.py')
s=p.read_text(encoding='utf-8')
prefix=s.split("print('V119_BEGIN')",1)[0]
ns={'__name__':'v119defs','__file__':str(p)}
exec(compile(prefix,str(p),'exec'),ns)

START=ns['START']; END=ns['END']; START_CAPITAL=ns['START_CAPITAL']
COMM=ns['COMM']; POINT=ns['POINT']; TAX=ns['TAX']
fetch_futures=ns['fetch_futures']; fetch_margin_events=ns['fetch_margin_events']; load_signal=ns['load_signal']
roll_map=ns['roll_map']; active_expiry=ns['active_expiry']; desired_contracts=ns['desired_contracts']; margin_state=ns['margin_state']

ANNUAL_YIELD=0.015
RESERVE_MULT=5.0
SLIP=1.0


def pct(v): return f'{100*v:.2f}%'
def money(v): return f'{v:,.0f}'


def run_split(px,sig,events,mode='monthly'):
    if mode not in ('monthly','daily'):
        raise ValueError(mode)
    price={(r.product,r.expiry,r.date):float(r.close) for r in px.itertuples()}
    low={(r.product,r.expiry,r.date):float(r.low) if pd.notna(r.low) else float(r.close) for r in px.itertuples()}
    rolls=roll_map(px); exps=sorted(rolls)
    tmf_rows=px[px['product']=='TMF']; tmf_first=tmf_rows['date'].min() if len(tmf_rows) else pd.Timestamp.max
    dates=sorted(set(px.loc[px['product']=='TX','date']) & set(sig.loc[(sig.index>=START)&(sig.index<=END)].index))

    fut_cash=START_CAPITAL
    external=0.0
    holdings={}; prev_close={}; last_target=2.0
    prev_date=None; prev_month=None
    cum_interest=0.0; transfer_count=0; transfer_gross=0.0
    rows=[]

    for d in dates:
        # External sleeve earns yield between trading dates; futures-account cash earns 0%.
        interest=0.0
        if prev_date is not None and external>0:
            gap=max((d-prev_date).days,0)
            interest=external*((1.0+ANNUAL_YIELD)**(gap/365.25)-1.0)
            external += interest
            cum_interest += interest

        # Position held during today's regular session is yesterday's close position.
        held=dict(holdings)
        fut_start=fut_cash
        pnl=0.0; intraday_pnl=0.0
        for (prod,exp),q in held.items():
            key=(prod,exp,d)
            if key not in price: raise RuntimeError(f'held close missing {key}')
            cur=price[key]; prv=prev_close[(prod,exp)]
            pnl += q*POINT[prod]*(cur-prv)
            intraday_pnl += q*POINT[prod]*(low[key]-prv)
        fut_cash += pnl
        intraday_fut_equity=fut_start+intraday_pnl

        # Frozen signal and combined-equity sizing.
        if d in sig.index: last_target=float(sig.loc[d,'target_x'])
        exp=active_expiry(d,rolls,exps)
        if exp is None: continue
        combined_pre_trade=fut_cash+external
        desired=desired_contracts(last_target,combined_pre_trade,d,exp,price,tmf_first)

        # Close / open / roll costs at regular-session close.
        allk=set(held)|set(desired); cost=0.0; sides=0
        for k in allk:
            old=held.get(k,0); new=desired.get(k,0); delta=new-old
            if delta==0: continue
            prod,ex=k; key=(prod,ex,d)
            if key not in price: raise RuntimeError(f'trade close missing {key}')
            n=abs(delta); notion=price[key]*POINT[prod]*n
            cost += n*COMM[prod] + notion*TAX + n*SLIP*POINT[prod]
            sides += n
        fut_cash -= cost
        holdings=desired
        prev_close={(prod,ex):price[(prod,ex,d)] for prod,ex in holdings}

        # Historical margin schedule for today's close and for the position held intraday.
        ms=margin_state(events,d); tx_i=float(ms['initial']); tx_m=float(ms['maint'])
        scale={'TX':1.0,'MTX':0.25,'TMF':0.05}
        im=sum(q*tx_i*scale[prod] for (prod,ex),q in holdings.items())
        mm=sum(q*tx_m*scale[prod] for (prod,ex),q in holdings.items())
        intraday_im=sum(q*tx_i*scale[prod] for (prod,ex),q in held.items())
        intraday_mm=sum(q*tx_m*scale[prod] for (prod,ex),q in held.items())

        # Cash management after the close.
        before_transfer_total=fut_cash+external
        reserve_target=RESERVE_MULT*im
        is_first_month_day=(prev_month is None or (d.year,d.month)!=prev_month)
        transfer=0.0  # positive = external -> futures, negative = futures -> external

        if im>0:
            if mode=='daily' or is_first_month_day:
                desired_fut=min(before_transfer_total,reserve_target)
                transfer=desired_fut-fut_cash
            else:  # monthly mode: no outward sweep except month boundary; emergency top-up is allowed
                if fut_cash<reserve_target:
                    transfer=min(external,reserve_target-fut_cash)
        # Clamp for numerical / liquidity consistency.
        if transfer>external: transfer=external
        if transfer<0 and -transfer>fut_cash: transfer=-fut_cash
        fut_cash += transfer
        external -= transfer
        if abs(transfer)>0.5:
            transfer_count += 1
            transfer_gross += abs(transfer)

        combined=fut_cash+external
        notional=sum(q*POINT[prod]*price[(prod,ex,d)] for (prod,ex),q in holdings.items())
        close_ratio=(fut_cash/im) if im>0 else np.nan
        intraday_ratio=(intraday_fut_equity/intraday_im) if intraday_im>0 else np.nan
        call_equiv=(mm/im) if im>0 else np.nan
        intraday_call_equiv=(intraday_mm/intraday_im) if intraday_im>0 else np.nan
        insufficient=(im>0 and close_ratio+1e-12<RESERVE_MULT)

        rows.append(dict(
            date=d, total_equity=combined, futures_equity=fut_cash, external_cash=external,
            pnl=pnl, interest=interest, cum_interest=cum_interest, cost=cost, sides=sides,
            target_x=last_target, realized_x=notional/combined if combined else np.nan, notional=notional,
            initial_margin=im, maint_margin=mm, broker_ratio=close_ratio, call_equiv_ratio=call_equiv,
            intraday_futures_equity=intraday_fut_equity, intraday_initial_margin=intraday_im,
            intraday_maint_margin=intraday_mm, intraday_broker_ratio=intraday_ratio,
            intraday_call_equiv_ratio=intraday_call_equiv,
            reserve_target=reserve_target, transfer=transfer, insufficient_reserve=insufficient,
            external_share=external/combined if combined else np.nan,
            TX=sum(q for (p,e),q in holdings.items() if p=='TX'),
            MTX=sum(q for (p,e),q in holdings.items() if p=='MTX'),
            TMF=sum(q for (p,e),q in holdings.items() if p=='TMF'), expiry=exp
        ))
        prev_date=d; prev_month=(d.year,d.month)

    z=pd.DataFrame(rows).set_index('date')
    z.attrs['transfer_count']=transfer_count
    z.attrs['transfer_gross']=transfer_gross
    return z


def metrics(x):
    eq=x.total_equity
    total=eq.iloc[-1]/START_CAPITAL-1
    days=max((eq.index[-1]-START).days,1)
    cagr=(eq.iloc[-1]/START_CAPITAL)**(365.25/days)-1
    eqs=pd.concat([pd.Series([START_CAPITAL],index=[START-pd.Timedelta(days=1)]),eq])
    dd=eqs/eqs.cummax()-1
    mdd=dd.min()
    return dict(terminal=float(eq.iloc[-1]),total=float(total),cagr=float(cagr),mdd=float(mdd),calmar=float(cagr/abs(mdd)))


def print_mode(name,x):
    m=metrics(x)
    bc=x.broker_ratio.dropna(); bi=x.intraday_broker_ratio.dropna()
    dclose=bc.idxmin(); dintra=bi.idxmin(); r=x.loc[dintra]
    print('MODE',name)
    print('terminal',money(m['terminal']),'total',pct(m['total']),'cagr',pct(m['cagr']),'mdd',pct(m['mdd']),'calmar',f"{m['calmar']:.2f}")
    print('interest',money(x.cum_interest.iloc[-1]),'avg_external_share',pct(x.external_share.mean()),'max_external_share',pct(x.external_share.max()))
    print('transfers',x.attrs['transfer_count'],'gross_transfer',money(x.attrs['transfer_gross']))
    print('min_close',pct(bc.min()),dclose.date(),'min_intraday',pct(bi.min()),dintra.date(),'insufficient_close_days',int(x.insufficient_reserve.sum()))
    print('worst_intraday_detail','date',dintra.date(),'fut_equity',money(r.intraday_futures_equity),'initial',money(r.intraday_initial_margin),
          'maint',money(r.intraday_maint_margin),'ratio',pct(r.intraday_broker_ratio),'call_equiv',pct(r.intraday_call_equiv_ratio),
          'holdings_close',int(r.TX),int(r.MTX),int(r.TMF),'target',r.target_x)
    for mult in [1.0,1.5,2.0]:
        close=bc/mult; intra=bi/mult
        # call-equivalent ratio is unchanged if initial and maintenance are scaled together.
        ce=x.call_equiv_ratio.reindex(close.index)
        cei=x.intraday_call_equiv_ratio.reindex(intra.index)
        print('shock',mult,'close_min',pct(close.min()),close.idxmin().date(),'intra_min',pct(intra.min()),intra.idxmin().date(),
              'close_below_call',int((close<ce).sum()),'intra_below_call',int((intra<cei).sum()),
              'intra_below_100',int((intra<1.0).sum()),'intra_below_200',int((intra<2.0).sum()),'intra_below_250',int((intra<2.5).sum()))
    return m


print('V121_BEGIN')
px=fetch_futures(); sig=load_signal(); events,missing=fetch_margin_events()
print('data_rows',len(px),'margin_events',len(events),'missing_margin_csv',len(missing))
print('annual_external_yield',ANNUAL_YIELD,'reserve_multiple',RESERVE_MULT,'slip',SLIP)

monthly=run_split(px,sig,events,'monthly')
daily=run_split(px,sig,events,'daily')
mm=print_mode('MONTHLY_PRIMARY',monthly)
dm=print_mode('DAILY_IDEAL',daily)

# Explicit key-date audit.
for d0 in [pd.Timestamp('2025-06-02'),pd.Timestamp('2025-06-03')]:
    if d0 in monthly.index:
        r=monthly.loc[d0]
        print('PRIMARY_DATE',d0.date(),'total',money(r.total_equity),'futures',money(r.futures_equity),'external',money(r.external_cash),
              'initial',money(r.initial_margin),'maint',money(r.maint_margin),'close_ratio',pct(r.broker_ratio),
              'intraday_ratio','nan' if pd.isna(r.intraday_broker_ratio) else pct(r.intraday_broker_ratio),
              'transfer',money(r.transfer),'TX/MTX/TMF',int(r.TX),int(r.MTX),int(r.TMF))

print('REFERENCE v117_zero_yield terminal=31,504,877 CAGR=44.01% MDD=-38.24% Calmar=1.15')
print('REFERENCE v119_all_free_cash_1.5pct terminal=35,290,991 CAGR=45.75% MDD=-37.89% Calmar=1.21')
print('REFERENCE 00685L terminal=31,700,514 CAGR=44.1% MDD=-36.8% Calmar=1.20')
print('PRIMARY_DELTA_VS_00685L terminal',money(mm['terminal']-31_700_514),'cagr_pp',f"{(mm['cagr']-.441)*100:.3f}")
print('DAILY_DELTA_VS_PRIMARY terminal',money(dm['terminal']-mm['terminal']),'cagr_pp',f"{(dm['cagr']-mm['cagr'])*100:.3f}")
print('DEFINITION close broker ratio = futures-account equity / required initial margin; external cash is excluded until transferred into the futures account.')
print('INTRADAY no transfers assumed; daily-low proxy uses the prior-close held position and is conservative, not tick-by-tick.')
print('V121_END')
