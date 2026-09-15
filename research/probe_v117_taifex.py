import io,requests,pandas as pd
H={'User-Agent':'Mozilla/5.0'}
requests.packages.urllib3.disable_warnings()
u='https://www.taifex.com.tw/cht/3/futDataDown'
tests=[('TX','2026/08/18','2026/09/15'),('TX','2019/07/01','2019/07/29'),('MTX','2019/07/01','2019/07/29'),('TMF','2024/07/01','2024/07/29')]
for prod,a,b in tests:
    form={'down_type':'1','commodity_id':prod,'queryStartDate':a,'queryEndDate':b,'MarketCode':'0'}
    r=requests.post(u,data=form,headers=H,timeout=60,verify=False)
    txt=r.content.decode('cp950',errors='replace').strip()
    print('\nTEST',prod,a,b,'bytes',len(r.content),'header',('交易日期' in txt),'first',repr(txt[:180]))
    try:
        df=pd.read_csv(io.StringIO(txt),dtype=str)
        print('shape raw',df.shape,'columns',list(df.columns))
        df.columns=[str(c).strip() for c in df.columns]
        need=['交易日期','契約','到期月份(週別)','收盤價','最低價','結算價','交易時段']
        print('need present',[c in df.columns for c in need])
        z=df[need].copy(); z.columns=['date','product','expiry','close','low','settle','session']
        print('unique product raw',z['product'].dropna().unique()[:10])
        print('unique session raw',z['session'].dropna().unique()[:10])
        z['product']=z['product'].astype(str).str.strip(); z['expiry']=z['expiry'].astype(str).str.strip(); z['session']=z['session'].astype(str).str.strip()
        print('counts product',int((z.product==prod).sum()),'regular',int((z.session=='一般').sum()),'expiry6',int(z.expiry.str.match(r'^\d{6}$',na=False).sum()))
        q=z[(z['product']==prod)&(z['session']=='一般')&z['expiry'].str.match(r'^\d{6}$',na=False)]
        print('FINAL',q.shape,'sample',q.head(3).to_dict('records'))
    except Exception as e:
        print('ERR',repr(e))
