import calendar
import time
import numpy as np
import pandas as pd
import requests
import yfinance as yf

START='2015-01-01'; END='2026-09-16'; LISTING=pd.Timestamp('2017-03-30')
CAP0=1_000_000.0; TMF_START=pd.Timestamp('2024-07-29'); TAX=0.00002
COMM={'TX':38.0,'MTX':19.0,'TMF':16.0}; MULT={'TX':200.0,'MTX':50.0,'TMF':10.0}
ETF_COMM=0.0005; ETF_TAX=0.0010; ETF_SLIP=0.0003


def dl(t):
    x=yf.download(t,start=START,end=END,auto_adjust=True,actions=False,progress=False,threads=False)
    if x.empty: raise RuntimeError(t)
    if isinstance(x.columns,pd.MultiIndex): x.columns=x.columns.get_level_values(0)
    x.columns=[c.lower() for c in x.columns]
    x.index=pd.to_datetime(x.index).tz_localize(None)
    return x.sort_index()


def fetch_tri(start='2017-03-01',end='2026-09-30'):
    s=pd.Timestamp(start); e=pd.Timestamp(end); rows=[]
    sess=requests.Session(); sess.headers.update({'User-Agent':'Mozilla/5.0'})
    for dt in pd.date_range(s,e,freq='MS'):
        url='https://www.twse.com.tw/indicesReport/MFI94U'
        r=sess.get(url,params={'response':'json','date':dt.strftime('%Y%m%d')},timeout=20)
        r.raise_for_status(); j=r.json()
        if j.get('stat')!='OK':
            continue
        for row in j.get('data',[]):
            if len(row)<2: continue
            ds=str(row[0]).strip().replace('年','/').replace('月','/').replace('日','').replace('.','/').replace('-','/')
            parts=[p for p in ds.split('/') if p]
            if len(parts)!=3: continue
            y,m,d=map(int,parts)
            if y<1911: y+=1911
            val=float(str(row[1]).replace(',',''))
            rows.append((pd.Timestamp(y,m,d),val))
        time.sleep(0.05)
    if not rows: raise RuntimeError('No TWSE total-return-index data')
    out=pd.DataFrame(rows,columns=['date','tri']).drop_duplicates('date').set_index('date').sort_index()
    return out


def add_sig(df):
    o=df.copy()
    for n in [10,20,60]: o[f'ma{n}']=o['close'].rolling(n).mean()
    o['ma60_20ago']=o['ma60'].shift(20)
    o['bear']=(o['close']<=o['ma60'])&(o['ma60']<=o['ma60_20ago'])
    vals=[]
    for _,r in o.iterrows():
        if not bool(r['bear']): a=1.0
        else:
            a=.25
            if pd.notna(r['ma10']) and r['close']>r['ma10']: a=.50
            if pd.notna(r['ma20']) and r['close']>r['ma20']: a=.75
        vals.append(a)
    o['alloc']=vals; o['fut_mult']=o['alloc']*2.0
    return o


def metrics(eq):
    eq=eq.dropna()
    total=eq.iloc[-1]/eq.iloc[0]-1; days=max((eq.index[-1]-eq.index[0]).days,1)
    cagr=(eq.iloc[-1]/eq.iloc[0])**(365.25/days)-1; dd=eq/eq.cummax()-1; mdd=dd.min()
    return dict(total=float(total),cagr=float(cagr),mdd=float(mdd),calmar=float(cagr/abs(mdd)) if mdd<0 else np.nan,terminal=float(eq.iloc[-1]))


def window_metrics(eq,st,en=None):
    x=eq[eq.index>=pd.Timestamp(st)]
    if en: x=x[x.index<=pd.Timestamp(en)]
    if len(x)<2: return dict(total=np.nan,mdd=np.nan)
    z=x/x.iloc[0]; return dict(total=float(z.iloc[-1]-1),mdd=float((z/z.cummax()-1).min()))


def run_etf(sig,asset):
    m=pd.concat([sig['alloc'],asset['close'].rename('px')],axis=1,join='inner').dropna()
    pos=m['alloc'].shift(1).fillna(0.0); r=m['px'].pct_change().fillna(0.0); d=pos-pos.shift(1).fillna(0.0)
    cost=d.abs()*(ETF_COMM+ETF_SLIP)+(-d).clip(lower=0)*ETF_TAX
    eq=CAP0*(1+pos*r-cost).cumprod()
    return pd.DataFrame({'eq':eq,'pos':pos,'cost_pct':cost})


