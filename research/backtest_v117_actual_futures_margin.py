import io, re, math, time, warnings
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor, as_completed
from urllib.parse import urljoin

import numpy as np
import pandas as pd
import requests
import yfinance as yf
from bs4 import BeautifulSoup

warnings.filterwarnings('ignore')
requests.packages.urllib3.disable_warnings()

START = pd.Timestamp('2017-03-30')
END = pd.Timestamp('2026-09-15')
DL_START = pd.Timestamp('2016-10-01')
START_CAPITAL = 1_000_000.0
COMM = {'TX':38.0, 'MTX':19.0, 'TMF':16.0}
POINT = {'TX':200.0, 'MTX':50.0, 'TMF':10.0}
TAX = 0.00002
SLIPS = [0.0,1.0,2.0]
TAIFEX = 'https://www.taifex.com.tw'
HEADERS = {'User-Agent':'Mozilla/5.0 (compatible; research-backtest/1.0)'}

# Official-announcement reconstruction for the pre-modern-news-index period.
# Each date is the date the NEW margin became effective after the regular session close.
# Values are TX original/maintenance; MTX=1/4 and TMF=1/20 by contract scale.
MANUAL_MARGIN = [
    ('2017-03-30', 83000, 64000, 'baseline after 2017 spring-holiday reversion'),
    ('2018-02-12', 92000, 71000, '2018 Lunar New Year temporary increase'),
    ('2018-02-22', 83000, 64000, '2018 Lunar New Year reversion'),
    ('2018-10-15', 96000, 74000, '2018-10-12 official adjustment'),
    ('2019-01-30',107000, 82000, '2019 Lunar New Year temporary increase'),
    ('2019-02-12', 96000, 74000, '2019 Lunar New Year reversion'),
    ('2019-02-20',107000, 82000, '2019-02-19 official adjustment'),
    ('2019-07-08', 94000, 72000, '2019-07-05 official adjustment'),
    ('2019-10-02',103000, 79000, '2019-10-01 official adjustment'),
    ('2019-10-21', 91000, 70000, '2019-10-18 official adjustment'),
    ('2020-01-20',100000, 77000, '2020 Lunar New Year temporary increase'),
    ('2020-01-31', 91000, 70000, '2020 Lunar New Year reversion'),
]


def req(method, url, **kw):
    for k in range(5):
        try:
            r = requests.request(method, url, headers=HEADERS, timeout=45, verify=False, **kw)
            r.raise_for_status()
            return r
        except Exception:
            if k == 4: raise
            time.sleep(0.5*(2**k))


def chunks(st,en,days=28):
    x=st
    while x<=en:
        y=min(x+pd.Timedelta(days=days),en)
        yield x,y
        x=y+pd.Timedelta(days=1)


def fetch_fut_chunk(prod,st,en):
    form={'down_type':'1','commodity_id':prod,'queryStartDate':st.strftime('%Y/%m/%d'),
          'queryEndDate':en.strftime('%Y/%m/%d'),'MarketCode':'0'}
    r=req('POST',TAIFEX+'/cht/3/futDataDown',data=form)
    txt=r.content.decode('cp950',errors='replace').strip()
    if not txt or '交易日期' not in txt:
        return pd.DataFrame()
    try: df=pd.read_csv(io.StringIO(txt),dtype=str)
    except Exception: return pd.DataFrame()
    if df.empty: return df
    df.columns=[str(c).strip() for c in df.columns]
    need=['交易日期','契約','到期月份(週別)','收盤價','最低價','結算價','交易時段']
    if any(c not in df.columns for c in need): return pd.DataFrame()
    z=df[need].copy()
    z.columns=['date','product','expiry','close','low','settle','session']
    z['product']=z['product'].astype(str).str.strip()
    z['expiry']=z['expiry'].astype(str).str.strip()
    z['session']=z['session'].astype(str).str.strip()
    z=z[(z['product']==prod)&(z['session']=='一般')&z['expiry'].str.match(r'^\d{6}$',na=False)]
    z['date']=pd.to_datetime(z['date'],errors='coerce')
    for c in ['close','low','settle']:
        z[c]=pd.to_numeric(z[c].replace('-',np.nan),errors='coerce')
    z=z.dropna(subset=['date','close']).drop_duplicates(['date','product','expiry'],keep='last')
    return z


