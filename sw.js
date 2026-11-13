const CACHE_VERSION = 'mahasib-v7.0-offline';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icon.svg',
  // المكتبات الخارجية التي يحتاجها التطبيق
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
  'https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js',
  'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js',
  'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then(cache => {
        return cache.addAll(APP_SHELL);
      })
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  
  if (req.method !== 'GET') return;

  event.respondWith(
    caches.match(req).then(cached => {
      if (cached) {
        // تحديث الملف في الخلفية إذا كان هناك إنترنت
        fetch(req).then(res => {
          if (res && res.ok) {
            caches.open(CACHE_VERSION).then(c => c.put(req, res));
          }
        }).catch(() => {});
        return cached;
      }
      
      return fetch(req).then(res => {
        if (res && res.ok) {
          const clone = res.clone();
          caches.open(CACHE_VERSION).then(c => c.put(req, clone));
        }
        return res;
      }).catch(() => {
        // إذا انقطع الإنترنت وفشل التحميل، أعد تحميل ملف التطبيق الأساسي
        if (req.mode === 'navigate') {
          return caches.match('./index.html');
        }
      });
    })
  );
});