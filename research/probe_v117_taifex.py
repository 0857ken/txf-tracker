import io,re,requests,pandas as pd
from bs4 import BeautifulSoup

H={'User-Agent':'Mozilla/5.0'}

print('=== FUTURES SAMPLE ===')
u='https://www.taifex.com.tw/cht/3/futDataDown'
form={'down_type':'1','commodity_id':'TX','queryStartDate':'2026/09/15','queryEndDate':'2026/09/15','MarketCode':'0'}
r=requests.post(u,data=form,headers=H,timeout=30,verify=False)
print('status',r.status_code,'bytes',len(r.content), 'ctype',r.headers.get('content-type'))
text=r.content.decode('ms950',errors='replace')
print(text[:2500])

print('\n=== HISNEWS FORM ===')
u='https://www.taifex.com.tw/cht/11/hisNews'
r=requests.get(u,headers=H,timeout=30,verify=False)
print('status',r.status_code,'len',len(r.text),'url',r.url)
s=BeautifulSoup(r.text,'html.parser')
for i,f in enumerate(s.find_all('form')):
    print('FORM',i,'action=',f.get('action'),'method=',f.get('method'))
    for inp in f.find_all(['input','select']):
        print(' ',inp.name, 'name=',inp.get('name'),'value=',inp.get('value'),'id=',inp.get('id'))

print('\n=== ANNOUNCEMENT LINKS CURRENT ===')
u='https://www.taifex.com.tw/cht/11/announcement'
r=requests.get(u,headers=H,timeout=30,verify=False)
print('status',r.status_code,'len',len(r.text))
s=BeautifulSoup(r.text,'html.parser')
for a in s.find_all('a',href=True):
    href=a['href']; txt=' '.join(a.stripped_strings)
    if 'newsDetail' in href or '保證金' in txt:
        print(txt[:180],href)