def fetch_futures():
    jobs=[]
    for prod,st in [('TX',DL_START),('MTX',DL_START),('TMF',pd.Timestamp('2024-07-01'))]:
        for a,b in chunks(st,END): jobs.append((prod,a,b))
    out=[]
    with ThreadPoolExecutor(max_workers=4) as ex:
        fut={ex.submit(fetch_fut_chunk,*j):j for j in jobs}
        done=0
        for f in as_completed(fut):
            j=fut[f]; done+=1
            try:
                x=f.result()
                if not x.empty: out.append(x)
            except Exception as e:
                print('DOWNLOAD_ERROR',j,repr(e))
                raise
            if done%50==0: print('download chunks',done,'/',len(jobs))
    z=pd.concat(out,ignore_index=True).sort_values(['date','product','expiry'])
    z=z[(z['date']>=START)&(z['date']<=END)]
    return z


def roc_effective_date(text):
    text=re.sub(r'\s+','',text)
    pats=[r'自(\d{3})年(\d{1,2})月(\d{1,2})日一般交易時段結束後',
          r'實施期間自(\d{3})年(\d{1,2})月(\d{1,2})日一般交易時段結束後']
    for p in pats:
        m=re.search(p,text)
        if m:
            y,mn,d=map(int,m.groups()); return pd.Timestamp(y+1911,mn,d)
    return None


def decode_csv(content):
    for enc in ['cp950','big5','utf-8-sig','utf-8']:
        try:
            s=content.decode(enc)
            if '契約' in s and '保證金' in s: return s
        except Exception: pass
    return None


def fetch_margin_events():
    # Modern searchable announcement index (2020 onward is present in current archive).
    form={'isQuery':'1','queryStartDate':'2020/01/01','queryEndDate':END.strftime('%Y/%m/%d'),
          'newsType':'','queryKeyWord':'臺股期貨'}
    r=req('POST',TAIFEX+'/cht/11/hisNews',data=form)
    s=BeautifulSoup(r.text,'html.parser')
    links=[]
    for a in s.find_all('a',href=True):
        title=' '.join(a.stripped_strings); href=a['href']
        if 'newsDetail' in href and '保證金' in title and ('臺股期貨' in title or '臺指' in title):
            links.append((title,urljoin(TAIFEX+'/cht/11/',href)))
    events=[]; missing=[]
    for title,u in links:
        rr=req('GET',u); ss=BeautifulSoup(rr.text,'html.parser')
        text=' '.join(ss.stripped_strings)
        eff=roc_effective_date(title+' '+text)
        if eff is None or eff<START or eff>END: continue
        csvs=[]
        for a in ss.find_all('a',href=True):
            h=urljoin(u,a['href'])
            if '.csv' in h.lower(): csvs.append(h)
        found=False
        for h in csvs:
            cr=req('GET',h); tx=decode_csv(cr.content)
            if not tx: continue
            try: df=pd.read_csv(io.StringIO(tx),dtype=str)
            except Exception: continue
            df.columns=[str(c).strip() for c in df.columns]
            codecol=next((c for c in df.columns if '契約代碼' in c),None)
            if codecol is None: continue
            row=df[df[codecol].astype(str).str.strip()=='TX']
            if row.empty: continue
            def colpick(key,after=True):
                candidates=[c for c in df.columns if key in c and (('調整後' in c) if after else ('調整前' in c))]
                return candidates[0] if candidates else None
            ca=colpick('原始保證金',True); cm=colpick('維持保證金',True)
            cb=colpick('原始保證金',False); cn=colpick('維持保證金',False)
            # Pandas preserves the full canonical headers used by current TAIFEX files.
            if ca is None: ca=next((c for c in df.columns if c=='調整後原始保證金'),None)
            if cm is None: cm=next((c for c in df.columns if c=='調整後維持保證金'),None)
            if cb is None: cb=next((c for c in df.columns if c=='調整前原始保證金'),None)
            if cn is None: cn=next((c for c in df.columns if c=='調整前維持保證金'),None)
            if not ca or not cm: continue
            q=row.iloc[0]
            def num(c): return float(str(q[c]).replace(',','').strip()) if c and pd.notna(q[c]) else np.nan
            events.append(dict(date=eff,initial=num(ca),maint=num(cm),before_initial=num(cb),before_maint=num(cn),source=u,title=title))
            found=True; break
        if not found: missing.append((eff,title,u))
    # Merge with manual pre-archive events; automatic entries supersede same-date manual records except Jan-2020 fallback.
    all_events=[dict(date=pd.Timestamp(d),initial=float(i),maint=float(m),before_initial=np.nan,before_maint=np.nan,
                     source='manual-official-reconstruction',title=note) for d,i,m,note in MANUAL_MARGIN]
    for e in events:
        all_events=[x for x in all_events if x['date']!=e['date']]
        all_events.append(e)
    all_events=sorted(all_events,key=lambda x:x['date'])
    # Remove exact duplicate states on same date if any.
    uniq=[]
    for e in all_events:
        if uniq and e['date']==uniq[-1]['date']: uniq[-1]=e
        else: uniq.append(e)
    return uniq,missing


