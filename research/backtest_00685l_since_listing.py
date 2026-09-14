import pandas as pd
import numpy as np
import yfinance as yf

START='2015-01-01'; END='2026-09-16'; LISTING=pd.Timestamp('2017-03-30')

def dl(t):
    x=yf.download(t,start=START,end=END,auto_adjust=True,actions=False,progress=False,threads=False)
    if isinstance(x.columns,pd.MultiIndex): x.columns=x.columns.get_level_values(0)
    x.columns=[c.lower() for c in x.columns]; x.index=pd.to_datetime(x.index).tz_localize(None); return x.sort_index()

def add(df):
    o=df.copy(); o['month_run_high']=o.groupby(o.index.to_period('M'))['high'].cummax(); o['ma60']=o['close'].rolling(60).mean(); o['ma60_20ago']=o['ma60'].shift(20); return o

def base(df):
    pos=0.; anchor=None; u2=u3=False; vals=[]
    for _,r in df.iterrows():
        px=float(r['close']); rh=r['month_run_high']
        if pos>0 and anchor is not None and px>=anchor:
            pos=0.; anchor=None; u2=u3=False
        else:
            if pos==0 and pd.notna(rh) and px<=float(rh)*.97: anchor=float(rh); pos=.2
            if pos>0 and anchor is not None:
                if not u2 and px<=anchor*.94: pos+=.3; u2=True
                if not u3 and px<=anchor*.91: pos+=.5; u3=True
                pos=min(pos,1.)
        vals.append(pos)
    return pd.Series(vals,index=df.index)

def mult(df):
    vals=[]
    for _,r in df.iterrows():
        if pd.isna(r['ma60']) or pd.isna(r['ma60_20ago']): vals.append(.5); continue
        a=r['close']>r['ma60']; b=r['ma60']>r['ma60_20ago']; vals.append(3. if a and b else 2. if a or b else .5)
    return pd.Series(vals,index=df.index)

def seq(df):
    tar=base(df)*mult(df); p=tar.shift(1).fillna(0); f=df['open'].shift(-1)/df['open']-1; r=(p*f).dropna(); return (1+r).cumprod()

def bh(df):
    c=df['close'].dropna(); return c/c.iloc[0]

def two(df):
    r=df['close'].pct_change().fillna(0); return (1+(2*r).clip(lower=-.999999)).cumprod()

def met(eq):
    eq=eq.dropna(); total=eq.iloc[-1]-1; days=(eq.index[-1]-eq.index[0]).days; cagr=eq.iloc[-1]**(365.25/days)-1; dd=eq/eq.cummax()-1; mdd=dd.min(); return total,cagr,mdd,cagr/abs(mdd)

E=add(dl('0050.TW')); T=dl('^TWII'); L=dl('00685L.TW'); end=min(E.index.max(),T.index.max(),L.index.max())
E=E[(E.index>=LISTING)&(E.index<=end)]; T=T[(T.index>=LISTING)&(T.index<=end)]; L=L[(L.index>=LISTING)&(L.index<=end)]
for n,e in [('C',seq(E)),('0050',bh(E)),('TAIEX1x',bh(T)),('TAIEX2x',two(T)),('00685L',bh(L))]:
    a,b,c,d=met(e); print(n,f'{a*100:.1f}%',f'{b*100:.1f}%',f'{c*100:.1f}%',f'{d:.2f}')
