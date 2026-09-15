from pathlib import Path
import csv
import numpy as np
import pandas as pd

# Load the v1.17 definitions, applying the same corrections used by run_v117_fixed.py,
# but stop before its top-level execution block.
p=Path('research/backtest_v117_actual_futures_margin.py')
s=p.read_text(encoding='utf-8')
s=s.replace('import io, re, math, time, warnings', 'import io, csv, re, math, time, warnings', 1)
s=s.replace("('2020-01-31', 91000, 70000, '2020 Lunar New Year reversion')",
            "('2020-01-31',110000, 84000, '2020-01-30 official post-holiday adjustment')", 1)
old="""    try: df=pd.read_csv(io.StringIO(txt),dtype=str)\n    except Exception: return pd.DataFrame()\n    if df.empty: return df\n    df.columns=[str(c).strip() for c in df.columns]\n"""
new="""    try:\n        rows=list(csv.reader(io.StringIO(txt)))\n        if not rows: return pd.DataFrame()\n        header=[str(c).strip() for c in rows[0]]\n        body=[r[:len(header)] for r in rows[1:] if len(r)>=len(header)]\n        df=pd.DataFrame(body,columns=header,dtype=str)\n    except Exception: return pd.DataFrame()\n    if df.empty: return df\n    df.columns=[str(c).strip() for c in df.columns]\n"""
if old not in s: raise RuntimeError('CSV parser patch target not found')
s=s.replace(old,new,1)
prefix=s.split("print('V117_DOWNLOAD_BEGIN')",1)[0]
ns={'__name__':'v117defs','__file__':str(p)}
exec(compile(prefix,str(p),'exec'),ns)

START=ns['START']; END=ns['END']; START_CAPITAL=ns['START_CAPITAL']
COMM=ns['COMM']; POINT=ns['POINT']; TAX=ns['TAX']
fetch_futures=ns['fetch_futures']; fetch_margin_events=ns['fetch_margin_events']; load_signal=ns['load_signal']
roll_map=ns['roll_map']; active_expiry=ns['active_expiry']; desired_contracts=ns['desired_contracts']; margin_state=ns['margin_state']


def run_cash(px,sig,events,annual_yield,slip=1.0):
    price_lookup={(r.product,r.expiry,r.date):float(r.close) for r in px.itertuples()}
    low_lookup={(r.product,r.expiry,r.date):float(r.low) if pd.notna(r.low) else float(r.close) for r in px.itertuples()}
    rolls=roll_map(px); exps=sorted(rolls)
    tmf_rows=px[px['product']=='TMF']; tmf_first=tmf_rows['date'].min() if len(tmf_rows) else pd.Timestamp.max
    dates=sorted(set(px.loc[px['product']=='TX','date']) & set(sig.loc[(sig.index>=START)&(sig.index<=END)].index))

    equity=START_CAPITAL; holdings={}; prev_close={}; rows=[]; last_target=2.0
    prev_date=None; prev_free_cash=START_CAPITAL; cumulative_interest=0.0

    for d in dates:
        # Interest is earned on prior trading day's equity in excess of required initial margin.
        interest=0.0
        if prev_date is not None and annual_yield>0 and prev_free_cash>0:
            gap=max((d-prev_date).days,0)
            interest=prev_free_cash*((1.0+annual_yield)**(gap/365.25)-1.0)
            equity += interest
            cumulative_interest += interest

        eq_start=equity; pnl=0.0; intraday_pnl=0.0
        for (prod,exp),q in holdings.items():
            key=(prod,exp,d)
            if key not in price_lookup: raise RuntimeError(f'held close missing {key}')
            cur=price_lookup[key]; prv=prev_close[(prod,exp)]
            pnl += q*POINT[prod]*(cur-prv)
            lo=low_lookup[key]
            intraday_pnl += q*POINT[prod]*(lo-prv)
        equity += pnl
        intraday_equity=eq_start+intraday_pnl

        if d in sig.index: last_target=float(sig.loc[d,'target_x'])
        exp=active_expiry(d,rolls,exps)
        if exp is None: continue
        desired=desired_contracts(last_target,equity,d,exp,price_lookup,tmf_first)

        allk=set(holdings)|set(desired); cost=0.0; sides=0
        for k in allk:
            old=holdings.get(k,0); new=desired.get(k,0); delta=new-old
            if delta==0: continue
            prod,ex=k; key=(prod,ex,d)
            if key not in price_lookup: raise RuntimeError(f'trade close missing {key}')
            n=abs(delta); notion=price_lookup[key]*POINT[prod]*n
            cost += n*COMM[prod] + notion*TAX + n*slip*POINT[prod]
            sides += n
        equity -= cost
        holdings=desired
        prev_close={(prod,ex):price_lookup[(prod,ex,d)] for prod,ex in holdings}

        ms=margin_state(events,d); tx_i=ms['initial']; tx_m=ms['maint']; scale={'TX':1.0,'MTX':0.25,'TMF':0.05}
        im=sum(q*tx_i*scale[prod] for (prod,ex),q in holdings.items())
        mm=sum(q*tx_m*scale[prod] for (prod,ex),q in holdings.items())
        notional=sum(q*POINT[prod]*price_lookup[(prod,ex,d)] for (prod,ex),q in holdings.items())
        free_cash=max(equity-im,0.0)
        rows.append(dict(date=d,equity=equity,pnl=pnl,interest=interest,cum_interest=cumulative_interest,cost=cost,
                         target_x=last_target,realized_x=notional/equity if equity else np.nan,notional=notional,
                         initial_margin=im,maint_margin=mm,initial_usage=im/equity,maint_usage=mm/equity,
                         free_cash=free_cash,intraday_equity_floor=intraday_equity,
                         TX=sum(q for (p,e),q in holdings.items() if p=='TX'),
                         MTX=sum(q for (p,e),q in holdings.items() if p=='MTX'),
                         TMF=sum(q for (p,e),q in holdings.items() if p=='TMF'),expiry=exp))
        prev_free_cash=free_cash; prev_date=d
    return pd.DataFrame(rows).set_index('date')


