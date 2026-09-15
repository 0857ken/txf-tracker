import itertools
import numpy as np
import pandas as pd
import yfinance as yf

START='2015-01-01'; END='2026-09-16'; LISTING=pd.Timestamp('2017-03-30')
FASTS=[8,10,12]; SLOWS=[18,20,22]; LAGS=[1,2,3]
FRICTIONS={
    'gross': dict(comm=0.0,tax=0.0,slip=0.0),
    'low': dict(comm=0.0003,tax=0.0010,slip=0.0002),
    'base': dict(comm=0.0005,tax=0.0010,slip=0.0003),
    'conservative': dict(comm=0.001425,tax=0.0010,slip=0.0005),
}


def dl(t):
    x=yf.download(t,start=START,end=END,auto_adjust=True,actions=False,progress=False,threads=False)
    if x.empty: raise RuntimeError(t)
    if isinstance(x.columns,pd.MultiIndex): x.columns=x.columns.get_level_values(0)
    x.columns=[c.lower() for c in x.columns]
    x.index=pd.to_datetime(x.index).tz_localize(None)
    return x.sort_index()


def add_sig(df):
    o=df.copy()
    for n in sorted(set(FASTS+SLOWS+[60])):
        o[f'ma{n}']=o['close'].rolling(n).mean()
    o['ma60_20ago']=o['ma60'].shift(20)
    o['bear']=(o['close']<=o['ma60'])&(o['ma60']<=o['ma60_20ago'])
    return o


def target(sig,fast,slow):
    vals=[]
    for _,r in sig.iterrows():
        bear=bool(r['bear']) if pd.notna(r['bear']) else False
        px=float(r['close'])
        if not bear:
            t=1.0
        else:
            t=.25
            if pd.notna(r[f'ma{fast}']) and px>r[f'ma{fast}']:
                t=.50
            if pd.notna(r[f'ma{slow}']) and px>r[f'ma{slow}']:
                t=.75
        vals.append(t)
    return pd.Series(vals,index=sig.index,dtype=float)


def run(sig,asset,fast=10,slow=20,lag=1,fr='gross'):
    tar=target(sig,fast,slow).rename('target')
    m=pd.concat([tar,asset['close'].rename('asset')],axis=1,join='inner').dropna()
    pos=m['target'].shift(lag).fillna(0.0)
    ar=m['asset'].pct_change().fillna(0.0)
    delta=pos-pos.shift(1).fillna(0.0)
    f=FRICTIONS[fr]
    turnover=delta.abs()
    sells=(-delta).clip(lower=0.0)
    cost=turnover*(f['comm']+f['slip']) + sells*f['tax']
    ret=pos*ar-cost
    return pd.DataFrame({'ret':ret,'gross_ret':pos*ar,'cost':cost,'pos':pos,'delta':delta,'asset_ret':ar})


def metrics(df):
    r=df['ret'].dropna(); eq=(1+r).cumprod()
    if len(eq)<2: return dict(total=np.nan,cagr=np.nan,mdd=np.nan,calmar=np.nan,turnover=np.nan,switches=np.nan,cost_drag=np.nan,avgpos=np.nan)
    total=float(eq.iloc[-1]-1); days=max((eq.index[-1]-eq.index[0]).days,1)
    cagr=float(eq.iloc[-1]**(365.25/days)-1); dd=eq/eq.cummax()-1; mdd=float(dd.min())
    return dict(total=total,cagr=cagr,mdd=mdd,calmar=cagr/abs(mdd) if mdd<0 else np.nan,
                turnover=float(df['delta'].abs().sum()),switches=int((df['delta'].abs()>1e-12).sum()),
                cost_drag=float(df['cost'].sum()),avgpos=float(df['pos'].mean()))


def cut(df,st,en=None):
    x=df[df.index>=pd.Timestamp(st)]
    if en is not None: x=x[x.index<=pd.Timestamp(en)]
    return x


def p(x): return f'{x*100:.1f}%'

S=add_sig(dl('0050.TW')); L=dl('00685L.TW')
end=min(S.index.max(),L.index.max())
S=S[(S.index>=LISTING)&(S.index<=end)]; L=L[(L.index>=LISTING)&(L.index<=end)]

print('V113_BEGIN')
print(f'data {LISTING.date()} to {end.date()}')
print('FROZEN signal=0050, central rule MA10/MA20; traded asset=00685L')
print('FRICTIONS low=(0.03% commission,0.10% sell tax,0.02% slip); base=(0.05%,0.10%,0.03%); conservative=(0.1425%,0.10%,0.05%)')

