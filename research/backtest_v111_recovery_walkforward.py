import numpy as np
import pandas as pd
import yfinance as yf

START='2015-01-01'; END='2026-09-16'; LISTING=pd.Timestamp('2017-03-30')
NAMES=['base_25','ma10_50','ma20_50','ma30_50','rebound3_50','rebound5_50','rebound8_50','rebound10_50','r5_and_ma20_50','r5_or_ma20_50','ma10_50_ma20_75','r5_50_ma20_75','r5_50_r8_75']


def dl(t):
    x=yf.download(t,start=START,end=END,auto_adjust=True,actions=False,progress=False,threads=False)
    if isinstance(x.columns,pd.MultiIndex): x.columns=x.columns.get_level_values(0)
    x.columns=[c.lower() for c in x.columns]; x.index=pd.to_datetime(x.index).tz_localize(None)
    return x.sort_index()


def sigs(df):
    o=df.copy()
    for n in (10,20,30,60): o[f'ma{n}']=o['close'].rolling(n).mean()
    o['ma60_20ago']=o['ma60'].shift(20)
    o['bear']=(o['close']<=o['ma60'])&(o['ma60']<=o['ma60_20ago'])
    return o


def target_rule(sig,name):
    out=[]; prev=False; low=None
    for _,r in sig.iterrows():
        bear=bool(r['bear']) if pd.notna(r['bear']) else False; px=float(r['close'])
        if not bear:
            out.append(1.0); prev=False; low=None; continue
        if not prev or low is None: low=px
        else: low=min(low,px)
        reb=px/low-1.0; t=.25
        if name=='base_25': pass
        elif name=='ma10_50': t=.50 if pd.notna(r['ma10']) and px>r['ma10'] else .25
        elif name=='ma20_50': t=.50 if pd.notna(r['ma20']) and px>r['ma20'] else .25
        elif name=='ma30_50': t=.50 if pd.notna(r['ma30']) and px>r['ma30'] else .25
        elif name=='rebound3_50': t=.50 if reb>=.03 else .25
        elif name=='rebound5_50': t=.50 if reb>=.05 else .25
        elif name=='rebound8_50': t=.50 if reb>=.08 else .25
        elif name=='rebound10_50': t=.50 if reb>=.10 else .25
        elif name=='r5_and_ma20_50': t=.50 if reb>=.05 and pd.notna(r['ma20']) and px>r['ma20'] else .25
        elif name=='r5_or_ma20_50': t=.50 if reb>=.05 or (pd.notna(r['ma20']) and px>r['ma20']) else .25
        elif name=='ma10_50_ma20_75':
            if pd.notna(r['ma10']) and px>r['ma10']: t=.50
            if pd.notna(r['ma20']) and px>r['ma20']: t=.75
        elif name=='r5_50_ma20_75':
            if reb>=.05: t=.50
            if reb>=.05 and pd.notna(r['ma20']) and px>r['ma20']: t=.75
        elif name=='r5_50_r8_75':
            if reb>=.05: t=.50
            if reb>=.08: t=.75
        out.append(t); prev=True
    return pd.Series(out,index=sig.index,dtype=float)


def returns(sig,asset,target):
    m=pd.concat([target.rename('target'),asset['close'].rename('asset')],axis=1,join='inner').dropna()
    pos=m['target'].shift(1).fillna(0.0); r=m['asset'].pct_change().fillna(0.0)
    return pos*r


def met_from_ret(r):
    r=r.dropna(); eq=(1+r).cumprod()
    if len(eq)<2:return dict(total=np.nan,cagr=np.nan,mdd=np.nan,calmar=np.nan)
    total=float(eq.iloc[-1]-1); days=max((eq.index[-1]-eq.index[0]).days,1)
    cagr=float(eq.iloc[-1]**(365.25/days)-1); dd=eq/eq.cummax()-1; mdd=float(dd.min())
    return dict(total=total,cagr=cagr,mdd=mdd,calmar=cagr/abs(mdd) if mdd<0 else np.nan)


def cut(r,st,en): return r[(r.index>=pd.Timestamp(st))&(r.index<=pd.Timestamp(en))]
def p(x): return f'{x*100:.1f}%'

S=sigs(dl('0050.TW')); L=dl('00685L.TW'); end=min(S.index.max(),L.index.max())
S=S[(S.index>=LISTING)&(S.index<=end)]; L=L[(L.index>=LISTING)&(L.index<=end)]
rets={n:returns(S,L,target_rule(S,n)) for n in NAMES}
bhret=L['close'].pct_change().fillna(0.0)
folds=[('F1','2017-03-30','2018-12-31','2019-01-01','2020-12-31'),('F2','2017-03-30','2020-12-31','2021-01-01','2022-12-31'),('F3','2017-03-30','2022-12-31','2023-01-01','2024-12-31'),('F4','2017-03-30','2024-12-31','2025-01-01',str(end.date()))]
chain=[]
print('V111_BEGIN')
print('METHOD anchored walk-forward; select max training CAGR with training MDD <=40%; next test unseen.')
print('|Fold|Train|Test|Selected|Train CAGR|Train MDD|Test Total|Test CAGR|Test MDD|Base25 Test|00685L Test|')
print('|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|')
for fid,ts,te,vs,ve in folds:
    cand=[]
    for n,r in rets.items():
        m=met_from_ret(cut(r,ts,te))
        if m['mdd']>=-.40: cand.append((m['cagr'],m['calmar'],n,m))
    cand.sort(reverse=True); _,_,sel,tm=cand[0]
    tr=cut(rets[sel],vs,ve); chain.append(tr); tst=met_from_ret(tr)
    base=met_from_ret(cut(rets['base_25'],vs,ve)); b=met_from_ret(cut(bhret,vs,ve))
    print(f'|{fid}|{ts[:4]}-{te[:4]}|{vs[:4]}-{ve[:4]}|{sel}|{p(tm["cagr"])}|{p(tm["mdd"])}|{p(tst["total"])}|{p(tst["cagr"])}|{p(tst["mdd"])}|{p(base["total"])}|{p(b["total"])}|')

chainret=pd.concat(chain).sort_index(); fixed=cut(rets['ma10_50_ma20_75'],'2019-01-01',str(end.date())); base=cut(rets['base_25'],'2019-01-01',str(end.date())); b=cut(bhret,'2019-01-01',str(end.date()))
print('CHAINED_OOS_2019_END')
print('|Strategy|Total|CAGR|MDD|Calmar|')
print('|---|---:|---:|---:|---:|')
for n,r in [('Adaptive recovery walk-forward',chainret),('Fixed ma10/ma20 reference',fixed),('Base 100/25',base),('00685L B&H',b)]:
    m=met_from_ret(r); print(f'|{n}|{p(m["total"])}|{p(m["cagr"])}|{p(m["mdd"])}|{m["calmar"]:.2f}|')
print('V111_END')
