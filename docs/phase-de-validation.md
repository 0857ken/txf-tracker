# Phase D／E implementation validation

本輪只處理執行時序與風控治理，沒有開始完整 v1.27 歷史比較，也沒有修改已凍結的訊號、曝險級距、500/550、±0.05x 或 allocator ranking。

## Phase D：實盤時序

`defense-governance.js` 將每日流程拆成兩個不可混用的階段：

- `post-13:30`：0050 收盤訊號確認與交易決策；訊號不可早於台灣時間 13:30。
- `post-13:45`：TAIFEX 日終 MTM 與每日快照；估值不可早於台灣時間 13:45。

成交參考時間必須落在訊號確認後、日終估值前。既有 `validateDay` 現在會套用這些最低時間門檻，因此不會在 13:45 才首次產生交易訊號。

## Phase E：保證金與換倉治理

每筆可選的 margin provenance 現在可保存並驗證：

- `source`
- `effectiveDate`
- `fetchedAt`
- `initial`
- `maintenance`
- `brokerOverride`（可選）

缺 metadata 會明確標示 `unknown`；超過預設 7 日、未生效、抓取時間在未來、數值無效或手動標 stale 都不會顯示 fresh 綠色安全狀態。這是資料新鮮度治理，不會改變 allocator 的固定排名。

券商風險核對透過 `reconcileBrokerRisk` 回傳 `matched` 或 `mismatch`，保留逐欄差異，不把券商數值靜默覆蓋計算值。

換倉日期透過 `rollDate(year, month, tradingDays)` 計算第三個星期三前一個有效 TAIFEX 交易日；沒有交易日曆時 fail closed，不以單純日曆日猜測。

## 驗證

- Node tests：90/90 passed
- Python tests：4/4 passed
- Python compile check：passed
- `git diff --check`：passed

正式上線前仍需完成：可信 v1.26／v1.27 歷史比較、手機實機 UI、正式 cron schedule、使用者最終批准。
