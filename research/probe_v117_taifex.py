import requests
from bs4 import BeautifulSoup
H={'User-Agent':'Mozilla/5.0'}
requests.packages.urllib3.disable_warnings()

print('=== HISNEWS OPTIONS ===')
u='https://www.taifex.com.tw/cht/11/hisNews'
r=requests.get(u,headers=H,timeout=30,verify=False); s=BeautifulSoup(r.text,'html.parser')
sel=s.find('select',{'name':'newsType'})
print([(o.get('value'),' '.join(o.stripped_strings)) for o in sel.find_all('option')] if sel else 'no select')

variants=[
 {'isQuery':'1','queryStartDate':'2026/01/01','queryEndDate':'2026/09/15','newsType':'','queryKeyWord':'保證金'},
 {'isQuery':'1','queryStartDate':'2026/01/01','queryEndDate':'2026/09/15','newsType':'1','queryKeyWord':'保證金'},
 {'isQuery':'1','queryStartDate':'2017/03/30','queryEndDate':'2026/09/15','newsType':'','queryKeyWord':'臺股期貨'},
 {'isQuery':'1','queryStartDate':'2017/03/30','queryEndDate':'2026/09/15','newsType':'','queryKeyWord':'臺股期貨 + 保證金'},
 {'isQuery':'1','queryStartDate':'2017/03/30','queryEndDate':'2026/09/15','newsType':'','queryKeyWord':'臺股期貨,保證金'},
]
for i,form in enumerate(variants):
    rr=requests.post(u,data=form,headers=H,timeout=60,verify=False)
    ss=BeautifulSoup(rr.text,'html.parser')
    links=[]
    for a in ss.find_all('a',href=True):
        if 'newsDetail' in a['href']:
            links.append((' '.join(a.stripped_strings),a['href']))
    print('\nVAR',i,form,'status',rr.status_code,'len',len(rr.text),'count',len(links))
    for x in links[:15]: print(x)
    # print likely no-data text and pagination controls
    text=' '.join(ss.stripped_strings)
    for key in ['查無','筆資料','頁次','下一頁','共']:
        if key in text:
            p=text.find(key); print('SNIP',text[max(0,p-100):p+200]); break
    pag=[]
    for a in ss.find_all('a',href=True):
        h=a['href']; t=' '.join(a.stripped_strings)
        if 'page' in h.lower() or 'pageno' in h.lower() or t in ['下一頁','最後一頁','2','3']:
            pag.append((t,h))
    print('PAG',pag[:20])
