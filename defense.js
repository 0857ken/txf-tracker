/* Fourth-strategy UI. No writes to legacy positions, stocks or strategy files. */
(function () {
  'use strict';
  const C = window.DefenseCore, config = window.DefenseConfig;
  const $ = id => document.getElementById(id);
  const escape = s => String(s ?? '').replace(/[&<>"']/g, x => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[x]));
  const fmt = (n, digits = 0) => C.finite(n) ? n.toLocaleString('zh-TW', {minimumFractionDigits: digits, maximumFractionDigits: digits}) : '—';
  const pct = n => C.finite(n) ? fmt(n * 100, 2) + '%' : '—';
  const money = n => C.finite(n) ? (n < 0 ? '−' : '') + '$' + fmt(Math.abs(n)) : '—';
  const now = () => new Date().toISOString();
  const localTime = s => new Date(Date.parse(s) + 8 * 3600000).toISOString().slice(0, 19);
  const isoTime = s => {
    if (!s) throw new Error('請填寫時間');
    const value = /(?:Z|[+-]\d{2}:\d{2})$/.test(s) ? s : s + '+08:00';
    C.timestamp(value); return value;
  };
  const badge = (text, color = 'blue') => '<span class="badge ' + color + '">' + escape(text) + '</span>';
  const metric = (label, value, note = '', color = '') => '<div class="metric"><div class="label">' + escape(label) + '</div><div class="value ' + color + '">' + escape(value) + '</div>' + (note ? '<small>' + escape(note) + '</small>' : '') + '</div>';
  const keys = rows => '<dl class="key-list">' + rows.map(([k, v]) => '<div class="key-row"><dt>' + escape(k) + '</dt><dd>' + escape(v) + '</dd></div>').join('') + '</dl>';
  const empty = (title, text) => '<div class="card empty"><strong>' + escape(title) + '</strong>' + escape(text) + '</div>';
  const STORE = 'txf-defense-preview-v1';
  let state = {account: null, snapshots: [], executions: [], events: [], health: null, ledgerSeed: null, ledgerInputs: [], ledgerDays: [], ledgerRevision: 0};
  let market = null, snapshot = null, connected = false, adapter = null, busy = false, pendingOrderId = crypto.randomUUID(), ledgerUI = null, localStore = STORE;
  function notice(message, error = false) {
    $('notice').textContent = message;
    $('notice').classList.toggle('error', error);
  }
  async function task(action) {
    if (busy) return;
    busy = true;
    document.querySelectorAll('button').forEach(b => { b.disabled = true; });
    try { await action(); } catch (error) { notice(error.message || '操作失敗，請保留輸入重試', true); }
    finally { busy = false; document.querySelectorAll('button').forEach(b => { b.disabled = false; }); }
  }
  function persistLocal(next) {
    try { localStorage.setItem(localStore, JSON.stringify(next)); }
    catch { throw new Error('瀏覽器無法儲存預覽資料，請先匯出紀錄；這次未儲存'); }
    state = next;
  }
  async function publicMarket() {
    if (window.DEFENSE_INLINE_DATA) return C.clone(window.DEFENSE_INLINE_DATA);
    const get = async url => {
      const r = await fetch(url + '?t=' + Date.now(), {cache: 'no-store', signal: AbortSignal.timeout(15000)});
      if (!r.ok) throw new Error('行情讀取失敗：HTTP ' + r.status);
      return r.json();
    };
    const [strategy, price] = await Promise.all([get('data/strategy_data.json'), get('data/market_data.json')]);
    const r = strategy.target?.at(-1);
    if (!r) throw new Error('尚無0050日收盤資料');
    const date = r.date, index = strategy.benchmark_close.at(-1);
    const updatedAt = strategy.updated_at.replace(' ', 'T') + '+08:00';
    const sourceClock = new Date(Date.parse(updatedAt) + 8 * 3600000);
    const closed = C.twDate(updatedAt) >= date && (C.twDate(updatedAt) > date || sourceClock.getUTCHours() * 60 + sourceClock.getUTCMinutes() >= 825);
    return {date: price.trend.dates.at(-1), index: price.market.current_price, target: strategy.target,
      updatedAt: price.updated_at.replace(' ', 'T') + '+08:00', signalUpdatedAt: updatedAt,
      closed, source: 'Yahoo Finance · 0050日收盤與加權指數',
      currentIndex: price.market.current_price, currentIndexDate: price.trend.dates.at(-1), currentIndexUpdatedAt: price.updated_at};
  }
  function demoAccount() {
    if (window.DEFENSE_REALISTIC_ACCOUNT) return C.clone(window.DEFENSE_REALISTIC_ACCOUNT);
    return {revision: 0, asof: now(), equityDate: market.date, equity: 1450000, outside: 550000,
      indexAtEquity: market.index, initialMargin: 280400, maintenanceMargin: 215200,
      positions: [{product: 'MTX', month: '2026-10', lots: 1, mark: null},
        {product: 'TMF', month: '2026-10', lots: 3, mark: null}],
      marginReference: {checkedOn: '2026-09-17', source: 'https://www.taifex.com.tw/cht/5/indexMarging'},
      nextRollDate: '2026-10-20', lastAppliedState: 'nonbear:2', lastCleanupMonth: market.date.slice(0, 7)};
  }
  function renderToday() {
    const s = C.signal(market.target), x = snapshot;
    const badges = x ? x.labels.map(t => badge(t, t === '需補款' ? 'red' : t === '正常' ? 'green' : 'gold')).join('')
      : badge('請核對帳戶', 'gold');
    $('today-content').innerHTML = '<div class="card hero"><div class="hero-heading"><h3>' + escape(s.reason || '資料待核對') +
      '</h3><div class="badges">' + badges + '</div></div><div class="metrics">' +
      metric('目標曝險', s.valid ? fmt(s.target, 1) + 'x' : '待確認', '固定本金 200 萬元', 'gold') +
      metric('實際曝險', x ? fmt(x.actualExposure, 3) + 'x' : '—', x?.exposureSource === 'futures_marks' ? '已核對期貨參考價' : '加權指數代理估計', 'blue') +
      metric('加權指數', fmt(market.index, 2), market.date + ' 收盤') +
      metric('0050 收盤', fmt(s.close, 2), s.date || '') +
      '</div><div class="meta">資料日 ' + escape(market.date) + ' · 更新 ' + escape(localTime(market.updatedAt).replace('T', ' ')) +
      '（台灣）</div></div><div class="card"><div class="metrics compact">' +
      metric('MA10', fmt(s.ma10, 4)) + metric('MA20', fmt(s.ma20, 4)) + metric('MA60', fmt(s.ma60, 4)) +
      metric('20交易日前 MA60', fmt(s.ma60Lag20, 4)) + '</div><div class="divider"></div>' +
      keys([['確認空頭', s.bear === null ? '待資料' : s.bear ? '是' : '否'], ['條件', '0050 < MA60，且 MA60 < 20交易日前MA60']]) +
      (x?.quality.length ? '<p class="meta gold">' + x.quality.map(escape).join(' · ') + '</p>' : '') + '</div>';
  }
  function renderPositions() {
    const x = snapshot;
    if (!x) { $('positions-content').innerHTML = empty('先核對你的策略帳戶', '第4策略不會自動把其他策略或主頁持倉算進來。'); return; }
    const parts = x.positions.map(p => keys([['商品／月份', p.product + ' · ' + p.month], ['持倉', p.lots + ' 口'],
      ['參考價', p.mark === null ? '缺少期貨價格' : fmt(p.mark, 2)]])).join('<div class="divider"></div>');
    $('positions-content').innerHTML = '<div class="card"><div class="metrics">' +
      metric('目標－實際差距', fmt(x.decision.gap, 3) + 'x', '正值需增加曝險') +
      metric('±0.05x band', x.decision.insideBand === null ? '待確認' : x.decision.insideBand ? '範圍內' : '範圍外', '訊號改變／換倉仍須執行', x.decision.insideBand ? 'green' : 'gold') +
      metric('淨名目曝險', money(x.notional)) + metric('總策略權益', money(x.totalEquity), '期貨權益＋場外資金') +
      '</div><div class="pill-values"><span>TX ' + x.lots.TX + ' 口</span><span>MTX ' + x.lots.MTX + ' 口</span><span>TMF ' + x.lots.TMF + ' 口</span></div>' +
      keys([['訊號是否尚待執行', x.decision.signalChanged ? '是（band內也需核對調倉）' : '否'],
        ['下一次換倉日', x.nextRollDate || '尚未指定'], ['期貨帳戶核對時間', localTime(x.accountAsOf).replace('T', ' ')],
        ['權益來源', x.equitySource === 'broker_confirmed' ? '使用者券商核對值' : x.equitySource === 'futures_mtm' ? '逐合約期貨MTM估值' : '最後核對值（待更新）']]) +
      '<details><summary>逐筆合約</summary>' + (parts || '<p class="muted">目前無部位。</p>') + '</details></div>';
  }
  function renderFunding() {
    const x = snapshot;
    if (!x) { $('funding-content').innerHTML = empty('尚無帳戶權益與保證金', '補款不能只靠名目曝險推算，請填入券商帳戶資料。'); return; }
    const r = x.risk;
    $('funding-content').innerHTML = '<div class="card"><div class="metrics">' +
      metric('目前風險指標', r.ratio === null ? '無部位' : fmt(r.ratio, 1) + '%', '期貨權益 ÷ 原始保證金', r.below500 ? 'red' : r.approaching ? 'gold' : 'green') +
      metric('跌破500%需補款', money(r.topUp), '補到550%，不是只補到500%', r.below500 ? 'red' : '') +
      metric('期貨帳戶權益', money(x.equity), x.equitySource === 'broker_confirmed' ? '已核對' : '非即時券商值，請核對') +
      metric('場外備用資金', money(x.outside), '可立即轉入') +
      '</div>' + keys([['所需原始保證金', money(x.initialMargin)], ['所需維持保證金', money(x.maintenanceMargin)],
        ['500%安全線', r.below500 ? '低於安全線' : r.ratio === null ? '無部位，不適用' : '未跌破'],
        ['可由場外補入', money(r.availableTransfer)], ['場外不足缺口', money(r.fundingShortfall)],
        ['距維持保證金', money(r.maintenanceBuffer)], ['月初550%整理', r.monthlyTransfer >= 0 ? '需轉入 ' + money(r.monthlyTransfer) : '可轉出 ' + money(-r.monthlyTransfer)],
        ['本月整理紀錄', x.monthCleanupDue ? '尚未完成核對' : '已記錄']]) +
      '<p class="meta">資金轉帳前後，總策略權益不變。保證金採本次核對總額，不套用舊保證金常數。</p></div>';
  }
  function renderStress() {
    if (!snapshot) { $('stress-content').innerHTML = empty('輸入帳戶後即可壓測', '需要實際口數、期貨權益、場外資金與保證金。'); return; }
    $('stress-content').innerHTML = snapshot.stress.map(r => '<article class="card stress-card"><div class="stress-top"><strong>' +
      fmt(r.change * 100) + '%</strong>' + badge(r.below500 ? '需補款' : r.ratio === null ? '無部位' : '未跌破500%', r.below500 ? 'red' : 'green') +
      '</div><div class="stress-index">' + fmt(r.currentIndex, 2) + ' → ' + fmt(r.scenarioIndex, 2) + ' 點</div>' +
      '<div class="stress-pair"><div><div class="label">期貨壓力損益</div><div class="value red">' + money(r.totalPnl) +
      '</div></div><div><div class="label">壓力後總策略權益</div><div class="value">' + money(r.total) + '</div></div></div>' +
      keys([['期貨帳戶剩餘權益', money(r.equity)], ['期貨帳戶負權益缺口', money(r.equityDeficit)], ['相對目前總權益回撤', fmt(r.drawdownPct, 2) + '%'],
        ['預估風險指標', r.ratio === null ? '無部位' : fmt(r.ratio, 1) + '%']]) +
      '<div class="funding-callout"><small>補至550%所需入金（未取整）</small><strong>' + fmt(r.to550, 2) + ' 元' +
      '</strong>' + (!r.reserveSufficient ? '<small class="red">場外資金不足 · 缺口 ' + fmt(r.shortfallTo550, 2) + ' 元</small>' : '<small>場外資金足夠</small>') +
      '<small>' + (r.below500 ? '已跌破500%，需緊急補款' : '未跌破500%，不觸發緊急補款') + '</small></div>' +
      '<details><summary>完整壓測明細</summary>' + keys([['下跌點數', fmt(-r.pointChange, 2)],
        ['TX 壓力損益', money(r.pnl.TX)], ['MTX 壓力損益', money(r.pnl.MTX)], ['TMF 壓力損益', money(r.pnl.TMF)],
        ['場外資金（補款前）', money(r.outside)], ['原始保證金（不變）', money(r.initialMargin)],
        ['維持保證金（不變）', money(r.maintenanceMargin)], ['整元入金建議', money(r.suggestedDeposit)],
        ['維持門檻狀態', r.belowMaintenance ? '已低於維持保證金' : r.nearMaintenance ? '接近（已低於原始保證金）' : '尚未接近'],
        ['距維持保證金', money(r.maintenanceBuffer)], ['補款後期貨權益', money(r.equityAfterTransfer)],
        ['補款後場外資金', money(r.outsideAfterTransfer)], ['補款後總策略權益', money(r.equityAfterTransfer + r.outsideAfterTransfer)]]) +
      '</details></article>').join('');
  }
  function renderExecutions() {
    const stats = C.executionStats(state.executions);
    $('execution-stats').innerHTML = '<div class="card"><div class="metrics compact">' +
      metric('平均滑價', fmt(stats.mean, 2) + ' 點') + metric('中位數', fmt(stats.median, 2) + ' 點') +
      metric('P95 滑價', fmt(stats.p95, 2) + ' 點') + metric('最大滑價', fmt(stats.max, 2) + ' 點') +
      '</div>' + keys([['平均等待時間', fmt(stats.averageWaitSeconds, 2) + ' 秒'],
        ['換倉平均滑價', fmt(stats.byKind.roll.mean, 2) + ' 點'], ['訊號調倉平均滑價', fmt(stats.byKind.signal.mean, 2) + ' 點'],
        ['總滑價成本', money(stats.slippageCost)], ['委託樣本數', String(stats.count)], ['費稅不完整委託', String(stats.incompleteCostOrders)]]) +
      '<p class="meta">每筆委託以成交口數加權均價計算；P95採線性插值。跨商品金額以各自乘數換算。</p></div>';
    $('execution-list').innerHTML = state.executions.length ? [...state.executions].sort((a, b) => b.orderedAt.localeCompare(a.orderedAt)).map(raw => {
      const o = C.analyzeExecution(raw);
      return '<details class="card execution-item"><summary>' + escape(o.product + ' · ' + (o.kind === 'roll' ? '換倉' : '訊號調倉') + ' · ' + o.tradeDate) +
        '</summary>' + keys([['近／遠月', o.nearMonth + (o.farMonth ? ' → ' + o.farMonth : '')],
        ['方向', o.side === 'buy' ? '買' : '賣'], ['下單時間', localTime(o.orderedAt).replace('T', ' ')],
        ['第一筆委託價', fmt(o.firstLimit, 2)], ['arrival中間價（理論參考）', fmt(o.arrivalMid, 2)],
        ['arrival可成交五檔均價', fmt(o.arrivalExecutable, 2)], ['實際成交均價', fmt(o.averageFill, 2)], ['成交口數', o.filledLots + ' 口'],
        ['最終成交時間', localTime(o.finalFillAt).replace('T', ' ')], ['最終一筆成交價', fmt(o.finalFillPrice, 2)],
        ['arrival slippage', fmt(o.arrivalSlippage, 2) + ' 點'], ['相對可成交價滑價', fmt(o.touchSlippage, 2) + ' 點'],
        ['至最終成交等待', fmt(o.lastFillSeconds, 2) + ' 秒'],
        ['平均等待成交', fmt(o.averageWaitSeconds, 2) + ' 秒'], ['最終追價點數', fmt(o.chasePoints, 2)],
        ['最大改價追幅', fmt(o.maxChasePoints, 2)], ['手續費／交易稅', money(o.fee) + ' / ' + money(o.tax)],
        ['換月價差現金量（另列）', money(o.rollSpreadCash)], ['滑價成本', money(o.arrivalCost)]]) +
        '<p class="record-meta">' + escape(o.note || '') + '</p><details><summary>五檔、改價與每筆成交</summary><pre class="record-meta">' +
        escape(JSON.stringify({bids: o.bids, asks: o.asks, revisions: o.revisions, fills: o.fills}, null, 2)) +
        '</pre></details>' + (o.attachments || []).map(a => '<button class="text-button attachment" data-id="' + escape(a.id) + '">' + escape(a.name) + ' ↗</button>').join('') + '</details>';
    }).join('') : empty('還沒有交易執行紀錄', '取得下單前五檔及成交資料後，即可累積實際滑價樣本。');
    document.querySelectorAll('.attachment').forEach(b => b.addEventListener('click', () => task(async () => {
      if (!adapter) throw new Error('請先連接資料');
      const {blob} = await adapter.loadAttachment(b.dataset.id);
      const url = URL.createObjectURL(blob); window.open(url, '_blank', 'noopener'); setTimeout(() => URL.revokeObjectURL(url), 60000);
    })));
  }
  function chart(series) {
    if (series.length < 2) return '';
    const vals = series.map(s => s.cumulativeReturn), min = Math.min(0, ...vals), max = Math.max(0.01, ...vals);
    const points = vals.map((v, i) => (12 + i * 676 / (vals.length - 1)).toFixed(1) + ',' + (166 - (v - min) / (max - min) * 148).toFixed(1)).join(' ');
    return '<svg class="chart" viewBox="0 0 700 190" role="img" aria-label="Forward累積報酬曲線"><path d="M12 172H688" stroke="#334059"/><polyline points="' +
      points + '" fill="none" stroke="#6fb3ff" stroke-width="2.5"/></svg><p class="chart-label">' +
      escape(series[0].date + ' → ' + series.at(-1).date) + ' · 已核對權益的累積報酬</p>';
  }
  function renderForward() {
    if (state.ledgerSeed && ledgerUI) { ledgerUI.renderForward(); return; }
    const series = C.forwardSeries(state.snapshots, state.events), valid = series.filter(x => x.performanceEligible), last = valid.at(-1);
    const stats = C.executionStats(state.executions.filter(o => o.tradeDate >= C.START));
    if (!last) { $('forward-content').innerHTML = empty('等待真正 Forward 紀錄', '起算日為2026/09/16；首次有券商核對快照後建立基準，不回填示範或歷史回測。'); return; }
    const risks = series.map(x => x.risk.ratio).filter(C.finite), mdd = Math.max(...valid.map(x => x.drawdown || 0));
    $('forward-content').innerHTML = '<div class="card">' + (connected ? '' : '<p class="gold muted">預覽紀錄，不是真實Forward實績。</p>') +
      '<div class="metrics">' + metric('累積報酬', pct(last.cumulativeReturn), valid.length + '日已核對') +
      metric('最近每日報酬', pct(last.dailyReturn), '缺核對日不偽填0%') + metric('觀測最大回撤', pct(mdd), '資料缺口可能低估回撤') +
      metric('最低觀測風險指標', fmt(risks.length ? Math.min(...risks) : null, 1) + '%') + '</div>' + chart(valid) +
      keys([['最近策略權益', money(last.totalEquity)], ['期貨理論權益', money(last.theoryEquity)], ['實際－理論', money(last.comparisonGap)],
        ['期貨理論累積報酬', pct(last.theoryCumulativeReturn)],
        ['理論／實際曝險', fmt(last.theoryExposure, 3) + 'x / ' + fmt(last.actualExposure, 3) + 'x'],
        ['實際手續費', money(stats.fee)], ['實際交易稅', money(stats.tax)], ['滑價成本', money(stats.slippageCost)],
        ['補款次數', String(state.events.filter(e => e.kind === 'margin_topup' && e.amount > 0 && e.date >= C.START).length)],
        ['換倉執行成本', money(stats.rollExecutionCost)]]) +
      '<p class="meta">請建立下方逐合約期貨帳本以比較理論／實際；不再提供指數代理理論曲線。實際費稅已在券商權益內，報酬不重複扣除。</p></div>';
  }
  function eventName(kind) {
    return {signal_change: '訊號改變', risk_below500: '跌破500%', data_quality: '資料品質',
      margin_topup: '補款', monthly_cleanup: '月初整理', external_flow: '策略外資金流',
      account_update: '帳戶核對', ledger_input: '日終帳本輸入', ledger_seed: '期初帳本建立', rebalance: '調倉', roll: '換倉', abnormal_slippage: '異常滑價', rule_violation: '規則違反'}[kind] || kind;
  }
  function renderHistory() {
    const health = state.health, s = [...state.snapshots].sort((a, b) => b.date.localeCompare(a.date));
    $('history-content').innerHTML = '<div class="card">' + keys([
      ['每日自動儲存', health?.lastSuccessAt ? '已接收排程快照' : '待核准合併並啟用排程'],
      ['上次成功時間', health?.lastSuccessAt ? localTime(health.lastSuccessAt).replace('T', ' ') : '—'],
      ['工作狀態', health?.status || '尚未啟用'], ['快照數量', String(s.length)]]) +
      '<p class="meta">關閉手機也能由排程保存。每日摘要保留最新觀測，每次觀測原始輸入與版本仍完整留存。</p></div>' +
      (s.length ? s.slice(0, 90).map(x => '<details class="card history-entry"><summary>' + escape(x.date) + ' · ' +
      escape(x.equitySource === 'broker_confirmed' ? '已核對' : '估值') + '</summary>' + keys([
        ['指數 / 0050', fmt(x.index, 2) + ' / ' + fmt(x.signal.close, 2)], ['目標 / 實際', fmt(x.signal.target, 1) + 'x / ' + fmt(x.actualExposure, 3) + 'x'],
        ['總權益', money(x.totalEquity)], ['風險指標', fmt(x.risk.ratio, 1) + '%'], ['狀態', x.labels.join('、')],
        ['資料品質', x.quality.join('；') || '完成'], ['觀測時間', x.observedAt], ['觀測ID', x.observationId || '本機預覽']]) +
        '<details><summary>完整快照與四種壓測</summary><pre class="record-meta">' + escape(JSON.stringify(x, null, 2)) + '</pre></details></details>').join('') :
      empty('風控黑盒子等待啟用', '本機預覽不會偽裝成已經每日自動保存。')) +
      '<div class="card"><h3>最近事件</h3><ul class="event-list">' +
      [...state.events].sort((a, b) => (b.at || '').localeCompare(a.at || '')).slice(0, 30).map(e => '<li>' +
      escape((e.date || '') + ' · ' + eventName(e.kind)) + (C.finite(e.amount) ? ' · ' + money(e.amount) : '') + '</li>').join('') + '</ul></div>';
  }
  function renderReview() {
    const month = $('review-month').value, r = state.ledgerSeed && ledgerUI
      ? window.DefenseLedger.monthlyReview(ledgerUI.data(), state.executions, state.events, month, state.snapshots)
      : C.monthlyReview(state.snapshots, state.executions, state.events, month);
    $('review-content').innerHTML = '<div class="card"><p class="muted">' + escape(r.reviewCycle) + '</p><div class="metrics">' +
      metric('月初權益', money(r.openingEquity), r.coverageStart || '待資料') + metric('月底／最新權益', money(r.endingEquity), r.coverageEnd || '待資料') +
      metric('本月報酬', pct(r.monthlyReturn), r.partialMonth ? '首次基準起的部分月份' : '扣除外部資金流') +
      metric('本月觀測最大回撤', pct(r.maxDrawdown), '以已核對權益計算') + '</div>' +
      '<div class="pill-values">' + Object.entries(r.exposureDays).map(([k, n]) => '<span>' + k + 'x · ' + n + ' 日</span>').join('') + '</div>' +
      keys([['已核對／估值天數', r.actualDays + ' / ' + r.estimatedDays], ['最低觀測風險指標', fmt(r.lowestRisk, 1) + '%'],
        ['平均／最大曝險偏差', fmt(r.meanExposureDeviation, 3) + 'x / ' + fmt(r.maxExposureDeviation, 3) + 'x'],
        ['調倉／換倉／補款', r.rebalanceCount + ' / ' + r.rollCount + ' / ' + r.topUpCount],
        ['手續費／交易稅', money(r.execution.fee) + ' / ' + money(r.execution.tax)],
        ['本月滑價總成本', money(r.execution.slippageCost)],
        ['平均／中位數滑價', fmt(r.execution.mean, 2) + ' / ' + fmt(r.execution.median, 2) + ' 點'],
        ['P95／最大滑價', fmt(r.execution.p95, 2) + ' / ' + fmt(r.execution.max, 2) + ' 點'],
        ['期貨理論月報酬', pct(r.theoreticalReturn)], ['實際－理論報酬差', pct(r.returnGap)],
        ['期貨理論權益', money(r.theoreticalEquity)], ['實際－理論', money(r.comparisonGap)],
        ['需核對規則事件', r.potentialViolations.length + ' 筆'], ['本月異常事件', r.exceptions.length + ' 筆']]) +
      '<p class="meta">「需核對」代表快照觀測到待處理狀態，須搭配成交與補款時間判斷，不直接認定違規。無觀測資料時不宣稱沒有違規。</p>' +
      '<details><summary>規則與異常事件明細</summary><ul class="event-list">' +
      r.potentialViolations.map(e => '<li>' + escape(e.date + ' · ' + e.detail) + '</li>').join('') +
      r.exceptions.map(e => '<li>' + escape(e.date + ' · ' + eventName(e.kind) + ' · ' + JSON.stringify(e.detail || {})) + '</li>').join('') +
      '</ul></details></div>';
  }
  function render() {
    snapshot = state.account ? C.buildSnapshot(market, state.account, now()) : null;
    renderToday(); renderPositions(); renderFunding(); renderStress(); renderExecutions(); renderForward(); renderHistory(); renderReview(); ledgerUI?.render();
  }
  function positionInput(p = {product: 'TMF', month: market.date.slice(0, 7), lots: 0, mark: null}) {
    const row = document.createElement('div'); row.className = 'position-input';
    row.innerHTML = '<label>商品<select class="pos-product">' + Object.keys(C.MULT).map(k => '<option' + (p.product === k ? ' selected' : '') + '>' + k + '</option>').join('') +
      '</select></label><label>月份<input class="pos-month" type="month" required value="' + escape(p.month) + '"></label>' +
      '<label>口數<input class="pos-lots" type="number" inputmode="numeric" step="1" required value="' + escape(p.lots) + '"></label>' +
      '<label>期貨參考價<input class="pos-mark" type="number" inputmode="decimal" step="0.01" min="0.01" value="' + escape(p.mark ?? '') + '"></label>' +
      '<button class="remove-position" type="button" aria-label="移除此合約">×</button>';
    row.querySelector('button').addEventListener('click', () => row.remove());
    $('position-inputs').append(row);
  }
  function populateAccount() {
    const a = state.account || {asof: now(), equityDate: market.date, indexAtEquity: market.index,
      equity: '', outside: '', initialMargin: '', maintenanceMargin: '', nextRollDate: ''};
    const f = $('account-form');
    ['equityDate', 'equity', 'outside', 'indexAtEquity', 'initialMargin', 'maintenanceMargin', 'nextRollDate'].forEach(k => { f.elements[k].value = a[k] ?? ''; });
    f.elements.asof.value = localTime(now()); f.elements.externalFlow.value = '0'; f.elements.acknowledge.checked = false;
    $('position-inputs').replaceChildren();
    (a.positions?.length ? a.positions : [{product: 'TMF', month: market.date.slice(0, 7), lots: 0, mark: null}]).forEach(positionInput);
  }
  async function saveAccount(next, event) {
    const before = state.account, expected = before?.revision || 0;
    const observedAt = now(), afterSnapshot = C.buildSnapshot(market, next, observedAt);
    const beforeSnapshot = before ? C.buildSnapshot(market, before, observedAt) : null;
    const events = [event, ...C.automaticEvents(beforeSnapshot, afterSnapshot)].filter(Boolean);
    if (connected) {
      state.account = await adapter.saveAccount(next, expected, events);
      state = {...state, ...await adapter.load()};
    } else {
      const value = {...next, revision: expected + 1};
      persistLocal({...state, account: value, events: [...state.events, ...events.map(e => ({...e, id: crypto.randomUUID()}))]});
    }
    render(); populateAccount();
    notice(connected ? '已儲存帳戶與事件紀錄。每日快照由排程獨立執行。' : '已儲存本機預覽紀錄；正式帳戶不受影響。');
  }
  function n(input, nullable = false) {
    if (input.value.trim() === '') { if (nullable) return null; throw new Error('必填數值不可留空'); }
    const v = Number(input.value); C.number(v, '輸入'); return v;
  }
  function setupForms() {
    $('account-form').addEventListener('submit', e => { e.preventDefault(); task(async () => {
      const f = e.target, at = now();
      const a = {...state.account, asof: isoTime(f.elements.asof.value), equityDate: f.elements.equityDate.value,
        nextRollDate: f.elements.nextRollDate.value || null};
      ['equity', 'outside', 'indexAtEquity', 'initialMargin', 'maintenanceMargin'].forEach(k => { a[k] = n(f.elements[k]); });
      a.positions = [...document.querySelectorAll('.position-input')].map(row => ({product: row.querySelector('.pos-product').value,
        month: row.querySelector('.pos-month').value, lots: n(row.querySelector('.pos-lots')), mark: n(row.querySelector('.pos-mark'), true)}));
      if (f.elements.acknowledge.checked) {
        const s = C.signal(market.target); if (!s.valid || !market.closed) throw new Error('訊號尚未有效，不能確認已調倉');
        a.lastAppliedState = s.state;
      }
      const flow = n(f.elements.externalFlow);
      await saveAccount(C.normalizeAccount(a), {kind: flow === 0 ? 'account_update' : 'external_flow', amount: flow,
        date: C.twDate(a.asof), at: a.asof, recordedAt: at, detail: {equityDate: a.equityDate}});
      $('account-details').open = false;
    }); });
    $('transfer-form').addEventListener('submit', e => { e.preventDefault(); task(async () => {
      if (!state.account) throw new Error('請先建立帳戶');
      const result = C.transfer(state.account, n(e.target.elements.amount), now(), e.target.elements.purpose.value);
      await saveAccount(result.account, result.event); e.target.reset();
    }); });
    $('book-inputs').innerHTML = '<div class="book-head"><span>委買：價格／口數</span><span>委賣：價格／口數</span></div>' +
      [1, 2, 3, 4, 5].map(i => '<div class="book-level"><span>' + i + '</span>' + ['bid', 'ask'].map(side => '<div class="book-pair"><input name="' +
        side + '-price-' + i + '" type="number" step="0.01" inputmode="decimal" required aria-label="' + (side === 'bid' ? '委買' : '委賣') + i +
        '檔價格" placeholder="價"><input name="' + side + '-lots-' + i + '" type="number" step="1" min="1" inputmode="numeric" required aria-label="' +
        (side === 'bid' ? '委買' : '委賣') + i + '檔口數" placeholder="量"></div>').join('') + '</div>').join('');
    $('execution-form').elements.screenshots.disabled = true;
    $('execution-form').addEventListener('submit', e => { e.preventDefault(); task(async () => {
      const f = e.target, time = isoTime(f.elements.orderedAt.value), files = [...f.elements.screenshots.files];
      const parseLines = (s, fill) => s.trim() ? s.trim().split(/\n+/).map(line => {
        const a = line.split(/[,，]/).map(x => x.trim());
        if (a.length < (fill ? 3 : 2) || a.length > (fill ? 7 : 2)) throw new Error('改價／成交每行欄位數有誤');
        if (a[1] === '' || (fill && a[2] === '')) throw new Error('成交價與口數不可留空');
        return fill ? {at: isoTime(a[0]), price: Number(a[1]), lots: Number(a[2]),
          fee: a[3] === undefined || a[3] === '' ? null : Number(a[3]), tax: a[4] === undefined || a[4] === '' ? null : Number(a[4]),
          nearPrice: a[5] === undefined || a[5] === '' ? null : Number(a[5]), farPrice: a[6] === undefined || a[6] === '' ? null : Number(a[6])}
          : {at: isoTime(a[0]), price: Number(a[1])};
      }) : [];
      const raw = {id: pendingOrderId, kind: f.elements.kind.value, product: f.elements.product.value, side: f.elements.side.value,
        nearMonth: f.elements.nearMonth.value, farMonth: f.elements.farMonth.value || null, quoteConvention: 'far-minus-near',
        tradeDate: C.twDate(time), orderedAt: time, bookAt: isoTime(f.elements.bookAt.value),
        requestedLots: n(f.elements.requestedLots), firstLimit: n(f.elements.firstLimit),
        abnormalThreshold: n(f.elements.abnormalThreshold, true), note: f.elements.note.value,
        revisions: parseLines(f.elements.revisions.value, false), fills: parseLines(f.elements.fills.value, true)};
      ['bids', 'asks'].forEach(side => { raw[side] = [1, 2, 3, 4, 5].map(i => ({price: n(f.elements[side.slice(0, -1) + '-price-' + i]),
        lots: n(f.elements[side.slice(0, -1) + '-lots-' + i])})); });
      const result = C.analyzeExecution(raw);
      if (C.timestamp(raw.fills.at(-1).at) > C.timestamp(now())) throw new Error('成交時間不可晚於現在');
      if (connected) { await adapter.saveExecution(raw, files); state = {...state, ...await adapter.load()}; }
      else {
        if (files.length) throw new Error('請先連接測試資料再保存原始截圖');
        const event = {id: raw.id, kind: raw.kind === 'roll' ? 'roll' : 'rebalance', date: raw.tradeDate, at: raw.orderedAt, executionId: raw.id};
        const events = [...state.events, event];
        if (C.finite(raw.abnormalThreshold) && result.arrivalSlippage > raw.abnormalThreshold)
          events.push({...event, id: raw.id + '-slippage', kind: 'abnormal_slippage', detail: {arrivalSlippage: result.arrivalSlippage, threshold: raw.abnormalThreshold}});
        persistLocal({...state, executions: [...state.executions, raw], events, ledgerRevision: (state.ledgerRevision || 0) + 1});
      }
      pendingOrderId = crypto.randomUUID(); f.reset(); $('execution-details').open = false;
      render(); notice('成交紀錄已儲存。請依實際成交核對持倉與帳戶，避免把紀錄動作當成已更新部位。');
    }); });
  }
  async function connect() {
    if (window.DEFENSE_INLINE_DATA) throw new Error('此檔為獨立預覽，雲端功能請由feature branch頁面開啟');
    adapter = await import('./defense-data.js');
    const loaded = await adapter.load();
    state = {...state, ...loaded}; connected = true;
    if (loaded.market && loaded.market.date >= market.date) market = loaded.market;
    $('mode-label').textContent = config.mode === 'production' ? '正式 Forward 帳戶' : '開發預覽 · 獨立雲端測試帳戶';
    $('connect').textContent = '已連接'; $('execution-form').elements.screenshots.disabled = false;
    $('attachment-note').textContent = '原始截圖保存在本策略資料範圍，可供日後比對。';
    render(); populateAccount();
    if (!state.account) $('account-details').open = true;
    notice(state.account ? '已載入本策略資料。' : '測試帳戶目前空白，請輸入本策略帳戶資料；示範值不會寫入雲端。');
  }
  async function init() {
    setupForms();
    $('review-month').value = C.twDate(now()).slice(0, 7);
    market = await publicMarket();
    ledgerUI = window.DefenseLedgerUI.mount({getState: () => state, getMarket: () => market, renderAll: render, notice, task,
      modeLabel: () => connected && config.mode === 'production' ? '正式資料：實際成交MTM與理論策略分列' : '開發驗收資料，不是真實Forward實績',
      saveSeed: async seed => {
        if (connected) { await adapter.saveLedgerSeed(seed); state = {...state, ...await adapter.load()}; }
        else persistLocal({...state, ledgerSeed: seed, ledgerRevision: (state.ledgerRevision || 0) + 1,
          events: [...state.events, {id: crypto.randomUUID(), kind: 'ledger_seed', date: C.twDate(seed.at), at: now()}]});
      },
      saveDay: async day => {
        if (connected) { await adapter.saveLedgerDay(day, state.ledgerRevision || 0); state = {...state, ...await adapter.load()}; }
        else {
          const prior = (state.ledgerInputs || []).find(d => d.date === day.date);
          if (JSON.stringify(prior) === JSON.stringify(day)) return;
          persistLocal({...state, ledgerInputs: [...(state.ledgerInputs || []).filter(d => d.date !== day.date), day],
            ledgerRevision: (state.ledgerRevision || 0) + 1, events: [...state.events,
              {id: crypto.randomUUID(), kind: 'ledger_input', date: day.date, at: now(), detail: {before: prior || null, after: day}}]});
        }
      },
      loadExample: async () => {
        if (connected) throw new Error('已連接雲端，不載入示範覆蓋資料');
        const example = C.clone(window.DEFENSE_ACCEPTANCE_EXAMPLE); if (!example) throw new Error('本頁未附合成範例');
        localStore = STORE + '-acceptance'; market = example.market;
        state = {account: example.account, snapshots: [], executions: example.orders, events: [], health: null,
          ledgerSeed: example.seed, ledgerInputs: example.days, ledgerRevision: 0, datasetKind: 'synthetic_acceptance'};
        $('mode-label').textContent = '第三輪合成驗收 · 非真實帳戶'; populateAccount();
      }
    });
    if (config.mode === 'production') await connect();
    else {
      let saved;
      try { saved = JSON.parse(localStorage.getItem(STORE) || 'null'); } catch { saved = null; }
      if (saved?.account) state = saved;
      else state.account = demoAccount();
      render(); populateAccount();
    }
    $('connect').addEventListener('click', () => task(connect));
    $('refresh').addEventListener('click', () => task(async () => {
      market = localStore === STORE ? await publicMarket() : C.clone(window.DEFENSE_ACCEPTANCE_EXAMPLE.market);
      if (connected) { state = {...state, ...await adapter.load()}; if (state.market && state.market.date >= market.date) market = state.market; }
      render(); populateAccount(); notice('已重新載入行情與本策略紀錄。');
    }));
    $('edit-account').addEventListener('click', () => { populateAccount(); $('account-details').open = true; $('account-details').scrollIntoView({behavior: 'smooth'}); });
    $('add-position').addEventListener('click', () => positionInput());
    $('review-month').addEventListener('change', () => task(async () => renderReview()));
    $('export-data').addEventListener('click', () => {
      const blob = new Blob([JSON.stringify({mode: connected ? config.mode : 'demo', schemaVersion: 1, exportedAt: now(), ...state,
        computedLedger: ledgerUI.data()}, null, 2)], {type: 'application/json'});
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'defense-records-' + C.twDate(now()) + '.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    });
    window.DefenseUI = {getState: () => C.clone(state), getSnapshot: () => C.clone(snapshot)};
  }
  init().catch(error => { notice(error.message, true); $('today-content').innerHTML = empty('尚無法完成資料核對', '重新載入前請先保留已輸入資料。'); });
})();
