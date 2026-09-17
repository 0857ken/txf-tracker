# 第4策略：實作與驗收基準（第二輪2026-09-17更新）

檢查日期：2026-09-16。網站基底 gh-pages `57dc4079be23abc9899e76f0bd58166eec08fa7d`，main `332857ef1cb968212ef5462d767857158537fc1c`。

## 實際架構與修改範圍

現行 root HTML + Vanilla JS + Chart.js + Firestore，Yahoo Finance 的 0050.TW / ^TWII 日資料；既有 strategy_data.json 有128筆且日期對齊。main 的4個排程 checkout gh-pages；3個行情排程在 push 前均 pull --rebase，daily.yml 廣播 LINE。main / gh-pages 都還保有舊 backend、Railway 設定與過時 README，但現行網站不引用該後端。原樣保留，不依舊 README 部署。

netlify.toml仍設定publish="frontend"；現有Netlify整合的PR預覽會指向舊frontend，不能拿來驗收新root頁面。這次交付的是獨立HTML預覽檔及GitHub驗證artifact，沒有改動Netlify正式部署設定。

三策略：耀的 RS（50/5、九轉、極端乖離）、橘太郎三條線、滾動20日最高月波動網格（含 gridActive 大盤拉回條件）。strategy-calc.js / scripts/strategy_calc.py 與 LINE 全部不修改。assets.html 留有未被引用的錯誤 TXF_POINT 常數，本功能絕不使用。

新增 defense.html / defense.css / defense.js / defense-core.js / defense-data.js / defense-config.js；strategy.html 只增加入口和入口所需樣式。新增 scripts/defense-*.cjs、tools/defense-runner 套件、tests/defense-*.test.cjs 與本組文件。新核心同時供瀏覽器與 Node 使用，避免再增加一套獨立公式。舊 Python 在執行環境完成既有測試與語法檢查，不要求使用者本機 Python。

## 儲存與隔離

正式資料根：users/me/defenseStrategies/0050-defense-v1。
測試資料根：users/me/defensePreviews/0050-defense-candidate-v1。

- state/account：已核對的帳戶、部位、保證金、基準指數、時間與 revision。
- accountRevisions/{uuid}：每次帳戶修改的完整前後狀態。
- executions/{uuid}：委託、五檔、每次改價、每筆成交、實際費稅；原始紀錄不可覆寫。
- attachments/{uuid}/chunks/{n}：選用的原始截圖分片，metadata 保留 SHA256。不上傳公開 repo。
- events/{uuid或確定性ID}：訊號、調倉、換倉、資金移轉、外部申贖、跌破安全線、異常滑價與資料問題。
- observations/{input-hash}：不可變的計算輸入、來源日期與版本、帳戶 revision、全套風控輸出。
- dailySnapshots/{YYYY-MM-DD}：該日最新觀測的指標與 observationId，舊觀測仍留存。
- monthlyReviews/{YYYY-MM}：從每日快照和事件推導、可重建的月檢討快取。
- ledgerSettings/opening：不可覆寫的期初雙帳本、費稅假設與來源。
- ledgerInputs/{YYYY-MM-DD}：逐合約可成交報價、日終價、保證金、實際成交完整性確認與券商對帳值；更正留事件。
- ledgerDaily/{YYYY-MM-DD}：可重建的理論／實際持倉、成交、MTM、費稅、滑價、權益及績效。
- state/ledgerVersion：帳本與成交的交易版本；拒絕過期排程覆蓋新輸入。
- market/latest：第4策略抓取的公開行情副本，含來源與有效收盤時間。

preview 模式預設使用明確標示的示範資料，只有使用者按「連接測試資料」才連到測試 namespace。發布前將 defense-config.js 的 mode 改為 production，並且只有正式 Pages 網址允許正式 namespace。無法用 query string 切換正式資料。預覽不引用原始 positions/stocks，因此不能修改它們。

沿用既有 Firestore 驗證，不修改安全規則、不啟用測試模式。不請求或輸出任何 Secret。正式每日工作獨立置於以 main 為基底的 feature branch，確認合併前不在 main 啟用；只寫 Firestore，不提交私有帳戶 JSON 到 gh-pages。GitHub Actions 排程有延遲可能；保留多次盤後重試與工作狀態時間，前端是否開啟不影響排程。

namespace 隔離是應用程式的讀寫範圍，不是新增的 Firestore 權限邊界；既有正式安全規則沒有在這次工作中被驗證或修改。帳戶更新與其事件（包括當下跌破500%）同一 transaction 儲存，避免等排程之前已補款而漏掉事件。圖片以原始位元組保存並校驗；本階段五檔與成交由表單輸入，尚無自動 OCR。

## 固定規則與未指定邊界

曝險＝名目曝險 / 固定2,000,000，禁止改成浮動總資產。乘數 TX/TXF=200、MTX/MXF=50、TMF=10。收盤 < MA60 且 MA60 < 第20個交易日前 MA60 才確認空頭；至少需要80筆有效日收盤。計算不先四捨五入。

非空頭2x；空頭close>=MA20為1.5x，其次close<=MA10為0.5x，其他為1x。第二輪明確指定MA20相等歸1.5x。MA10>MA20造成條件重疊時，實作暫採MA20優先，輸出overlap及boundaryPolicy；此優先序是待驗收的規則解讀，不是回測最佳化。

訊號狀態包括空頭旗標和目標級距。和最後已執行訊號比對，因此未執行的調倉要求不會隔日自行消失。首次尚未核對亦顯示待調倉。換倉日由使用者按合約填入，過期仍警示；第3個週三只提供結算日參考，不能自行當作已核准換倉日。

