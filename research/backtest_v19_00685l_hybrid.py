import numpy as np
import pandas as pd
import yfinance as yf

START='2015-01-01'; END='2026-09-16'
LISTING=pd.Timestamp('2017-03-30')
THRESHOLDS=[(0.03,0.06,0.09),(0.05,0.10,0.15),(0.06,0.09,0.12),(0.08,0.12,0.16)]
BEAR_CUTS=[0.0,0.25,0.50]


def dl(t):
    x=yf.download(t,start=START,end=END,auto_adjust=True,actions=False,progress=False,threads=False)
    if x.empty: raise RuntimeError(t)
    if isinstance(x.columns,pd.MultiIndex): x.columns=x.columns.get_level_values(0)
    x.columns=[c.lower() for c in x.columns]
    x.index=pd.to_datetime(x.index).tz_localize(None)
    return x.sort_index()


def add_sig(df):
    o=df.copy()
    o['ma60']=o['close'].rolling(60).mean()
    o['ma60_20ago']=o['ma60'].shift(20)
    o['high60']=o['high'].rolling(60).max()
    o['bear']=(o['close']<=o['ma60']) & (o['ma60']<=o['ma60_20ago'])
    return o


def tactical_target(sig, bear_cut, ths=None):
    # 100% 00685L while not confirmed bear.
    # On first confirmed-bear close, cut to bear_cut and freeze prior 60d high as anchor.
    # During bear, scale back to at least 25/50/100% when 0050 drawdown hits thresholds.
    out=[]; anchor=None; prev_bear=False; pos=1.0
    for _,r in sig.iterrows():
        bear=bool(r['bear']) if pd.notna(r['bear']) else False
        if bear and not prev_bear:
            anchor=float(r['high60']) if pd.notna(r['high60']) else float(r['close'])
            pos=float(bear_cut)
        elif not bear:
            anchor=None
            pos=1.0
        if bear and anchor is not None and ths is not None:
            dd=float(r['close'])/anchor-1.0
            if dd<=-ths[0]: pos=max(pos,0.25)
            if dd<=-ths[1]: pos=max(pos,0.50)
            if dd<=-ths[2]: pos=max(pos,1.00)
        out.append(pos)
        prev_bear=bear
    return pd.Series(out,index=sig.index,dtype=float)


def equity_from_target(sig, asset, target):
    m=pd.concat([target.rename('target'),asset['open'].rename('open')],axis=1,join='inner').dropna()
    # signal at close t -> position effective next open
    pos=m['target'].shift(1).fillna(0.0)
    fwd=m['open'].shift(-1)/m['open']-1.0
    r=(pos*fwd).dropna()
    return (1.0+r).cumprod(), pos.loc[r.index]


def bh_open(asset):
    o=asset['open'].dropna()
    r=(o.shift(-1)/o-1.0).dropna()
    return (1+r).cumprod()


def c_base(df):
    tmp=df.copy(); tmp['month_run_high']=tmp.groupby(tmp.index.to_period('M'))['high'].cummax()
    pos=0.; anchor=None; u2=u3=False; vals=[]
    for _,r in tmp.iterrows():
        px=float(r['close']); rh=r['month_run_high']
        if pos>0 and anchor is not None and px>=anchor:
            pos=0.; anchor=None; u2=u3=False
        else:
            if pos==0 and pd.notna(rh) and px<=float(rh)*.97:
                anchor=float(rh); pos=.2
            if pos>0 and anchor is not None:
                if not u2 and px<=anchor*.94: pos+=.3; u2=True
                if not u3 and px<=anchor*.91: pos+=.5; u3=True
                pos=min(pos,1.)
        vals.append(pos)
    return pd.Series(vals,index=tmp.index,dtype=float)


def c_mult(df):
    vals=[]
    for _,r in df.iterrows():
        if pd.isna(r['ma60']) or pd.isna(r['ma60_20ago']): vals.append(.25); continue
        a=r['close']>r['ma60']; b=r['ma60']>r['ma60_20ago']
        vals.append(.25 if (not a and not b) else 3.0)
    return pd.Series(vals,index=df.index,dtype=float)


def c_on_taiex(sig, tx):
    target=c_base(sig)*c_mult(sig)
    return equity_from_target(sig,tx,target)[0]


