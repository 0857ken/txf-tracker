import calendar
import math
import numpy as np
import pandas as pd
import yfinance as yf

START='2015-01-01'; END='2026-09-16'; LISTING=pd.Timestamp('2017-03-30')
CAP0=1_000_000.0
TMF_START=pd.Timestamp('2024-07-29')
TAX=0.00002
COMM={'TX':38.0,'MTX':19.0,'TMF':16.0}
MULT={'TX':200.0,'MTX':50.0,'TMF':10.0}
ETF_COMM=0.0005; ETF_TAX=0.0010; ETF_SLIP=0.0003


def dl(t):
    x=yf.download(t,start=START,end=END,auto_adjust=True,actions=False,progress=False,threads=False)
    if x.empty: raise RuntimeError(t)
    if isinstance(x.columns,pd.MultiIndex): x.columns=x.columns.get_level_values(0)
    x.columns=[c.lower() for c in x.columns]
    x.index=pd.to_datetime(x.index).tz_localize(None)
    return x.sort_index()


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
    o['alloc']=vals
    o['fut_mult']=o['alloc']*2.0
    return o


def metrics_from_eq(eq):
    eq=eq.dropna()
    if len(eq)<2: return dict(total=np.nan,cagr=np.nan,mdd=np.nan,calmar=np.nan,terminal=np.nan)
    total=eq.iloc[-1]/eq.iloc[0]-1
    days=max((eq.index[-1]-eq.index[0]).days,1)
    cagr=(eq.iloc[-1]/eq.iloc[0])**(365.25/days)-1
    dd=eq/eq.cummax()-1; mdd=dd.min()
    return dict(total=float(total),cagr=float(cagr),mdd=float(mdd),calmar=float(cagr/abs(mdd)) if mdd<0 else np.nan,terminal=float(eq.iloc[-1]))


def window_metrics(eq,st,en=None):
    x=eq[eq.index>=pd.Timestamp(st)]
    if en is not None: x=x[x.index<=pd.Timestamp(en)]
    if len(x)<2: return dict(total=np.nan,mdd=np.nan)
    base=x.iloc[0]
    z=x/base
    return dict(total=float(z.iloc[-1]-1),mdd=float((z/z.cummax()-1).min()))


def run_etf(sig,asset):
    m=pd.concat([sig['alloc'],asset['close'].rename('px')],axis=1,join='inner').dropna()
    pos=m['alloc'].shift(1).fillna(0.0)
    r=m['px'].pct_change().fillna(0.0)
    d=pos-pos.shift(1).fillna(0.0)
    cost=d.abs()*(ETF_COMM+ETF_SLIP)+(-d).clip(lower=0)*ETF_TAX
    ret=pos*r-cost
    eq=CAP0*(1+ret).cumprod()
    return pd.DataFrame({'eq':eq,'ret':ret,'pos':pos,'cost_pct':cost,'delta':d})


def run_ideal(sig,index):
    m=pd.concat([sig['fut_mult'],index['close'].rename('px')],axis=1,join='inner').dropna()
    pos=m['fut_mult'].shift(1).fillna(0.0)
    r=m['px'].pct_change().fillna(0.0)
    ret=pos*r
    eq=CAP0*(1+ret).cumprod()
    return pd.DataFrame({'eq':eq,'ret':ret,'pos':pos})


def third_wed(year,month):
    cal=calendar.monthcalendar(year,month)
    weds=[wk[calendar.WEDNESDAY] for wk in cal if wk[calendar.WEDNESDAY]!=0]
    return pd.Timestamp(year=year,month=month,day=weds[2])


def roll_dates(index_dates):
    idx=pd.DatetimeIndex(index_dates)
    out=set()
    months=sorted(set((d.year,d.month) for d in idx))
    for y,m in months:
        exp=third_wed(y,m)
        prev=idx[(idx<exp)&(idx.year==y)&(idx.month==m)]
        if len(prev): out.add(prev.max())
    return out


def choose_counts(target_notional,idx_px,micro_allowed=True):
    unit=idx_px*10.0
    if target_notional<=0 or unit<=0: return {'TX':0,'MTX':0,'TMF':0}
    if micro_allowed:
        units=max(0,int(round(target_notional/unit)))
    else:
        mt_unit=idx_px*50.0
        n=max(0,int(round(target_notional/mt_unit)))
        units=5*n
    tx=units//20; rem=units%20
    mtx=rem//5; tmf=rem%5 if micro_allowed else 0
    return {'TX':int(tx),'MTX':int(mtx),'TMF':int(tmf)}


