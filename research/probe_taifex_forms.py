import requests
from bs4 import BeautifulSoup

URL='https://www.taifex.com.tw/cht/3/futDailyMarketView'
s=requests.Session(); s.headers.update({'User-Agent':'Mozilla/5.0'})
r=s.get(URL,timeout=30); r.raise_for_status()
print('status',r.status_code,'len',len(r.text),'url',r.url)
soup=BeautifulSoup(r.text,'html.parser')
forms=soup.find_all('form')
print('forms',len(forms))
for i,f in enumerate(forms):
    txt=' '.join(f.stripped_strings)
    if '年度行情下載' in txt or '每日行情下載' in txt or 'year' in str(f).lower():
        print('\nFORM',i,'action=',f.get('action'),'method=',f.get('method'))
        for tag in f.find_all(['input','select','button']):
            print(tag.name,'name=',tag.get('name'),'value=',tag.get('value'),'id=',tag.get('id'),'type=',tag.get('type'))
            if tag.name=='select':
                print(' options=',[(o.get('value'),o.get_text(strip=True)) for o in tag.find_all('option')[:20]])
        print('HTML',str(f)[:12000])
