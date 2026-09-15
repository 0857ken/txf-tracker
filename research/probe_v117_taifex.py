import io,re,requests,pandas as pd
from bs4 import BeautifulSoup

H={'User-Agent':'Mozilla/5.0'}

print('=== FUTURES SAMPLE ===')
u='https://www.taifex.com.tw/cht/3/futDataDown'
form={'down_type':'1','commodity_id':'TX','queryStartDate':'2026/09/15','queryEndDate':'2026/09/15','MarketCode':'0'}
r=requests.post(u,data=form,headers=H,timeout=30,verify=False)
print('status',r.status_code,'bytes',len(r.content), 'ctype',r.headers.get('content-type'))
text=r.content.decode('ms950',errors='replace')
print(text[:1800])

print('\n=== HISTORICAL MARGIN NEWS QUERY ===')
u='https://www.taifex.com.tw/cht/11/hisNews'
form={'isQuery':'1','queryStartDate':'2017/03/30','queryEndDate':'2026/09/15','newsType':'1','queryKeyWord':'臺股期貨+保證金'}
r=requests.post(u,data=form,headers=H,timeout=60,verify=False)
print('status',r.status_code,'len',len(r.text),'url',r.url)
s=BeautifulSoup(r.text,'html.parser')
links=[]
for a in s.find_all('a',href=True):
    href=a['href']; txt=' '.join(a.stripped_strings)
    if 'newsDetail' in href:
        links.append((txt,href))
print('newsDetail count=',len(links))
for x in links[:25]: print('FIRST',x)
for x in links[-25:]: print('LAST',x)
print('forms:')
for i,f in enumerate(s.find_all('form')):
    names=[(e.name,e.get('name'),e.get('value'),e.get('id')) for e in f.find_all(['input','select'])]
    print('FORM',i,'action=',f.get('action'),'method=',f.get('method'),'fields=',names[:30])

print('\n=== SAMPLE RELEVANT DETAIL / ATTACHMENTS ===')
rel=[x for x in links if ('臺股期貨' in x[0] or '臺指' in x[0]) and '保證金' in x[0]]
print('relevant=',len(rel))
for txt,href in rel[:5]:
    url=requests.compat.urljoin('https://www.taifex.com.tw/cht/11/',href)
    rr=requests.get(url,headers=H,timeout=30,verify=False)
    ss=BeautifulSoup(rr.text,'html.parser')
    print('DETAIL',txt[:140],url)
    for a in ss.find_all('a',href=True):
        h=a['href']; t=' '.join(a.stripped_strings)
        if any(k in h.lower() for k in ['.csv','.xls','.xlsx','.pdf']) or '保證金' in t:
            print('  ATT',t[:120],requests.compat.urljoin(url,h))
