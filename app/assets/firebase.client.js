<script type="module">
// Firebase Web SDK 초기화 (Email/Password)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getAuth, setPersistence, browserLocalPersistence,
  onIdTokenChanged, signInWithEmailAndPassword, signOut, getIdToken, getIdTokenResult
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

/* TODO: 실제 Firebase Web 설정으로 교체 */
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT",
  appId: "YOUR_APP_ID",
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
await setPersistence(auth, browserLocalPersistence);

/* 간단 유틸 */
export async function emailPasswordLogin(email, password){
  const cred = await signInWithEmailAndPassword(auth, email, password);
  return cred.user;
}
export async function logout(){ await signOut(auth); }
export function onToken(cb){ return onIdTokenChanged(auth, cb); }
export async function currentIdToken(force=false){ return auth.currentUser ? await getIdToken(auth.currentUser, force) : null; }
export async function currentTokenResult(force=false){ return auth.currentUser ? await getIdTokenResult(auth.currentUser, force) : null; }
</script>
