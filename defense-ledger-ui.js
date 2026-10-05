/* Fourth-strategy-only futures ledger forms. No legacy account writes. */
(function (root) {
  'use strict';
  root.DefenseLedgerUI = {mount(o) {
    const C = root.DefenseCore, L = root.DefenseLedger, $ = id => document.getElementById(id);
    const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
    const num = x => C.finite(x) ? x.toLocaleString('zh-TW', {maximumFractionDigits: 2}) : '—';
    const money = x => C.finite(x) ? '$' + num(x) : '—';
    const pct = x => C.finite(x) ? num(x * 100) + '%' : '—';
    const metric = (name, value) => '<div class="metric"><div class="label">' + esc(name) + '</div><div class="value">' + esc(value) + '</div></div>';
    const keys = pairs => '<dl class="key-list">' + pairs.map(([a, b]) => '<div class="key-row"><dt>' + esc(a) + '</dt><dd>' + esc(b) + '</dd></div>').join('') + '</dl>';
    const local = at => new Date(Date.parse(at) + 8 * 3600000).toISOString().slice(0, 19);
    const iso = at => { const value = at + '+08:00'; C.timestamp(value); return value; };
    const value = (element, optional = false) => {
      if (!element.value.trim()) { if (optional) return null; throw new Error('帳本必填數值不可空白'); }
      return C.number(Number(element.value), '帳本輸入');
    };
    function data() { const s = o.getState(); return L.buildLedger(s.ledgerSeed, s.ledgerInputs || [], s.executions); }
    function positions(a) { return a.length ? a.map(p => p.product + ' ' + p.month + ' ' + p.lots + '口').join('／') : '無部位'; }
    function quoteInput(q = {}) {
      const row = document.createElement('div'); row.className = 'ledger-quote card';
      row.innerHTML = '<div class="form-grid"><label>商品<select class="l-product">' + Object.keys(C.MULT).map(p => '<option' + (q.product === p ? ' selected' : '') + '>' + p + '</option>').join('') +
        '</select></label><label>合約月份<input class="l-month" type="month" required value="' + esc(q.month || $('ledger-day-form').elements.targetMonth.value) + '"></label>' +
        [['bid', '報價時委買'], ['ask', '報價時委賣'], ['mark', '日終期貨估值價'], ['initialMargin', '每口原始保證金'], ['maintenanceMargin', '每口維持保證金']].map(([k, label]) =>
          '<label>' + label + '<input class="l-' + k + '" type="number" step="0.01" min="0" inputmode="decimal" required value="' + esc(q[k] ?? '') + '"></label>').join('') +
        '<label>保證金生效日<input class="l-marginEffectiveDate" type="date" value="' + esc(q.margin?.effectiveDate ?? '') + '"></label>' +
        '<label>保證金抓取時間<input class="l-marginFetchedAt" type="datetime-local" step="1" value="' + esc(q.margin?.fetchedAt ?? '') + '"></label>' +
        '<label>券商覆寫原始保證金<input class="l-marginOverrideInitial" type="number" min="0" step="0.01" inputmode="decimal" value="' + esc(q.margin?.brokerOverride?.initial ?? '') + '"></label>' +
        '<label>券商覆寫維持保證金<input class="l-marginOverrideMaintenance" type="number" min="0" step="0.01" inputmode="decimal" value="' + esc(q.margin?.brokerOverride?.maintenance ?? '') + '"></label>' +
        '</div><button type="button" class="text-button">移除此合約</button>';
      row.querySelector('button').addEventListener('click', () => row.remove()); $('ledger-quote-inputs').append(row);
    }
    function populate() {
      const s = o.getState(), market = o.getMarket(), d = $('ledger-day-form'), seed = $('ledger-seed-form');
      if (!market) return;
      seed.elements.at.value ||= local(s.account?.asof || new Date().toISOString());
      seed.querySelector('button').disabled = Boolean(s.ledgerSeed);
      if (d.elements.date.value) return;
      const date = market.date; d.elements.date.value = date;
      d.elements.targetMonth.value = s.account?.positions[0]?.month || date.slice(0, 7);
      d.elements.signalAt.value = date + 'T13:30:00'; d.elements.referenceAt.value = date + 'T13:31:00'; d.elements.valuationAt.value = date + 'T13:45:00';
      for (const p of Object.keys(C.MULT)) {
        const current = (market.futures || []).find(q => q.product === p && q.month === d.elements.targetMonth.value);
        const held = s.account?.positions.find(q => q.product === p && q.month === d.elements.targetMonth.value);
        quoteInput({product: p, month: d.elements.targetMonth.value, mark: current?.mark ?? held?.mark ?? null});
      }
    }
    async function saveDay(day) {
      const s = o.getState(); if (!s.ledgerSeed) throw new Error('請先建立期初帳本');
      const valid = L.validateDay(day, s.ledgerSeed);
      if (C.timestamp(valid.valuationAt) > Date.now()) throw new Error('日終估值時間尚未發生，不能保存成Forward資料');
      await o.saveDay(valid); o.renderAll(); o.notice('日終輸入已保存。正式日終快照由排程執行，同日期不會另建一筆。');
    }
    $('ledger-seed-form').addEventListener('submit', e => { e.preventDefault(); o.task(async () => {
      const s = o.getState(), f = e.target, a = s.account;
      if (!a) throw new Error('請先核對實際帳戶'); if (s.ledgerSeed) throw new Error('期初已建立，不能覆寫');
      const at = iso(f.elements.at.value); if (Date.parse(at) > Date.now()) throw new Error('期初不可晚於現在');
      const seed = L.normalizeSeed({at, equity: a.equity, outside: a.outside, positions: a.positions,
        lastAppliedState: a.lastAppliedState || null, source: f.elements.source.value,
        fees: {TX: value(f.elements.feeTX), MTX: value(f.elements.feeMTX), TMF: value(f.elements.feeTMF)}, taxRate: value(f.elements.taxRate)});
      await o.saveSeed(seed); o.renderAll(); $('ledger-seed-details').open = false; o.notice('期初帳本已建立；沒有回填或重建不存在的真實成交。');
    }); });
    $('ledger-add-quote').addEventListener('click', () => quoteInput());
    $('ledger-day-form').addEventListener('submit', e => { e.preventDefault(); o.task(async () => {
      const f = e.target, market = o.getMarket();
      if (f.elements.date.value !== market.target.at(-1).date) throw new Error('當日訊號來源日期不同；歷史日請匯入完整日終JSON');
      const source = f.elements.source.value;
      const quotes = [...document.querySelectorAll('.ledger-quote')].map(row => {
        const q = {product: row.querySelector('.l-product').value, month: row.querySelector('.l-month').value, source};
        ['bid', 'ask', 'mark', 'initialMargin', 'maintenanceMargin'].forEach(k => { q[k] = value(row.querySelector('.l-' + k)); });
        const effectiveDate = row.querySelector('.l-marginEffectiveDate').value;
        const fetchedAt = row.querySelector('.l-marginFetchedAt').value ? iso(row.querySelector('.l-marginFetchedAt').value) : '';
        const overrideInitial = row.querySelector('.l-marginOverrideInitial').value.trim() ? value(row.querySelector('.l-marginOverrideInitial')) : null;
        const overrideMaintenance = row.querySelector('.l-marginOverrideMaintenance').value.trim() ? value(row.querySelector('.l-marginOverrideMaintenance')) : null;
        if (effectiveDate || fetchedAt || overrideInitial !== null || overrideMaintenance !== null) q.margin = {
          source, effectiveDate, fetchedAt, initial: q.initialMargin, maintenance: q.maintenanceMargin,
          brokerOverride: overrideInitial === null && overrideMaintenance === null ? null : {initial: overrideInitial, maintenance: overrideMaintenance}};
        return q;
      });
      const spreads = f.elements.spreads.value.trim() ? f.elements.spreads.value.trim().split(/\n+/).map(line => {
        const a = line.split(/[,，]/).map(x => x.trim()); if (a.length !== 6) throw new Error('跨月價差每行須有6欄');
        return {product: C.product(a[0]), nearMonth: a[1], farMonth: a[2], bid: Number(a[3]), ask: Number(a[4]), nearReference: Number(a[5]), source};
      }) : [];
      await saveDay({date: f.elements.date.value, signalDate: market.target.at(-1).date, indicators: C.indicators(market.target),
        previousTradingDate: market.target.at(-2)?.date || null,
        signalAt: iso(f.elements.signalAt.value), referenceAt: iso(f.elements.referenceAt.value), valuationAt: iso(f.elements.valuationAt.value),
        targetMonth: f.elements.targetMonth.value, externalFlow: value(f.elements.externalFlow), actualTransfer: value(f.elements.actualTransfer),
        brokerEquity: value(f.elements.brokerEquity, true), brokerOutside: value(f.elements.brokerOutside, true),
        roll: f.elements.roll.checked, monthlyCleanup: f.elements.monthlyCleanup.checked, actualComplete: f.elements.actualComplete.checked, quotes, spreads});
      $('ledger-day-details').open = false;
    }); });
    $('ledger-import').addEventListener('change', e => o.task(async () => {
      const file = e.target.files[0]; if (!file) return; if (file.size > 1000000) throw new Error('日終JSON上限1MB');
      await saveDay(JSON.parse(await file.text())); e.target.value = '';
    }));
    $('load-ledger-example').hidden = !root.DEFENSE_ACCEPTANCE_EXAMPLE;
    $('load-ledger-example').addEventListener('click', () => o.task(async () => { await o.loadExample(); o.renderAll(); o.notice('目前是獨立合成驗收範例，含未來示範日期；不是真實Forward，不會寫入雲端或覆蓋原預覽紀錄。'); }));
    function renderForward() {
      const result = data(), completed = result.rows.filter(r => r.status === 'complete'), last = completed.at(-1);
      if (!last) { $('forward-content').innerHTML = '<div class="card empty"><strong>等待完整期貨Forward帳本</strong>已有期初；請補齊每日逐合約行情與實際成交。缺資料不以指數補值。</div>'; return; }
      $('forward-content').innerHTML = '<div class="card"><p class="gold muted">' + esc(o.modeLabel()) + '</p><div class="metrics">' +
        metric('理論累積報酬', pct(last.theory.cumulativeReturn)) + metric('實際累積報酬', pct(last.actual.cumulativeReturn)) +
        metric('理論最大回撤', pct(Math.max(...completed.map(r => r.theory.drawdown)))) + metric('實際最大回撤', pct(Math.max(...completed.map(r => r.actual.drawdown)))) + '</div>' +
        keys([['最近完整日', last.date], ['理論總權益', money(last.theory.totalEquity)], ['實際總權益', money(last.actual.totalEquity)], ['實際－理論', money(last.gap)],
          ['理論／實際曝險', num(last.theory.exposure) + 'x / ' + num(last.actual.exposure) + 'x'], ['券商日結對帳', last.actual.reconciled ? '帳戶權益／場外金額一致' : '尚未完成；目前為逐筆成交MTM帳本'],
          ['最低實際風險指標', num(Math.min(...completed.map(r => r.actual.risk.ratio).filter(C.finite))) + '%'], ['帳本狀態', result.status === 'complete' ? '已輸入日期完整' : '有資料缺口，後續暫停續算']]) +
        '<p class="meta">實際損益取逐合約價格與真實輸入成交；手續費／稅已扣除，滑價不重複扣款。所有資料日期仍需核對，測試資料不是真實實績。</p></div>';
    }
    function render() {
      populate(); const result = data();
      $('ledger-rows').innerHTML = result.rows.map(r => {
        if (r.status !== 'complete') return '<div class="card"><strong class="gold">' + esc(r.date + ' · 帳本待補') + '</strong><p>' + esc(r.error) + '</p></div>';
        const a = r.actual, t = r.theory;
        return '<details class="card ledger-day"><summary>' + esc(r.date + ' · ' + r.targetExposure + 'x · 實際－理論 ' + money(r.gap)) + '</summary>' +
          '<div class="metrics two">' + metric('理論總權益', money(t.totalEquity)) + metric('實際總權益', money(a.totalEquity)) + '</div>' +
          keys([['理論訊號', r.signal.reason], ['訊號／報價／日終', local(r.signalAt) + ' / ' + local(r.referenceAt) + ' / ' + local(r.at)],
            ['理論應持口數', positions(r.theoreticalLots)], ['實際持倉口數', positions(r.actualLots)],
            ['每日MTM：理論／實際', money(t.mtmPnl) + ' / ' + money(a.mtmPnl)], ['手續費：理論／實際', money(t.fee) + ' / ' + money(a.fee)],
            ['交易稅：理論／實際', money(t.tax) + ' / ' + money(a.tax)], ['滑價成本：理論／實際', money(t.slippageCost) + ' / ' + money(a.slippageCost)],
            ['期貨權益：理論／實際', money(t.equity) + ' / ' + money(a.equity)], ['場外資金：理論／實際', money(t.outside) + ' / ' + money(a.outside)],
            ['帳戶間移轉：理論／實際', money(t.transfer) + ' / ' + money(a.transfer)], ['曝險：理論／實際', num(t.exposure) + 'x / ' + num(a.exposure) + 'x']]) +
          '<p class="meta">' + esc(r.allocationPolicy) + '</p>' + ['theory', 'actual'].map(k => '<details><summary>' + (k === 'theory' ? '理論逐筆成交與MTM' : '實際逐筆成交與MTM') +
            '</summary>' + (r[k].trades.map(x => keys([['商品／月／口數', x.product + ' ' + x.month + ' ' + x.signedLots], ['成交時間', local(x.at)], ['成交價', num(x.price)], ['手續費／稅', money(x.fee) + ' / ' + money(x.tax)], ['來源', x.priceSource]])).join('<div class="divider"></div>') || '<p class="muted">當日無成交，保留原部位。</p>') + '</details>').join('') +
          '<details><summary>完整日終帳本與來源</summary><pre class="record-meta">' + esc(JSON.stringify(r, null, 2)) + '</pre></details></details>';
      }).reverse().join('');
    }
    return {render, renderForward, data};
  }};
})(window);