def metrics(x):
    eq=x['equity']; total=eq.iloc[-1]/START_CAPITAL-1
    days=max((eq.index[-1]-START).days,1)
    cagr=(eq.iloc[-1]/START_CAPITAL)**(365.25/days)-1
    eqs=pd.concat([pd.Series([START_CAPITAL],index=[START-pd.Timedelta(days=1)]),eq])
    dd=eqs/eqs.cummax()-1; mdd=dd.min()
    return dict(total=float(total),cagr=float(cagr),mdd=float(mdd),calmar=float(cagr/abs(mdd)),terminal=float(eq.iloc[-1]))


def pct(v): return f'{100*v:.2f}%'
def money(v): return f'{v:,.0f}'

print('V119_BEGIN')
px=fetch_futures(); sig=load_signal(); events,missing=fetch_margin_events()
print('data_rows',len(px),'margin_events',len(events),'missing_margin_csv',len(missing))

rates=[0.0,0.015,0.02,0.03]
res={}
for r in rates:
    print('RUN_YIELD',r)
    res[r]=run_cash(px,sig,events,r,1.0)

print('MAIN')
print('|Free-cash yield|Terminal|Total|CAGR|MDD|Calmar|Cum interest|Max initial usage|Max maint usage|2x shock breach days|')
print('|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|')
for r,x in res.items():
    m=metrics(x); shock=(x.maint_margin*2/x.equity)
    print(f'|{100*r:.1f}%|{money(m["terminal"])}|{pct(m["total"])}|{pct(m["cagr"])}|{pct(m["mdd"])}|{m["calmar"]:.2f}|{money(x.cum_interest.iloc[-1])}|{pct(x.initial_usage.max())}|{pct(x.maint_usage.max())}|{int((shock>1).sum())}|')

print('DELTA_VS_ZERO')
base=metrics(res[0.0])
for r in rates[1:]:
    m=metrics(res[r])
    print(f'yield={100*r:.1f}% terminal_delta={money(m["terminal"]-base["terminal"])} cagr_delta_pp={(m["cagr"]-base["cagr"])*100:.3f} interest={money(res[r].cum_interest.iloc[-1])}')

# Approximate break-even yield via bisection. Because integer sizing can make the mapping non-smooth,
# this is an approximate operational threshold rather than an analytic solution.
def solve_rate(target_cagr,lo=0.0,hi=0.06):
    flo=metrics(run_cash(px,sig,events,lo,1.0))['cagr']-target_cagr
    fhi=metrics(run_cash(px,sig,events,hi,1.0))['cagr']-target_cagr
    if flo>=0: return lo
    if fhi<0: return np.nan
    for _ in range(12):
        mid=(lo+hi)/2
        fm=metrics(run_cash(px,sig,events,mid,1.0))['cagr']-target_cagr
        if fm>=0: hi=mid
        else: lo=mid
    return hi

r441=solve_rate(.441); r446=solve_rate(.446)
print('BREAK_EVEN')
print('yield_to_match_00685L_CAGR_44.1', 'nan' if pd.isna(r441) else pct(r441))
print('yield_to_reach_replacement_CAGR_44.6', 'nan' if pd.isna(r446) else pct(r446))

print('REFERENCE')
print('v117 futures 0% approx terminal=31,504,877 CAGR=44.0 MDD=-38.2 Calmar=1.15')
print('00685L benchmark terminal=31,700,514 CAGR=44.1 MDD=-36.8 Calmar=1.20')
print('ASSUMPTION free cash only; posted initial margin earns 0%; free-cash yield has no tax/fees/haircut/liquidity delay')
print('V119_END')