def run_ideal(sig,ret_series):
    m=pd.concat([sig['fut_mult'],ret_series.rename('r')],axis=1,join='inner').dropna()
    pos=m['fut_mult'].shift(1).fillna(0.0); eq=CAP0*(1+pos*m['r']).cumprod()
    return pd.DataFrame({'eq':eq,'pos':pos})


def third_wed(y,m):
    cal=calendar.monthcalendar(y,m); w=[wk[calendar.WEDNESDAY] for wk in cal if wk[calendar.WEDNESDAY]]
    return pd.Timestamp(y,m,w[2])


def roll_dates(idx):
    idx=pd.DatetimeIndex(idx); out=set()
    for y,m in sorted(set((d.year,d.month) for d in idx)):
        exp=third_wed(y,m); prev=idx[(idx<exp)&(idx.year==y)&(idx.month==m)]
        if len(prev): out.add(prev.max())
    return out


def choose_counts(target,px,micro=True):
    if target<=0: return {'TX':0,'MTX':0,'TMF':0}
    if micro: units=max(0,int(round(target/(px*10.0))))
    else: units=5*max(0,int(round(target/(px*50.0))))
    tx=units//20; rem=units%20; mtx=rem//5; tmf=rem%5 if micro else 0
    return {'TX':int(tx),'MTX':int(mtx),'TMF':int(tmf)}


def notional(c,px): return sum(c[k]*MULT[k]*px for k in c)


def side_cost(sides,px,slip):
    comm=sum(sides[k]*COMM[k] for k in sides); tax=sum(sides[k]*MULT[k]*px*TAX for k in sides); sl=sum(sides[k]*MULT[k]*slip for k in sides)
    return comm+tax+sl,comm,tax,sl


def run_integer(sig,price_idx,proxy_ret,mode='current',slip=1.0):
    m=pd.concat([sig['fut_mult'],price_idx['close'].rename('px'),proxy_ret.rename('r')],axis=1,join='inner').dropna()
    dates=m.index; rolls=roll_dates(dates); c={'TX':0,'MTX':0,'TMF':0}; eq=CAP0; prev_notional=0.0
    rows=[]; sums=dict(total=0.0,roll=0.0,comm=0.0,tax=0.0,slip=0.0,sides=0)
    for i,d in enumerate(dates):
        px=float(m.at[d,'px'])
        if i>0: eq += prev_notional*float(m.at[d,'r'])
        target_mult=float(m.at[d,'fut_mult']); target=target_mult*eq; micro=(mode=='current') or (d>=TMF_START); nc=choose_counts(target,px,micro)
        is_roll=(d in rolls and i>0)
        sides={k:(c[k]+nc[k] if is_roll else abs(nc[k]-c[k])) for k in c}
        cost,cc,tt,ss=side_cost(sides,px,slip); eq-=cost
        sums['total']+=cost; sums['comm']+=cc; sums['tax']+=tt; sums['slip']+=ss; sums['sides']+=sum(sides.values())
        if is_roll: sums['roll']+=cost
        c=nc; prev_notional=notional(c,px); real_mult=prev_notional/eq if eq>0 else np.nan; track=(prev_notional-target)/eq if eq>0 else np.nan
        margin=c['TX']*636000+c['MTX']*159000+c['TMF']*31800
        rows.append({'date':d,'eq':eq,'target_mult':target_mult,'realized_mult':real_mult,'track_err':track,'TX':c['TX'],'MTX':c['MTX'],'TMF':c['TMF'],'margin_current_schedule':margin})
    out=pd.DataFrame(rows).set_index('date'); out.attrs.update(sums); return out


def p(x): return f'{x*100:.1f}%'
def money(x): return f'{x:,.0f}'

S=add_sig(dl('0050.TW')); E=dl('00685L.TW'); P=dl('^TWII'); TRI=fetch_tri()
end=min(S.index.max(),E.index.max(),P.index.max(),TRI.index.max())
common=S.index.intersection(E.index).intersection(P.index).intersection(TRI.index)
common=common[(common>=LISTING)&(common<=end)]
S=S.loc[common]; E=E.loc[common]; P=P.loc[common]; TRI=TRI.loc[common]
tri_ret=TRI['tri'].pct_change().fillna(0.0); price_ret=P['close'].pct_change().fillna(0.0)
ETF=run_etf(S,E); IDEAL_TR=run_ideal(S,tri_ret); IDEAL_PRICE=run_ideal(S,price_ret)
CUR={sp:run_integer(S,P,tri_ret,'current',sp) for sp in [0.0,1.0,2.0]}; HIST=run_integer(S,P,tri_ret,'historical',1.0); PRICE_CUR=run_integer(S,P,price_ret,'current',1.0)