def notional(counts,px):
    return sum(counts[k]*MULT[k]*px for k in counts)


def side_cost(counts_sides,px,slip_points):
    comm=sum(counts_sides[k]*COMM[k] for k in counts_sides)
    tax=sum(counts_sides[k]*MULT[k]*px*TAX for k in counts_sides)
    slip=sum(counts_sides[k]*MULT[k]*slip_points for k in counts_sides)
    return comm+tax+slip,comm,tax,slip


def run_integer(sig,index,mode='current',slip_points=1.0):
    m=pd.concat([sig['fut_mult'],index['close'].rename('px')],axis=1,join='inner').dropna()
    dates=m.index
    rolls=roll_dates(dates)
    counts={'TX':0,'MTX':0,'TMF':0}
    equity=CAP0
    rows=[]
    total_cost=0.0; total_roll_cost=0.0; total_comm=0.0; total_tax=0.0; total_slip=0.0; total_sides=0
    prev_px=None
    for i,d in enumerate(dates):
        px=float(m.at[d,'px'])
        # P&L from prior close to this close using prior contract counts
        pnl=0.0
        if prev_px is not None:
            pnl=sum(counts[k]*MULT[k]*(px-prev_px) for k in counts)
            equity += pnl
        target_mult=float(m.at[d,'fut_mult'])
        target_notional=target_mult*equity
        micro_allowed=(mode=='current') or (d>=TMF_START)
        new_counts=choose_counts(target_notional,px,micro_allowed=micro_allowed)
        is_roll=d in rolls and i>0
        if is_roll:
            sides={k:counts[k]+new_counts[k] for k in counts}
        else:
            sides={k:abs(new_counts[k]-counts[k]) for k in counts}
        c,cc,tt,ss=side_cost(sides,px,slip_points)
        equity -= c
        total_cost += c; total_comm+=cc; total_tax+=tt; total_slip+=ss; total_sides+=sum(sides.values())
        if is_roll: total_roll_cost += c
        counts=new_counts
        realized=notional(counts,px)
        realized_mult=realized/equity if equity>0 else np.nan
        track=(realized-target_notional)/equity if equity>0 else np.nan
        margin_current=counts['TX']*636000+counts['MTX']*159000+counts['TMF']*31800
        rows.append({'date':d,'eq':equity,'pnl':pnl,'cost':c,'target_mult':target_mult,'realized_mult':realized_mult,'track_err':track,
                     'TX':counts['TX'],'MTX':counts['MTX'],'TMF':counts['TMF'],'roll':is_roll,'margin_current_schedule':margin_current})
        prev_px=px
    out=pd.DataFrame(rows).set_index('date')
    out.attrs.update(total_cost=total_cost,roll_cost=total_roll_cost,commission=total_comm,tax=total_tax,slippage=total_slip,sides=total_sides)
    return out


def p(x): return f'{x*100:.1f}%'
def money(x): return f'{x:,.0f}'

S=add_sig(dl('0050.TW')); E=dl('00685L.TW'); I=dl('^TWII')
end=min(S.index.max(),E.index.max(),I.index.max())
S=S[(S.index>=LISTING)&(S.index<=end)]; E=E[(E.index>=LISTING)&(E.index<=end)]; I=I[(I.index>=LISTING)&(I.index<=end)]
common=S.index.intersection(E.index).intersection(I.index)
S=S.loc[common]; E=E.loc[common]; I=I.loc[common]

ETF=run_etf(S,E); IDEAL=run_ideal(S,I)
CUR={sp:run_integer(S,I,'current',sp) for sp in [0.0,1.0,2.0]}
HIST=run_integer(S,I,'historical',1.0)

