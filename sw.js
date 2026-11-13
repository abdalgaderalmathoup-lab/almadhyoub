const CACHE_NAME = 'mahasib-cache-v8'; // تم تغيير الإصدار لإجبار التحديث
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon.svg',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
  'https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js',
  'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js',
  'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js'
];

// تثبيت الكاش وحفظ الملفات
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(ASSETS);
    }).then(() => self.skipWaiting())
  );
});

// تنظيف الكاش القديم
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.map(key => { if (key !== CACHE_NAME) return caches.delete(key); })
    )).then(() => self.clients.claim())
  );
});

// جلب الملفات
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  
  // إذا كان الطلب لفتح التطبيق (صفحة HTML)، جرب الإنترنت أولاً ثم الكاش
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request).catch(() => {
        return caches.match('./index.html');
      })
    );
    return;
  }

  // لبقية الملفات (مكتبات، أيقونات)، استخدم الكاش أولاً
  e.respondWith(
    caches.match(e.request).then(cached => {
      return cached || fetch(e.request).then(res => {
         if(res && res.status === 200) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
         }
         return res;
      }).catch(() => {
         // إذا فشل تحميل أي شيء وفقد الاتصال
      });
    })
  );
});