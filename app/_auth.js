<!-- app/_auth.js -->
<script>
window.auth = {
  token: localStorage.getItem('jwt') || '',
  role: localStorage.getItem('role') || '',
  ents: JSON.parse(localStorage.getItem('ents') || '[]'),
  setLogin({token, role, entitlements}) {
    this.token = token || '';
    this.role = role || '';
    this.ents = entitlements || [];
    localStorage.setItem('jwt', this.token);
    localStorage.setItem('role', this.role);
    localStorage.setItem('ents', JSON.stringify(this.ents));
  },
  logout(){ this.setLogin({}); location.href='/login.html'; },
  async api(url, opts={}) {
    opts.headers = Object.assign({}, opts.headers || {}, this.token ? {Authorization: 'Bearer ' + this.token} : {});
    const r = await fetch(url, opts);
    if (r.status === 401) { location.href = '/login.html'; return new Response(null,{status:401}); }
    return r;
  },
  has(ent){ return (this.ents||[]).includes(ent); }
};
</script>