print('V115_BEGIN')
print(f'data {common.min().date()} to {common.max().date()} start_capital={money(CAP0)}')
print('signal=0050 frozen MA10/20/60 rule; ETF=00685L; futures proxy=TAIEX close-to-close')
print('user commissions one-way TX/MTX/TMF = 38/19/16 NTD; tax=0.002%; base slip=1 index point/side')
print('MAIN')
print('|Implementation|Terminal NTD|Total|CAGR|MDD|Calmar|')
print('|---|---:|---:|---:|---:|---:|')
for name,df in [('00685L base-cost',ETF),('Ideal continuous futures',IDEAL),('Futures current toolkit 1pt',CUR[1.0]),('Futures historical availability 1pt',HIST)]:
    mm=metrics_from_eq(df['eq'])
    print(f"|{name}|{money(mm['terminal'])}|{p(mm['total'])}|{p(mm['cagr'])}|{p(mm['mdd'])}|{mm['calmar']:.2f}|")

print('FUTURES_SLIPPAGE_CURRENT_TOOLKIT')
print('|Slippage points/side|Terminal NTD|CAGR|MDD|Total costs NTD|Roll costs NTD|Sides|Avg realized x|Mean abs tracking error|Max current-schedule margin/equity|')
print('|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|')
for sp,df in CUR.items():
    mm=metrics_from_eq(df['eq']); avgx=df['realized_mult'].mean(); mae=df['track_err'].abs().mean(); mr=(df['margin_current_schedule']/df['eq']).max()
    print(f"|{sp:.0f}|{money(mm['terminal'])}|{p(mm['cagr'])}|{p(mm['mdd'])}|{money(df.attrs['total_cost'])}|{money(df.attrs['roll_cost'])}|{df.attrs['sides']}|{avgx:.3f}|{p(mae)}|{p(mr)}|")

print('COST_BREAKDOWN_CURRENT_1PT')
d=CUR[1.0]
print(f"commission={money(d.attrs['commission'])} tax={money(d.attrs['tax'])} slippage={money(d.attrs['slippage'])} total={money(d.attrs['total_cost'])} roll_component={money(d.attrs['roll_cost'])}")

print('STRESS')
print('|Window|00685L Total|00685L MDD|Futures current Total|Futures current MDD|Ideal futures Total|Ideal MDD|')
print('|---|---:|---:|---:|---:|---:|---:|')
for nm,st,en in [('2018','2018-01-01','2018-12-31'),('COVID2020','2020-01-01','2020-12-31'),('2022','2022-01-01','2022-12-31'),('2023-24','2023-01-01','2024-12-31'),('2025-26','2025-01-01',str(end.date()))]:
    a=window_metrics(ETF['eq'],st,en); b=window_metrics(CUR[1.0]['eq'],st,en); c=window_metrics(IDEAL['eq'],st,en)
    print(f"|{nm}|{p(a['total'])}|{p(a['mdd'])}|{p(b['total'])}|{p(b['mdd'])}|{p(c['total'])}|{p(c['mdd'])}|")

print('CURRENT_1M_CONTRACT_EXAMPLES')
px=float(I.iloc[-1]['close']); dt=I.index[-1]
print(f'index_proxy_close={px:.2f} date={dt.date()}')
print('|State|Target x|Target notional|TX|MTX|TMF|Realized notional|Realized x|Current initial margin|')
print('|---|---:|---:|---:|---:|---:|---:|---:|---:|')
for alloc in [.25,.50,.75,1.0]:
    mult=alloc*2; tgt=CAP0*mult; cc=choose_counts(tgt,px,True); rn=notional(cc,px); margin=cc['TX']*636000+cc['MTX']*159000+cc['TMF']*31800
    print(f"|{int(alloc*100)}% 00685L-equivalent|{mult:.1f}x|{money(tgt)}|{cc['TX']}|{cc['MTX']}|{cc['TMF']}|{money(rn)}|{rn/CAP0:.3f}x|{money(margin)}|")

print('NOTES')
print('TMF synthetic current-toolkit series assumes today\'s micro contract granularity existed for the full sample; historical-availability version only allows TMF from 2024-07-29.')
print('Futures proxy uses TAIEX close changes, not actual roll-adjusted TX closes; basis/dividend fair value/roll spread are not modeled.')
print('Monthly roll proxy charges two transaction sides on the trading day before third Wednesday; 1pt scenario includes 1 index point slippage per side.')
print('Unused cash earns 0%. Current margin schedule is used only as a feasibility diagnostic, not as historical margin data.')
print('V115_END')
