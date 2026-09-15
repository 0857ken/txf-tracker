from pathlib import Path
import numpy as np
import pandas as pd

# Reuse v1.21 definitions without executing its top-level block.
p=Path('research/backtest_v121_500_margin_reserve.py')
s=p.read_text(encoding='utf-8')
prefix=s.split("print('V121_BEGIN')",1)[0]
ns={'__name__':'v121defs','__file__':str(p)}
exec(compile(prefix,str(p),'exec'),ns)

START=ns['START']; END=ns['END']; START_CAPITAL=ns['START_CAPITAL']
fetch_futures=ns['fetch_futures']; fetch_margin_events=ns['fetch_margin_events']; load_signal=ns['load_signal']
run_split=ns['run_split']; metrics=ns['metrics']


def pct(v): return f'{100*v:.2f}%'
def money(v): return f'{v:,.0f}'

print('V122_BEGIN')
px=fetch_futures(); sig=load_signal(); events,missing=fetch_margin_events()
print('data_rows',len(px),'margin_events',len(events),'missing_margin_csv',len(missing))
print('annual_external_yield',ns['ANNUAL_YIELD'],'slip',ns['SLIP'],'mode monthly')

levels=[5.0,6.0,7.0]
res={}
for mult in levels:
    ns['RESERVE_MULT']=mult
    print('RUN_RESERVE',mult)
    res[mult]=run_split(px,sig,events,'monthly')

print('MAIN')
print('|Reserve|Terminal|CAGR|MDD|Calmar|Interest|Avg ext share|Transfers|Min close|Min intra|2x close min|2x intra min|')
print('|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|')
for mult,x in res.items():
    m=metrics(x); bc=x.broker_ratio.dropna(); bi=x.intraday_broker_ratio.dropna()
    print(f'|{mult*100:.0f}%|{money(m["terminal"])}|{pct(m["cagr"])}|{pct(m["mdd"])}|{m["calmar"]:.2f}|{money(x.cum_interest.iloc[-1])}|{pct(x.external_share.mean())}|{x.attrs["transfer_count"]}|{pct(bc.min())}|{pct(bi.min())}|{pct((bc/2).min())}|{pct((bi/2).min())}|')

print('DETAIL')
for mult,x in res.items():
    m=metrics(x); bc=x.broker_ratio.dropna(); bi=x.intraday_broker_ratio.dropna()
    dc=bc.idxmin(); di=bi.idxmin(); r=x.loc[di]
    print('RESERVE',mult)
    print('performance terminal',money(m['terminal']),'cagr',pct(m['cagr']),'mdd',pct(m['mdd']),'calmar',f"{m['calmar']:.3f}")
    print('cash interest',money(x.cum_interest.iloc[-1]),'avg_external_share',pct(x.external_share.mean()),'max_external_share',pct(x.external_share.max()),
          'transfers',x.attrs['transfer_count'],'gross_transfer',money(x.attrs['transfer_gross']))
    print('min_close',pct(bc.min()),dc.date(),'min_intraday',pct(bi.min()),di.date(),
          'intraday_fut_equity',money(r.intraday_futures_equity),'intraday_initial',money(r.intraday_initial_margin),
          'intraday_maint',money(r.intraday_maint_margin),'call_equiv',pct(r.intraday_call_equiv_ratio))
    for shock in [1.0,1.5,2.0]:
        close=bc/shock; intra=bi/shock
        ce=x.call_equiv_ratio.reindex(close.index); cei=x.intraday_call_equiv_ratio.reindex(intra.index)
        print('shock',shock,
              'close_min',pct(close.min()),close.idxmin().date(),
              'intra_min',pct(intra.min()),intra.idxmin().date(),
              'intra_below_250',int((intra<2.5).sum()),
              'intra_below_200',int((intra<2.0).sum()),
              'intra_below_150',int((intra<1.5).sum()),
              'intra_below_100',int((intra<1.0).sum()),
              'intra_below_call',int((intra<cei).sum()),
              'close_below_call',int((close<ce).sum()))
    d0=pd.Timestamp('2025-06-02')
    if d0 in x.index:
        q=x.loc[d0]
        print('DATE_2025_06_02','total',money(q.total_equity),'futures',money(q.futures_equity),'external',money(q.external_cash),
              'initial',money(q.initial_margin),'maint',money(q.maint_margin),'close_ratio',pct(q.broker_ratio),
              'intraday_ratio','nan' if pd.isna(q.intraday_broker_ratio) else pct(q.intraday_broker_ratio),
              'transfer',money(q.transfer),'TX/MTX/TMF',int(q.TX),int(q.MTX),int(q.TMF))

print('MARGINAL')
for a,b in [(5.0,6.0),(6.0,7.0)]:
    xa,xb=res[a],res[b]; ma,mb=metrics(xa),metrics(xb)
    ia=(xa.intraday_broker_ratio/2).min(); ib=(xb.intraday_broker_ratio/2).min()
    print(f'{a:.0f}x_to_{b:.0f}x terminal_delta={money(mb["terminal"]-ma["terminal"])} cagr_delta_pp={(mb["cagr"]-ma["cagr"])*100:.3f} 2x_intra_min_gain_pp={(ib-ia)*100:.2f} interest_delta={money(xb.cum_interest.iloc[-1]-xa.cum_interest.iloc[-1])}')

print('VS_00685L')
for mult,x in res.items():
    m=metrics(x)
    print(mult,'terminal_delta',money(m['terminal']-31_700_514),'cagr_delta_pp',f"{(m['cagr']-.441)*100:.3f}",'mdd_delta_pp',f"{(m['mdd']-(-.368))*100:.3f}",'calmar_delta',f"{m['calmar']-1.20:.3f}")

print('DEFINITION broker ratio = futures-account equity / required initial margin. External cash is excluded until transferred.')
print('INTRADAY daily-low proxy uses the position held from prior close and assumes no same-day external transfer rescue; it is conservative, not tick-by-tick.')
print('V122_END')
