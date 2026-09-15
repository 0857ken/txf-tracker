from pathlib import Path
import csv
import pandas as pd

p=Path('research/backtest_v117_actual_futures_margin.py')
s=p.read_text(encoding='utf-8')
s=s.replace('import io, re, math, time, warnings', 'import io, csv, re, math, time, warnings', 1)
s=s.replace("('2020-01-31', 91000, 70000, '2020 Lunar New Year reversion')",
            "('2020-01-31',110000, 84000, '2020-01-30 official post-holiday adjustment')", 1)
old="""    try: df=pd.read_csv(io.StringIO(txt),dtype=str)\n    except Exception: return pd.DataFrame()\n    if df.empty: return df\n    df.columns=[str(c).strip() for c in df.columns]\n"""
new="""    try:\n        rows=list(csv.reader(io.StringIO(txt)))\n        if not rows: return pd.DataFrame()\n        header=[str(c).strip() for c in rows[0]]\n        body=[r[:len(header)] for r in rows[1:] if len(r)>=len(header)]\n        df=pd.DataFrame(body,columns=header,dtype=str)\n    except Exception: return pd.DataFrame()\n    if df.empty: return df\n    df.columns=[str(c).strip() for c in df.columns]\n"""
s=s.replace(old,new,1)
prefix=s.split("print('V117_DOWNLOAD_BEGIN')",1)[0]
ns={'__name__':'defs','__file__':str(p)}
exec(compile(prefix,str(p),'exec'),ns)
for prod in ['TX','MTX']:
    z=ns['fetch_fut_chunk'](prod,pd.Timestamp('2017-08-01'),pd.Timestamp('2017-08-04'))
    z=z[z.expiry=='201708']
    print(prod)
    print(z[['date','product','expiry','close','low','settle','session']].to_string(index=False))
