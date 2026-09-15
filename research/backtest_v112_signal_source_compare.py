import numpy as np
import pandas as pd
import yfinance as yf

START='2015-01-01'; END='2026-09-17'; LISTING=pd.Timestamp('2017-03-30')


def dl(t):
    x=yf.download(t,start=START,end=END,auto_adjust=True,actions=False,progress=False,threads=False)
    if x.empty: raise RuntimeError(f'empty {t}')
    if isinstance(x.columns,pd.MultiIndex): x.columns=x.columns.get_level_values(0)
    x.columns=[c.lower() for c in x.columns]
    x.index=pd.to_datetime(x.index).tz_localize(None)
    return x.sort_index()


def add_signals(df):
    o=df.copy()
    for n in (10,20,60): o[f'ma{n}']=o['close'].rolling(n).mean()
    o['ma60_20ago']=o['ma60'].shift(20)
    o['bear']=(o['close']<=o['ma60']) & (o['ma60']<=o['ma60_20ago'])
    return o


def target(sig):
    # Frozen rule from v1.10/v1.11:
    # non-bear 100%; confirmed bear 25%; still bear >MA10 => 50%; >MA20 => 75%.
    out=[]
    for _,r in sig.iterrows():
        bear=bool(r['bear']) if pd.notna(r['bear']) else False
        if not bear:
            out.append(1.0); continue
        t=.25
        if pd.notna(r['ma10']) and r['close']>r['ma10']: t=.50
        if pd.notna(r['ma20']) and r['close']>r['ma20']: t=.75
        out.append(t)
    return pd.Series(out,index=sig.index,dtype=float)


def strat_returns(sig, asset):
    t=target(sig)
    m=pd.concat([t.rename('target'),asset['close'].rename('asset')],axis=1,join='inner').dropna()
    # close t signal -> next trading day's return exposure
    pos=m['target'].shift(1).fillna(0.0)
    r=m['asset'].pct_change().fillna(0.0)
    return pos*r, pos, t.loc[m.index]


def met(r):
    r=r.dropna(); eq=(1+r).cumprod()
    if len(eq)<2: return dict(total=np.nan,cagr=np.nan,mdd=np.nan,calmar=np.nan)
    total=float(eq.iloc[-1]-1)
    days=max((eq.index[-1]-eq.index[0]).days,1)
    cagr=float(eq.iloc[-1]**(365.25/days)-1)
    dd=eq/eq.cummax()-1; mdd=float(dd.min())
    return dict(total=total,cagr=cagr,mdd=mdd,calmar=cagr/abs(mdd) if mdd<0 else np.nan)


def cut(r,st,en=None):
    x=r[r.index>=pd.Timestamp(st)]
    if en is not None: x=x[x.index<=pd.Timestamp(en)]
    return x


def p(x): return f'{x*100:.1f}%'

S50=add_signals(dl('0050.TW'))
STW=add_signals(dl('^TWII'))
L=dl('00685L.TW')
end=min(S50.index.max(),STW.index.max(),L.index.max())
start=LISTING
S50=S50[(S50.index>=start)&(S50.index<=end)]
STW=STW[(STW.index>=start)&(STW.index<=end)]
L=L[(L.index>=start)&(L.index<=end)]

r50,pos50,t50=strat_returns(S50,L)
rTW,posTW,tTW=strat_returns(STW,L)
bh=L['close'].pct_change().fillna(0.0)

# Align for direct state comparison.
state=pd.concat([t50.rename('0050'),tTW.rename('TAIEX')],axis=1,join='inner').dropna()
state_diff=(state['0050']!=state['TAIEX'])
alloc_gap=(state['0050']-state['TAIEX']).abs()

# confirmed-bear disagreement only
bears=pd.concat([S50['bear'].rename('0050_bear'),STW['bear'].rename('TAIEX_bear')],axis=1,join='inner').dropna()
bear_diff=(bears['0050_bear']!=bears['TAIEX_bear'])

# state switch counts
sw50=int((state['0050']!=state['0050'].shift(1)).sum()-1)
swTW=int((state['TAIEX']!=state['TAIEX'].shift(1)).sum()-1)

