from pathlib import Path
import io, csv
import numpy as np
import pandas as pd
import yfinance as yf

# Reuse the audited v1.17 TAIFEX index-futures machinery without executing its report section.
p=Path('research/backtest_v117_actual_futures_margin.py')
s=p.read_text(encoding='utf-8')
s=s.replace('import io, re, math, time, warnings', 'import io, csv, re, math, time, warnings', 1)
old="""    try: df=pd.read_csv(io.StringIO(txt),dtype=str)\n    except Exception: return pd.DataFrame()\n    if df.empty: return df\n    df.columns=[str(c).strip() for c in df.columns]\n"""
new="""    try:\n        rows=list(csv.reader(io.StringIO(txt)))\n        if not rows: return pd.DataFrame()\n        header=[str(c).strip() for c in rows[0]]\n        body=[r[:len(header)] for r in rows[1:] if len(r)>=len(header)]\n        df=pd.DataFrame(body,columns=header,dtype=str)\n    except Exception: return pd.DataFrame()\n    if df.empty: return df\n    df.columns=[str(c).strip() for c in df.columns]\n"""
if old not in s: raise RuntimeError('v117 csv patch target not found')
s=s.replace(old,new,1)
defs=s.split("print('V117_DOWNLOAD_BEGIN')")[0]
ns={'__name__':'v117defs','__file__':str(p)}
exec(compile(defs,str(p),'exec'),ns)

START=ns['START']; END=ns['END']; CAP=ns['START_CAPITAL']
POINT=ns['POINT']; COMM=ns['COMM']; TAX=ns['TAX']
fetch_futures=ns['fetch_futures']; fetch_fut_chunk=ns['fetch_fut_chunk']; chunks=ns['chunks']
load_signal=ns['load_signal']; fetch_margin_events=ns['fetch_margin_events']; margin_state=ns['margin_state']
roll_map=ns['roll_map']; active_expiry=ns['active_expiry']; desired_contracts=ns['desired_contracts']

SRF_START=pd.Timestamp('2024-07-29')
SRF_MULT=1000.0
SRF_COMM_BASE=20.0
SRF_COMM_SENS=[10.0,20.0,30.0]
SRF_INIT_RATE=0.10
SRF_MAINT_RATE=0.08


def fetch_srf():
    out=[]
    for a,b in chunks(SRF_START,END):
        x=fetch_fut_chunk('SRF',a,b)
        if not x.empty: out.append(x)
    if not out: return pd.DataFrame(columns=['date','product','expiry','close','low','settle','session'])
    return pd.concat(out,ignore_index=True).sort_values(['date','expiry'])


def load_0050_total_return():
    x=yf.download('0050.TW',start='2024-07-01',end='2026-09-16',auto_adjust=False,actions=False,progress=False,threads=False)
    if x.empty: raise RuntimeError('0050 download empty')
    if isinstance(x.columns,pd.MultiIndex): x.columns=x.columns.get_level_values(0)
    x.columns=[str(c).lower() for c in x.columns]
    x.index=pd.to_datetime(x.index).tz_localize(None)
    if 'adj close' in x.columns: adj=x['adj close'].astype(float)
    else:
        y=yf.download('0050.TW',start='2024-07-01',end='2026-09-16',auto_adjust=True,actions=False,progress=False,threads=False)
        if isinstance(y.columns,pd.MultiIndex): y.columns=y.columns.get_level_values(0)
        y.columns=[str(c).lower() for c in y.columns]; y.index=pd.to_datetime(y.index).tz_localize(None)
        adj=y['close'].astype(float)
    return adj.sort_index()


def tick(px):
    return 0.01 if px < 50 else 0.05


def calc_metrics(x):
    eq=x['equity']
    total=eq.iloc[-1]/CAP-1
    days=max((eq.index[-1]-START).days,1)
    cagr=(eq.iloc[-1]/CAP)**(365.25/days)-1
    e0=pd.concat([pd.Series([CAP],index=[START-pd.Timedelta(days=1)]),eq])
    dd=e0/e0.cummax()-1; mdd=dd.min()
    return dict(total=total,cagr=cagr,mdd=mdd,calmar=cagr/abs(mdd),terminal=eq.iloc[-1])


