from pathlib import Path
import pandas as pd

# Reuse the frozen v1.21 implementation without executing its top-level block.
p=Path('research/backtest_v121_500_margin_reserve.py')
s=p.read_text(encoding='utf-8')
prefix=s.split("print('V121_BEGIN')",1)[0]
ns={'__name__':'v121defs','__file__':str(p)}
exec(compile(prefix,str(p),'exec'),ns)

fetch_futures=ns['fetch_futures']; fetch_margin_events=ns['fetch_margin_events']; load_signal=ns['load_signal']
run_split=ns['run_split']; metrics=ns['metrics']
ns['RESERVE_MULT']=5.0


def pct(v): return f'{100*v:.2f}%'
def money(v): return f'{v:,.0f}'

print('V123_BEGIN')
px=fetch_futures(); sig=load_signal(); events,missing=fetch_margin_events()
print('data_rows',len(px),'margin_events',len(events),'missing_margin_csv',len(missing))
x=run_split(px,sig,events,'monthly')
m=metrics(x)
print('BASE500 terminal',money(m['terminal']),'cagr',pct(m['cagr']),'mdd',pct(m['mdd']),'calmar',f"{m['calmar']:.3f}")

# State audit. target_x is the index exposure target: 0.5x/1.0x/1.5x/2.0x.
# Equivalent 00685L allocations are 25%/50%/75%/100% respectively.
labels={0.5:'25% ETF-equivalent / 0.5x index',1.0:'50% / 1.0x',1.5:'75% / 1.5x',2.0:'100% / 2.0x'}
total_days=len(x)
print('STATE_TABLE')
print('|target_x|equiv|days|share|avg_total_equity|avg_initial_margin|avg_initial_margin_pct_equity|avg_5x_reserve_target|avg_reserve_target_pct_equity|avg_futures_equity|avg_futures_share|avg_external_cash|avg_external_share|median_external_share|')
print('|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|')
for t in [0.5,1.0,1.5,2.0]:
    g=x[x.target_x==t]
    if g.empty: continue
    print(f'|{t:.1f}|{labels[t]}|{len(g)}|{pct(len(g)/total_days)}|{money(g.total_equity.mean())}|{money(g.initial_margin.mean())}|{pct((g.initial_margin/g.total_equity).mean())}|{money(g.reserve_target.mean())}|{pct((g.reserve_target/g.total_equity).mean())}|{money(g.futures_equity.mean())}|{pct((g.futures_equity/g.total_equity).mean())}|{money(g.external_cash.mean())}|{pct(g.external_share.mean())}|{pct(g.external_share.median())}|')

print('STATE_DETAIL')
for t in [0.5,1.0,1.5,2.0]:
    g=x[x.target_x==t]
    if g.empty: continue
    print('STATE',t,'days',len(g),'share',pct(len(g)/total_days),
          'avg_initial',money(g.initial_margin.mean()),
          'avg_initial_pct_total',pct((g.initial_margin/g.total_equity).mean()),
          'avg_5x_target',money(g.reserve_target.mean()),
          'avg_target_pct_total',pct((g.reserve_target/g.total_equity).mean()),
          'avg_external_share',pct(g.external_share.mean()),
          'median_external_share',pct(g.external_share.median()),
          'min_external_share',pct(g.external_share.min()),
          'max_external_share',pct(g.external_share.max()),
          'avg_realized_x',f'{g.realized_x.mean():.3f}')

# Count state transitions and spell lengths to show how often cash management state changes are driven by the signal.
state=x.target_x
transitions=int((state!=state.shift(1)).sum()-1)
print('TRANSITIONS',transitions)
for t in [0.5,1.0,1.5,2.0]:
    mask=(state==t)
    # run ids increment whenever state changes
    run_id=(state!=state.shift(1)).cumsum()
    lengths=x[mask].groupby(run_id[mask]).size()
    if len(lengths):
        print('SPELL',t,'episodes',len(lengths),'avg_days',f'{lengths.mean():.1f}','median_days',f'{lengths.median():.1f}','max_days',int(lengths.max()))

print('CHECK totals days',sum(int((x.target_x==t).sum()) for t in [0.5,1.0,1.5,2.0]),'all_days',total_days)
print('DEFINITION avg_external_share is external_cash / total_equity after the monthly sweep/emergency top-up rule. 500% is a target based on 5x required initial margin, not a guaranteed hard floor when total strategy equity is insufficient.')
print('V123_END')
