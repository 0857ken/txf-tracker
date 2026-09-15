import requests,time
H={'User-Agent':'Mozilla/5.0'}
requests.packages.urllib3.disable_warnings()
u='https://www.taifex.com.tw/cht/3/futDataDown'
tests=[
 ('TX','2026/09/15','2026/09/15'),
 ('TX','2026/09/01','2026/09/15'),
 ('TX','2019/07/01','2019/07/20'),
 ('MTX','2026/09/01','2026/09/15'),
 ('TMF','2026/09/01','2026/09/15'),
]
for prod,a,b in tests:
    form={'down_type':'1','commodity_id':prod,'queryStartDate':a,'queryEndDate':b,'MarketCode':'0'}
    r=requests.post(u,data=form,headers=H,timeout=60,verify=False)
    print('\nTEST',prod,a,b,'status',r.status_code,'bytes',len(r.content),'ctype',r.headers.get('content-type'),'url',r.url)
    for enc in ['cp950','utf-8','big5']:
        try:
            t=r.content.decode(enc)
            repl=t[:1000].count('\ufffd')
            print('ENC',enc,'replacement',repl,'has_header',('交易日期' in t),'has_TX',(',TX,' in t),'first=',repr(t[:700]))
        except Exception as e:
            print('ENCERR',enc,repr(e))
    time.sleep(1)
