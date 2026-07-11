// 策略計算引擎:在瀏覽器計算所有技術指標
function sma(arr, period, idx) {
  if (idx === undefined) idx = arr.length - 1;
  if (idx < period - 1) return null;
  let sum = 0;
  for (let i = idx - period + 1; i <= idx; i++) sum += arr[i];
  return sum / period;
}
function ema(arr, period) {
  const k = 2 / (period + 1);
  const out = [];
  let prev;
  arr.forEach((v, i) => {
    if (i === 0) { prev = v; out.push(v); }
    else { prev = v * k + prev * (1 - k); out.push(prev); }
  });
  return out;
}
function mansfieldRS(closes, benchCloses, length = 50, smooth = 5) {
  const rsRatio = closes.map((c, i) => benchCloses[i] ? c / benchCloses[i] : null);
  const mansfield = rsRatio.map((r, i) => {
    const s = sma(rsRatio, length, i);
    return (r && s) ? ((r / s) - 1) * 100 : null;
  });
  const valid = mansfield.map(v => v === null ? 0 : v);
  const smoothed = ema(valid, smooth);
  return { mansfield, smoothed };
}
function tdSequential(closes) {
  let sc = 0, bc = 0;
  const scArr = [], bcArr = [];
  for (let i = 0; i < closes.length; i++) {
    if (i >= 4) {
      sc = closes[i] > closes[i - 4] ? sc + 1 : 0;
      bc = closes[i] < closes[i - 4] ? bc + 1 : 0;
    }
    scArr.push(sc); bcArr.push(bc);
  }
  return { sc, bc, scArr, bcArr };
}
function bollinger(closes, period = 20, mult = 2) {
  const idx = closes.length - 1;
  const mid = sma(closes, period, idx);
  if (mid === null) return null;
  let variance = 0;
  for (let i = idx - period + 1; i <= idx; i++) variance += (closes[i] - mid) ** 2;
  const sd = Math.sqrt(variance / period);
  return { mid, upper: mid + mult * sd, lower: mid - mult * sd };
}
function rsi(closes, period = 14) {
  if (closes.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff; else losses -= diff;
  }
  const avgGain = gains / period, avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}
function extremeBands(highs, lows, closes, mLen = 23, lkbk = 60) {
  const idx = closes.length - 1;
  const m23 = sma(closes, mLen, idx);
  if (m23 === null) return null;
  let maxU = -Infinity, maxL = -Infinity;
  for (let i = idx - lkbk; i < idx; i++) {
    if (i < mLen - 1) continue;
    const m = sma(closes, mLen, i);
    if (m === null) continue;
    maxU = Math.max(maxU, highs[i] - m);
    maxL = Math.max(maxL, m - lows[i]);
  }
  const h10 = Math.max(...highs.slice(idx - 9, idx + 1));
  const l10 = Math.min(...lows.slice(idx - 9, idx + 1));
  return { m23, sellP: m23 + maxU, buyP: m23 - maxL, h10, l10 };
}
function computeAll(data) {
  const rows = data.target;
  const closes = rows.map(r => r.close);
  const highs = rows.map(r => r.high);
  const lows = rows.map(r => r.low);
  const vols = rows.map(r => r.volume);
  const bench = data.benchmark_close;
  const cur = rows[rows.length - 1];
  const ma20 = sma(closes, 20);
  const ma60 = sma(closes, 60);
  const volMa5 = sma(vols, 5);
  const rsData = mansfieldRS(closes, bench);
  const td = tdSequential(closes);
  const boll = bollinger(closes);
  const rsiVal = rsi(closes);
  const bands = extremeBands(highs, lows, closes);
  const curMonth = cur.date.slice(0, 7);
  const monthHigh = Math.max(...rows.filter(r => r.date.slice(0,7) === curMonth).map(r => r.high));
  return {
    date: cur.date, price: cur.close,
    open: cur.open, high: cur.high, low: cur.low, volume: cur.volume,
    ma20, ma60, volMa5,
    rs: rsData.smoothed[rsData.smoothed.length - 1],
    rsPrev: rsData.smoothed[rsData.smoothed.length - 2],
    sc: td.sc, bc: td.bc,
    boll, rsi: rsiVal, bands, monthHigh,
  };
}
window.computeAll = computeAll;
window.fetchStrategyData = async function() {
  const res = await fetch('data/strategy_data.json?t=' + Date.now());
  return await res.json();
};
