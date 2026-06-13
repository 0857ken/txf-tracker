// Firebase 初始化(單人使用,匿名驗證)
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

// 匿名登入,登入完成後標記 ready
window.fbReady = new Promise((resolve) => {
  onAuthStateChanged(auth, (user) => {
    if (user) {
      window.fbUid = user.uid;
      resolve(user.uid);
    }
  });
  signInAnonymously(auth).catch((e) => console.error('匿名登入失敗:', e));
});

// 把 db 和常用函式掛到 window,讓其他 script 用
window.fbDb = db;
