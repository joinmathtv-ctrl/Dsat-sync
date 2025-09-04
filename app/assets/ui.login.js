<script type="module">
import { emailPasswordLogin, logout } from "./firebase.client.js";

function qs(s,root=document){ return root.querySelector(s); }

export function mountLoginUI(){
  const loginBtn = qs('[data-action="login"]');
  const logoutBtn = qs('[data-action="logout"]');
  const userEmail = qs('[data-user-email]');
  const modal = qs('#loginModal');
  const form = qs('#loginForm');
  const close = qs('#loginClose');

  function open(){ modal?.classList.add('open'); }
  function closeModal(){ modal?.classList.remove('open'); }

  loginBtn?.addEventListener('click', open);
  close?.addEventListener('click', closeModal);

  form?.addEventListener('submit', async(e)=>{
    e.preventDefault();
    const email = qs('#loginEmail').value.trim();
    const pw    = qs('#loginPw').value;
    const btn   = form.querySelector('button[type=submit]');
    btn.disabled = true;
    try{
      await emailPasswordLogin(email,pw);
      closeModal();
    }catch(err){
      alert('Login failed: '+(err?.message||err));
    }finally{
      btn.disabled = false;
    }
  });

  logoutBtn?.addEventListener('click', async()=>{ await logout(); });

  window.addEventListener("session:changed", ({detail})=>{
    const loggedIn = !!detail.user;
    qs('[data-when="loggedout"]')?.classList.toggle('hidden', !!loggedIn);
    qs('[data-when="loggedin"]')?.classList.toggle('hidden', !loggedIn);
    if(userEmail) userEmail.textContent = detail.user?.email || '';
    qs('[data-badge="paid"]')?.classList.toggle('hidden', !detail.claims.PAID_SETS);
    qs('[data-badge="internal"]')?.classList.toggle('hidden', !detail.claims.INTERNAL_SETS);
  });
}
</script>
