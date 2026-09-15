import numpy as np
import pandas as pd
import yfinance as yf

START='2015-01-01'; END='2026-09-16'; LISTING=pd.Timestamp('2017-03-30')


def dl(t):
    x=yf.download(t,start=START,end=END,auto_adjust=True,actions=False,progress=False,threads=False)
    if x.empty: raise RuntimeError(t)
    if isinstance(x.columns,pd.MultiIndex): x.columns=x.columns.get_level_values(0)
    x.columns=[c.lower() for c in x.columns]
    x.index=pd.to_datetime(x.index).tz_localize(None)
    return x.sort_index()


def add_sig(df):
    o=df.copy()
    for n in (10,20,30,60): o[f'ma{n}']=o['close'].rolling(n).mean()
    o['ma60_20ago']=o['ma60'].shift(20)
    o['bear']=(o['close']<=o['ma60']) & (o['ma60']<=o['ma60_20ago'])
    return o


def target_rule(sig,name):
    vals=[]; prev_bear=False; low=None
    for _,r in sig.iterrows():
        bear=bool(r['bear']) if pd.notna(r['bear']) else False
        px=float(r['close'])
        if not bear:
            vals.append(1.0); prev_bear=False; low=None; continue
        if not prev_bear or low is None: low=px
        else: low=min(low,px)
        rebound=px/low-1.0 if low else 0.0
        t=.25
        if name=='base_25':
            pass
        elif name=='ma10_50':
            if pd.notna(r['ma10']) and px>r['ma10']: t=.50
        elif name=='ma20_50':
            if pd.notna(r['ma20']) and px>r['ma20']: t=.50
        elif name=='ma30_50':
            if pd.notna(r['ma30']) and px>r['ma30']: t=.50
        elif name=='rebound3_50':
            if rebound>=.03: t=.50
        elif name=='rebound5_50':
            if rebound>=.05: t=.50
        elif name=='rebound8_50':
            if rebound>=.08: t=.50
        elif name=='rebound10_50':
            if rebound>=.10: t=.50
        elif name=='r5_and_ma20_50':
            if rebound>=.05 and pd.notna(r['ma20']) and px>r['ma20']: t=.50
        elif name=='r5_or_ma20_50':
            if rebound>=.05 or (pd.notna(r['ma20']) and px>r['ma20']): t=.50
        elif name=='ma10_50_ma20_75':
            if pd.notna(r['ma10']) and px>r['ma10']: t=.50
            if pd.notna(r['ma20']) and px>r['ma20']: t=.75
        elif name=='r5_50_ma20_75':
            if rebound>=.05: t=.50
            if rebound>=.05 and pd.notna(r['ma20']) and px>r['ma20']: t=.75
        elif name=='r5_50_r8_75':
            if rebound>=.05: t=.50
            if rebound>=.08: t=.75
        else:
            raise ValueError(name)
        vals.append(t); prev_bear=True
    return pd.Series(vals,index=sig.index,dtype=float)


def equity(sig,asset,target):
    m=pd.concat([target.rename('target'),asset['close'].rename('asset')],axis=1,join='inner').dropna()
    pos=m['target'].shift(1).fillna(0.0)
    ret=m['asset'].pct_change().fillna(0.0)
    r=pos*ret
    return (1+r).cumprod(),pos


def bh(asset):
    c=asset['close'].dropna(); return (1+c.pct_change().fillna(0)).cumprod()


def met(eq):
    eq=eq.dropna()
    if len(eq)<2:return dict(total=np.nan,cagr=np.nan,mdd=np.nan,calmar=np.nan)
    total=float(eq.iloc[-1]/eq.iloc[0]-1)
    days=max((eq.index[-1]-eq.index[0]).days,1)
    cagr=float((eq.iloc[-1]/eq.iloc[0])**(365.25/days)-1)
    dd=eq/eq.cummax()-1; mdd=float(dd.min())
    calmar=cagr/abs(mdd) if mdd<0 else np.nan
    return dict(total=total,cagr=cagr,mdd=mdd,calmar=calmar)


def sub(eq,start,end=None):
    x=eq[eq.index>=pd.Timestamp(start)]
    if end is not None:x=x[x.index<=pd.Timestamp(end)]
    return x/x.iloc[0] if len(x) else x


def p(x): return f'{x*100:.1f}%'

S=add_sig(dl('0050.TW')); L=dl('00685L.TW')
end=min(S.index.max(),L.index.max())
S=S[(S.index>=LISTING)&(S.index<=end)]; L=L[(L.index>=LISTING)&(L.index<=end)]
NAMES=['base_25','ma10_50','ma20_50','ma30_50','rebound3_50','rebound5_50','rebound8_50','rebound10_50','r5_and_ma20_50','r5_or_ma20_50','ma10_50_ma20_75','r5_50_ma20_75','r5_50_r8_75']
rows=[]
for name in NAMES:
    eq,pos=equity(S,L,target_rule(S,name)); m=met(eq)
    m5=met(sub(eq,end-pd.DateOffset(years=5))); m3=met(sub(eq,end-pd.DateOffset(years=3)))
    rows.append(dict(name=name,eq=eq,pos=pos,m5=m5,m3=m3,avg=float(pos.mean()),**m))

bh685=bh(L)
feas=sorted([r for r in rows if r['mdd']>=-.40],key=lambda r:(r['calmar'],r['cagr']),reverse=True)
raw=sorted(rows,key=lambda r:r['cagr'],reverse=True)
print('V110_BEGIN')
print(f'end={end.date()} variants={len(rows)} feasible_mdd40={len(feas)}')
print('TOP_MDD40')
print('|Rank|Rule|Total|CAGR|MDD|Calmar|5Y Total|5Y MDD|3Y Total|3Y MDD|Avg alloc|')
print('|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|')
for i,r in enumerate(feas,1):
    print(f"|{i}|{r['name']}|{p(r['total'])}|{p(r['cagr'])}|{p(r['mdd'])}|{r['calmar']:.2f}|{p(r['m5']['total'])}|{p(r['m5']['mdd'])}|{p(r['m3']['total'])}|{p(r['m3']['mdd'])}|{r['avg']:.2f}|")
print('BENCHMARK')
for nm,eq in [('00685L_BH',bh685)]:
    m=met(eq); print(nm,p(m['total']),p(m['cagr']),p(m['mdd']),f'{m["calmar"]:.2f}')
print('TOP_RAW_CAGR')
for r in raw[:8]: print(r['name'],p(r['total']),p(r['cagr']),p(r['mdd']),f'cal={r["calmar"]:.2f}')
print('STRESS_TOP3')
windows=[('2018','2018-01-01','2018-12-31'),('COVID2020','2020-01-01','2020-12-31'),('2022','2022-01-01','2022-12-31'),('2025-26','2025-01-01',str(end.date()))]
for r in feas[:3]:
    print('RULE',r['name'])
    for nm,st,en in windows:
        a=met(sub(r['eq'],st,en)); b=met(sub(bh685,st,en)); print(nm,p(a['total']),p(a['mdd']),p(b['total']),p(b['mdd']))
print('V110_END')
