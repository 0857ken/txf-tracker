import numpy as np
import pandas as pd
import yfinance as yf

START='2015-01-01'; END='2026-09-16'
BULLS=[3.0,3.25,3.5,3.75,4.0]
NEUTRALS=[2.0,2.25,2.5,2.75,3.0]
BEARS=[0.25,0.5,0.75,1.0]
FIXED=(3.0,3.0,0.25)
FOLDS=[
    ('F1','2015-01-01','2018-12-31','2019-01-01','2020-12-31'),
    ('F2','2015-01-01','2020-12-31','2021-01-01','2022-12-31'),
    ('F3','2015-01-01','2022-12-31','2023-01-01','2024-12-31'),
    ('F4','2015-01-01','2024-12-31','2025-01-01','2026-09-14'),
]

def dl(t):
    x=yf.download(t,start=START,end=END,auto_adjust=True,actions=False,progress=False,threads=False)
    if x.empty: raise RuntimeError(t)
    if isinstance(x.columns,pd.MultiIndex): x.columns=x.columns.get_level_values(0)
    x.columns=[c.lower() for c in x.columns]
    x.index=pd.to_datetime(x.index).tz_localize(None)
    return x.sort_index()

def prep_signal(df):
    o=df.copy()
    o['month_run_high']=o.groupby(o.index.to_period('M'))['high'].cummax()
    o['ma60']=o['close'].rolling(60).mean()
    o['ma60_20ago']=o['ma60'].shift(20)
    # base grid is path-dependent but parameter-independent; compute once using only past/current information
    pos=0.; anchor=None; u2=u3=False; vals=[]
    for _,r in o.iterrows():
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
    o['base']=pd.Series(vals,index=o.index,dtype=float)
    a=o['close']>o['ma60']; b=o['ma60']>o['ma60_20ago']
    # 2=both bullish, 1=mixed, 0=both bearish. NaN warmup -> 0 (defensive)
    o['regime']=np.where(a & b,2,np.where(a | b,1,0))
    return o

def target_series(sig, params):
    bull,neutral,bear=params
    mult=np.where(sig['regime'].eq(2),bull,np.where(sig['regime'].eq(1),neutral,bear))
    return sig['base']*pd.Series(mult,index=sig.index,dtype=float)

def strat_returns(sig, tx, params):
    m=pd.concat([target_series(sig,params).rename('target'),tx['open'].rename('open')],axis=1,join='inner').dropna()
    pos=m['target'].shift(1).fillna(0.0)
    fwd=m['open'].shift(-1)/m['open']-1
    return (pos*fwd).dropna()

def bh_returns(df):
    return df['close'].pct_change().dropna()

def two_returns(df):
    return (2*df['close'].pct_change()).clip(lower=-.999999).dropna()

def metrics_from_returns(r):
    r=r.dropna()
    if len(r)<2: return dict(total=np.nan,cagr=np.nan,mdd=np.nan,calmar=np.nan)
    eq=(1+r).cumprod()
    days=max((eq.index[-1]-eq.index[0]).days,1)
    total=float(eq.iloc[-1]-1)
    cagr=float(eq.iloc[-1]**(365.25/days)-1)
    dd=eq/eq.cummax()-1
    mdd=float(dd.min())
    calmar=cagr/abs(mdd) if mdd<0 else np.nan
    return dict(total=total,cagr=cagr,mdd=mdd,calmar=calmar)

def slice_r(r,start,end):
    return r[(r.index>=pd.Timestamp(start))&(r.index<=pd.Timestamp(end))]

def p(x): return 'nan' if pd.isna(x) else f'{x*100:.1f}%'