def margin_state(events,d):
    x=None
    for e in events:
        if e['date']<=d: x=e
        else: break
    if x is None: raise RuntimeError('no margin state '+str(d))
    return x


def load_signal():
    x=yf.download('0050.TW',start='2016-01-01',end='2026-09-16',auto_adjust=True,actions=False,progress=False,threads=False)
    if isinstance(x.columns,pd.MultiIndex): x.columns=x.columns.get_level_values(0)
    x.columns=[str(c).lower() for c in x.columns]
    x.index=pd.to_datetime(x.index).tz_localize(None)
    x=x.sort_index()
    for n in [10,20,60]: x[f'ma{n}']=x['close'].rolling(n).mean()
    x['ma60_20ago']=x['ma60'].shift(20)
    x['bear']=(x['close']<=x['ma60'])&(x['ma60']<=x['ma60_20ago'])
    t=[]
    for _,r in x.iterrows():
        if not bool(r['bear']): v=2.0
        else:
            v=.5
            if pd.notna(r['ma10']) and r['close']>r['ma10']: v=1.0
            if pd.notna(r['ma20']) and r['close']>r['ma20']: v=1.5
        t.append(v)
    x['target_x']=t
    return x[['close','ma10','ma20','ma60','ma60_20ago','bear','target_x']]


def third_wed(y,m):
    d=pd.Timestamp(y,m,1)
    while d.weekday()!=2: d+=pd.Timedelta(days=1)
    return d+pd.Timedelta(days=14)


def roll_map(px):
    tx=px[px['product']=='TX']
    out={}
    for exp,g in tx.groupby('expiry'):
        y=int(exp[:4]); m=int(exp[4:6]); w=third_wed(y,m)
        prior=g.loc[g['date']<w,'date']
        if len(prior): out[exp]=prior.max()
    return out


def active_expiry(d,rolls,available):
    cands=[]
    for e in available:
        rd=rolls.get(e)
        if rd is not None and rd>d: cands.append(e)
    if not cands: return None
    return min(cands)


def desired_contracts(target_x,equity,d,exp,price_lookup,tmf_first):
    # Deterministic denomination: TX first, MTX residual, and TMF residual after its actual listing.
    use_tmf = d>=tmf_first and ('TMF',exp,d) in price_lookup
    if use_tmf:
        p=price_lookup[('TMF',exp,d)]
        units=max(0,int(round(target_x*equity/(p*POINT['TMF']))))
        qtx=units//20; rem=units%20; qmtx=rem//5; qtmf=rem%5
        q={'TX':qtx,'MTX':qmtx,'TMF':qtmf}
    else:
        p=price_lookup.get(('MTX',exp,d),price_lookup.get(('TX',exp,d)))
        denom=p*POINT['MTX']
        units=max(0,int(round(target_x*equity/denom)))
        qtx=units//4; qmtx=units%4
        q={'TX':qtx,'MTX':qmtx,'TMF':0}
    # If a chosen product has no close for this expiry/date, replace using smaller denomination when possible.
    if q['TX'] and ('TX',exp,d) not in price_lookup:
        q['MTX'] += 4*q['TX']; q['TX']=0
    if q['MTX'] and ('MTX',exp,d) not in price_lookup:
        if use_tmf: q['TMF'] += 5*q['MTX']; q['MTX']=0
        else: raise RuntimeError(f'MTX missing {d} {exp}')
    if q['TMF'] and ('TMF',exp,d) not in price_lookup: raise RuntimeError(f'TMF missing {d} {exp}')
    return {(k,exp):v for k,v in q.items() if v>0}


