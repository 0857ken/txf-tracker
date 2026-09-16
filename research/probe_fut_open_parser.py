import io,requests,pandas as pd,numpy as np
url='https://www.taifex.com.tw/cht/3/futDataDown'
form={'down_type':'1','commodity_id':'TX','queryStartDate':'2025/06/01','queryEndDate':'2025/06/05','MarketCode':'0'}
r=requests.post(url,data=form,headers={'User-Agent':'Mozilla/5.0'},timeout=45,verify=False)
txt=r.content.decode('cp950',errors='replace').strip()
print('has date', '交易日期' in txt)
df=pd.read_csv(io.StringIO(txt),dtype=str)
df.columns=[str(c).strip() for c in df.columns]
print('cols',repr(df.columns.tolist()))
need=['交易日期','契約','到期月份(週別)','開盤價','收盤價','最低價','結算價','交易時段']
print('missing',[c for c in need if c not in df.columns])
z=df[need].copy(); z.columns=['date','product','expiry','open','close','low','settle','session']
for c in ['product','expiry','session']:
    z[c]=z[c].astype(str).str.strip()
print('products',z['product'].unique()[:10])
print('sessions',z['session'].unique()[:10])
print('expiry sample',z['expiry'].head().tolist())
a=z[(z['product']=='TX') & (z['session']=='一般') & z['expiry'].str.match(r'^\d{6}$',na=False)]
print('filtered',len(a)); print(a.head().to_string(index=False))
