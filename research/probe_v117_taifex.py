import requests,re
from bs4 import BeautifulSoup
from urllib.parse import urljoin
H={'User-Agent':'Mozilla/5.0'}
requests.packages.urllib3.disable_warnings()
base='https://www.taifex.com.tw/cht/11/'
form={'isQuery':'1','queryStartDate':'2016/01/01','queryEndDate':'2026/09/15','newsType':'','queryKeyWord':'臺股期貨'}
r=requests.post(urljoin(base,'hisNews'),data=form,headers=H,timeout=60,verify=False)
s=BeautifulSoup(r.text,'html.parser')
links=[]
for a in s.find_all('a',href=True):
    t=' '.join(a.stripped_strings); h=a['href']
    if 'newsDetail' in h and '保證金' in t and ('臺股期貨' in t or '臺指' in t):
        links.append((t,urljoin(base,h)))
print('relevant',len(links))
for j in sorted(set([0,1,2,10,20,30,40,max(0,len(links)-3),max(0,len(links)-2),max(0,len(links)-1)])):
    if j>=len(links): continue
    t,u=links[j]
    rr=requests.get(u,headers=H,timeout=30,verify=False); ss=BeautifulSoup(rr.text,'html.parser')
    print('\nINDEX',j,'TITLE',t[:220],'URL',u)
    text=' '.join(ss.stripped_strings)
    m=re.search(r'日期\s*[|:]?\s*(20\d{2}/\d{2}/\d{2})',text)
    print('DATE',m.group(1) if m else 'NA')
    atts=[]
    for a in ss.find_all('a',href=True):
        h=urljoin(u,a['href']); tt=' '.join(a.stripped_strings)
        if any(ext in h.lower() for ext in ['.csv','.xls','.xlsx']): atts.append((tt,h))
    print('ATTACH',atts)
    for tt,h in atts[:2]:
        z=requests.get(h,headers=H,timeout=30,verify=False)
        print(' ATT_STATUS',z.status_code,'bytes',len(z.content),'url',h)
        for enc in ['utf-8-sig','cp950','big5']:
            try:
                tx=z.content.decode(enc)
                if '�' not in tx[:500]: break
            except: continue
        print(' ENC',enc)
        print(tx[:2500].replace('\r',''))