def choose_params(sig,tx,train_start,train_end):
    candidates=[]
    tx1=metrics_from_returns(slice_r(bh_returns(tx),train_start,train_end))
    for bu in BULLS:
        for ne in NEUTRALS:
            for be in BEARS:
                par=(bu,ne,be)
                m=metrics_from_returns(slice_r(strat_returns(sig,tx,par),train_start,train_end))
                if pd.isna(m['cagr']): continue
                # Fixed ex-ante rule: maximize CAGR while keeping training MDD within 40%.
                if m['mdd']>=-0.40:
                    candidates.append((m['cagr'],m['calmar'],m['total'],par,m))
    if not candidates:
        raise RuntimeError('No feasible candidate')
    candidates.sort(key=lambda z:(z[0],z[1],z[2]),reverse=True)
    best=candidates[0]
    return best[3],best[4],tx1,len(candidates)

S=prep_signal(dl('0050.TW'))
T=dl('^TWII')
L=dl('00685L.TW')
all_strat={par:strat_returns(S,T,par) for par in [(bu,ne,be) for bu in BULLS for ne in NEUTRALS for be in BEARS]}
# overwrite helper cache path by local getter for speed

def sr(par): return all_strat[par]

print('V18_BEGIN')
print('METHOD: anchored walk-forward; each fold optimizes only on its training window; objective=max training CAGR subject to MDD<=40%; next fold is unseen test window.')
print('| Fold | Train | Test | Selected B/N/B | Train CAGR | Train MDD | Feasible | Test Total | Test CAGR | Test MDD | Fixed 3/3/.25 Total | Fixed MDD | TAIEX1x Total | TAIEX2x Total | 00685L Total |')
print('|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|')
chosen=[]; adaptive_parts=[]; fixed_parts=[]; t1_parts=[]; t2_parts=[]; l_parts=[]
for name,tr0,tr1,te0,te1 in FOLDS:
    # inline faster chooser using cached return series
    cand=[]
    for par,r in all_strat.items():
        m=metrics_from_returns(slice_r(r,tr0,tr1))
        if not pd.isna(m['cagr']) and m['mdd']>=-0.40:
            cand.append((m['cagr'],m['calmar'],m['total'],par,m))
    cand.sort(key=lambda z:(z[0],z[1],z[2]),reverse=True)
    _,_,_,par,trainm=cand[0]
    chosen.append(par)
    ra=slice_r(sr(par),te0,te1); rf=slice_r(sr(FIXED),te0,te1)
    rt1=slice_r(bh_returns(T),te0,te1); rt2=slice_r(two_returns(T),te0,te1); rl=slice_r(bh_returns(L),te0,te1)
    ma=metrics_from_returns(ra); mf=metrics_from_returns(rf); m1=metrics_from_returns(rt1); m2=metrics_from_returns(rt2); ml=metrics_from_returns(rl)
    adaptive_parts.append(ra); fixed_parts.append(rf); t1_parts.append(rt1); t2_parts.append(rt2); l_parts.append(rl)
    print(f'| {name} | {tr0[:4]}-{tr1[:4]} | {te0[:4]}-{te1[:4]} | {par[0]:.2f}/{par[1]:.2f}/{par[2]:.2f} | {p(trainm["cagr"])} | {p(trainm["mdd"])} | {len(cand)} | {p(ma["total"])} | {p(ma["cagr"])} | {p(ma["mdd"])} | {p(mf["total"])} | {p(mf["mdd"])} | {p(m1["total"])} | {p(m2["total"])} | {p(ml["total"])} |')

def concat_parts(parts):
    return pd.concat(parts).sort_index()[lambda x: ~x.index.duplicated(keep='first')]

print('CHAINED_OOS_2019_END')
print('| Strategy | Total | CAGR | MDD | Calmar |')
print('|---|---:|---:|---:|---:|')
for nm,parts in [
    ('Adaptive walk-forward',adaptive_parts),
    ('Fixed 3/3/0.25',fixed_parts),
    ('TAIEX 1x',t1_parts),
    ('TAIEX daily 2x',t2_parts),
    ('00685L',l_parts),
]:
    m=metrics_from_returns(concat_parts(parts))
    print(f'| {nm} | {p(m["total"])} | {p(m["cagr"])} | {p(m["mdd"])} | {m["calmar"]:.2f} |')
print('SELECTED_SEQUENCE',chosen)
print('V18_END')
