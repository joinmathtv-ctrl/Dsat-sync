const CACHE = 'dsat-perf-v1';
const CORE = [
  '/', '/index.html', '/assets/style.css',
  '/assets/curves.presets.js', '/src/main.js'
];

self.addEventListener('install', (e)=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(CORE)));
});

self.addEventListener('fetch', (e)=>{
  e.respondWith((async ()=>{
    const cached = await caches.match(e.request);
    if (cached) return cached;
    try {
      const res = await fetch(e.request);
      const c = await caches.open(CACHE);
      c.put(e.request, res.clone());
      return res;
    } catch {
      return cached || Response.error();
    }
  })());
});
