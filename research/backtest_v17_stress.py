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
    o=df.copy(); o['month_run_high']=o.groupby(o.index.to_period('M'))['high'].cummax(); o['ma60']=o['close'].rolling(60).mean(); o['ma60_20ago']=o['ma60'].shift(20); return o


def base(df):
    pos=0.; anchor=None; u2=u3=False; vals=[]
    for _,r in df.iterrows():
        px=float(r['close']); rh=r['month_run_high']
        if pos>0 and anchor is not None and px>=anchor:
            pos=0.; anchor=None; u2=u3=False
        else:
            if pos==0 and pd.notna(rh) and px<=float(rh)*.97:
                anchor=float(rh); pos=.2
            if pos>0 and anchor is not None:
                if (not u2) and px<=anchor*.94: pos+=.3; u2=True
                if (not u3) and px<=anchor*.91: pos+=.5; u3=True
                pos=min(pos,1.)
        vals.append(pos)
    return pd.Series(vals,index=df.index,dtype=float)


def mult(df,bm,nm,xm):
    vals=[]
    for _,r in df.iterrows():
        if pd.isna(r['ma60']) or pd.isna(r['ma60_20ago']): vals.append(xm); continue
        a=bool(r['close']>r['ma60']); b=bool(r['ma60']>r['ma60_20ago'])
        vals.append(bm if (a and b) else nm if (a or b) else xm)
    return pd.Series(vals,index=df.index,dtype=float)


def strategy_returns(sig,tx,bm,nm,xm,start=LISTING):
    s=sig[sig.index>=start].copy(); t=tx[tx.index>=start].copy()
    tar=(base(s)*mult(s,bm,nm,xm)).rename('target')
    m=pd.concat([tar,t['open'].rename('open')],axis=1,join='inner').dropna()
    pos=m['target'].shift(1).fillna(0.)
    fwd=m['open'].shift(-1)/m['open']-1
    r=(pos*fwd).dropna()
    return r,pos.loc[r.index]


def asset_returns(df,start=LISTING,lev=1.0):
    c=df[df.index>=start]['close'].dropna(); r=c.pct_change().fillna(0.)
    if lev!=1.0: r=(lev*r).clip(lower=-.999999)
    return r


def metrics_from_returns(r):
    r=r.dropna(); eq=(1+r).cumprod(); tot=float(eq.iloc[-1]-1); days=max((eq.index[-1]-eq.index[0]).days,1); cagr=float(eq.iloc[-1]**(365.25/days)-1); dd=eq/eq.cummax()-1; mdd=float(dd.min()); cal=cagr/abs(mdd) if mdd<0 else np.nan
    trough=dd.idxmin(); peak=eq.loc[:trough].idxmax()
    return tot,cagr,mdd,cal,peak,trough


def slice_metrics(r,start,end):
    z=r[(r.index>=start)&(r.index<=end)]
    if len(z)<2: return None
    return metrics_from_returns(z)


def fmt(m):
    return f'{m[0]*100:.1f}% | {m[1]*100:.1f}% | {m[2]*100:.1f}% | {m[3]:.2f} | {m[4].date()}->{m[5].date()}'

S=add_sig(dl('0050.TW')); T=dl('^TWII'); L=dl('00685L.TW'); end=min(S.index.max(),T.index.max(),L.index.max())
rc,pc=strategy_returns(S,T,3.0,3.0,0.25)
r0,p0=strategy_returns(S,T,3.0,2.0,0.5)
r1=asset_returns(T,lev=1.0); r2=asset_returns(T,lev=2.0); rl=asset_returns(L,lev=1.0)
series={'C new 3/3/0.25':rc,'C old 3/2/0.5':r0,'TAIEX 1x':r1,'TAIEX daily 2x':r2,'00685L':rl}

print('V17_BEGIN')
print('SINCE_LISTING_CONTINUOUS')
print('| Strategy | Total | CAGR | MDD | Calmar | MDD period |')
print('|---|---:|---:|---:|---:|---|')
for n,r in series.items():
    m=metrics_from_returns(r[r.index<=end]); print(f'| {n} | {m[0]*100:.1f}% | {m[1]*100:.1f}% | {m[2]*100:.1f}% | {m[3]:.2f} | {m[4].date()} -> {m[5].date()} |')

print('EXPOSURE')
for n,p in [('new',pc),('old',p0)]:
    p=p[p.index<=end]; print(f'{n}: avg={p.mean():.3f}x max={p.max():.2f}x pct_gt2={(p>2).mean()*100:.1f}% pct_gt0={(p>0).mean()*100:.1f}%')

print('STRESS_WINDOWS')
windows=[('2018 selloff','2018-01-01','2018-12-31'),('COVID 2020','2020-01-01','2020-12-31'),('2022 bear','2022-01-01','2022-12-31'),('2025-26','2025-01-01',str(end.date()))]
print('| Window | Strategy | Total | MDD |')
print('|---|---|---:|---:|')
for label,a,b in windows:
    for n,r in series.items():
        m=slice_metrics(r,pd.Timestamp(a),pd.Timestamp(b))
        if m: print(f'| {label} | {n} | {m[0]*100:.1f}% | {m[2]*100:.1f}% |')

print('CALENDAR_RETURNS')
years=range(2018,end.year+1)
print('| Year | C new | C old | TAIEX 1x | TAIEX 2x | 00685L |')
print('|---:|---:|---:|---:|---:|---:|')
for y in years:
    vals=[]
    for r in [rc,r0,r1,r2,rl]:
        z=r[(r.index>=pd.Timestamp(f'{y}-01-01'))&(r.index<=pd.Timestamp(f'{y}-12-31'))]
        vals.append((1+z).prod()-1 if len(z) else np.nan)
    print(f"| {y} | "+' | '.join(f'{v*100:.1f}%' if pd.notna(v) else 'NA' for v in vals)+' |')

print('SUBPERIOD_STABILITY')
periods=[('2017-2020','2017-03-30','2020-12-31'),('2021-2023','2021-01-01','2023-12-31'),('2024-end','2024-01-01',str(end.date()))]
print('| Period | Strategy | CAGR | MDD | Calmar |')
print('|---|---|---:|---:|---:|')
for label,a,b in periods:
    for n,r in series.items():
        m=slice_metrics(r,pd.Timestamp(a),pd.Timestamp(b))
        if m: print(f'| {label} | {n} | {m[1]*100:.1f}% | {m[2]*100:.1f}% | {m[3]:.2f} |')
print('V17_END')
