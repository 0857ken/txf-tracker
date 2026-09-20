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
  function signalEligibility(now, marketDate) {
    isoDate(marketDate, '行情');
    const localDate = twDate(now);
    if (localDate > marketDate) return {eligible: true, phase: 'post-13:30'};
    if (localDate < marketDate) return {eligible: false, phase: 'pre-market-date', reason: '行情尚未到交易日'};
    const eligible = localMinutes(now) >= 13 * 60 + 30;
    return {eligible, phase: eligible ? 'post-13:30' : 'pre-13:30', reason: eligible ? null : '尚未到台灣13:30'};
  }
  function eodEligibility(now, marketDate) {
    isoDate(marketDate, '行情');
    const localDate = twDate(now);
    if (localDate > marketDate) return {eligible: true, phase: 'post-13:45'};
    if (localDate < marketDate) return {eligible: false, phase: 'pre-market-date', reason: '行情尚未到交易日'};
    const eligible = localMinutes(now) >= 13 * 60 + 45;
    return {eligible, phase: eligible ? 'post-13:45' : 'pre-13:45', reason: eligible ? null : '尚未到台灣13:45'};
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
    const override = record?.brokerOverride;
    if (override !== null && override !== undefined) {
      if (!override || typeof override !== 'object' || !override.source || !override.effectiveDate || !override.fetchedAt ||
        !Number.isFinite(Number(override.initial)) || !Number.isFinite(Number(override.maintenance))) reasons.push('invalid-brokerOverride');
      else {
        if (override.effectiveDate > new Date(asOfMs + 8 * 3600000).toISOString().slice(0, 10)) reasons.push('brokerOverride-effective-in-future');
        if (asOfMs && Date.parse(override.fetchedAt) > asOfMs) reasons.push('brokerOverride-fetched-in-future');
        if (asOfMs && Number.isFinite(Date.parse(override.fetchedAt)) && (asOfMs - Date.parse(override.fetchedAt)) / DAY > maxAgeDays) reasons.push('brokerOverride-stale-age');
      }
    }
    const rejected = reasons.some(x => x.includes('future'));
    return {...record, source: source || null, ageDays, maxAgeDays, rejected,
      freshness: reasons.length ? 'stale' : 'fresh', fresh: reasons.length === 0, reasons};
  }
  function reconcileBrokerRisk({calculated, broker, asOf, tolerance = 0.01, maxAgeHours = 24}) {
    const fields = ['initialMargin', 'maintenanceMargin', 'ratio'];
    const differences = {};
    const brokerReportedAt = broker?.reportedAt || null;
    const brokerAgeHours = asOf && brokerReportedAt ? (parsed(asOf, '核對') - parsed(brokerReportedAt, '券商風險率')) / 3600000 : null;
    const current = Number.isFinite(brokerAgeHours) && brokerAgeHours >= 0 && brokerAgeHours <= maxAgeHours;
    if (!broker || !Number.isFinite(Number(broker.ratio)) || !brokerReportedAt || !current)
      return {modelRatio: calculated?.ratio ?? null, brokerReportedRatio: Number.isFinite(Number(broker?.ratio)) ? Number(broker.ratio) : null,
        brokerReportedAt, difference: null, reconciliationStatus: 'unavailable', brokerAgeHours,
        tolerance, maxAgeHours, differences: {broker: 'missing-or-not-current'}};
    fields.forEach(field => {
      const a = Number(calculated?.[field]), b = Number(broker?.[field]);
      if (!Number.isFinite(a) || !Number.isFinite(b) || Math.abs(a - b) > tolerance) differences[field] = {calculated: a, broker: b};
    });
    return {modelRatio: calculated?.ratio ?? null, brokerReportedRatio: Number(broker.ratio), brokerReportedAt,
      difference: Number(broker.ratio) - Number(calculated?.ratio), reconciliationStatus: Object.keys(differences).length ? 'mismatch' : 'matched',
      status: Object.keys(differences).length ? 'mismatch' : 'matched', brokerAgeHours, tolerance, maxAgeHours, differences};
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
  return Object.freeze({validateDecisionWindow, signalEligibility, eodEligibility, validateMarginRecord, reconcileBrokerRisk, thirdWednesday, rollDate});
});
