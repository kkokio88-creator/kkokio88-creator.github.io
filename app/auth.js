/*
 * v2 로그인: 구글 계정(Google Identity Services)으로 토큰을 받아 엔진에 넘긴다.
 * - 처음: '구글로 시작하기' 한 번 → 권한 허용 → 내 드라이브에 시트가 자동으로 생기고 오늘 화면이 열린다.
 * - 다시 올 때: 토큰이 살아 있으면 바로. 만료(1시간) 5분 전, 창이 다시 보일 때·포커스를 받을 때 조용히 새로 받는다.
 *   조용한 갱신이 안 될 때만 아래쪽 '구글로 계속하기' 막대를 띄운다. 앱이 열린 뒤에는 전체 화면을 다시 쓰지 않는다.
 * - 토큰은 이 브라우저에만 잠시(만료 시각까지) 둔다. 서버로 보내지 않는다.
 */
(function () {
  var CFG = window.KIT_V2_OVERRIDE || window.KIT_V2 || {};
  // 필요한 만큼만(구글 심사 기준 '가장 좁은 권한'): 앱이 만든 파일 · 캘린더 목록 보기 · 일정 보기 · 내 캘린더 일정 넣고 빼기
  var SCOPES = ['https://www.googleapis.com/auth/drive.file', 'https://www.googleapis.com/auth/calendar.calendarlist.readonly', 'https://www.googleapis.com/auth/calendar.events.readonly', 'https://www.googleapis.com/auth/calendar.events.owned', 'openid', 'email'].join(' ');
  var tok = null, waiters = [], client = null, started = false;
  try { tok = JSON.parse(localStorage.getItem('kitTok') || 'null'); } catch (e) {}
  var valid = function () { return tok && tok.t && tok.exp > Date.now() + 60e3; };
  var store = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  };

  var GRACE = 1500, LOGIN_WAIT = 45e3, FOCUS_WAIT = 10e3, START_WAIT = 30e3;
  var SOON = 5 * 60e3, timer = null, tryAt = 0, failAt = 0, hiddenAt = 0, silent = false, silentTimer = null, loginAt = 0, fetching = false, warmWait = false, closedTimer = null, loginTimer = null, focusTimer = null, loginPending = false, closedWait = false, startSeq = 0;
  function expiring() { return !tok || !tok.t || tok.exp < Date.now() + SOON; }
  function visible() { return document.visibilityState !== 'hidden'; }
  // 조용한 갱신: 이메일을 알고 로그인 스크립트가 로드됐고 창이 보일 때만. 숨은 창에서는 구글이 답을 안 주거나 실패해서 보내지 않는다
  function canSilent() { return !!(tok && tok.email && CFG.clientId && window.google && google.accounts && google.accounts.oauth2 && visible()); }
  function cooling() { return Date.now() - failAt < 120e3 || Date.now() - loginAt < 120e3; }
  // force: 창이 다시 보일 때·포커스·401 처럼 사람이 돌아온 순간. 이전 실패·시도 간격을 무시하고 새로 시도한다
  function refresh(force) {
    if (!expiring() || Date.now() - loginAt < 120e3) return;
    if (!force && (Date.now() - tryAt < 30e3 || Date.now() - failAt < 120e3)) return;
    if (!canSilent()) { if (!valid() && started && visible()) showGate(true); return; }
    if (silent) {
      if (!force || (hiddenAt < tryAt && Date.now() - tryAt < 5e3)) return; // 방금 보낸 요청이 진행 중
      silent = false; clearTimeout(silentTimer); // 숨은 사이 보낸 요청은 버리고 새로 보낸다
    }
    tryAt = Date.now(); silent = true;
    // 팝업이 막히면 구글이 아무 응답도 안 줄 수 있다 → 15초 안에 답이 없으면 실패로 보고 막대로 넘긴다 (숨은 시간이 끼었으면 실패로 보지 않는다)
    clearTimeout(silentTimer); silentTimer = setTimeout(function () { if (!silent) return; if (hiddenAt >= tryAt) { silent = false; return; } silentFail(); }, 15e3);
    try { getClient().requestAccessToken({ prompt: '', login_hint: tok.email }); } catch (e) { silentFail(); }
  }
  function silentFail() {
    clearTimeout(silentTimer); silent = false;
    if (!visible()) return; // 숨은 동안의 실패는 확정하지 않는다: 다시 보일 때 새로 시도
    failAt = Date.now();
    if (valid()) { // 아직 토큰이 살아 있으면 막대를 띄우지 않고, 만료되는 때 확인한다
      showGate(false); clearTimeout(timer);
      timer = setTimeout(function () { if (!visible()) return; if (!valid()) showGate(true); else schedule(); }, Math.max(1000, tok.exp - 60e3 - Date.now() + 1000));
      return;
    }
    // 만료된 토큰은 정리하되 이메일·프로필은 남긴다(다음에 열 때 처음 화면이 아니라 저장본 + '계속하기' 막대)
    if (tok) { tok = { email: tok.email, name: tok.name, picture: tok.picture, pf: tok.pf }; store.set('kitTok', JSON.stringify(tok)); }
    showGate(true);
  }
  function schedule() {
    clearTimeout(timer);
    if (!tok || !tok.t) return;
    timer = setTimeout(refresh, Math.max(0, tok.exp - SOON - Date.now()));
  }
  // 토큰이 필요할 때: 만료면 막대부터 띄우지 않고 먼저 조용히 갱신하고, 실패했을 때만 막대
  function token(force) {
    if (valid()) return Promise.resolve(tok.t);
    var p = new Promise(function (res) { waiters.push(res); });
    if (silent) return p;
    if (started && canSilent() && Date.now() - failAt >= 120e3 && Date.now() - loginAt >= 120e3) refresh(force === true);
    else if (visible()) showGate(true);
    return p;
  }
  function gotToken(r) {
    var wasSilent = silent; silent = false; loginAt = 0; clearTimeout(silentTimer); clearLogin();
    if (wasSilent && (!r || r.error || !r.access_token)) return silentFail();
    if (!r || r.error || !r.access_token) { gateMsg(r && r.error === 'access_denied' ? '권한을 허용해야 내 시트를 만들 수 있어요. 다시 눌러 주세요 (E-DENIED)' : '로그인하지 못했어요. 다시 눌러 주세요 (E-TOKEN)'); return; }
    var granted = String(r.scope || SCOPES);
    if (granted.indexOf('drive.file') < 0) { gateMsg('권한 화면에서 위쪽 "모두 선택"을 눌러 주세요. 내 시트를 만들고 캘린더를 보려면 필요해요. 버튼을 다시 눌러 주세요 (E-SCOPE)'); return; }
    var oldMsg = document.getElementById('kgMsg'); if (oldMsg) oldMsg.textContent = ''; // 늦게 온 토큰: 떠 있던 안내·오류를 지운다
    tok = { t: r.access_token, exp: Date.now() + (Number(r.expires_in) || 3600) * 1000, cal: granted.indexOf('calendar') >= 0, email: tok && tok.email };
    store.set('kitTok', JSON.stringify(tok)); failAt = 0;
    schedule();
    var w = waiters; waiters = []; w.forEach(function (f) { f(tok.t); });
    afterLogin();
  }
  function afterLogin() {
    schedule();
    var go = function (email) {
      if (started) { showGate(false); fetchEmail(); return; }
      started = true; document.documentElement.classList.add('kit-signed');
      // 처음 시작(큰 화면)은 시트를 만드는 동안 진행 상황을 보여 준다. 다시 올 때는 저장본 화면을 바로 보인다
      var g = document.getElementById('kitGate'), first = g && !g.hidden && g.className === 'kg-full';
      var seq = ++startSeq, startTimer = null;
      if (first) {
        gateMsg(''); busy(true);
        // 시트를 여는 데 30초가 넘으면 멈춘 것으로 보고 버튼을 다시 누를 수 있게 한다 (늦게라도 끝나면 그대로 이어간다)
        startTimer = setTimeout(function () { if (seq !== startSeq) return; busy(false); started = false; gateMsg('시트를 여는 데 시간이 너무 걸려요. 인터넷을 확인하고 버튼을 다시 눌러 주세요 (E-START-TIMEOUT)'); }, START_WAIT);
      } else if (valid()) showGate(false);
      // 로그인이 만료됐어도 이 기기 저장본으로 먼저 열고(아래 '계속하기' 막대는 그대로), 저장은 로그인한 뒤 이어서 보낸다
      window.KIT_ENGINE.start(email).then(function () { clearTimeout(startTimer); if (seq !== startSeq) return; started = true; busy(false); gateMsg(''); if (valid()) showGate(false); })
        .catch(function (e) { clearTimeout(startTimer); if (seq !== startSeq) return; busy(false); started = false; gateMsg('시작하지 못했어요 (E-START): ' + ((e && e.message) || '')); });
    };
    if (tok.email) return go(tok.email);
    // 이메일(로그아웃 표시·다음 로그인 힌트용)은 시작과 동시에 받는다 — 시작을 기다리게 하지 않는다
    go('');
    fetchEmail();
  }
  // 이메일을 몰랐다면(시트 기록만 있던 경우 등) 로그인 뒤에 받아 저장하고 엔진에도 알린다
  function fetchEmail() {
    if (!tok || (tok.email && tok.pf) || !tok.t || fetching) return;
    fetching = true;
    fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: 'Bearer ' + tok.t } }).then(function (r) { return r.json(); })
      .then(function (u) { fetching = false; if (!tok || !u || !u.email) return; var had = tok.email; tok.email = u.email; tok.name = u.name || ''; tok.picture = u.picture || ''; tok.pf = 1; store.set('kitTok', JSON.stringify(tok)); if (!had) { try { window.KIT_ENGINE.setEmail(u.email); } catch (e) {} } try { window.dispatchEvent(new Event('kit:profile')); } catch (e) {} })
      .catch(function () { fetching = false; });
  }
  function clearLogin() { clearTimeout(closedTimer); clearTimeout(loginTimer); clearTimeout(focusTimer); loginPending = false; closedWait = false; }
  function loginFail(code, text) { clearLogin(); loginAt = 0; gateMsg(text + ' (' + code + ')'); }
  // popup_closed 뒤: 창이 보이는 상태에서 잠깐 토큰을 더 기다리고, 끝내 안 오면 안내한다
  function armGrace() {
    clearTimeout(closedTimer);
    if (!visible()) return; // 숨은 동안은 기다리지 않고, 다시 보일 때 시작한다
    closedTimer = setTimeout(function () { if (loginPending && closedWait) loginFail('E-POPUP', '로그인 응답이 없어요. 다시 눌러 주세요'); }, GRACE);
  }
  function backFromPopup() {
    if (!loginPending || silent) return;
    if (closedWait) return armGrace();
    clearTimeout(focusTimer); // 로그인 창에서 돌아왔는데 토큰도 오류도 안 오면
    focusTimer = setTimeout(function () { if (loginPending && !closedWait) loginFail('E-TIMEOUT', '응답이 없어요. 다시 눌러 주세요'); }, FOCUS_WAIT);
  }
  function login() {
    if (!window.google || !google.accounts || !google.accounts.oauth2) { gateMsg('구글 로그인을 불러오는 중이에요. 잠시 뒤 다시 눌러 주세요 (E-LOAD)'); return; }
    if (!CFG.clientId) { gateMsg('아직 준비 중이에요. 곧 열어요! (E-CONFIG)'); return; }
    silent = false; clearTimeout(silentTimer); clearLogin(); loginAt = Date.now(); loginPending = true; // 사람이 누른 로그인: 이 동안 조용한 요청은 보내지 않는다
    gateMsg('구글 로그인 창을 열었어요 (L-OPEN)', true);
    loginTimer = setTimeout(function () { if (loginPending) loginFail('E-TIMEOUT', '응답이 없어요. 다시 눌러 주세요'); }, LOGIN_WAIT);
    try { getClient().requestAccessToken({ prompt: tok ? '' : 'consent', login_hint: tok && tok.email ? tok.email : undefined }); }
    catch (e) { loginFail('E-GIS', '로그인 창을 열지 못했어요. 다시 눌러 주세요'); }
  }
  function getClient() {
    if (!client) client = google.accounts.oauth2.initTokenClient({ client_id: CFG.clientId, scope: SCOPES, include_granted_scopes: true, callback: gotToken, error_callback: function (e) {
      if (silent) return silentFail();
      // 동의 화면에서 '계속'을 누르면 팝업이 닫히면서 popup_closed가 토큰보다 먼저 올 수 있다 → 창이 다시 보인 뒤 잠시 토큰을 기다렸다가, 끝내 안 오면 안내한다
      if (e && e.type === 'popup_closed') { loginPending = true; closedWait = true; gateMsg('로그인 응답을 기다리는 중 (L-WAIT)', true); armGrace(); return; }
      if (e && e.type === 'popup_failed_to_open') return loginFail('E-BLOCKED', '로그인 창이 막혔어요. 팝업을 허용하고 다시 눌러 주세요');
      loginFail('E-GIS', '로그인하지 못했어요. 다시 눌러 주세요');
    } });
    return client;
  }
  function logout() {
    clearTimeout(timer); clearTimeout(silentTimer); clearLogin();
    try { if (tok && google.accounts.oauth2.revoke) google.accounts.oauth2.revoke(tok.t, function () {}); } catch (e) {}
    started = false; // 창을 닫을 때 저장본을 다시 쓰지 않게
    tok = null; ['kitTok', 'kitSheetId'].forEach(function (k) { try { localStorage.removeItem(k); } catch (e) {} });
    try { Object.keys(localStorage).filter(function (k) { return /^kitView|^kit(Book|Cal|Tabs):/.test(k); }).forEach(function (k) { localStorage.removeItem(k); }); } catch (e) {}
    location.reload();
  }

  // ── 첫 화면 / 계속하기 막대 ──
  function gate() {
    var g = document.getElementById('kitGate');
    // 앱이 이미 열렸고 시작 진행 화면이 끝났으면 전체 화면은 버리고 막대로 다시 만든다
    if (g && g.className === 'kg-full' && started && g.hidden) { g.remove(); g = null; }
    if (g) return g;
    g = document.createElement('div'); g.id = 'kitGate';
    var first = !started && !(tok && tok.email) && !store.get('kitSheetId');
    g.className = first ? 'kg-full' : 'kg-bar';
    var gbtn = '<button class="kg-btn" id="kgBtn" type="button"><svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.2l7.9 6.2C12.5 13.6 17.8 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4 7.1-10 7.1-17.5z"/><path fill="#FBBC05" d="M10.6 28.6c-.5-1.4-.8-2.9-.8-4.6s.3-3.2.8-4.6l-7.9-6.2C1 16.6 0 20.2 0 24s1 7.4 2.7 10.8l7.9-6.2z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.8 2.3-8.4 2.3-6.2 0-11.5-4.1-13.4-9.9l-7.9 6.2C6.6 42.6 14.6 48 24 48z"/></svg><span>' + (first ? '구글로 시작하기' : '구글로 계속하기') + '</span></button>';
    g.innerHTML = first
      ? '<div class="kg-in"><div class="kg-logo"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg></div>' +
        '<h1>GTD 워크</h1><p class="kg-sub">떠오르면 담고, 하루 한 번 정리하고,<br>오늘 할 일만 봐요.</p>' + gbtn + '<p class="kg-msg" id="kgMsg" role="alert"></p><p class="kg-prog" id="kgProg" hidden><i></i><span id="kgProgT" role="status"></span><br><small>처음 한 번만 걸려요</small></p>' +
        '<ol class="kg-how"><li>구글 계정을 고르세요</li><li><b>"확인하지 않은 앱"</b>이 뜨면 <b>고급 ▸ 이동</b> <small>(심사 중이라 나오는 안내예요)</small></li><li>권한 화면에서 <b>모두 선택</b> ▸ 계속</li></ol>' +
        '<ul class="kg-pts"><li>내 구글 드라이브에 <b>내 시트를 하나 만들어</b> 거기에만 저장해요</li><li>운영자를 포함해 <b>누구도 내 할 일을 볼 수 없어요</b></li><li>구글 캘린더 일정과 함께 보고, 할 일을 끌어다 넣어요</li></ul>' +
        '<p class="kg-fine">시작하면 <a href="../privacy.html" target="_blank">개인정보 처리방침</a>에 동의하는 것으로 봐요. 이 앱은 자기가 만든 파일만 볼 수 있어요.</p></div>'
      : '<span>로그인이 만료됐어요</span>' + gbtn + '<span class="kg-msg" id="kgMsg" role="alert"></span>';
    document.body.appendChild(g);
    document.getElementById('kgBtn').onclick = login;
    return g;
  }
  function busy(on) {
    var b = document.getElementById('kgBtn'); if (b) { b.disabled = on; b.style.opacity = on ? '.55' : ''; }
    var p = document.getElementById('kgProg'); if (p) p.hidden = !on;
    if (on) progress('구글 계정을 확인했어요');
  }
  function progress(m) { var el = document.getElementById('kgProgT'); if (el) el.textContent = m + '…'; }
  function showGate(on) { if (on) { gate().hidden = false; } else { var g = document.getElementById('kitGate'); if (g) g.hidden = true; } }
  // 안내·오류는 구글 버튼 바로 아래에 보인다. info=true면 진행 안내(회색), 아니면 오류(빨강)
  function gateMsg(m, info) { var g = gate(); if (m) g.hidden = false; var el = document.getElementById('kgMsg'); if (!el) return; el.textContent = m || ''; el.className = 'kg-msg' + (info ? ' kg-info' : ''); }

  // 엔진 만들기 (App.html 의 call()이 KIT_ENGINE 을 쓴다)
  window.KIT_ENGINE = createKitEngine({
    token: token, storage: store, onProgress: progress,
    // 만료돼도 이메일은 남겨 둔다: 다음에 열 때 처음 화면이 아니라 저장본 + '계속하기' 막대로
    onUnauthorized: function (bad) {
      if (tok && tok.t && bad && tok.t !== bad && valid()) return Promise.resolve(tok.t); // 다른 호출이 이미 새 토큰을 받았다
      if (tok) tok.exp = 0; // 메모리에서만 만료로 표시한다. 저장본은 조용한 갱신이 실패했을 때만 정리한다
      return token(true);
    },
    onSaveError: function () { saveNote(true); }, onSaved: function () { saveNote(false); },
    // 뒤에서 새로 받은 시트·캘린더가 화면과 다르면 화면(App.html)이 다시 그린다
    onChange: function () { try { window.dispatchEvent(new Event('kit:changed')); } catch (e) {} },
    onConflict: function (c) { try { window.dispatchEvent(new CustomEvent('kit:conflict', { detail: c })); } catch (e) {} }
  });
  // 저장은 뒤에서 한다 → 실패하면 화면 위에 알리고 다시 시도 버튼을 준다
  function saveNote(on) {
    var n = document.getElementById('kitSave');
    if (!on) { if (n) n.remove(); return; }
    if (n) return;
    n = document.createElement('div'); n.id = 'kitSave'; n.setAttribute('role', 'alert');
    n.style.cssText = 'position:fixed;left:12px;right:12px;top:calc(10px + env(safe-area-inset-top));z-index:150;display:flex;align-items:center;gap:10px;padding:10px 14px;border-radius:14px;background:#FFF0F1;color:#C42B3A;font-size:14px;font-weight:600;box-shadow:0 8px 24px rgba(0,0,0,.12)';
    n.innerHTML = '<span style="flex:1">구글 시트에 저장하지 못했어요. 인터넷 연결을 확인해 주세요.</span><button type="button" style="min-height:40px;padding:0 14px;border-radius:10px;border:0;background:#F04452;color:#fff;font:inherit;font-weight:700;cursor:pointer">다시 시도</button>';
    n.querySelector('button').onclick = function () { n.querySelector('button').disabled = true; window.KIT_ENGINE.retrySave().then(function () { var b = n.querySelector('button'); if (b) b.disabled = false; }); };
    document.body.appendChild(n);
  }
  // 앱으로 돌아오면 오래된 시트·캘린더를 미리 새로 받아 둔다 (다음 누름이 기다리지 않게)
  // 다른 앱으로 가거나 창을 닫을 때는 이 기기 저장본을 바로 써 둔다(못 보낸 변경은 다음에 열 때 이어서 보냄)
  document.addEventListener('visibilitychange', function () { if (visible()) backFromPopup(); if (!started) return; if (document.visibilityState === 'visible') { refresh(true); warmWhenReady(); } else { hiddenAt = Date.now(); window.KIT_ENGINE.persist(); } });
  function warmWhenReady() {
    if (valid()) return window.KIT_ENGINE.warm();
    if (warmWait) return; warmWait = true; // 새 토큰을 받은 뒤에 미리 받아 둔다
    waiters.push(function () { warmWait = false; window.KIT_ENGINE.warm(); });
  }
  window.addEventListener('focus', function () { backFromPopup(); if (started) refresh(true); });
  window.addEventListener('pagehide', function () { if (started) window.KIT_ENGINE.persist(); });
  window.addEventListener('beforeunload', function (e) { if (started) window.KIT_ENGINE.persist(); if (started && window.KIT_ENGINE.saveFailed()) { e.preventDefault(); e.returnValue = ''; } });
  window.KIT_AUTH = { login: login, logout: logout, email: function () { return (tok && tok.email) || ''; }, profile: function () { return tok ? { email: tok.email || '', name: tok.name || '', picture: tok.picture || '' } : {}; }, getToken: function () { return token(); } };

  // GIS 스크립트
  var s = document.createElement('script'); s.src = 'https://accounts.google.com/gsi/client'; s.async = true; s.defer = true; s.onload = function () { if (tok && tok.email) { if (expiring()) refresh(); else schedule(); } }; document.head.appendChild(s);
  document.addEventListener('DOMContentLoaded', function () {
    if (valid()) return afterLogin();
    showGate(true);
    // 전에 이 기기에서 쓴 적이 있으면 로그인을 기다리지 않고 저장본으로 바로 연다
    var sid = store.get('kitSheetId');
    if ((tok && tok.email || sid) && sid && store.get('kitBook:' + sid)) { if (!tok) tok = {}; afterLogin(); }
  });
})();
