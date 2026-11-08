/*
 * v2 로그인: 구글 계정(Google Identity Services)으로 토큰을 받아 엔진에 넘긴다.
 * - 처음: '구글로 시작하기' 한 번 → 권한 허용 → 내 드라이브에 시트가 자동으로 생기고 오늘 화면이 열린다.
 * - 다시 올 때: 토큰이 살아 있으면 바로, 만료됐으면(1시간) 아래쪽 '구글로 계속하기' 한 번.
 * - 토큰은 이 브라우저에만 잠시(만료 시각까지) 둔다. 서버로 보내지 않는다.
 */
(function () {
  var CFG = window.KIT_V2_OVERRIDE || window.KIT_V2 || {};
  var SCOPES = ['https://www.googleapis.com/auth/drive.file', 'https://www.googleapis.com/auth/calendar.readonly', 'https://www.googleapis.com/auth/calendar.events', 'openid', 'email'].join(' ');
  var tok = null, waiters = [], client = null, started = false;
  try { tok = JSON.parse(localStorage.getItem('kitTok') || 'null'); } catch (e) {}
  var valid = function () { return tok && tok.t && tok.exp > Date.now() + 60e3; };
  var store = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  };

  function token() {
    if (valid()) return Promise.resolve(tok.t);
    showGate(true);
    return new Promise(function (res) { waiters.push(res); });
  }
  function gotToken(r) {
    if (!r || r.error || !r.access_token) { gateMsg(r && r.error === 'access_denied' ? '권한을 허용해야 내 시트를 만들 수 있어요.' : '로그인하지 못했어요. 다시 눌러 주세요.'); return; }
    var granted = String(r.scope || SCOPES);
    if (granted.indexOf('drive.file') < 0) { gateMsg('"이 앱이 만든 파일 보기" 권한을 체크해 주세요. 내 시트를 만들 때 필요해요.'); return; }
    tok = { t: r.access_token, exp: Date.now() + (Number(r.expires_in) || 3600) * 1000, cal: granted.indexOf('calendar') >= 0, email: tok && tok.email };
    store.set('kitTok', JSON.stringify(tok));
    var w = waiters; waiters = []; w.forEach(function (f) { f(tok.t); });
    afterLogin();
  }
  function afterLogin() {
    var go = function (email) {
      showGate(false);
      if (!started) { started = true; document.documentElement.classList.add('kit-signed'); window.KIT_ENGINE.start(email).catch(function (e) { gateMsg('시작하지 못했어요: ' + e.message); showGate(true); started = false; }); }
    };
    if (tok.email) return go(tok.email);
    fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: 'Bearer ' + tok.t } }).then(function (r) { return r.json(); })
      .then(function (u) { tok.email = u.email || ''; store.set('kitTok', JSON.stringify(tok)); go(tok.email); })
      .catch(function () { go(''); });
  }
  function login() {
    if (!window.google || !google.accounts || !google.accounts.oauth2) { gateMsg('구글 로그인을 불러오는 중이에요. 잠시 뒤 다시 눌러 주세요.'); return; }
    if (!CFG.clientId) { gateMsg('아직 준비 중이에요. 곧 열어요!'); return; }
    if (!client) client = google.accounts.oauth2.initTokenClient({ client_id: CFG.clientId, scope: SCOPES, include_granted_scopes: true, callback: gotToken, error_callback: function (e) { gateMsg(e && e.type === 'popup_closed' ? '로그인 창이 닫혔어요. 다시 눌러 주세요.' : '로그인하지 못했어요.'); } });
    client.requestAccessToken({ prompt: tok ? '' : 'consent', login_hint: tok && tok.email ? tok.email : undefined });
  }
  function logout() {
    try { if (tok && google.accounts.oauth2.revoke) google.accounts.oauth2.revoke(tok.t, function () {}); } catch (e) {}
    tok = null; ['kitTok', 'kitSheetId'].forEach(function (k) { try { localStorage.removeItem(k); } catch (e) {} });
    try { Object.keys(localStorage).filter(function (k) { return /^kitView/.test(k); }).forEach(function (k) { localStorage.removeItem(k); }); } catch (e) {}
    location.reload();
  }

  // ── 첫 화면 / 계속하기 막대 ──
  function gate() {
    var g = document.getElementById('kitGate'); if (g) return g;
    g = document.createElement('div'); g.id = 'kitGate';
    var first = !tok;
    g.className = first ? 'kg-full' : 'kg-bar';
    var gbtn = '<button class="kg-btn" id="kgBtn" type="button"><svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.2l7.9 6.2C12.5 13.6 17.8 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4 7.1-10 7.1-17.5z"/><path fill="#FBBC05" d="M10.6 28.6c-.5-1.4-.8-2.9-.8-4.6s.3-3.2.8-4.6l-7.9-6.2C1 16.6 0 20.2 0 24s1 7.4 2.7 10.8l7.9-6.2z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.8 2.3-8.4 2.3-6.2 0-11.5-4.1-13.4-9.9l-7.9 6.2C6.6 42.6 14.6 48 24 48z"/></svg><span>' + (first ? '구글로 시작하기' : '구글로 계속하기') + '</span></button>';
    g.innerHTML = first
      ? '<div class="kg-in"><div class="kg-logo"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg></div>' +
        '<h1>내 업무관리 키트</h1><p class="kg-sub">떠오르면 담고, 하루 한 번 정리하고,<br>오늘 할 일만 봐요.</p>' + gbtn +
        '<ul class="kg-pts"><li>내 구글 드라이브에 <b>내 시트를 하나 만들어</b> 거기에만 저장해요</li><li>운영자를 포함해 <b>누구도 내 할 일을 볼 수 없어요</b></li><li>구글 캘린더 일정과 함께 보고, 할 일을 끌어다 넣어요</li></ul>' +
        '<p class="kg-msg" id="kgMsg" role="alert"></p><p class="kg-fine">시작하면 <a href="../privacy.html" target="_blank">개인정보 처리방침</a>에 동의하는 것으로 봐요. 이 앱은 자기가 만든 파일만 볼 수 있어요.</p></div>'
      : '<span>로그인이 만료됐어요</span>' + gbtn + '<span class="kg-msg" id="kgMsg" role="alert"></span>';
    document.body.appendChild(g);
    document.getElementById('kgBtn').onclick = login;
    return g;
  }
  function showGate(on) { if (on) { gate().hidden = false; } else { var g = document.getElementById('kitGate'); if (g) g.hidden = true; } }
  function gateMsg(m) { gate(); var el = document.getElementById('kgMsg'); if (el) el.textContent = m || ''; }

  // 엔진 만들기 (App.html 의 call()이 KIT_ENGINE 을 쓴다)
  window.KIT_ENGINE = createKitEngine({
    token: token, storage: store,
    onUnauthorized: function () { tok = null; store.set('kitTok', 'null'); return token(); }
  });
  window.KIT_AUTH = { login: login, logout: logout };

  // GIS 스크립트
  var s = document.createElement('script'); s.src = 'https://accounts.google.com/gsi/client'; s.async = true; s.defer = true; document.head.appendChild(s);
  document.addEventListener('DOMContentLoaded', function () { if (valid()) afterLogin(); else showGate(true); });
})();
