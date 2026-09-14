import itertools
import numpy as np
import pandas as pd
import yfinance as yf

START='2015-01-01'; END='2026-09-16'
LISTING=pd.Timestamp('2017-03-30')


def dl(t):
    x=yf.download(t,start=START,end=END,auto_adjust=True,actions=False,progress=False,threads=False)
    if x.empty: raise RuntimeError(t)
    if isinstance(x.columns,pd.MultiIndex): x.columns=x.columns.get_level_values(0)
    x.columns=[c.lower() for c in x.columns]
    x.index=pd.to_datetime(x.index).tz_localize(None)
    return x.sort_index()


def add_sig(df):
    o=df.copy()
    o['month_run_high']=o.groupby(o.index.to_period('M'))['high'].cummax()
    o['ma60']=o['close'].rolling(60).mean()
    o['ma60_20ago']=o['ma60'].shift(20)
    return o


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
                if (not u2) and px<=anchor*.94:
                    pos+=.3; u2=True
                if (not u3) and px<=anchor*.91:
                    pos+=.5; u3=True
                pos=min(pos,1.)
        vals.append(pos)
    return pd.Series(vals,index=df.index,dtype=float)


def regime_flags(df):
    bull=[]; neutral=[]; bear=[]
    for _,r in df.iterrows():
        if pd.isna(r['ma60']) or pd.isna(r['ma60_20ago']):
            bull.append(False); neutral.append(False); bear.append(True); continue
        a=bool(r['close']>r['ma60']); b=bool(r['ma60']>r['ma60_20ago'])
        bull.append(a and b); neutral.append(a ^ b); bear.append((not a) and (not b))
    return (pd.Series(bull,index=df.index), pd.Series(neutral,index=df.index), pd.Series(bear,index=df.index))


def target(sig,bm,nm,xm):
    b=base(sig); bull,neu,bear=regime_flags(sig)
    mult=pd.Series(np.where(bull,bm,np.where(neu,nm,xm)),index=sig.index,dtype=float)
    return b*mult


def equity_on_taiex(sig,tx,bm,nm,xm):
    tar=target(sig,bm,nm,xm).rename('target')
    m=pd.concat([tar,tx['open'].rename('open')],axis=1,join='inner').dropna()
    pos=m['target'].shift(1).fillna(0.)
    fwd=m['open'].shift(-1)/m['open']-1
    r=(pos*fwd).dropna()
    return (1+r).cumprod(), pos.loc[r.index]


def metrics(eq):
    eq=eq.dropna(); tot=float(eq.iloc[-1]-1)
    days=max((eq.index[-1]-eq.index[0]).days,1)
    cagr=float(eq.iloc[-1]**(365.25/days)-1)
    dd=eq/eq.cummax()-1; mdd=float(dd.min())
    cal=cagr/abs(mdd) if mdd<0 else np.nan
    return tot,cagr,mdd,cal


def period_result(S,T,start,bm,nm,xm):
    s=S[(S.index>=start)&(S.index<=END)]; t=T[(T.index>=start)&(T.index<=END)]
    eq,pos=equity_on_taiex(s,t,bm,nm,xm)
    met=metrics(eq)
    return met,float(pos.mean()),float(pos.max())

S=add_sig(dl('0050.TW')); T=dl('^TWII'); L=dl('00685L.TW')
end=min(S.index.max(),T.index.max(),L.index.max()); END=end

rows=[]
for bm,nm,xm in itertools.product([3.0,3.25,3.5,3.75,4.0],[2.0,2.25,2.5,2.75,3.0],[0.25,0.5,0.75,1.0]):
    if not (bm>=nm>=xm): continue
    listing,avg,maxp=period_result(S,T,LISTING,bm,nm,xm)
    y5,_,_=period_result(S,T,end-pd.DateOffset(years=5),bm,nm,xm)
    y3,_,_=period_result(S,T,end-pd.DateOffset(years=3),bm,nm,xm)
    # Require drawdown <= 40% in all principal windows.
    feasible=(listing[2]>=-.40 and y5[2]>=-.40 and y3[2]>=-.40)
    rows.append(dict(bull=bm,neutral=nm,bear=xm,feasible=feasible,
                     total=listing[0],cagr=listing[1],mdd=listing[2],calmar=listing[3],
                     total5=y5[0],cagr5=y5[1],mdd5=y5[2],calmar5=y5[3],
                     total3=y3[0],cagr3=y3[1],mdd3=y3[2],calmar3=y3[3],
                     avgexp=avg,maxexp=maxp))

R=pd.DataFrame(rows)
F=R[R.feasible].copy().sort_values(['total','calmar'],ascending=False)
print('V16_BEGIN')
print(f'tested={len(R)} feasible_under_40pct_mdd={len(F)} end={end.date()}')
print('TOP_BY_RETURN_UNDER_MDD40')
print('| Rank | Bull/Neutral/Bear | Since listing Total | CAGR | MDD | Calmar | 5Y Total | 5Y MDD | 3Y Total | 3Y MDD | Avg exp | Max exp |')
print('|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|')
for i,(_,r) in enumerate(F.head(15).iterrows(),1):
    print(f"| {i} | {r.bull:.2f}/{r.neutral:.2f}/{r.bear:.2f} | {r.total*100:.1f}% | {r.cagr*100:.1f}% | {r.mdd*100:.1f}% | {r.calmar:.2f} | {r.total5*100:.1f}% | {r.mdd5*100:.1f}% | {r.total3*100:.1f}% | {r.mdd3*100:.1f}% | {r.avgexp:.2f}x | {r.maxexp:.2f}x |")

# Also rank by Calmar among candidates that improve return over current 3/2/0.5.
current=R[(R.bull==3.0)&(R.neutral==2.0)&(R.bear==0.5)].iloc[0]
Q=F[F.total>current.total].sort_values(['calmar','total'],ascending=False)
print('TOP_CALMAR_WHILE_BEATING_CURRENT_RETURN')
print('| Rank | Bull/Neutral/Bear | Since listing Total | CAGR | MDD | Calmar | 5Y Total | 5Y MDD |')
print('|---:|---|---:|---:|---:|---:|---:|---:|')
for i,(_,r) in enumerate(Q.head(10).iterrows(),1):
    print(f"| {i} | {r.bull:.2f}/{r.neutral:.2f}/{r.bear:.2f} | {r.total*100:.1f}% | {r.cagr*100:.1f}% | {r.mdd*100:.1f}% | {r.calmar:.2f} | {r.total5*100:.1f}% | {r.mdd5*100:.1f}% |")

print('CURRENT_3_2_0.5')
print(current.to_dict())
print('V16_END')
