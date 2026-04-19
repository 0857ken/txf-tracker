# 台指期追蹤系統

## 專案結構
```
taiwan-futures-tracker/
├── backend/
│   ├── main.py            # FastAPI 後端主程式
│   └── requirements.txt   # Python 套件清單
└── frontend/
    └── index.html         # 前端單頁應用
```

## 快速啟動

### 第一步：啟動後端
```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

### 第二步：開啟前端
直接用瀏覽器打開 `frontend/index.html` 即可。

> **注意**：前端預設連線 `http://localhost:8000`
> 若後端在其他 port，請修改 `index.html` 第一行 `const API = '...'`

---

## 功能說明

### 儀表板
- **現價**：自動從 Yahoo Finance 抓取台股加權指數作為代理報價
- **人工校對**：可在現價卡片輸入今日期貨實際收盤價覆蓋自動報價
- **未實現損益**：根據進場成本 37,281 點自動計算（微台每點 50 元）
- **距撤退牆**：顯示距硬底線 35,800 的距離與進度條

### 均線狀態
| 狀態 | 模式 | 建議槓桿 |
|------|------|----------|
| 多頭排列 | 收割模式 | 1.5–2.0 倍 |
| 5日穿越月線 | 進攻模式 | 1.2–1.5 倍 |
| 均線走平 | 觀察模式 | 0.8–1.0 倍 |
| 空頭排列 | 防禦模式 | 0–0.6 倍 |

### 阿東式訊號
- 每日自動判斷紅K/黑K
- 紅K → 留倉；黑K → 當日加碼單出清

### 部位管理
- 新增買賣紀錄（支援微台 MXF / 小台 TXF）
- 點擊「平倉」關閉部位
- 每日紀律清單自動檢核

---

## 正式版升級建議（第二階段）
1. 換用 PostgreSQL 取代記憶體儲存（重啟不丟失資料）
2. 串接台灣期交所官方 API 取代 Yahoo Finance
3. 加入帳號登入系統（JWT）
4. 部署到 VPS（Render / Railway / 自架）
5. LINE 通知：硬底線警報推播
