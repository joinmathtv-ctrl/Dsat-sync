<script type="module">
import { onToken, currentIdToken, currentTokenResult } from "./firebase.client.js";

/* API 호출 시 Authorization 헤더 자동 첨부 + 클레임/세션 관리 */
class SessionManager {
  constructor(){
    this.user = null;
    this.token = null;
    this.claims = {};
    this.ready = new Promise(res => this._readyRes = res);

    onToken(async(u) => {
      this.user = u;
      if(u){
        this.token = await currentIdToken(true);
        const tr = await currentTokenResult(true);
        this.claims = tr?.claims || {};
        localStorage.setItem("id_token", this.token);
        localStorage.setItem("user_email", u.email||"");
      }else{
        this.token = null; this.claims = {};
        localStorage.removeItem("id_token");
        localStorage.removeItem("user_email");
      }
      window.dispatchEvent(new CustomEvent("session:changed", {detail:{user:this.user,claims:this.claims}}));
      this._readyRes(true);
    });
  }
  hasPaid(){ return !!this.claims.PAID_SETS; }
  hasInternal(){ return !!this.claims.INTERNAL_SETS; }
  isAdmin(){ return !!this.claims.ADMIN; }

  async refresh(){
    if(!this.user) return;
    this.token = await currentIdToken(true);
    const tr = await currentTokenResult(true);
    this.claims = tr?.claims || {};
    window.dispatchEvent(new CustomEvent("session:changed", {detail:{user:this.user,claims:this.claims}}));
  }

  async fetch(url, opts={}){
    const headers = new Headers(opts.headers||{});
    if(this.token) headers.set("Authorization", `Bearer ${this.token}`);
    return fetch(url, {...opts, headers});
  }
}
export const Session = new SessionManager();
</script>
