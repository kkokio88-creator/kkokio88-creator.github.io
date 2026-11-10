/* 자동 생성 파일 — tools/build-web2.js (원본: web2/sw-src.js) */
// GTD 워크 v2 — 서비스 워커: 앱 화면을 이 기기에 저장해 두고 바로 연다
// - 엔진·로그인 코드(주소에 버전)는 저장해 둔 것을 바로 쓰고, 화면(index)은 새 버전을 먼저 받는다(느리거나 오프라인이면 저장본).
// - 새 버전이 올라가면 이 파일의 버전이 바뀌어 새 화면을 미리 받아 두고 옛 저장본을 지운다.
// - 글꼴(jsDelivr, 버전 고정)은 저장해 둔 것 먼저. 구글 로그인·구글 API(시트·캘린더)는 절대 저장하지 않는다.
// tools/build-web2.js 가 버전과 미리 받을 파일 목록을 채워 web2/sw.js 를 만든다. 이 파일(sw-src.js)을 고칠 것.
var V = "1.11.0-332ed267d2";
var CACHE = 'kit-app-' + V, FONT = 'kit-font-1';
var SHELL = ["./","engine.js?v=332ed267d2","auth.js?v=332ed267d2","manifest.webmanifest","icons/icon-192.png","icons/apple-touch-icon.png"];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k.indexOf('kit-app-') === 0 && k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  var req = e.request; if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin === self.location.origin) {
    var isPage = req.mode === 'navigate' || /\/(index\.html)?$/.test(url.pathname);
    if (isPage) {
      // 화면(index)은 새 버전 먼저: 온라인이면 새로 받아 쓰고(새로고침 한 번이면 최신), 1.5초 안에 못 받거나 오프라인이면 저장본.
      // 예전엔 저장본을 먼저 보여 주고 뒤에서 받아 '다음 번'에 썼더니, 배포 뒤 새로고침해도 옛 화면이 남았다(휴대폰 제보).
      var key = new URL('./', self.location).href;
      e.respondWith(caches.open(CACHE).then(function (c) {
        var net = fetch(req, { cache: 'no-store' }).then(function (res) { if (res && res.ok) c.put(key, res.clone()); return res; });
        var slow = new Promise(function (res) { setTimeout(res, 1500); }).then(function () { return c.match(key); });
        return Promise.race([net.catch(function () { return c.match(key); }), slow.then(function (hit) { return hit || net; })])
          .then(function (r) { if (!r) return net; e.waitUntil(net.catch(function () {})); return r; });
      }));
      return;
    }
    // 엔진·로그인 코드·아이콘: 주소에 버전이 붙어 있어 저장본 그대로 써도 안전
    e.respondWith(caches.match(req).then(function (hit) {
      return hit || fetch(req).then(function (res) { if (res && res.ok) { var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(req, copy); }); } return res; });
    }));
    return;
  }
  if (url.hostname === 'cdn.jsdelivr.net' && /pretendard@v[\d.]+/.test(url.pathname)) {
    e.respondWith(caches.open(FONT).then(function (c) {
      return c.match(req).then(function (hit) { return hit || fetch(req).then(function (res) { if (res && (res.ok || res.type === 'opaque')) c.put(req, res.clone()); return res; }); });
    }));
  }
  // 그 밖(구글 로그인·구글 API 등)은 건드리지 않는다
});