def met(eq):
    eq=eq.dropna()
    if len(eq)<2: return dict(total=np.nan,cagr=np.nan,mdd=np.nan,calmar=np.nan)
    total=float(eq.iloc[-1]-1)
    days=max((eq.index[-1]-eq.index[0]).days,1)
    cagr=float(eq.iloc[-1]**(365.25/days)-1)
    dd=eq/eq.cummax()-1
    mdd=float(dd.min())
    calmar=cagr/abs(mdd) if mdd<0 else np.nan
    return dict(total=total,cagr=cagr,mdd=mdd,calmar=calmar)


def sub(eq,start,end=None):
    x=eq[eq.index>=pd.Timestamp(start)]
    if end is not None: x=x[x.index<=pd.Timestamp(end)]
    if x.empty: return x
    return x/x.iloc[0]


def p(x): return f'{x*100:.1f}%'

S=add_sig(dl('0050.TW')); L=dl('00685L.TW'); T=dl('^TWII')
end=min(S.index.max(),L.index.max(),T.index.max())
S=S[(S.index>=LISTING)&(S.index<=end)]
L=L[(L.index>=LISTING)&(L.index<=end)]
T=T[(T.index>=LISTING)&(T.index<=end)]

results=[]
# trend-cut-only baselines
for cut in BEAR_CUTS:
    target=tactical_target(S,cut,None)
    eq,pos=equity_from_target(S,L,target)
    m=met(eq)
    results.append(dict(name=f'cut{cut:.2f}_no_rebuy',cut=cut,ths=None,eq=eq,pos=pos,**m))
# staged re-entry variants
for cut in BEAR_CUTS:
    for th in THRESHOLDS:
        target=tactical_target(S,cut,th)
        eq,pos=equity_from_target(S,L,target)
        m=met(eq)
        results.append(dict(name=f'cut{cut:.2f}_{int(th[0]*100)}-{int(th[1]*100)}-{int(th[2]*100)}',cut=cut,ths=th,eq=eq,pos=pos,**m))

# rank by Calmar among MDD <= 40%, then CAGR
feasible=[r for r in results if r['mdd']>=-0.40]
feasible=sorted(feasible,key=lambda r:(r['calmar'],r['cagr']),reverse=True)
allret=sorted(results,key=lambda r:r['cagr'],reverse=True)

bh=bh_open(L); c=c_on_taiex(S,T); taiex=bh_open(T)

print('V19_BEGIN')
print(f'end={end.date()} variants={len(results)} feasible_mdd40={len(feasible)}')
print('TOP_FEASIBLE_BY_CALMAR')
print('|Rank|Rule|Total|CAGR|MDD|Calmar|5Y Total|5Y MDD|3Y Total|3Y MDD|Avg 685 alloc|')
print('|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|')
for i,r in enumerate(feasible[:10],1):
    m5=met(sub(r['eq'],end-pd.DateOffset(years=5))); m3=met(sub(r['eq'],end-pd.DateOffset(years=3)))
    av=float(r['pos'].mean())
    print(f"|{i}|{r['name']}|{p(r['total'])}|{p(r['cagr'])}|{p(r['mdd'])}|{r['calmar']:.2f}|{p(m5['total'])}|{p(m5['mdd'])}|{p(m3['total'])}|{p(m3['mdd'])}|{av:.2f}|")

print('BENCHMARKS_SINCE_LISTING')
print('|Strategy|Total|CAGR|MDD|Calmar|')
print('|---|---:|---:|---:|---:|')
for name,eq in [('00685L buy&hold',bh),('Current C 3/3/0.25 -> TAIEX',c),('TAIEX 1x',taiex)]:
    m=met(eq); print(f"|{name}|{p(m['total'])}|{p(m['cagr'])}|{p(m['mdd'])}|{m['calmar']:.2f}|")

# Stress top candidate
if feasible:
    best=feasible[0]
    print(f"BEST_RULE {best['name']}")
    print('STRESS_BEST_VS_685')
    print('|Window|Hybrid Total|Hybrid MDD|00685L Total|00685L MDD|')
    print('|---|---:|---:|---:|---:|')
    windows=[('2018','2018-01-01','2018-12-31'),('COVID2020','2020-01-01','2020-12-31'),('2022','2022-01-01','2022-12-31'),('2025-26','2025-01-01',str(end.date()))]
    for nm,st,en in windows:
        mh=met(sub(best['eq'],st,en)); mb=met(sub(bh,st,en))
        print(f"|{nm}|{p(mh['total'])}|{p(mh['mdd'])}|{p(mb['total'])}|{p(mb['mdd'])}|")

print('TOP_RAW_CAGR')
for r in allret[:5]: print(r['name'],p(r['cagr']),p(r['mdd']),f"cal={r['calmar']:.2f}")
print('V19_END')
