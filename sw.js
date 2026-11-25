// ── PUSH NOTIFICATIONS (Firebase) ───────────────────────────────────
importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyC_OXACPuxzAerOWiQ6O1BZBL0Du8Axdtg',
  authDomain: 'glass-finder-pro.firebaseapp.com',
  projectId: 'glass-finder-pro',
  messagingSenderId: '1082015655381',
  appId: '1:1082015655381:web:cf24bbc2d7442b10a6c95c',
});

// App band ho tab bhi notification dikhana aur click par app kholna Firebase khud sambhalta hai
firebase.messaging();
// ────────────────────────────────────────────────────────────────────

// Version badalte hi purana cache apne aap hat jata hai
const CACHE_NAME = 'universal-combo-v3';
const urlsToCache = ['./', './index.html', './manifest.json'];

self.addEventListener('install', function(event) {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(urlsToCache.map(function(u){ return new Request(u, {cache: 'reload'}); }))
        .catch(function(err) { console.log('Cache add error (non-fatal):', err); });
    })
  );
});

self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(names) {
      return Promise.all(names.map(function(n) {
        if (n !== CACHE_NAME) return caches.delete(n);
      }));
    }).then(function() { return self.clients.claim(); })
  );
});

self.addEventListener('message', function(event) {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

// Network pehle (browser ka purana HTTP cache bypass), net na ho tab hi cache
self.addEventListener('fetch', function(event) {
  var req = event.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  var isPage = req.mode === 'navigate' || /\.html$|\/$/.test(url.pathname);
  var netReq = isPage ? new Request(req, {cache: 'no-store'}) : req;

  event.respondWith(
    fetch(netReq).then(function(res) {
      if (res && res.ok) {
        var copy = res.clone();
        caches.open(CACHE_NAME).then(function(c) { c.put(req, copy); });
      }
      return res;
    }).catch(function() {
      return caches.match(req).then(function(hit) {
        return hit || caches.match('./index.html');
      });
    })
  );
});
