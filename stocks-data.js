// 股票 + 自訂資產的 Firestore 資料層
import { collection, addDoc, updateDoc, deleteDoc, doc, getDocs } from 'https://www.gstatic.com/firebasejs/12.14.0/firebase-firestore.js';

function stockCol() { return collection(window.fbDb, 'users', 'me', 'stocks'); }
function assetCol() { return collection(window.fbDb, 'users', 'me', 'customAssets'); }

// ---- 股票 ----
window.fetchStocks = async function() {
  await window.fbReady;
  const snap = await getDocs(stockCol());
  const list = [];
  snap.forEach(d => list.push({ id: d.id, ...d.data() }));
  return list;
};
window.addStockFS = async function(data) {
  await window.fbReady;
  await addDoc(stockCol(), data);
};
window.updateStockFS = async function(id, data) {
  await window.fbReady;
  await updateDoc(doc(window.fbDb, 'users', 'me', 'stocks', id), data);
};
window.deleteStockFS = async function(id) {
  await window.fbReady;
  await deleteDoc(doc(window.fbDb, 'users', 'me', 'stocks', id));
};

// ---- 自訂資產 ----
window.fetchCustomAssets = async function() {
  await window.fbReady;
  const snap = await getDocs(assetCol());
  const list = [];
  snap.forEach(d => list.push({ id: d.id, ...d.data() }));
  return list;
};
window.addCustomAssetFS = async function(data) {
  await window.fbReady;
  await addDoc(assetCol(), data);
};
window.updateCustomAssetFS = async function(id, data) {
  await window.fbReady;
  await updateDoc(doc(window.fbDb, 'users', 'me', 'customAssets', id), data);
};
window.deleteCustomAssetFS = async function(id) {
  await window.fbReady;
  await deleteDoc(doc(window.fbDb, 'users', 'me', 'customAssets', id));
};

// ---- 讀股價 JSON ----
window.fetchStockPrices = async function() {
  try {
    const res = await fetch('data/stock_prices.json?t=' + Date.now());
    if (!res.ok) return {};
    const j = await res.json();
    return j.prices || {};
  } catch (e) { return {}; }
};

// ---- 讀台指期報價 JSON ----
window.fetchMarketData = async function() {
  try {
    const res = await fetch('data/market_data.json?t=' + Date.now());
    if (!res.ok) return null;
    return await res.json();
  } catch (e) { return null; }
};

// ---- 已實現損益 ----
function realizedCol() { return collection(window.fbDb, 'users', 'me', 'realizedPnl'); }

window.fetchRealized = async function() {
  await window.fbReady;
  const snap = await getDocs(realizedCol());
  const list = [];
  snap.forEach(d => list.push({ id: d.id, ...d.data() }));
  return list;
};
window.addRealizedFS = async function(data) {
  await window.fbReady;
  await addDoc(realizedCol(), data);
};
window.updateRealizedFS = async function(id, data) {
  await window.fbReady;
  await updateDoc(doc(window.fbDb, 'users', 'me', 'realizedPnl', id), data);
};
window.deleteRealizedFS = async function(id) {
  await window.fbReady;
  await deleteDoc(doc(window.fbDb, 'users', 'me', 'realizedPnl', id));
};