print('V116_BEGIN')
print(f'data {common.min().date()} to {common.max().date()} n={len(common)} start_capital={money(CAP0)}')
print('futures return proxy=TWSE TAIEX total-return index; notional sizing=TAIEX price index')
print('MAIN')
print('|Implementation|Terminal NTD|Total|CAGR|MDD|Calmar|')
print('|---|---:|---:|---:|---:|---:|')
for name,df in [('00685L base-cost',ETF),('Ideal futures total-return proxy',IDEAL_TR),('Futures current toolkit 1pt TR-proxy',CUR[1.0]),('Futures historical availability 1pt TR-proxy',HIST),('v1.15 current toolkit price-index proxy',PRICE_CUR)]:
    mm=metrics(df['eq']); print(f"|{name}|{money(mm['terminal'])}|{p(mm['total'])}|{p(mm['cagr'])}|{p(mm['mdd'])}|{mm['calmar']:.2f}|")

print('SLIPPAGE')
print('|Slip pts/side|Terminal|CAGR|MDD|Calmar|Total costs|Roll costs|Sides|Avg x|Mean abs tracking error|Max current-margin/equity|')
print('|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|')
for sp,df in CUR.items():
    mm=metrics(df['eq']); mr=(df['margin_current_schedule']/df['eq']).max()
    print(f"|{sp:.0f}|{money(mm['terminal'])}|{p(mm['cagr'])}|{p(mm['mdd'])}|{mm['calmar']:.2f}|{money(df.attrs['total'])}|{money(df.attrs['roll'])}|{df.attrs['sides']}|{df['realized_mult'].mean():.3f}|{p(df['track_err'].abs().mean())}|{p(mr)}|")

d=CUR[1.0]; print('COST_BREAKDOWN_1PT'); print(f"commission={money(d.attrs['comm'])} tax={money(d.attrs['tax'])} slippage={money(d.attrs['slip'])} total={money(d.attrs['total'])} roll_component={money(d.attrs['roll'])}")
print('STRESS')
print('|Window|00685L Total|00685L MDD|Futures TR Total|Futures TR MDD|Ideal TR Total|Ideal TR MDD|')
print('|---|---:|---:|---:|---:|---:|---:|')
for nm,st,en in [('2018','2018-01-01','2018-12-31'),('COVID2020','2020-01-01','2020-12-31'),('2022','2022-01-01','2022-12-31'),('2023-24','2023-01-01','2024-12-31'),('2025-26','2025-01-01',str(end.date()))]:
    a=window_metrics(ETF['eq'],st,en); b=window_metrics(CUR[1.0]['eq'],st,en); c=window_metrics(IDEAL_TR['eq'],st,en)
    print(f"|{nm}|{p(a['total'])}|{p(a['mdd'])}|{p(b['total'])}|{p(b['mdd'])}|{p(c['total'])}|{p(c['mdd'])}|")

print('CURRENT_1M_CONTRACT_EXAMPLES'); px=float(P.iloc[-1]['close']); dt=P.index[-1]
print(f'price_index={px:.2f} date={dt.date()}')
print('|State|Target x|Target notional|TX|MTX|TMF|Realized notional|Realized x|Current initial margin|')
print('|---|---:|---:|---:|---:|---:|---:|---:|---:|')
for a in [.25,.5,.75,1.0]:
    mult=a*2; tgt=CAP0*mult; c=choose_counts(tgt,px,True); rn=notional(c,px); margin=c['TX']*636000+c['MTX']*159000+c['TMF']*31800
    print(f"|{int(a*100)}% equivalent|{mult:.1f}x|{money(tgt)}|{c['TX']}|{c['MTX']}|{c['TMF']}|{money(rn)}|{rn/CAP0:.3f}x|{money(margin)}|")
print('NOTES')
print('TR proxy corrects v1.15 ex-dividend distortion but is still not actual roll-adjusted TX history. Exact basis and realized roll spread remain unmodeled.')
print('Current-toolkit synthetic allows TMF across full sample to test todays granularity; historical-availability only allows TMF from 2024-07-29.')
print('Unused cash interest=0. Monthly roll costs are modeled separately using user commission, tax, and slippage assumptions.')
print('V116_END')
