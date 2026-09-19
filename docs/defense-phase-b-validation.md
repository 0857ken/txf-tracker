# Phase B — Dynamic Equity Denominator 驗證

日期：2026-09-19。分支：`feature/forward-dynamic-equity`。本階段只修正Forward曝險分母與權益流，未開始Phase C–E，未改配口ranking、MA、500/550或±0.05x規則。

## 決策時序與單一定義

- `capitalBase = 2,000,000`只保留為Forward期初本金與績效基準metadata。
- 決策前先將舊持倉以當時逐合約bid/ask中間價MTM。
- `strategyEquity = decisionTimeFuturesEquity + outsideCash`。
- `targetNotional = strategyEquity × targetX`。
- `actualExposure = currentFuturesNotional / strategyEquity`，曝險差與±0.05x band用同一分母。
- 當次新交易的手續費、交易稅與新持倉日終損益不回頭改變當次target。
- 期貨帳戶與場外現金的內部移轉不改變strategy equity；只有external deposit/withdrawal改變。
- 期貨權益或逐合約估值不足時回傳`allocationStatus = valuation-unavailable`，保留待處理訊號，但`tradeRequired = false`，不以固定本金代算口數。

## 固定本金引用audit

| 位置 | Phase B結果 |
|---|---|
| `defense-core.js` snapshot / actual exposure / band | 改用動態`strategyEquity`；`capitalBase`只留metadata |
| `defense-ledger.js` exposure / selectHoldings / theoreticalTrades | 改用決策時動態權益 |
| Forward daily ledger / snapshot / UI | 儲存並顯示`decisionStrategyEquity`、`targetNotional`與`allocationStatus` |
| Forward performance | 2,000,000仍是期初績效基準；日報酬排除external flow |
| `defense-config.js` / `scripts/defense-examples.cjs` | 保留作為期初本金metadata，不參與配口 |
| `assets.html`、`backend/snapshot.py`、`backend/daily_summary.py` | 屬原有三策略／200萬資產頁，本階段故意不改 |
| 第一～三輪驗證文件 | 保留當時fixture與歷史證據，不是Phase B現行曝險定義 |

## 固定價格20,000、2.0x實例

| Strategy equity | Target notional | 配口 | 實際名目值 | 實際曝險 |
|---:|---:|---|---:|---:|
| 1,500,000 | 3,000,000 | MTX 3 | 3,000,000 | 2.0x |
| 2,000,000 | 4,000,000 | TX 1 | 4,000,000 | 2.0x |
| 3,000,000 | 6,000,000 | TX 1 + MTX 2 | 6,000,000 | 2.0x |

配口演算法未變；以相同價格與tie-breaker執行，僅將目標金額分母改為當下權益。

## 權益流證據

內部補款100,000：移轉前期貨權益550,000、場外1,450,000、總額2,000,000；移轉後期貨權益650,000、場外1,350,000、總額仍為2,000,000。外部入金100,000使決策權益增加100,000；外部提領100,000使其減少100,000。

同一持倉fixture名目值6,600,000：舊固定2,000,000分母為3.3x；當總策略權益為10,000,000時，新定義為0.66x。

## 測試結果

- Node：78/78通過，0 failed。其中Phase B新增10項，包含1.5m/2m/3m、四級曝險、近零與非正權益、負期貨權益但總權益為正、估值缺失、band邊界、決策時MTM、內外部權益流、場外資金不足與舊新分母差異。
- Python：2/2通過。
- Python scripts compileall：通過。
- `git diff --check`：通過。
- UI DOM回歸、原三策略byte-identical防護與第4策略現有壓測／Firestore adapter隔離測試均通過。
- 本機Firestore emulator啟動前被`firebase-tools`拒絕：本機只有Java 17，新版工具要求Java 21。沒有連到或寫入任何Firestore；這是本機環境限制，非測試assertion失敗。

Phase C margin-aware allocator、Phase D實盤時序與Phase E保證金／換倉治理未開始。