def run_hybrid(px,srf,sig,events,adj,idx_slip=1.0,srf_comm=20.0):
    price={(r.product,r.expiry,r.date):float(r.close) for r in px.itertuples()}
    low={(r.product,r.expiry,r.date):float(r.low) if pd.notna(r.low) else float(r.close) for r in px.itertuples()}
    rolls=roll_map(px); exps=sorted(rolls)
    tmf_rows=px[px['product']=='TMF']; tmf_first=tmf_rows['date'].min() if len(tmf_rows) else pd.Timestamp.max
    srf_price={(r.expiry,r.date):float(r.close) for r in srf.itertuples()}
    srf_first=srf['date'].min() if len(srf) else pd.Timestamp.max
    dates=sorted(set(px.loc[px['product']=='TX','date']) & set(sig.loc[(sig.index>=START)&(sig.index<=END)].index))
    equity=CAP; holdings={}; prev_close={}; last_target=2.0
    q_srf=0; prev_srf_unit=0.0; prev_srf_adj=None; prev_exp=None
    rows=[]
    for d in dates:
        eq_start=equity; pnl_idx=0.0
        for (prod,exp),q in holdings.items():
            key=(prod,exp,d)
            if key not in price: raise RuntimeError(f'held index close missing {key}')
            pnl_idx += q*POINT[prod]*(price[key]-prev_close[(prod,exp)])
        pnl_srf=0.0
        if q_srf>0 and prev_srf_adj is not None and d in adj.index:
            r=float(adj.loc[d]/prev_srf_adj-1.0)
            pnl_srf=q_srf*prev_srf_unit*r
        equity += pnl_idx+pnl_srf
        if d in sig.index: last_target=float(sig.loc[d,'target_x'])
        exp=active_expiry(d,rolls,exps)
        if exp is None: continue
        desired=desired_contracts(last_target,equity,d,exp,price,tmf_first)
        base_notional=sum(q*POINT[prod]*price[(prod,ex,d)] for (prod,ex),q in desired.items())
        target_notional=last_target*equity
        residual=max(target_notional-base_notional,0.0)
        sp=srf_price.get((exp,d),np.nan)
        q_new=0
        if d>=srf_first and pd.notna(sp) and sp>0:
            unit=float(sp)*SRF_MULT
            q_new=max(0,int(round(residual/unit)))
        # Index futures trading costs.
        cost_idx=0.0; sides_idx=0
        for k in set(holdings)|set(desired):
            oldq=holdings.get(k,0); newq=desired.get(k,0); delta=newq-oldq
            if delta==0: continue
            prod,ex=k; key=(prod,ex,d); n=abs(delta)
            notion=price[key]*POINT[prod]*n
            cost_idx += n*COMM[prod] + notion*TAX + n*idx_slip*POINT[prod]
            sides_idx += n
        # Residual leg cost. Charge close+open on expiry roll even if quantity is unchanged.
        cost_srf=0.0; sides_srf=0
        if pd.notna(sp) and sp>0:
            unit=float(sp)*SRF_MULT
            if prev_exp is not None and exp!=prev_exp:
                sides_srf=q_srf+q_new
            else:
                sides_srf=abs(q_new-q_srf)
            if sides_srf:
                cost_srf=sides_srf*(srf_comm + unit*TAX + tick(float(sp))*SRF_MULT)
        equity -= (cost_idx+cost_srf)
        holdings=desired
        prev_close={(prod,ex):price[(prod,ex,d)] for prod,ex in holdings}
        q_srf=q_new
        if q_srf>0 and pd.notna(sp) and d in adj.index:
            prev_srf_unit=float(sp)*SRF_MULT
            prev_srf_adj=float(adj.loc[d])
        else:
            prev_srf_unit=0.0
            prev_srf_adj=float(adj.loc[d]) if d in adj.index else prev_srf_adj
        prev_exp=exp
        # Margin: actual reconstructed index-futures margin + conservative residual proxy margin.
        ms=margin_state(events,d); tx_i=ms['initial']; tx_m=ms['maint']; scale={'TX':1.0,'MTX':0.25,'TMF':0.05}
        im_idx=sum(q*tx_i*scale[prod] for (prod,ex),q in holdings.items())
        mm_idx=sum(q*tx_m*scale[prod] for (prod,ex),q in holdings.items())
        srf_notional=q_srf*(float(sp)*SRF_MULT if pd.notna(sp) else 0.0)
        im=im_idx+SRF_INIT_RATE*srf_notional; mm=mm_idx+SRF_MAINT_RATE*srf_notional
        notional=base_notional+srf_notional
        rows.append(dict(date=d,equity=equity,target_x=last_target,realized_x=notional/equity,
                         base_notional=base_notional,srf_notional=srf_notional,q_srf=q_srf,
                         cost_idx=cost_idx,cost_srf=cost_srf,sides_idx=sides_idx,sides_srf=sides_srf,
                         initial_margin=im,maint_margin=mm,initial_usage=im/equity,maint_usage=mm/equity,
                         free_equity=equity-im,TX=sum(q for (p,e),q in holdings.items() if p=='TX'),
                         MTX=sum(q for (p,e),q in holdings.items() if p=='MTX'),TMF=sum(q for (p,e),q in holdings.items() if p=='TMF'),expiry=exp))
    return pd.DataFrame(rows).set_index('date')