def run_backtest(px,sig,events,slip):
    # lookups
    price_lookup={(r.product,r.expiry,r.date):float(r.close) for r in px.itertuples()}
    low_lookup={(r.product,r.expiry,r.date):float(r.low) if pd.notna(r.low) else float(r.close) for r in px.itertuples()}
    settle_lookup={(r.product,r.expiry,r.date):float(r.settle) if pd.notna(r.settle) else float(r.close) for r in px.itertuples()}
    rolls=roll_map(px); exps=sorted(rolls)
    tmf_rows=px[px['product']=='TMF']; tmf_first=tmf_rows['date'].min() if len(tmf_rows) else pd.Timestamp.max
    dates=sorted(set(px.loc[px['product']=='TX','date']) & set(sig.loc[(sig.index>=START)&(sig.index<=END)].index))
    equity=START_CAPITAL; holdings={}; prev_close={}; rows=[]; last_target=2.0
    for d in dates:
        # Mark prior holdings from previous close to today's close.
        eq_start=equity; pnl=0.0; intraday_pnl=0.0
        for (prod,exp),q in holdings.items():
            key=(prod,exp,d)
            if key not in price_lookup: raise RuntimeError(f'held close missing {key}')
            cur=price_lookup[key]
            prv=prev_close[(prod,exp)]
            pnl += q*POINT[prod]*(cur-prv)
            lo=low_lookup[key]
            intraday_pnl += q*POINT[prod]*(lo-prv)
        equity += pnl
        intraday_equity=eq_start+intraday_pnl

        # 0050 close is known before futures regular close; use that day's frozen signal.
        if d in sig.index: last_target=float(sig.loc[d,'target_x'])
        exp=active_expiry(d,rolls,exps)
        if exp is None: continue
        desired=desired_contracts(last_target,equity,d,exp,price_lookup,tmf_first)

        # Execute at regular-session close; contract-expiry changes create both closing and opening sides.
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

        ms=margin_state(events,d); tx_i=ms['initial']; tx_m=ms['maint']
        scale={'TX':1.0,'MTX':0.25,'TMF':0.05}
        im=sum(q*tx_i*scale[prod] for (prod,ex),q in holdings.items())
        mm=sum(q*tx_m*scale[prod] for (prod,ex),q in holdings.items())
        notional=sum(q*POINT[prod]*price_lookup[(prod,ex,d)] for (prod,ex),q in holdings.items())
        rows.append(dict(date=d,equity=equity,pnl=pnl,cost=cost,sides=sides,target_x=last_target,
                         realized_x=notional/equity if equity else np.nan,notional=notional,
                         initial_margin=im,maint_margin=mm,initial_usage=im/equity,maint_usage=mm/equity,
                         free_equity=equity-im,intraday_equity_floor=intraday_equity,
                         intraday_maint_usage=mm/intraday_equity if intraday_equity>0 else np.inf,
                         TX=sum(q for (p,e),q in holdings.items() if p=='TX'),
                         MTX=sum(q for (p,e),q in holdings.items() if p=='MTX'),
                         TMF=sum(q for (p,e),q in holdings.items() if p=='TMF'),expiry=exp,
                         margin_tx_initial=tx_i,margin_tx_maint=tx_m))
    return pd.DataFrame(rows).set_index('date')


def metrics(x):
    eq=x['equity']; total=eq.iloc[-1]/eq.iloc[0]-1
    days=max((eq.index[-1]-eq.index[0]).days,1); cagr=(eq.iloc[-1]/eq.iloc[0])**(365.25/days)-1
    dd=eq/eq.cummax()-1; mdd=dd.min(); return dict(total=total,cagr=cagr,mdd=mdd,calmar=cagr/abs(mdd))


def stress_metrics(x,st,en):
    z=x[(x.index>=pd.Timestamp(st))&(x.index<=pd.Timestamp(en))]
    if len(z)<2: return (np.nan,np.nan)
    eq=z['equity']/z['equity'].iloc[0]; return (eq.iloc[-1]-1,(eq/eq.cummax()-1).min())


def pct(v): return f'{100*v:.1f}%'

def money(v): return f'{v:,.0f}'

print('V117_DOWNLOAD_BEGIN')
px=fetch_futures(); print('rows',len(px),'products',px.groupby('product').size().to_dict(),'range',px.date.min().date(),px.date.max().date())
sig=load_signal(); events,missing=fetch_margin_events()
print('margin events',len(events),'missing announcement csv',len(missing))
print('margin event first/last',events[0]['date'].date(),events[-1]['date'].date())
# Continuity audit for automatic events where before-values are available.
prev=None; mism=[]
for e in events:
    if pd.notna(e.get('before_initial',np.nan)) and prev is not None:
        if abs(e['before_initial']-prev['initial'])>1 or abs(e['before_maint']-prev['maint'])>1:
            mism.append((e['date'].date(),prev['initial'],prev['maint'],e['before_initial'],e['before_maint'],e['title'][:60]))
    prev=e
print('margin chain mismatches',len(mism))
for z in mism[:20]: print('MARGIN_CHAIN_MISMATCH',z)
print('missing csv examples',[(str(d.date()),t[:80]) for d,t,u in missing[:10]])

results={}
for s in SLIPS:
    print('RUN slip',s)
    results[s]=run_backtest(px,sig,events,s)

