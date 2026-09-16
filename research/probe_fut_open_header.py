import requests
url='https://www.taifex.com.tw/cht/3/futDataDown'
form={'down_type':'1','commodity_id':'TX','queryStartDate':'2025/06/01','queryEndDate':'2025/06/05','MarketCode':'0'}
r=requests.post(url,data=form,headers={'User-Agent':'Mozilla/5.0'},timeout=45,verify=False)
print('status',r.status_code)
txt=r.content.decode('cp950',errors='replace')
for i,line in enumerate(txt.splitlines()[:8]):
    print('LINE',i,repr(line))