# day-level return comparison: how often one strategy wins on days allocations differ
common=pd.concat([r50.rename('r50'),rTW.rename('rTW')],axis=1,join='inner').dropna()
diff_days=state_diff.reindex(common.index).fillna(False)
win50=int((common.loc[diff_days,'r50']>common.loc[diff_days,'rTW']).sum())
winTW=int((common.loc[diff_days,'rTW']>common.loc[diff_days,'r50']).sum())
ties=int((common.loc[diff_days,'rTW']==common.loc[diff_days,'r50']).sum())

print('V112_BEGIN')
print(f'data {start.date()} to {end.date()}')
print('SAME_FROZEN_RULE: non-bear=100%; bear=25%; bear+close>MA10=50%; bear+close>MA20=75%; signal lag 1 day; traded asset=00685L adjusted close returns')
print('MAIN')
print('|Signal source|Total|CAGR|MDD|Calmar|Avg alloc|State switches|')
print('|---|---:|---:|---:|---:|---:|---:|')
for name,r,pos in [('0050',r50,pos50),('TAIEX',rTW,posTW),('00685L B&H',bh,pd.Series(1.0,index=bh.index))]:
    m=met(r); sw='-' if name=='00685L B&H' else str(sw50 if name=='0050' else swTW)
    print(f'|{name}|{p(m["total"])}|{p(m["cagr"])}|{p(m["mdd"])}|{m["calmar"]:.2f}|{pos.mean():.3f}|{sw}|')

print('WINDOWS')
print('|Window|0050 Total|0050 MDD|TAIEX Total|TAIEX MDD|00685L Total|00685L MDD|')
print('|---|---:|---:|---:|---:|---:|---:|')
windows=[('2018','2018-01-01','2018-12-31'),('COVID2020','2020-01-01','2020-12-31'),('2022','2022-01-01','2022-12-31'),('2023-24','2023-01-01','2024-12-31'),('2025-26','2025-01-01',str(end.date()))]
for nm,st,en in windows:
    a=met(cut(r50,st,en)); b=met(cut(rTW,st,en)); c=met(cut(bh,st,en))
    print(f'|{nm}|{p(a["total"])}|{p(a["mdd"])}|{p(b["total"])}|{p(b["mdd"])}|{p(c["total"])}|{p(c["mdd"])}|')

print('ROLLING_END_WINDOWS')
print('|Window|0050 Total|0050 CAGR|0050 MDD|TAIEX Total|TAIEX CAGR|TAIEX MDD|')
print('|---|---:|---:|---:|---:|---:|---:|')
for yrs in (3,5):
    st=end-pd.DateOffset(years=yrs)
    a=met(cut(r50,st,end)); b=met(cut(rTW,st,end))
    print(f'|{yrs}Y|{p(a["total"])}|{p(a["cagr"])}|{p(a["mdd"])}|{p(b["total"])}|{p(b["cagr"])}|{p(b["mdd"])}|')

print('SIGNAL_DIFFERENCE')
print(f'state_diff_days={int(state_diff.sum())} of {len(state)} ({state_diff.mean()*100:.2f}%)')
print(f'bear_diff_days={int(bear_diff.sum())} of {len(bears)} ({bear_diff.mean()*100:.2f}%)')
print(f'mean_abs_allocation_gap={alloc_gap.mean()*100:.2f} percentage_points')
print(f'on_state_diff_days_daily_return_wins: 0050={win50}, TAIEX={winTW}, ties={ties}')

# Largest cumulative divergence dates and current state
q=pd.DataFrame({'0050_eq':(1+r50).cumprod(),'TAIEX_eq':(1+rTW).cumprod()}).dropna()
q['ratio']=q['TAIEX_eq']/q['0050_eq']
mx=q['ratio'].idxmax(); mn=q['ratio'].idxmin()
print(f'max_TAIEX_vs_0050_equity_ratio {mx.date()} {q.loc[mx,"ratio"]:.4f}')
print(f'min_TAIEX_vs_0050_equity_ratio {mn.date()} {q.loc[mn,"ratio"]:.4f}')
print(f'CURRENT {end.date()} 0050_target={t50.loc[:end].iloc[-1]:.2f} TAIEX_target={tTW.loc[:end].iloc[-1]:.2f}')
print('V112_END')