print('V117_RESULT_BEGIN')
print(f'data {START.date()} to {END.date()} start_capital={START_CAPITAL:,.0f}')
print('signal=0050 frozen; actual TAIFEX TX/MTX/TMF regular-session contract closes; roll=trading day before third Wednesday')
print('MAIN')
print('|Slip pts/side|Terminal|Total|CAGR|MDD|Calmar|Max initial usage|Max maint usage|Max regular-session-low maint usage|')
print('|---:|---:|---:|---:|---:|---:|---:|---:|---:|')
for s,x in results.items():
    m=metrics(x)
    print(f'|{s:g}|{money(x.equity.iloc[-1])}|{pct(m["total"])}|{pct(m["cagr"])}|{pct(m["mdd"])}|{m["calmar"]:.2f}|{pct(x.initial_usage.max())}|{pct(x.maint_usage.max())}|{pct(x.intraday_maint_usage.replace(np.inf,np.nan).max())}|')

base=results[1.0]; bm=metrics(base)
print('MARGIN_WORST_BASE')
for col in ['initial_usage','maint_usage','intraday_maint_usage']:
    z=base[col].replace(np.inf,np.nan); d=z.idxmax(); r=base.loc[d]
    print(col,'date',d.date(),'value',pct(z.loc[d]),'equity',money(r.equity),'TX/MTX/TMF',int(r.TX),int(r.MTX),int(r.TMF),'initial',money(r.initial_margin),'maint',money(r.maint_margin),'free',money(r.free_equity),'target',r.target_x,'x','expiry',r.expiry)

print('MARGIN_SHOCK_BASE')
for mult in [1.0,1.5,2.0]:
    iu=base.initial_margin*mult/base.equity; mu=base.maint_margin*mult/base.equity
    d=iu.idxmax(); r=base.loc[d]
    print(f'{mult:.1f}x max_initial_usage={pct(iu.max())} date={d.date()} equity={money(r.equity)} holdings={int(r.TX)}/{int(r.MTX)}/{int(r.TMF)} free_after_initial={money(r.equity-r.initial_margin*mult)} max_maint_usage={pct(mu.max())} maint_breach_days={int((mu>1).sum())}')

print('MARGIN_GATES')
m1=(base.maint_usage<=1).all(); m2=base.initial_usage.max()<=.50
m3_15=((base.maint_margin*1.5/base.equity)<=1).all(); m3_20=((base.maint_margin*2/base.equity)<=1).all()
print('M1 survival',m1,'breach_days',int((base.maint_usage>1).sum()))
print('M2 max original <=50%',m2,'actual',pct(base.initial_usage.max()))
print('M3 1.5x no maint breach',m3_15,'max',pct((base.maint_margin*1.5/base.equity).max()))
print('M3 2.0x no maint breach',m3_20,'max',pct((base.maint_margin*2/base.equity).max()))

print('PERFORMANCE_GATES_VS_00685L')
print('00685L reference CAGR=44.1% MDD=-36.8% Calmar=1.20')
p1=bm['cagr']>=.446; p2=bm['mdd']>=-.388; p3=bm['calmar']>=1.20
m2pt=metrics(results[2.0]); p4=m2pt['cagr']>=.441-.005  # not materially collapse: <=0.5pp below benchmark tolerated for diagnostic
print('P1 CAGR>=44.6',p1,pct(bm['cagr']))
print('P2 MDD>=-38.8',p2,pct(bm['mdd']))
print('P3 Calmar>=1.20',p3,f'{bm["calmar"]:.2f}')
print('P4 2pt CAGR not materially below 00685L',p4,pct(m2pt['cagr']))

print('STRESS_BASE_1PT')
print('|Window|Futures total|Futures MDD|')
print('|---|---:|---:|')
for nm,st,en in [('2018','2018-01-01','2018-12-31'),('COVID2020','2020-01-01','2020-12-31'),('2022','2022-01-01','2022-12-31'),('2023-24','2023-01-01','2024-12-31'),('2025-26','2025-01-01','2026-09-15')]:
    a,b=stress_metrics(base,st,en); print(f'|{nm}|{pct(a)}|{pct(b)}|')

print('COSTS_BASE_1PT')
print('total_cost',money(base.cost.sum()),'transaction_sides_contracts',int(base.sides.sum()),'avg_realized_x',f'{base.realized_x.mean():.3f}','mean_abs_tracking_error',pct((base.realized_x-base.target_x).abs().mean()))
print('DATA_QUALITY margin_chain_mismatches=',len(mism),'missing_margin_announcement_csv=',len(missing))
print('OVERALL_MARGIN_PASS=',bool(m1 and m2 and m3_20))
print('OVERALL_PERFORMANCE_PASS=',bool(p1 and p2 and p3 and p4))
print('V117_RESULT_END')
