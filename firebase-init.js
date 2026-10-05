// Firebase 初始化：保留既有登入；只有沒有登入狀態時才建立匿名工作階段。
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.14.0/firebase-app.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/12.14.0/firebase-firestore.js';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.14.0/firebase-auth.js';

const firebaseConfig = {
  apiKey: "AIzaSyDfjQ9mCQ1JPrV02I4IGIyoFSPTlNDqPos",
  authDomain: "txf-tracker.firebaseapp.com",
  projectId: "txf-tracker",
  storageBucket: "txf-tracker.firebasestorage.app",
  messagingSenderId: "47892230712",
  appId: "1:47892230712:web:c609390e6a56dd50f4eccd"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
window.fbDb = db;
window.fbAuth = auth;

let fallbackInFlight = false;
window.fbReady = new Promise((resolve, reject) => {
  let settled = false;
  onAuthStateChanged(auth, async (user) => {
    if (user) {
      window.fbUid = user.uid;
      if (!settled) { settled = true; resolve(user.uid); }
      return;
    }
    window.fbUid = null;
    if (fallbackInFlight) return;
    fallbackInFlight = true;
    try {
      await signInAnonymously(auth);
    } catch (error) {
      console.error('Firebase登入失敗');
      if (!settled) { settled = true; reject(error); }
    } finally {
      fallbackInFlight = false;
    }
  });
});
