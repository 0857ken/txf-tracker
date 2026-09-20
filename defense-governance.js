(function (root, factory) {
  'use strict';
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.DefenseGovernance = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const TZ = '+08:00', DAY = 86400000;
  function fail(ok, message) { if (!ok) throw new Error(message); }
  function parsed(value, label) {
    const t = Date.parse(value || ''); fail(Number.isFinite(t), label + '時間無效'); return t;
  }
  function twDate(value) { return new Date(parsed(value, '時間') + 8 * 3600000).toISOString().slice(0, 10); }
  function isoDate(value, label) {
    fail(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value), label + '日期格式無效');
    const t = Date.parse(value + 'T00:00:00Z');
    fail(Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === value, label + '日期無效');
    return value;
  }
  function localMinutes(value) {
    const d = new Date(parsed(value, '時間') + 8 * 3600000);
    return d.getUTCHours() * 60 + d.getUTCMinutes() + d.getUTCSeconds() / 60;
  }
  function validateDecisionWindow({date, signalAt, valuationAt, referenceAt}) {
    isoDate(date, '交易');
    fail(twDate(signalAt) === date, '訊號確認時間必須屬於交易日');
    fail(twDate(valuationAt) === date, '日終估值時間必須屬於交易日');
    if (referenceAt) fail(twDate(referenceAt) === date, '成交參考時間必須屬於交易日');
    fail(localMinutes(signalAt) >= 13 * 60 + 30, '訊號不可早於台灣13:30');
    fail(localMinutes(valuationAt) >= 13 * 60 + 45, '日終MTM／快照不可早於台灣13:45');
    fail(parsed(valuationAt, '日終估值') >= parsed(signalAt, '訊號'), '日終估值不可早於訊號');
    if (referenceAt) {
      fail(parsed(referenceAt, '成交參考') >= parsed(signalAt, '訊號'), '成交參考不可早於訊號確認');
      fail(parsed(referenceAt, '成交參考') <= parsed(valuationAt, '日終估值'), '成交參考不可晚於日終估值');
    }
    return {signalPhase: 'post-13:30', valuationPhase: 'post-13:45', signalAt, valuationAt, referenceAt: referenceAt || null};
  }
  function validateMarginRecord(record, asOf, options = {}) {
    const maxAgeDays = options.maxAgeDays ?? 7;
    const source = typeof record?.source === 'string' && record.source.trim();
    const effectiveDate = record?.effectiveDate;
    const fetchedAt = record?.fetchedAt;
    const initial = Number(record?.initial), maintenance = Number(record?.maintenance);
    const reasons = [];
    if (!source) reasons.push('missing-source');
    try { isoDate(effectiveDate, '保證金生效'); } catch { reasons.push('invalid-effectiveDate'); }
    try { parsed(fetchedAt, '保證金抓取'); } catch { reasons.push('invalid-fetchedAt'); }
    let asOfMs;
    try { asOfMs = parsed(asOf, '核對'); } catch { reasons.push('invalid-asOf'); }
    if (!Number.isFinite(initial) || initial <= 0) reasons.push('invalid-initial');
    if (!Number.isFinite(maintenance) || maintenance <= 0 || maintenance > initial) reasons.push('invalid-maintenance');
    if (asOfMs && Number.isFinite(Date.parse(fetchedAt)) && Date.parse(fetchedAt) > asOfMs) reasons.push('fetched-in-future');
    if (asOfMs && effectiveDate && effectiveDate > new Date(asOfMs + 8 * 3600000).toISOString().slice(0, 10)) reasons.push('effective-in-future');
    const ageDays = asOfMs && Number.isFinite(Date.parse(fetchedAt)) ? (asOfMs - Date.parse(fetchedAt)) / DAY : null;
    if (ageDays !== null && ageDays > maxAgeDays) reasons.push('stale-age');
    if (record?.stale === true) reasons.push('marked-stale');
    return {...record, source: source || null, ageDays, maxAgeDays,
      freshness: reasons.length ? 'stale' : 'fresh', fresh: reasons.length === 0, reasons};
  }
  function reconcileBrokerRisk({calculated, broker, tolerance = 0.01}) {
    const fields = ['initialMargin', 'maintenanceMargin', 'ratio'];
    const differences = {};
    fields.forEach(field => {
      const a = Number(calculated?.[field]), b = Number(broker?.[field]);
      if (!Number.isFinite(a) || !Number.isFinite(b) || Math.abs(a - b) > tolerance) differences[field] = {calculated: a, broker: b};
    });
    return {status: Object.keys(differences).length ? 'mismatch' : 'matched', tolerance, differences};
  }
  function thirdWednesday(year, month) {
    const first = new Date(Date.UTC(year, month - 1, 1));
    return new Date(Date.UTC(year, month - 1, 1 + ((3 - first.getUTCDay() + 7) % 7) + 14));
  }
  function rollDate(year, month, tradingDays) {
    const days = new Set((tradingDays || []).map(String));
    fail(days.size > 0, 'TAIFEX換倉日曆不可空白');
    const w = thirdWednesday(year, month);
    for (let t = w.getTime() - DAY; t >= w.getTime() - 14 * DAY; t -= DAY) {
      const d = new Date(t).toISOString().slice(0, 10);
      if (days.has(d)) return {contractMonth: `${year}-${String(month).padStart(2, '0')}`, thirdWednesday: w.toISOString().slice(0, 10), rollDate: d, source: 'TAIFEX-trading-calendar'};
    }
    throw new Error('找不到第三個星期三前的TAIFEX有效交易日');
  }
  return Object.freeze({validateDecisionWindow, validateMarginRecord, reconcileBrokerRisk, thirdWednesday, rollDate});
});
