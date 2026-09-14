import './firebase-init.js';
import {doc,getDoc,runTransaction} from 'https://www.gstatic.com/firebasejs/12.14.0/firebase-firestore.js';

function ref() { return doc(window.fbDb,'users','me','followPortfolios','default'); }
window.loadFollowPortfolio = async function() {
  await window.fbReady;
  const snapshot=await getDoc(ref());
  return snapshot.exists()?snapshot.data():null;
};
window.saveFollowPortfolio = async function(value,expectedRevision) {
  await window.fbReady;
  if(new Blob([JSON.stringify(value)]).size>800000) throw new Error('資料量過大，請先匯出備份');
  return runTransaction(window.fbDb,async tx=>{
    const current=await tx.get(ref());
    const revision=current.exists()?(current.data().revision || 0):0;
    if(revision!==expectedRevision) throw new Error('另一個裝置已更新。請先匯出未存內容，再重新載入雲端資料');
    const next={...value,revision:revision+1,updatedAt:new Date().toISOString()};
    tx.set(ref(),next);
    return next;
  });
};
