from pathlib import Path
import numpy as np
import pandas as pd

# Reuse v1.19 definitions without executing its top-level run block.
p=Path('research/backtest_v119_cash_yield.py')
s=p.read_text(encoding='utf-8')
prefix=s.split("print('V119_BEGIN')",1)[0]
ns={'__name__':'v119defs','__file__':str(p)}
exec(compile(prefix,str(p),'exec'),ns)

START=ns['START']; END=ns['END']; START_CAPITAL=ns['START_CAPITAL']
fetch_futures=ns['fetch_futures']; fetch_margin_events=ns['fetch_margin_events']; load_signal=ns['load_signal']
run_cash=ns['run_cash']; margin_state=ns['margin_state']


def pct(v): return f'{100*v:.2f}%'
def money(v): return f'{v:,.0f}'


def add_broker_ratios(x, events):
    z=x.copy()
    # Broker-style account ratio used here: equity / initial margin.
    z['broker_ratio']=np.where(z.initial_margin>0, z.equity/z.initial_margin, np.nan)
    z['call_equiv_ratio']=np.where(z.initial_margin>0, z.maint_margin/z.initial_margin, np.nan)

    # Intraday proxy must use the position held during the session (yesterday's closing position),
    # not the new position selected at today's close. Margin amount uses today's historical schedule.
    prev_tx=z.TX.shift(1).fillna(0.0)
    prev_mtx=z.MTX.shift(1).fillna(0.0)
    prev_tmf=z.TMF.shift(1).fillna(0.0)
    intraday_initial=[]; intraday_maint=[]
    for d,tx,mtx,tmf in zip(z.index,prev_tx,prev_mtx,prev_tmf):
        ms=margin_state(events,d)
        ti=float(ms['initial']); tm=float(ms['maint'])
        intraday_initial.append(ti*(tx + 0.25*mtx + 0.05*tmf))
        intraday_maint.append(tm*(tx + 0.25*mtx + 0.05*tmf))
    z['intraday_initial_margin']=intraday_initial
    z['intraday_maint_margin']=intraday_maint
    z['intraday_broker_ratio']=np.where(z.intraday_initial_margin>0, z.intraday_equity_floor/z.intraday_initial_margin, np.nan)
    z['intraday_call_equiv_ratio']=np.where(z.intraday_initial_margin>0, z.intraday_maint_margin/z.intraday_initial_margin, np.nan)
    return z


print('V120_BEGIN')
px=fetch_futures(); sig=load_signal(); events,missing=fetch_margin_events()
print('data_rows',len(px),'margin_events',len(events),'missing_margin_csv',len(missing))

rates=[0.0,0.015,0.02,0.03]
res={}
for r in rates:
    print('RUN_YIELD',r)
    res[r]=add_broker_ratios(run_cash(px,sig,events,r,1.0),events)

print('BROKER_RATIO_MAIN')
print('|Yield|Min close broker ratio|Date|Min intraday-low proxy|Date|Min call-equivalent ratio|2x shock min close|2x shock min intraday|')
print('|---:|---:|---|---:|---|---:|---:|---:|')
for r,x in res.items():
    bc=x.broker_ratio.dropna(); bi=x.intraday_broker_ratio.dropna(); ce=x.call_equiv_ratio.dropna()
    d1=bc.idxmin(); d2=bi.idxmin()
    print(f'|{100*r:.1f}%|{pct(bc.min())}|{d1.date()}|{pct(bi.min())}|{d2.date()}|{pct(ce.min())}|{pct((bc/2).min())}|{pct((bi/2).min())}|')

print('BASE_0_DETAIL')
x=res[0.0]; d=x.broker_ratio.idxmin(); q=x.loc[d]
print('min_close date',d.date(),'broker_ratio',pct(q.broker_ratio),'equity',money(q.equity),'initial',money(q.initial_margin),'maint',money(q.maint_margin),'call_equiv',pct(q.call_equiv_ratio),'holdings',int(q.TX),int(q.MTX),int(q.TMF),'target',q.target_x,'expiry',q.expiry)
di=x.intraday_broker_ratio.idxmin(); qi=x.loc[di]
print('min_intraday date',di.date(),'ratio',pct(qi.intraday_broker_ratio),'intraday_equity_floor',money(qi.intraday_equity_floor),'prior_position_initial',money(qi.intraday_initial_margin),'prior_position_maint',money(qi.intraday_maint_margin),'call_equiv',pct(qi.intraday_call_equiv_ratio))

print('YIELD_15_DETAIL')
x=res[0.015]; d=x.broker_ratio.idxmin(); q=x.loc[d]
print('min_close date',d.date(),'broker_ratio',pct(q.broker_ratio),'equity',money(q.equity),'initial',money(q.initial_margin),'maint',money(q.maint_margin),'call_equiv',pct(q.call_equiv_ratio),'holdings',int(q.TX),int(q.MTX),int(q.TMF),'target',q.target_x,'expiry',q.expiry)
di=x.intraday_broker_ratio.idxmin(); qi=x.loc[di]
print('min_intraday date',di.date(),'ratio',pct(qi.intraday_broker_ratio),'intraday_equity_floor',money(qi.intraday_equity_floor),'prior_position_initial',money(qi.intraday_initial_margin),'prior_position_maint',money(qi.intraday_maint_margin),'call_equiv',pct(qi.intraday_call_equiv_ratio))

# Explicit 2025-06-02 reconciliation when present.
for r in [0.0,0.015]:
    x=res[r]; d=pd.Timestamp('2025-06-02')
    if d in x.index:
        q=x.loc[d]
        print('DATE_2025_06_02','yield',r,'equity',money(q.equity),'initial',money(q.initial_margin),'maint',money(q.maint_margin),'broker_ratio',pct(q.broker_ratio),'call_equiv',pct(q.call_equiv_ratio),'holdings',int(q.TX),int(q.MTX),int(q.TMF))

print('SHOCK_DETAIL_YIELD_15')
x=res[0.015]
for mult in [1.0,1.5,2.0]:
    close=x.broker_ratio/mult
    intra=x.intraday_broker_ratio/mult
    print('shock',mult,'min_close',pct(close.min()),'date',close.idxmin().date(),'min_intraday',pct(intra.min()),'date',intra.idxmin().date(),
          'days_close_below_call_equiv',int((close < x.call_equiv_ratio).sum()),
          'days_close_below_100',int((close<1.0).sum()),'days_close_below_25',int((close<0.25).sum()))

print('DEFINITION broker_ratio = account equity / required initial margin. call_equiv_ratio = maintenance margin / initial margin; these are separate from any broker risk-indicator liquidation formula.')
print('INTRADAY proxy uses the simultaneous daily low of held contracts and the prior-close position; this is conservative and is not tick-by-tick reconstruction.')
print('V120_END')
