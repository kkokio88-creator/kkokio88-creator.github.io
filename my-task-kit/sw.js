// GTD 워크 — 서비스 워커 (오프라인에서도 화면이 열리게)
// 화면(index.html)은 네트워크 먼저 → 안 되면 저장해 둔 것. 아이콘·글꼴은 저장해 둔 것 먼저.
// 데이터(script.google.com · googleusercontent.com)는 절대 저장하지 않는다.
// VERSION 줄은 tools/build-web.js가 KIT.VERSION으로 바꿔 쓴다.
var VERSION = '1.10.0';
var CACHE = 'my-task-kit-' + VERSION;
var SHELL = ['./', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k.indexOf('my-task-kit-') === 0 && k !== CACHE; })
      .map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

function isApi(url) {
  return /(^|\.)script\.google\.com$/.test(url.hostname) || /(^|\.)googleusercontent\.com$/.test(url.hostname);
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (isApi(url)) return; // 데이터는 브라우저가 바로 주고받는다

  var sameOrigin = url.origin === self.location.origin;
  var isPage = req.mode === 'navigate' || (sameOrigin && /(\/|\/index\.html)$/.test(url.pathname));
  if (isPage) {
    // 네트워크 먼저. 공유하기(?share_text=…)로 열려도 같은 화면으로 저장·복원한다.
    var key = new URL(url.pathname.replace(/index\.html$/, ''), url.origin).href;
    e.respondWith(fetch(req).then(function (res) {
      if (res && res.ok) { var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(key, copy); }); }
      return res;
    }).catch(function () {
      return caches.match(key).then(function (hit) { return hit || caches.match('./'); });
    }));
    return;
  }

  var isAsset = (sameOrigin && /\/icons\//.test(url.pathname)) || /manifest\.webmanifest$/.test(url.pathname) ||
    url.hostname === 'cdn.jsdelivr.net' || url.hostname === 'fonts.gstatic.com' || url.hostname === 'fonts.googleapis.com';
  if (isAsset) {
    e.respondWith(caches.match(req).then(function (hit) {
      return hit || fetch(req).then(function (res) {
        if (res && (res.ok || res.type === 'opaque')) { var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(req, copy); }); }
        return res;
      });
    }));
  }
  // 나머지(latest.json, update/files.json 등)는 그대로 네트워크로
});
