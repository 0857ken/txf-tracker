from pathlib import Path

p=Path('research/backtest_v124_operational_robustness.py')
s=p.read_text(encoding='utf-8')

# v1.24 needs the TAIFEX HTTP helpers that are nested inside the imported v1.19 namespace,
# so define them explicitly for this diagnostic wrapper.
old="TAIFEX=ns['TAIFEX']; HEADERS=ns['HEADERS']; req=ns['req']; chunks=ns['chunks']"
new=r'''import requests
TAIFEX='https://www.taifex.com.tw'
HEADERS={'User-Agent':'Mozilla/5.0 (compatible; research-backtest/1.0)'}
requests.packages.urllib3.disable_warnings()

def req(method,url,**kw):
    for k in range(5):
        try:
            r=requests.request(method,url,headers=HEADERS,timeout=45,verify=False,**kw)
            r.raise_for_status()
            return r
        except Exception:
            if k==4: raise
            time.sleep(0.5*(2**k))

def chunks(st,en,days=28):
    x=st
    while x<=en:
        y=min(x+pd.Timedelta(days=days),en)
        yield x,y
        x=y+pd.Timedelta(days=1)
'''
if old not in s:
    raise RuntimeError('bootstrap replacement target not found')
s=s.replace(old,new,1)

# TAIFEX download rows have a ragged trailing field. pandas.read_csv can infer the first
# field as an index and shift all selected columns by one. Parse with csv.reader instead,
# explicitly padding/truncating rows to the header width so 交易日期/契約/到期月份/開盤價
# stay aligned.
old_parse="""    try:\n        df=pd.read_csv(io.StringIO(txt),dtype=str)\n    except Exception:\n        return pd.DataFrame()\n    if df.empty: return df\n"""
new_parse="""    try:\n        import csv\n        rr=list(csv.reader(io.StringIO(txt)))\n        if not rr: return pd.DataFrame()\n        header=[str(c).strip() for c in rr[0]]\n        data=[]\n        for row in rr[1:]:\n            if len(row)<len(header): row=row+['']*(len(header)-len(row))\n            elif len(row)>len(header): row=row[:len(header)]\n            data.append(row)\n        df=pd.DataFrame(data,columns=header,dtype=str)\n    except Exception:\n        return pd.DataFrame()\n    if df.empty: return df\n"""
if old_parse not in s:
    raise RuntimeError('CSV parser replacement target not found')
s=s.replace(old_parse,new_parse,1)

ns2={'__name__':'__main__','__file__':str(p)}
exec(compile(s,str(p),'exec'),ns2)
