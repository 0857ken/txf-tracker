// 期貨部位管理(Firestore 版)
import { collection, addDoc, updateDoc, deleteDoc, doc, getDocs } from 'https://www.gstatic.com/firebasejs/12.14.0/firebase-firestore.js';

const MULT = { TXF: 200, MXF: 50, TMF: 10, '大台': 200, '小台': 50, '微台': 10 };  // 合約乘數(含中文別名)

function posCol() {
  return collection(window.fbDb, 'users', 'me', 'positions');
}

// 讀取所有部位
window.fetchPositions = async function() {
  await window.fbReady;
  const snap = await getDocs(posCol());
  const list = [];
  snap.forEach(d => list.push({ id: d.id, ...d.data() }));
  return list;
};

// 新增部位
window.addPositionFS = async function(data) {
  await window.fbReady;
  await addDoc(posCol(), data);
};

// 更新部位
window.updatePositionFS = async function(id, data) {
  await window.fbReady;
  await updateDoc(doc(window.fbDb, 'users', 'me', 'positions', id), data);
};

// 刪除部位
window.deletePositionFS = async function(id) {
  await window.fbReady;
  await deleteDoc(doc(window.fbDb, 'users', 'me', 'positions', id));
};

// 計算單筆部位損益(台幣)
window.calcPnl = function(pos, currentPrice) {
  const m = MULT[pos.type] || 10;
  return Math.round((currentPrice - pos.entry_price) * m * pos.lots);
};

window.CONTRACT_MULT = MULT;