風險指標（純期貨）＝期貨帳戶權益 / 原始保證金 ×100%；低於500才需補款＝max(0,5.5×原始保證金−帳戶權益)，以整元無條件進位。500–550顯示接近警戒但不觸發補款。月初整理550%獨立顯示可移轉金額。場外備用金不足時分別顯示可補金額和缺口；不假設無限資金。維持門檻直接比較權益與維持保證金，接近門檻定義為已低於原始而尚未低於維持。

壓力測試固定當前持倉與當前總保證金，不假設途中MA減碼。delta點數＝加權指數×跌幅；各商品PnL＝delta×有符號口數×乘數；壓力總權益＝帳戶權益+PnL+場外資金。場外轉入不增加總權益。不把期貨名目價值當資產。市場代理假設期貨與指數等點數變動，不含基差額外擴大、交易所臨時調高保證金或強平沖銷費。

## 資料限制

既有系統沒有券商即時帳務與期貨近遠月五檔API。真實帳戶權益、部位、原始/維持保證金及成交費稅以使用者輸入為準。第二輪移除指數代理權益。自期交所DailyMarketReportFut取得指定交易日、一般時段、月合約結算價；缺逐合約價時保留最後核對權益，明確警示，不以加權指數補值。即時曝險也只用明確期貨參考價。公開日報沒有訊號確認時刻五檔，不能倒填為理論成交價。

Forward 起算下限2026-09-16，僅納入實際收集的資料，不補造過去快照。歷史回測只提供獨立區塊與待匯入狀態。月營運檢討不調參；核心策略檢討週期3–6個月。

實際報酬以已核對總權益計算，外部淨入金按期末流入處理；帳戶間轉帳不算報酬，券商權益內的費稅不重複扣除。缺少券商核對日不補0%日報酬，跨日僅列區間報酬。外部資金若要精確到盤中時間加權報酬，還需當時資產估值。

第二輪新增完整期貨双帳本：理論以訊號確認後的逐合約bid/ask整數配口，保留同一band／強制訊號與換月規則。配口取最接近目標名目額，等距取不超標，再取口數較少；不是重新最佳化參數。實際取逐筆成交。兩者MTM均為「舊持倉×(新估值−舊估值)＋本期成交有符號口數×(新估值−成交價)」，再扣費稅；滑價已在成交價中，不重複扣款。理論稅按設定稅率逐腿精算，與券商整元處理可能有差，實際稅保留券商值。

輸入包括signalAt/referenceAt/valuationAt及逐合約來源；理論不得先於訊號成交，所有成交須落在估值區間內。每次續算須有previousTradingDate對應前本，不跳過交易日缺口。交易日期目前採台灣曆日；夜盤須明確選定同一估值區間，不可混用券商次交易日標籤。日終後成交不混入較早日終。缺行情、費稅、換倉分腿價或完整性確認，該日及後续停止計算，不製造0%報酬。帳本完整與券商已對帳分開標示。

換倉理論優先跨月價差報價，實際換倉須提供近／遠月分腿成交價，且遠減近須等於價差。分腿用於MTM及費稅，價差本身不當作現金損失。月初跨月第一個完整帳本自動以550%整理；同月重複整理會拒絕。補款最多使用現有場外資金，不足仍保留警告。

正式排程只產生已收盤、同日對齊的dailySnapshots/{date}；假日／舊行情只留observation，不冒充日終。相同輸入雜湊不重寫；修正替換當日正式版本，舊observation與事件不刪除。每次觀測只保存帳本輸入的雜湊索引，原資料留ledgerInputs及更正事件，避免每天複製整份帳本。已用demo專案本機Firestore emulator實際驗證交易與讀回，不能據此宣稱正式安全規則或排程已啟用。

滑價統計以每筆委託為樣本，每筆成交價和等待秒數先按口數加權；平均／中位數／P95／最大值在委託樣本間計算，P95採線性插值。滑價成本依商品乘數換算。換倉執行成本＝arrival滑價成本＋實際兩腿費稅；正逆價差另外顯示，不加入滑價。

## 發布順序（須使用者另行核准）

1. 網站分支 `feature/0050-defense-forward` → `gh-pages`；排程分支 `feature/0050-defense-automation` → `main`。兩者都維持草稿狀態，未合併。
2. 先完成獨立預覽與手機畫面驗收、測試namespace的連線／權限驗證，以及未指定規則邊界確認。固定參數不重新最佳化。
3. 核准發布時才在網站feature branch把 defense-config.js 的 mode 改為 production，重新驗證並先合併網站；再合併排程PR。日排程讀取gh-pages程式並使用原有 FIREBASE_KEY，不新增LINE廣播。production寫入另要求main的工作來源及正確repository；預覽模式無法啟動正式寫入。
4. 正式頁面建立一次真實帳戶、權益日期、持倉、保證金及下一次換倉日；每日台灣14:15、14:45、15:15、15:45、16:15、16:45由排程保存（假日也留資料品質快照）。未建立帳戶時記錄 SETUP_REQUIRED，不使用示範餘額代替。
5. 驗證第一筆正式觀測與工作狀態。這次開發沒有啟動排程，也沒有把開發期間資料回填成真實forward。

## 外部規格來源

- [期交所微型臺指規格](https://www.taifex.com.tw/cht/2/tMF)：10元/點、結算與最後交易日。
- [期交所保證金常見問題](https://www.taifex.com.tw/cht/9/tradersQAClearing)：券商可加收保證金，不能把舊固定金額當目前要求。
- [國泰期貨風險規則](https://www.cathayfut.com.tw/F_BehalfReversal.aspx)：純期貨權益與原始保證金的風險比率。
- [Firebase Admin官方文件](https://firebase.google.com/docs/admin/setup)：Node每日快照使用服務帳戶的Admin SDK；前端只使用既有Web SDK。
