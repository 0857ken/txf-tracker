import './firebase-init.js';
import {
  EmailAuthProvider,
  linkWithCredential,
  signInWithEmailAndPassword
} from 'https://www.gstatic.com/firebasejs/12.14.0/firebase-auth.js';

function safe(error) {
  const code = error?.code || '';
  if (code === 'auth/invalid-email') return new Error('電子郵件格式不正確');
  if (code === 'auth/weak-password') return new Error('密碼至少需要 6 個字元');
  if (code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found')
    return new Error('電子郵件或密碼不正確');
  if (code === 'auth/too-many-requests') return new Error('登入嘗試過多，請稍後再試');
  if (code === 'auth/network-request-failed') return new Error('登入網路連線失敗');
  return new Error('正式 Forward 登入失敗');
}

export async function ready() {
  await window.fbReady;
  const user = window.fbAuth?.currentUser || null;
  return user ? {uid: user.uid, email: user.email || null, isAnonymous: user.isAnonymous} : null;
}

export async function loginOrCreate(email, password) {
  await window.fbReady;
  const auth = window.fbAuth, normalized = String(email || '').trim().toLowerCase();
  if (!auth) throw new Error('Firebase Authentication 尚未初始化');
  if (!normalized) throw new Error('請輸入電子郵件');
  if (String(password || '').length < 6) throw new Error('密碼至少需要 6 個字元');

  const current = auth.currentUser;
  if (current && !current.isAnonymous && current.email?.toLowerCase() === normalized) {
    window.fbUid = current.uid;
    return {uid: current.uid, email: current.email, created: false};
  }

  if (current?.isAnonymous) {
    try {
      const credential = EmailAuthProvider.credential(normalized, password);
      const linked = await linkWithCredential(current, credential);
      window.fbUid = linked.user.uid;
      return {uid: linked.user.uid, email: linked.user.email, created: true};
    } catch (error) {
      if (!['auth/email-already-in-use', 'auth/credential-already-in-use'].includes(error?.code)) throw safe(error);
    }
  }

  try {
    const signed = await signInWithEmailAndPassword(auth, normalized, password);
    window.fbUid = signed.user.uid;
    return {uid: signed.user.uid, email: signed.user.email, created: false};
  } catch (error) {
    throw safe(error);
  }
}
