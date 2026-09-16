from pathlib import Path

p=Path('research/backtest_v124_operational_robustness.py')
s=p.read_text(encoding='utf-8')
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
ns2={'__name__':'__main__','__file__':str(p)}
exec(compile(s,str(p),'exec'),ns2)