print('V118_BEGIN')
px=fetch_futures(); srf=fetch_srf(); sig=load_signal(); events,missing=fetch_margin_events(); adj=load_0050_total_return()
print('index_rows',len(px),'srf_rows',len(srf),'srf_range',srf.date.min().date() if len(srf) else None,srf.date.max().date() if len(srf) else None)
print('margin_events',len(events),'missing_margin_csv',len(missing))
res={}
for c in SRF_COMM_SENS:
    res[c]=run_hybrid(px,srf,sig,events,adj,idx_slip=1.0,srf_comm=c)
base=res[SRF_COMM_BASE]; m=calc_metrics(base)
print('BASE_SRF_COMM_20')
print('terminal',f'{m["terminal"]:,.0f}','total',f'{m["total"]*100:.1f}%','cagr',f'{m["cagr"]*100:.1f}%','mdd',f'{m["mdd"]*100:.1f}%','calmar',f'{m["calmar"]:.2f}')
print('mean_abs_tracking_error',f'{(base.realized_x-base.target_x).abs().mean()*100:.2f}%','post_srf',f'{(base.loc[base.index>=SRF_START,"realized_x"]-base.loc[base.index>=SRF_START,"target_x"]).abs().mean()*100:.2f}%')
print('avg_srf_contracts_post_listing',f'{base.loc[base.index>=SRF_START,"q_srf"].mean():.2f}','max_srf_contracts',int(base.q_srf.max()))
print('srf_cost',f'{base.cost_srf.sum():,.0f}','srf_sides',int(base.sides_srf.sum()),'index_cost',f'{base.cost_idx.sum():,.0f}')
print('max_initial_usage',f'{base.initial_usage.max()*100:.1f}%','max_maint_usage',f'{base.maint_usage.max()*100:.1f}%')
for mult in [1.5,2.0]:
    iu=(base.initial_margin*mult/base.equity); mu=(base.maint_margin*mult/base.equity)
    print('margin_shock',mult,'max_initial',f'{iu.max()*100:.1f}%','max_maint',f'{mu.max()*100:.1f}%','breach_days',int((mu>1).sum()))
print('COMMISSION_SENSITIVITY')
for c,x in res.items():
    z=calc_metrics(x)
    print('comm',int(c),'terminal',f'{z["terminal"]:,.0f}','cagr',f'{z["cagr"]*100:.2f}%','mdd',f'{z["mdd"]*100:.2f}%','calmar',f'{z["calmar"]:.2f}','tracking',f'{(x.realized_x-x.target_x).abs().mean()*100:.2f}%')
print('REFERENCE_V117_1PT terminal=31,504,877 CAGR=44.0% MDD=-38.2% Calmar=1.15 tracking=6.1%')
print('REFERENCE_00685L terminal=31,700,514 CAGR=44.1% MDD=-36.8% Calmar=1.20')
print('V118_END')
