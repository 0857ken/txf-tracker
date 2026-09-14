import numpy as np
import pandas as pd
import yfinance as yf

START='2015-01-01'; END='2026-09-16'; PERIODS=[1,3,5]

def dl(t):
    x=yf.download(t,start=START,end=END,auto_adjust=True,actions=False,progress=False,threads=False)
    if x.empty: raise RuntimeError(t)
    if isinstance(x.columns,pd.MultiIndex): x.columns=x.columns.get_level_values(0)
    x.columns=[c.lower() for c in x.columns]; x.index=pd.to_datetime(x.index).tz_localize(None); return x.sort_index()

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
                if not u2 and px<=anchor*.94: pos+=.3; u2=True
                if not u3 and px<=anchor*.91: pos+=.5; u3=True
                pos=min(pos,1.)
        vals.append(pos)
    return pd.Series(vals,index=df.index,dtype=float)

def mult(df):
    out=[]
    for _,r in df.iterrows():
        if pd.isna(r['ma60']) or pd.isna(r['ma60_20ago']): out.append(.5); continue
        a=r['close']>r['ma60']; b=r['ma60']>r['ma60_20ago']
        out.append(3. if a and b else 2. if a or b else .5)
    return pd.Series(out,index=df.index,dtype=float)

def strat_on_taiex(sig, tx):
    target=(base(sig)*mult(sig)).rename('target')
    m=pd.concat([target,tx['open'].rename('tx_open')],axis=1,join='inner').dropna()
    pos=m['target'].shift(1).fillna(0)
    fwd=m['tx_open'].shift(-1)/m['tx_open']-1
    r=(pos*fwd).dropna()
    return (1+r).cumprod()

def bh(df):
    c=df['close'].dropna(); return c/c.iloc[0]

def two(df):
    r=df['close'].pct_change().fillna(0); return (1+(2*r).clip(lower=-.999999)).cumprod()

def met(eq):
    eq=eq.dropna(); tot=float(eq.iloc[-1]-1); days=max((eq.index[-1]-eq.index[0]).days,1); cagr=float(eq.iloc[-1]**(365.25/days)-1); dd=eq/eq.cummax()-1; mdd=float(dd.min()); cal=cagr/abs(mdd) if mdd<0 else np.nan; return tot,cagr,mdd,cal

def p(x): return f'{x*100:.1f}%'

def row(lbl,name,eq):
    a,b,c,d=met(eq); print(f'| {lbl} | {name} | {p(a)} | {p(b)} | {p(c)} | {d:.2f} |')

S=add_sig(dl('0050.TW')); T=dl('^TWII'); L=dl('00685L.TW'); end=min(S.index.max(),T.index.max(),L.index.max())
print('V15_BEGIN'); print('| Window | Strategy | Total | CAGR | MDD | Calmar |'); print('|---|---|---:|---:|---:|---:|')
for y in PERIODS:
    st=end-pd.DateOffset(years=y); s=S[(S.index>=st)&(S.index<=end)]; t=T[(T.index>=st)&(T.index<=end)]; l=L[(L.index>=st)&(L.index<=end)]
    row(f'{y}Y','C signals -> TAIEX proxy',strat_on_taiex(s,t)); row(f'{y}Y','TAIEX 1x',bh(t)); row(f'{y}Y','TAIEX daily 2x synthetic',two(t)); row(f'{y}Y','00685L',bh(l))
st=pd.Timestamp('2017-03-30'); s=S[(S.index>=st)&(S.index<=end)]; t=T[(T.index>=st)&(T.index<=end)]; l=L[(L.index>=st)&(L.index<=end)]
row('Since listing','C signals -> TAIEX proxy',strat_on_taiex(s,t)); row('Since listing','TAIEX 1x',bh(t)); row('Since listing','TAIEX daily 2x synthetic',two(t)); row('Since listing','00685L',bh(l)); print('V15_END')
