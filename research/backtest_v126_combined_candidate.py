from pathlib import Path

# Reuse the pre-registered v1.25 implementation, changing only the two frozen v1.26
# operational settings: 500% floor -> refill/reset to 550%, and a single 0.05x
# position no-trade band candidate.
p=Path('research/backtest_v125_position_band.py')
s=p.read_text(encoding='utf-8')
s=s.replace("RESERVE=5.0\nBANDS=[0.0,0.025,0.05,0.075,0.10]","FLOOR=5.0\nRESET=5.5\nBANDS=[0.05]",1)
old="""            target_cash=RESERVE*im\n            if is_first_month_day:\n                desired_fut=min(before,target_cash); transfer=desired_fut-fut_cash\n            elif fut_cash<target_cash:\n                transfer=min(external,target_cash-fut_cash)\n"""
new="""            target_cash=RESET*im\n            floor_cash=FLOOR*im\n            if is_first_month_day:\n                desired_fut=min(before,target_cash); transfer=desired_fut-fut_cash\n            elif fut_cash<floor_cash:\n                transfer=min(external,target_cash-fut_cash)\n"""
if old not in s: raise RuntimeError('reserve block not found')
s=s.replace(old,new,1)
s=s.replace("print('V125_BEGIN')","print('V126_BEGIN')",1)
s=s.replace("print('V125_END')","""\n# Confirm opening-margin shocks for the single combined candidate.\nfor mult in [1.2,1.5,2.0]:\n    rr=o.open_ratio/mult\n    print('COMBINED_OPEN_SHOCK',mult,'min',pct(rr.min()),rr.idxmin().date(),\n          'below250',int((rr<2.5).sum()),'below200',int((rr<2.0).sum()),\n          'below150',int((rr<1.5).sum()),'below100',int((rr<1.0).sum()),\n          'below_call',int((rr<o.call_equiv).sum()))\nprint('V126_END')\n""",1)
exec(compile(s,'research/backtest_v126_combined_candidate.py','exec'),{'__name__':'__main__','__file__':str(p)})