print('CENTER_FRICTION')
print('|Scenario|Total|CAGR|MDD|Calmar|Turnover x capital|Switches|Sum modeled costs|Avg alloc|')
print('|---|---:|---:|---:|---:|---:|---:|---:|---:|')
center={}
for fr in ['gross','low','base','conservative']:
    d=run(S,L,10,20,1,fr); m=metrics(d); center[fr]=(d,m)
    print(f"|{fr}|{p(m['total'])}|{p(m['cagr'])}|{p(m['mdd'])}|{m['calmar']:.2f}|{m['turnover']:.2f}|{m['switches']}|{p(m['cost_drag'])}|{m['avgpos']:.3f}|")

print('MA_GRID_BASE_LAG1')
print('|Fast/Slow|Total|CAGR|MDD|Calmar|Turnover|Switches|')
print('|---|---:|---:|---:|---:|---:|---:|')
grid=[]
for fa,sl in itertools.product(FASTS,SLOWS):
    d=run(S,L,fa,sl,1,'base'); m=metrics(d); grid.append((fa,sl,m))
    print(f"|MA{fa}/MA{sl}|{p(m['total'])}|{p(m['cagr'])}|{p(m['mdd'])}|{m['calmar']:.2f}|{m['turnover']:.2f}|{m['switches']}|")

print('CENTER_DELAY_BASE')
print('|Lag trading days|Total|CAGR|MDD|Calmar|Turnover|Switches|')
print('|---:|---:|---:|---:|---:|---:|---:|')
delays={}
for lag in LAGS:
    d=run(S,L,10,20,lag,'base'); m=metrics(d); delays[lag]=(d,m)
    print(f"|{lag}|{p(m['total'])}|{p(m['cagr'])}|{p(m['mdd'])}|{m['calmar']:.2f}|{m['turnover']:.2f}|{m['switches']}|")

print('STRESS_CENTER_BASE_LAG1')
print('|Window|Total|MDD|00685L B&H Total|00685L B&H MDD|')
print('|---|---:|---:|---:|---:|')
cb=center['base'][0]
bh=pd.DataFrame({'ret':L['close'].pct_change().fillna(0.0),'delta':0.0,'cost':0.0,'pos':1.0})
for nm,st,en in [('2018','2018-01-01','2018-12-31'),('COVID2020','2020-01-01','2020-12-31'),('2022','2022-01-01','2022-12-31'),('2023-24','2023-01-01','2024-12-31'),('2025-26','2025-01-01',str(end.date()))]:
    a=metrics(cut(cb,st,en)); b=metrics(cut(bh,st,en))
    print(f"|{nm}|{p(a['total'])}|{p(a['mdd'])}|{p(b['total'])}|{p(b['mdd'])}|")

# Pre-registered gate
cons=center['conservative'][1]
base_good=sum(1 for _,_,m in grid if m['cagr']>=.38 and m['mdd']>=-.40)
base_bad=sum(1 for _,_,m in grid if m['cagr']<.30 or m['mdd']<-.45)
lag2=delays[2][1]
crit1=cons['cagr']>=.35 and cons['mdd']>=-.40
crit2=base_good>=7
crit3=lag2['cagr']>=.35 and lag2['mdd']>=-.42
crit4=base_bad==0
print('PREREGISTERED_GATE')
print(f'C1 conservative center CAGR>=35 and MDD<=40: {crit1} actual={p(cons["cagr"])},{p(cons["mdd"])}')
print(f'C2 >=7/9 neighbor combos base lag1 CAGR>=38 and MDD<=40: {crit2} actual={base_good}/9')
print(f'C3 center base lag2 CAGR>=35 and MDD<=42: {crit3} actual={p(lag2["cagr"])},{p(lag2["mdd"])}')
print(f'C4 no neighbor combo base lag1 CAGR<30 or MDD>45: {crit4} bad={base_bad}')
print(f'OVERALL_PASS={crit1 and crit2 and crit3 and crit4}')

# summary distribution
cagrs=np.array([m['cagr'] for _,_,m in grid]); mdds=np.array([m['mdd'] for _,_,m in grid]); cals=np.array([m['calmar'] for _,_,m in grid])
print('GRID_SUMMARY')
print(f'CAGR min/median/max {p(cagrs.min())}/{p(np.median(cagrs))}/{p(cagrs.max())}')
print(f'MDD best/median/worst {p(mdds.max())}/{p(np.median(mdds))}/{p(mdds.min())}')
print(f'Calmar min/median/max {cals.min():.2f}/{np.median(cals):.2f}/{cals.max():.2f}')
print('V113_END')
