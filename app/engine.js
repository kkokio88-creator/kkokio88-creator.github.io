/* 자동 생성 파일 — tools/build-web2.js. 직접 고치지 말 것 */
/*
 * 내 업무관리 키트 v2 엔진 — 서버 없이 브라우저에서 동작
 *
 * - 사용자 본인의 구글 시트를 시트 API로 읽어 '메모리 시트'에 올리고,
 *   v1과 똑같은 업무 규칙 코드(.gs)를 그 위에서 실행한 뒤, 바뀐 줄만 다시 저장한다.
 * - 캘린더는 캘린더 API로 미리 읽어 두고(.gs의 readCalendar_ 대신), 넣기·빼기는 비동기로 처리한다.
 * - 이 파일은 브라우저와 Node(테스트) 양쪽에서 돈다. 구글 로그인(토큰)은 바깥에서 넣어 준다(opts.token).
 * - 빌드: tools/build-web2.js 가 이 파일 + my-task-kit/*.gs 를 묶어 web2/engine.js 를 만든다.
 */
/* global __KIT_GS__ */
function createKitEngine(opts) {

  opts = opts || {};
  var fetchFn = opts.fetch || (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null);
  var getToken = opts.token; // () => Promise<accessToken>
  var store = opts.storage || { get: function () { return null; }, set: function () {} };
  var API = { drive: 'https://www.googleapis.com/drive/v3', upload: 'https://www.googleapis.com/upload/drive/v3', sheets: 'https://sheets.googleapis.com/v4/spreadsheets', cal: 'https://www.googleapis.com/calendar/v3', user: 'https://www.googleapis.com/oauth2/v3/userinfo' };
  var SHEET_NAME = '내 업무관리 키트';

  // ── 구글 API 호출 ──────────────────────────────────────────
  async function gapi(method, url, body, retry) {
    var tok = await getToken();
    var r = await fetchFn(url, { method: method, headers: Object.assign({ Authorization: 'Bearer ' + tok }, body ? { 'Content-Type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined });
    if (r.status === 401 && !retry && opts.onUnauthorized) { await opts.onUnauthorized(); return gapi(method, url, body, true); }
    if (r.status === 204) return {};
    var txt = await r.text(), j = txt ? JSON.parse(txt) : {};
    if (!r.ok) { var e = new Error(friendly(r.status, j)); e.status = r.status; throw e; }
    return j;
  }
  function friendly(status, j) {
    var m = (j && j.error && (j.error.message || j.error.status)) || ('구글 응답 오류 ' + status);
    if (status === 403 && /insufficient|scope|permission/i.test(m)) return '구글 권한이 부족해요. 다시 로그인해 주세요.';
    if (status === 429) return '요청이 많아요. 잠시 뒤 다시 해 주세요.';
    return m;
  }
  var enc = encodeURIComponent;

  // ── 메모리 시트 (my-task-kit/*.gs 가 쓰는 SpreadsheetApp 흉내) ──
  function chain(t) { return new Proxy(t, { get: function (o, k) { if (k in o) return o[k]; if (typeof k === 'symbol') return undefined; return function () { return chain(o); }; } }); }
  function builder() { var b = { f: null }; var p = new Proxy(b, { get: function (t, k) { if (k === 'whenFormulaSatisfied') return function (f) { t.f = f; return p; }; if (k === 'build') return function () { return { getBooleanCondition: function () { return { getCriteriaValues: function () { return [t.f]; } }; } }; }; if (typeof k === 'symbol') return undefined; return function () { return p; }; } }); return p; }

  function makeBook(meta) {
    var book = { id: meta.id, url: 'https://docs.google.com/spreadsheets/d/' + meta.id + '/edit', tz: meta.tz || 'Asia/Seoul', tzChanged: false, sheets: [], removed: [] };
    function makeSheet(name, id, rows, hidden, isNew) {
      var s = { name: name, id: id, data: rows || [], hidden: !!hidden, hiddenChanged: false, isNew: !!isNew, dirty: {}, full: false, prevRows: (rows || []).length, prevCols: 0, rules: [], formulas: {} };
      (rows || []).forEach(function (r) { s.prevCols = Math.max(s.prevCols, r.length); });
      var cell = function (r, c) { return s.data[r - 1] && s.data[r - 1][c - 1] !== undefined && s.data[r - 1][c - 1] !== null ? s.data[r - 1][c - 1] : ''; };
      var setCell = function (r, c, v) { while (s.data.length < r) s.data.push([]); s.data[r - 1][c - 1] = v; s.dirty[r] = 1; editSeq++; };
      var lastRow = function () { for (var i = s.data.length; i > 0; i--) if ((s.data[i - 1] || []).some(function (v) { return v !== '' && v !== undefined && v !== null; })) return i; return 0; };
      var lastCol = function () { var m = 0; s.data.forEach(function (r) { r.forEach(function (v, i) { if (v !== '' && v !== undefined && v !== null) m = Math.max(m, i + 1); }); }); return m; };
      var range = function (r, c, nr, nc) {
        if (typeof r === 'string') { var m = r.match(/^([A-Z]+)(\d+)/); if (!m) return chain({}); c = m[1].split('').reduce(function (a, ch) { return a * 26 + ch.charCodeAt(0) - 64; }, 0); r = +m[2]; }
        nr = nr || 1; nc = nc || 1;
        var self = chain({
          getRow: function () { return r; }, getColumn: function () { return c; }, getLastRow: function () { return r + nr - 1; }, getNumRows: function () { return nr; }, getSheet: function () { return api; },
          getValues: function () { var out = []; for (var i = 0; i < nr; i++) { var row = []; for (var j = 0; j < nc; j++) row.push(cell(r + i, c + j)); out.push(row); } return out; },
          getValue: function () { return cell(r, c); },
          getDisplayValue: function () { return String(cell(r, c)); },
          setValues: function (v) { v.forEach(function (row, i) { row.forEach(function (x, j) { setCell(r + i, c + j, x); }); }); return self; },
          setValue: function (v) { setCell(r, c, v); return self; },
          clearContent: function () { for (var i = 0; i < nr; i++) for (var j = 0; j < nc; j++) setCell(r + i, c + j, ''); return self; },
          setFormula: function (f) { s.formulas[r + ',' + c] = f; setCell(r, c, f); return self; },
          getBackground: function () { return '#ffffff'; }, getFontColor: function () { return '#000000'; }
        });
        return self;
      };
      var api = chain({
        getName: function () { return s.name; }, getSheetId: function () { return s.id; }, getParent: function () { return bookApi; },
        getLastRow: lastRow, getLastColumn: lastCol, getMaxRows: function () { return Math.max(1000, s.data.length); }, getMaxColumns: function () { return Math.max(26, lastCol()); },
        getRange: range, getDataRange: function () { return range(1, 1, Math.max(lastRow(), 1), Math.max(lastCol(), 1)); },
        hideSheet: function () { if (!s.hidden) { s.hidden = true; s.hiddenChanged = true; editSeq++; } return api; },
        deleteRow: function (r) { s.data.splice(r - 1, 1); s.full = true; editSeq++; return api; },
        getConditionalFormatRules: function () { return s.rules.slice(); }, setConditionalFormatRules: function (x) { s.rules = x; },
        clear: function () { s.data = []; s.formulas = {}; s.full = true; editSeq++; return api; }, clearConditionalFormatRules: function () { s.rules = []; },
        _s: s
      });
      s.api = api;
      return api;
    }
    var bookApi = chain({
      getId: function () { return book.id; }, getUrl: function () { return book.url; }, getName: function () { return SHEET_NAME; },
      getSpreadsheetTimeZone: function () { return book.tz; }, setSpreadsheetTimeZone: function (tz) { if (tz !== book.tz) { book.tz = tz; book.tzChanged = true; editSeq++; } },
      getSheetByName: function (n) { var x = book.sheets.filter(function (sh) { return sh.getName() === n; })[0]; return x || null; },
      getSheets: function () { return book.sheets.slice(); },
      insertSheet: function (n, idx) { editSeq++; var sh = makeSheet(n, Math.floor(Math.random() * 2e9) + 1, [], false, true); if (idx === 0) book.sheets.unshift(sh); else book.sheets.push(sh); return sh; },
      deleteSheet: function (sh) { editSeq++; book.sheets = book.sheets.filter(function (x) { return x !== sh; }); if (!sh._s.isNew) book.removed.push(sh._s.id); },
      setActiveSheet: function () {}, toast: function () {}
    });
    book.api = bookApi;
    (meta.sheets || []).forEach(function (m) { book.sheets.push(makeSheet(m.title, m.sheetId, m.rows, m.hidden, !!m.isNew)); });
    return book;
  }

  // 메모리 시트 → 구글 시트: 새 탭·숨김·바뀐 줄만
  function toCell(v) {
    if (v instanceof Date) return ymdLocal(v);
    if (v === undefined || v === null) return '';
    return v;
  }
  function ymdLocal(d) { return utils.formatDate(d, book ? book.tz : 'Asia/Seoul', 'yyyy-MM-dd'); }
  function colName(n) { var s = ''; while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }
  function q(name) { return "'" + String(name).replace(/'/g, "''") + "'"; }
  // 지금 바뀐 내용을 한 번에 떠서(그 순간 바뀜 표시를 비움) 보낸다. 보내는 동안 화면 동작은 계속 메모리 시트를 바꿔도 된다
  // (그 변경은 다음 저장에 실린다). 실패하면 떠 간 표시를 되돌려 다음 저장 때 다시 보낸다.
  var sending = 0;
  async function flush() { sending++; try { return await flush0(); } finally { sending--; } }
  var inflight = []; // 보내는 중인 변경 (저장본에는 '아직 못 보냄'으로 남긴다)
  async function flush0() {
    if (!book) return 0;
    if (!hasChanges()) return 0;
    await getToken(); // 로그인을 기다리는 동안에는 바뀜 표시를 그대로 둔다
    var bk = book, reqs = [], data = [], n = 0, marks = [];
    var st = { tz: bk.tzChanged, removed: bk.removed.slice(), sheets: [] };
    if (bk.tzChanged) reqs.push({ updateSpreadsheetProperties: { properties: { timeZone: bk.tz }, fields: 'timeZone' } });
    bk.sheets.forEach(function (sh, idx) {
      var s = sh._s;
      if (s.isNew) reqs.push({ addSheet: { properties: { sheetId: s.id, title: s.name, index: idx, hidden: s.hidden } } });
      else if (s.hiddenChanged) reqs.push({ updateSheetProperties: { properties: { sheetId: s.id, hidden: s.hidden }, fields: 'hidden' } });
      if (s.isNew || s.hiddenChanged) st.sheets.push({ s: s, isNew: s.isNew, hid: s.hiddenChanged });
      s.isNew = false; s.hiddenChanged = false;
    });
    st.removed.forEach(function (id) { reqs.push({ deleteSheet: { sheetId: id } }); });
    bk.tzChanged = false; bk.removed = [];
    bk.sheets.forEach(function (sh) {
      var s = sh._s, width = 0;
      if (!s.full && !Object.keys(s.dirty).length) return;
      s.data.forEach(function (r) { width = Math.max(width, r.length); });
      width = Math.max(width, s.prevCols, 1);
      var rowVals = function (i) { var r = s.data[i - 1] || [], out = []; for (var j = 0; j < width; j++) out.push(toCell(r[j])); return out; };
      if (s.full) {
        var rows = Math.max(s.data.length, s.prevRows), vals = [];
        for (var i = 1; i <= rows; i++) vals.push(rowVals(i));
        if (vals.length) data.push({ range: q(s.name) + '!A1:' + colName(width) + rows, values: vals });
      } else {
        var ks = Object.keys(s.dirty).map(Number).sort(function (a, b) { return a - b; }), start = null, prev = null, block = [];
        var push = function () { if (start !== null) data.push({ range: q(s.name) + '!A' + start + ':' + colName(width) + prev, values: block }); };
        ks.forEach(function (r) { if (prev !== null && r === prev + 1) { block.push(rowVals(r)); prev = r; } else { push(); start = r; prev = r; block = [rowVals(r)]; } });
        push();
      }
      marks.push({ s: s, full: s.full, dirty: s.dirty, prevRows: s.prevRows, prevCols: s.prevCols });
      s.full = false; s.dirty = {}; s.prevRows = s.data.length; s.prevCols = width;
    });
    inflight = marks;
    try { return await send(); } finally { inflight = []; }
    async function send() {
    if (reqs.length) {
      try { await gapi('POST', API.sheets + '/' + bk.id + ':batchUpdate', { requests: reqs }); n += reqs.length; }
      catch (e) {
        if (st.tz) bk.tzChanged = true;
        bk.removed = st.removed.concat(bk.removed);
        st.sheets.forEach(function (x) { if (x.isNew) x.s.isNew = true; if (x.hid) x.s.hiddenChanged = true; });
        restore(marks); throw e;
      }
    }
    if (data.length) {
      try { await gapi('POST', API.sheets + '/' + bk.id + '/values:batchUpdate', { valueInputOption: 'RAW', data: data }); n += data.length; }
      catch (e) { restore(marks); saveSnap(); throw e; }
    }
    if (n) saveSnap();
    return n;
    }
  }
  function restore(marks) {
    marks.forEach(function (m) {
      var s = m.s; if (m.full) s.full = true;
      Object.keys(m.dirty).forEach(function (r) { s.dirty[r] = 1; });
      s.prevRows = Math.max(s.prevRows, m.prevRows); s.prevCols = Math.max(s.prevCols, m.prevCols);
    });
  }
  function hasChanges() {
    return !!book && (book.tzChanged || book.removed.length > 0 || book.sheets.some(function (sh) { var s = sh._s; return s.isNew || s.hiddenChanged || s.full || Object.keys(s.dirty).length > 0; }));
  }

  // ── 구글 시트 → 메모리 시트 ─────────────────────────────────
  // 탭 이름을 이미 알면(이 기기에서 연 적이 있으면) 탭 목록과 값을 동시에 읽는다: 구글 왕복 2번 → 1번
  async function fetchBook(id) {
    var getVals = function (titles) {
      if (!titles.length) return Promise.resolve({});
      return gapi('GET', API.sheets + '/' + id + '/values:batchGet?' + titles.map(function (t) { return 'ranges=' + enc(q(t)); }).join('&') + '&valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING')
        .then(function (v) { var m = {}; titles.forEach(function (t, i) { m[t] = ((v.valueRanges || [])[i] || {}).values || []; }); return m; });
    };
    var hint = null;
    if (book && book.id === id) hint = book.sheets.map(function (sh) { return sh.getName(); });
    else { try { hint = JSON.parse(store.get('kitTabs:' + id) || 'null'); } catch (e) { hint = null; } }
    var metaP = gapi('GET', API.sheets + '/' + id + '?fields=' + enc('properties(timeZone),sheets(properties(sheetId,title,hidden,index))'));
    var valsP = hint && hint.length ? getVals(hint) : null;
    if (valsP) valsP.catch(function () {}); // 탭 이름이 바뀌었으면 아래에서 다시 읽는다
    var meta = await metaP;
    var sheets = (meta.sheets || []).map(function (x) { return x.properties; }).sort(function (a, b) { return (a.index || 0) - (b.index || 0); });
    var titles = sheets.map(function (s) { return s.title; });
    var vals = null;
    if (valsP && titles.every(function (t) { return hint.indexOf(t) >= 0; })) { try { vals = await valsP; } catch (e) { vals = null; } }
    if (!vals) vals = await getVals(titles);
    store.set('kitTabs:' + id, JSON.stringify(titles));
    return { id: id, tz: meta.properties && meta.properties.timeZone, sheets: sheets.map(function (s) { return { title: s.title, sheetId: s.sheetId, hidden: s.hidden, rows: vals[s.title] || [] }; }) };
  }
  function applyBook(meta, at) { cache = {}; book = makeBook(meta); loadedAt = at || Date.now(); saveSnap(); return book; }
  async function loadBook(id) { var at = Date.now(); return applyBook(await fetchBook(id), at); }

  // ── 이 기기 저장본 (다음에 열 때 구글을 기다리지 않고 바로 시작) ──
  // 시트 내용과 '아직 못 보낸 변경' 표시를 함께 둔다 → 창을 닫았다 열어도 못 보낸 변경은 이어서 보낸다
  var snapT = null;
  function saveSnap() {
    if (!book || snapT) return;
    snapT = setTimeout(function () { snapT = null; writeSnap(); }, opts.snapMs === undefined ? 300 : opts.snapMs);
  }
  function writeSnap() {
    if (snapT) { clearTimeout(snapT); snapT = null; }
    if (!book) return;
    try {
      store.set('kitBook:' + book.id, JSON.stringify({ v: 1, at: loadedAt, tz: book.tz, tzc: book.tzChanged, rm: book.removed, sheets: book.sheets.map(function (sh) {
        var x = sh._s, fl = inflight.filter(function (m) { return m.s === x; })[0], d = Object.keys(x.dirty);
        if (fl) d = d.concat(Object.keys(fl.dirty).filter(function (r) { return d.indexOf(r) < 0; }));
        return { t: x.name, id: x.id, h: x.hidden, hc: x.hiddenChanged, n: x.isNew, f: x.full || !!(fl && fl.full), d: d, pr: x.prevRows, pc: x.prevCols, r: x.data.map(function (row) { return (row || []).map(toCell); }) };
      }) }));
    } catch (e) {}
  }
  function readSnap(id) {
    var o = null; try { o = JSON.parse(store.get('kitBook:' + id) || 'null'); } catch (e) { o = null; }
    if (!o || o.v !== 1 || !o.sheets || !o.sheets.length) return null;
    var b = makeBook({ id: id, tz: o.tz, sheets: o.sheets.map(function (x) { return { title: x.t, sheetId: x.id, hidden: x.h, rows: x.r, isNew: x.n }; }) });
    b.tzChanged = !!o.tzc; b.removed = o.rm || [];
    b.sheets.forEach(function (sh, i) { var x = o.sheets[i], st = sh._s; st.isNew = !!x.n; st.hiddenChanged = !!x.hc; st.full = !!x.f; (x.d || []).forEach(function (r) { st.dirty[r] = 1; }); st.prevRows = x.pr || 0; st.prevCols = x.pc || 0; });
    return { book: b, at: o.at || 0 };
  }

  // ── 시트 찾기·만들기 (drive.file: 이 앱이 만든 파일만 보인다) ──
  function step(msg) { try { if (opts.onProgress) opts.onProgress(msg); } catch (e) {} }
  async function findOrCreateSheet() {
    var saved = store.get('kitSheetId');
    step(saved ? '내 시트를 여는 중이에요' : '내 드라이브에서 시트를 찾는 중이에요');
    if (saved) { try { await loadBook(saved); return { id: saved, created: false }; } catch (e) { if (e.status !== 404 && e.status !== 403) throw e; } }
    var list = await gapi('GET', API.drive + '/files?q=' + enc("appProperties has { key='myTaskKit' and value='1' } and trashed=false") + '&orderBy=createdTime&fields=' + enc('files(id,name)'));
    if (list.files && list.files.length) { var id0 = list.files[0].id; store.set('kitSheetId', id0); await loadBook(id0); return { id: id0, created: false }; }
    step('내 드라이브에 시트를 만드는 중이에요');
    var f = await gapi('POST', API.drive + '/files?fields=id', { name: SHEET_NAME, mimeType: 'application/vnd.google-apps.spreadsheet', appProperties: { myTaskKit: '1' }, description: '내 업무관리 키트가 만든 시트예요. 지우면 앱의 데이터도 사라져요.' });
    store.set('kitSheetId', f.id);
    // 방금 만든 빈 시트는 다시 읽지 않는다: 기본 탭(sheetId 0) 하나뿐이다. 시간대는 setup 이 서울로 맞춘다
    applyBook({ id: f.id, tz: 'Etc/UTC', sheets: [{ title: 'Sheet1', sheetId: 0, hidden: false, rows: [] }] });
    return { id: f.id, created: true };
  }
  /** 다른 시트(예: v1에서 쓰던 시트)를 고르면 그 시트로 연결 (구글 파일 선택 창이 drive.file 권한을 열어 준다) */
  async function useSheet(id) { await loadBook(id); store.set('kitSheetId', id); await setup(false); return true; }

  // ── .gs 실행 환경 ────────────────────────────────────────────
  var startLog = '';
  var book = null, loadedAt = 0, userEmail = '', cache = {}, props = {}, editSeq = 0;
  var calData = {}; // 'start|days|ids' → {ok, items}
  var utils = {
    getUuid: function () { return (globalThis.crypto && crypto.randomUUID) ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) { var r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); }); },
    formatDate: function (d, tz, fmt) {
      var p = {}; new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(d).forEach(function (x) { p[x.type] = x.value; });
      return String(fmt).replace('yyyy', p.year).replace('MM', p.month).replace('dd', p.day).replace('HH', p.hour).replace('mm', p.minute).replace('ss', p.second);
    },
    parseDate: function (str, tz, fmt) {
      var m = String(str).match(/(\d{4})-(\d{2})-(\d{2})(?:\s+(\d{2}):(\d{2}))?/); if (!m) return new Date(NaN);
      var guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0));
      // 그 시간대의 벽시계 시각이 되도록 오프셋 보정
      var off = function (t) { var s = utils.formatDate(new Date(t), tz, 'yyyy-MM-dd HH:mm'); var mm = s.match(/(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})/); return Date.UTC(+mm[1], +mm[2] - 1, +mm[3], +mm[4], +mm[5]) - t; };
      return new Date(guess - off(guess));
    }
  };
  var env = {
    console: console,
    Utilities: utils,
    SpreadsheetApp: { getActiveSpreadsheet: function () { return book ? book.api : null; }, newDataValidation: builder, newConditionalFormatRule: builder, getUi: function () { throw new Error('v2에는 시트 메뉴가 없어요'); }, flush: function () {} },
    CacheService: { getScriptCache: function () { return { get: function (k) { return cache[k] || null; }, put: function (k, v) { cache[k] = String(v); }, remove: function (k) { delete cache[k]; } }; } },
    LockService: { getDocumentLock: function () { return { tryLock: function () { return true; }, waitLock: function () {}, releaseLock: function () {} }; } },
    PropertiesService: { getScriptProperties: function () { return { getProperty: function (k) { return props[k] || null; }, setProperty: function (k, v) { props[k] = String(v); } }; }, getUserProperties: function () { return env.PropertiesService.getScriptProperties(); } },
    Session: { getEffectiveUser: function () { return { getEmail: function () { return userEmail; } }; }, getActiveUser: function () { return { getEmail: function () { return userEmail; } }; } },
    MailApp: { sendEmail: function () { throw new Error('메일 알림은 곧 지원해요. 지금은 캘린더 알림을 써 주세요.'); }, getRemainingDailyQuota: function () { return 0; } },
    ScriptApp: { getProjectTriggers: function () { return []; }, deleteTrigger: function () {}, newTrigger: function () { return chain({}); }, WeekDay: {}, getService: function () { return { getUrl: function () { return ''; } }; }, getScriptId: function () { return ''; } },
    HtmlService: { createHtmlOutput: function () { return chain({}); }, createTemplateFromFile: function () { return chain({}); } },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: function (t) { return { text: t, setMimeType: function () { return this; } }; } },
    CalendarApp: {
      getDefaultCalendar: function () { return calShim('primary'); }, getCalendarById: function (id) { return calShim(id); }, getAllCalendars: function () { return []; }
    }
  };
  function calShim(id) { return { getId: function () { return id; }, getName: function () { return id; }, getColor: function () { return ''; }, getEvents: function () { return []; } }; }

  // .gs 묶음 실행 (빌드 때 __KIT_GS__ 자리에 my-task-kit/*.gs 가 들어간다)
  var K = (function (env) {
    var console = env.console, Utilities = env.Utilities, SpreadsheetApp = env.SpreadsheetApp, CacheService = env.CacheService, LockService = env.LockService,
      PropertiesService = env.PropertiesService, Session = env.Session, MailApp = env.MailApp, ScriptApp = env.ScriptApp, HtmlService = env.HtmlService,
      ContentService = env.ContentService, CalendarApp = env.CalendarApp;
    /* ── 00_Config.gs ── */
/**
 * 내 업무관리 키트 — 설정
 *
 * ┌ 버전 호환 규칙 (새 버전을 만들 때 반드시 지킬 것) ─────────────────────────┐
 * │ 1. 사용자의 구글 시트가 원본이다. 코드는 언제든 통째로 바꿔 끼울 수 있어야 한다. │
 * │ 2. 열은 '머리글 이름'으로 찾는다. 열 순서·위치에 의존하지 않는다.            │
 * │ 3. 열·상태값은 추가만 한다. 지우거나 이름을 바꾸지 않는다.                   │
 * │    이름을 꼭 바꿔야 하면 aliases(열) / STATUS_ALIASES(상태)에 옛 이름을 남긴다. │
 * │ 4. 시트 구조가 바뀌면 SCHEMA_VERSION을 올리고 MIGRATIONS에 변환을 추가한다.   │
 * │ 5. 메뉴·트리거·사이드바가 부르는 함수 이름(공개 함수)은 바꾸지 않는다.        │
 * │    예전 트리거가 그 이름으로 계속 호출한다.                                  │
 * │ 6. 사용자가 직접 추가한 열, 직접 만든 시트, 직접 만든 조건부 서식은 건드리지 않는다. │
 * └──────────────────────────────────────────────────────────────────────────┘
 */

var KIT = {
  NAME: '내 업무관리 키트',
  VERSION: '1.7.1',       // 코드 버전 (화면 표시용)
  SCHEMA_VERSION: 5,      // 시트 구조 버전 (구조가 바뀔 때만 올림) — v2: '반복' 열, v3: '프로젝트' 열·'참고' 상태, v4: '오늘 할 날'·'예상(분)'·'우선순위' 열, v5: '맡긴 날' 열
  TASK_SHEET: '업무',
  DASH_SHEET: '오늘',
  SETTINGS_SHEET: '_설정',
  PROJECT_SHEET: '프로젝트', // 프로젝트 이름 · 완료 모습 (처음 적을 때 생긴다)
  RULE_MARK: 'N("kit")=0', // 키트가 만든 조건부 서식을 구분하는 표식
  WEEKLY_HANDLER: 'sendWeeklyReview',
  WEEKLY_HOUR: 16,
  // true: 웹앱은 개인 키(?k=)가 붙은 링크로만 열린다. '모든 사용자' 접근으로 배포할 때 반드시 true.
  // '나만 접근'으로만 배포한다면 false로 둬도 된다(구글 로그인이 본인 확인).
  WEB_KEY_REQUIRED: true,
  // 모두가 같이 쓰는 웹 화면 주소 (GitHub Pages). 비어 있으면 앱스크립트 웹앱 주소를 그대로 안내한다.
  WEB_PAGE_URL: 'https://kkokio88-creator.github.io/my-task-kit/'
};

var STATUS = {
  INBOX: '수집함',
  NEXT: '다음 행동',
  DELEGATED: '위임',
  SCHEDULED: '일정',
  SOMEDAY: '언젠가',
  DONE: '완료',
  DROPPED: '버림',
  REFERENCE: '참고'   // v3: 할 일은 아니지만 남겨둘 정보
};

var STATUS_LIST = [
  STATUS.INBOX, STATUS.NEXT, STATUS.DELEGATED, STATUS.SCHEDULED,
  STATUS.SOMEDAY, STATUS.DONE, STATUS.DROPPED, STATUS.REFERENCE
];

// 상태 이름을 바꾸게 되면 { '옛 이름': '새 이름' } 으로 남긴다. 마이그레이션이 자동 변환한다.
var STATUS_ALIASES = {};

// 업무 시트의 열 정의. 순서는 '처음 만들 때'의 배치일 뿐, 코드는 머리글 이름으로 찾는다.
// since: 이 열이 생긴 SCHEMA_VERSION / aliases: 예전 머리글 이름
var COLUMNS = [
  { key: 'title',     header: '할일',      width: 320, since: 1, aliases: [] },
  { key: 'status',    header: '상태',      width: 90,  since: 1, aliases: [] },
  { key: 'due',       header: '마감일',    width: 100, since: 1, aliases: [], type: 'date' },
  { key: 'context',   header: '상황',      width: 90,  since: 1, aliases: [],
    note: '어디서·무엇으로 할 수 있는지. 예) @컴퓨터, @전화, @외근' },
  { key: 'delegatee', header: '위임 대상', width: 100, since: 1, aliases: [] },
  { key: 'followUp',  header: '확인일',    width: 100, since: 1, aliases: [], type: 'date',
    note: '위임한 일을 확인할 날. 이 날이 지나면 [오늘] 시트의 "확인할 위임"에 뜹니다.' },
  { key: 'memo',      header: '메모',      width: 240, since: 1, aliases: [] },
  { key: 'created',   header: '등록일',    width: 100, since: 1, aliases: [], type: 'date' },
  { key: 'completed', header: '완료일',    width: 100, since: 1, aliases: [], type: 'date' },
  { key: 'id',        header: 'ID',        width: 120, since: 1, aliases: [],
    note: '자동으로 붙는 번호입니다. 지우거나 고치지 마세요.' },
  { key: 'repeat',    header: '반복',      width: 110, since: 2, aliases: [],
    note: '루틴(반복 업무). 완료하면 다음 회차가 자동으로 생깁니다.\n예) 매일 / 평일 / 매주 월 / 매주 월,수,금 / 매월 25일 / 매월 말일 / 매년 3월 1일 / 7일마다 / 2주마다 / 1개월마다\n(○일마다 = 완료한 날부터 계산)' },
  { key: 'project',   header: '프로젝트',  width: 130, since: 3, aliases: [],
    note: '2단계 이상 걸리는 일의 묶음 이름. 같은 이름을 적으면 한 프로젝트로 묶입니다.\n주간 검토에서 "다음 행동이 없는 프로젝트"를 알려 줍니다.' },
  { key: 'focus',     header: '오늘 할 날', width: 100, since: 4, aliases: [], type: 'date',
    note: '★ 오늘로 올린 날. 이 날짜가 되면 [오늘 꼭 할 일]에 맨 위로 올라옵니다.' },
  { key: 'est',       header: '예상(분)',   width: 80,  since: 4, aliases: [], type: 'number',
    note: '예상 소요 시간(분). 타임박스 자동 배치에 씁니다. 비우면 30분으로 계산합니다.' },
  { key: 'priority',  header: '우선순위',   width: 80,  since: 4, aliases: [], list: ['높음', '보통', '낮음'] },
  { key: 'delegatedOn', header: '맡긴 날',  width: 100, since: 5, aliases: [], type: 'date',
    note: '위임으로 바꾼 날. 자동으로 적힙니다. "며칠째 기다리는지" 계산에 씁니다.' }
];

var PRIORITY_ORDER = { '높음': 0, '보통': 1, '': 1, '낮음': 2 };

/**
 * 시트 구조 변환. 키 = 도달할 SCHEMA_VERSION.
 * ctx = { ss, sheet, map } (map: 열 key → 열 번호, 새 열 추가 후의 상태)
 * 규칙: 기존 데이터를 지우지 말 것. 여러 번 실행돼도 결과가 같게(멱등) 짤 것.
 *
 * 예) 2: function (ctx) { renameStatusValues_(ctx, { '대기': '위임' }); }
 */
var MIGRATIONS = {};

/* ── 10_Util.gs ── */
/** 내 업무관리 키트 — 공통 도우미 (시트에 의존하지 않는 순수 함수) */

function colLetter_(n) {
  var s = '';
  while (n > 0) {
    var m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** 셀 값(Date 또는 문자열)을 'yyyy-MM-dd' 문자열로. 날짜가 아니면 '' */
function ymd_(value, tz) {
  if (value === null || value === undefined || value === '') return '';
  if (Object.prototype.toString.call(value) === '[object Date]') {
    if (isNaN(value.getTime())) return '';
    return Utilities.formatDate(value, tz || 'Asia/Seoul', 'yyyy-MM-dd');
  }
  var m = String(value).trim().match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})/);
  if (!m) return '';
  return m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2);
}

function todayYmd_(tz) {
  return Utilities.formatDate(new Date(), tz || 'Asia/Seoul', 'yyyy-MM-dd');
}

/** 'yyyy-MM-dd' 에 n일을 더한다 (시간대 영향 없도록 UTC로 계산) */
function addDaysYmd_(ymd, n) {
  var p = ymd.split('-');
  var d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2] + n));
  return d.getUTCFullYear() + '-' + ('0' + (d.getUTCMonth() + 1)).slice(-2) + '-' + ('0' + d.getUTCDate()).slice(-2);
}

/** 그 주 월요일 */
function weekStartYmd_(ymd) {
  var p = ymd.split('-');
  var dow = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])).getUTCDay(); // 0=일
  return addDaysYmd_(ymd, dow === 0 ? -6 : 1 - dow);
}

function normalizeStatus_(value) {
  var s = String(value === null || value === undefined ? '' : value).trim();
  if (!s) return '';
  if (STATUS_ALIASES.hasOwnProperty(s)) return STATUS_ALIASES[s];
  return s;
}

function isClosedStatus_(status) {
  return status === STATUS.DONE || status === STATUS.DROPPED;
}

/** 지금 실행 대상인가 (끝남·언젠가·참고 제외) */
function isActionable_(status) {
  return !isClosedStatus_(status) && status !== STATUS.SOMEDAY && status !== STATUS.REFERENCE;
}

/** 머리글 배열 → { key: 열번호(1부터) }. 머리글 이름과 aliases 모두로 찾는다. */
function buildColumnMap_(headers) {
  var index = {};
  for (var i = 0; i < headers.length; i++) {
    var h = String(headers[i] === null || headers[i] === undefined ? '' : headers[i]).trim();
    if (h && !index.hasOwnProperty(h)) index[h] = i + 1;
  }
  var map = {};
  COLUMNS.forEach(function (c) {
    var names = [c.header].concat(c.aliases || []);
    for (var j = 0; j < names.length; j++) {
      if (index.hasOwnProperty(names[j])) { map[c.key] = index[names[j]]; return; }
    }
  });
  return map;
}

/** 시트에 없는 키트 열 목록 */
function missingColumns_(headers) {
  var map = buildColumnMap_(headers);
  return COLUMNS.filter(function (c) { return !map[c.key]; });
}

/** 업무 시트 한 줄 → 업무 객체 */
function rowToTask_(values, map, tz, rowNumber) {
  var get = function (key) { return map[key] ? values[map[key] - 1] : ''; };
  var str = function (key) { var v = get(key); return v === null || v === undefined ? '' : String(v).trim(); };
  return {
    row: rowNumber,
    id: str('id'),
    title: str('title'),
    status: normalizeStatus_(get('status')),
    due: ymd_(get('due'), tz),
    context: str('context'),
    delegatee: str('delegatee'),
    followUp: ymd_(get('followUp'), tz),
    memo: str('memo'),
    created: ymd_(get('created'), tz),
    completed: ymd_(get('completed'), tz),
    repeat: str('repeat'),
    project: str('project'),
    focus: ymd_(get('focus'), tz),
    est: Math.max(0, Math.round(Number(get('est')) || 0)),
    priority: str('priority'),
    delegatedOn: ymd_(get('delegatedOn'), tz)
  };
}

/**
 * 업무 ID. 한 번의 실행 안에서는 순번으로 절대 겹치지 않고,
 * 실행이 달라도 시각(ms) + 무작위 꼬리로 겹칠 일이 사실상 없다.
 */
var ID_SEQ_ = 0;
function newId_() {
  ID_SEQ_++;
  var rand = ('000' + Math.floor(Math.random() * 1679616).toString(36).toUpperCase()).slice(-4);
  return 'T' + Date.now().toString(36).toUpperCase() + '-' + ID_SEQ_.toString(36).toUpperCase() + rand;
}

// ── 캐시 (속도) ─────────────────────────────────────────────
// 데이터가 바뀔 때마다 '데이터 버전'을 올리고, 화면 캐시는 그 버전을 키에 넣는다 → 바뀌면 자동으로 새로 계산.
function cache_() { try { return typeof CacheService !== 'undefined' ? CacheService.getScriptCache() : null; } catch (e) { return null; } }
function cacheGetJson_(key) { var c = cache_(); if (!c) return null; try { var v = c.get(key); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
function cachePutJson_(key, obj, sec) { var c = cache_(); if (!c) return; try { var s = JSON.stringify(obj); if (s.length < 95000) c.put(key, s, sec); } catch (e) {} }
// 이 실행에서 직접 올린 버전. CacheService는 방금 넣은 값을 바로 읽는다는 보장이 없어서(옛 버전이 읽히면
// 바꾸기 전 화면 캐시가 그대로 나간다 — 예: 되돌리기 직후 할 일이 안 보임), 이 실행 안에서는 이 값을 먼저 쓴다.
var DATA_VER_ = {};
function dataVersion_(ssId) {
  if (DATA_VER_[ssId]) return DATA_VER_[ssId];
  var c = cache_(); if (!c) return '0';
  var v = c.get('ver:' + ssId);
  if (!v) { v = String(Date.now()) + Math.random(); try { c.put('ver:' + ssId, v, 21600); } catch (e) {} } // 사라졌으면 새 버전 (옛 화면 재사용 방지)
  return v;
}
function bumpDataVersion_(ssId) {
  var v = String(Date.now()) + Math.random();
  DATA_VER_[ssId] = v;
  var c = cache_(); if (c) try { c.put('ver:' + ssId, v, 21600); } catch (e) {}
}

function escapeHtml_(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ── 루틴(반복 규칙) ─────────────────────────────────────────

var DOW_KO_ = { '일': 0, '월': 1, '화': 2, '수': 3, '목': 4, '금': 5, '토': 6 };

/**
 * 반복 규칙 문자열 해석. 모르는 형식이면 null.
 * 날짜 고정형: 매일 · 평일 · 매주 월(,수,금) · 매월 25일 · 매월 말일 · 매년 3월 1일
 * 완료 간격형: 7일마다 · 2주마다 · 1개월마다 (완료한 날부터 계산)
 */
function parseRepeat_(rule) {
  var r = String(rule === null || rule === undefined ? '' : rule).replace(/\s+/g, ' ').trim();
  if (!r) return null;
  var m;
  if (r === '매일') return { type: 'daily' };
  if (r === '평일' || r === '매주 평일') return { type: 'weekly', days: [1, 2, 3, 4, 5] };
  if ((m = r.match(/^매\s?(\d+)\s*(일|주|개월)\s*마다$/)) || (m = r.match(/^(\d+)\s*(일|주|개월)\s*마다$/))) {
    var n = Number(m[1]);
    return n > 0 ? { type: 'interval', n: n, unit: m[2] } : null;
  }
  if ((m = r.match(/^매주\s*([월화수목금토일 ,·]+)(요일)?$/))) {
    var days = [];
    m[1].replace(/[월화수목금토일]/g, function (ch) { if (days.indexOf(DOW_KO_[ch]) === -1) days.push(DOW_KO_[ch]); return ch; });
    return days.length ? { type: 'weekly', days: days.sort() } : null;
  }
  if ((m = r.match(/^매월\s*(\d{1,2})\s*일$/)) && +m[1] >= 1 && +m[1] <= 31) return { type: 'monthly', day: +m[1] };
  if (/^매월\s*(말일|마지막\s*날)$/.test(r)) return { type: 'monthly', day: 31 };
  if ((m = r.match(/^매년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일$/)) && +m[1] >= 1 && +m[1] <= 12 && +m[2] >= 1 && +m[2] <= 31) {
    return { type: 'yearly', month: +m[1], day: +m[2] };
  }
  return null;
}

function daysInMonth_(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); } // m: 1~12
function ymdOf_(y, m, d) { // 없는 날짜는 그 달 말일로 (31일 → 30일·28일)
  while (m > 12) { m -= 12; y++; }
  var dd = Math.min(d, daysInMonth_(y, m));
  return y + '-' + ('0' + m).slice(-2) + '-' + ('0' + dd).slice(-2);
}
function dowOf_(ymd) { var p = ymd.split('-'); return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])).getUTCDay(); }

/**
 * 완료(또는 건너뛰기)한 회차의 다음 날짜.
 * 날짜 고정형: 원래 예정일과 오늘 중 늦은 날 "다음"의 규칙 날짜 (밀린 회차를 한꺼번에 만들지 않는다)
 * 완료 간격형: 오늘(실제 완료일) + 간격
 */
function nextOccurrence_(rule, due, today) {
  var p = parseRepeat_(rule);
  if (!p) return '';
  if (p.type === 'interval') {
    if (p.unit === '개월') { var t = today.split('-'); return ymdOf_(+t[0], +t[1] + p.n, +t[2]); }
    return addDaysYmd_(today, p.unit === '주' ? p.n * 7 : p.n);
  }
  var base = due && due > today ? due : today;
  var b = base.split('-'), y = +b[0], mo = +b[1];
  if (p.type === 'daily') return addDaysYmd_(base, 1);
  if (p.type === 'weekly') {
    for (var i = 1; i <= 7; i++) { var c = addDaysYmd_(base, i); if (p.days.indexOf(dowOf_(c)) !== -1) return c; }
    return '';
  }
  if (p.type === 'monthly') {
    var cand = ymdOf_(y, mo, p.day);
    return cand > base ? cand : ymdOf_(y, mo + 1, p.day);
  }
  if (p.type === 'yearly') {
    var cy = ymdOf_(y, p.month, p.day);
    return cy > base ? cy : ymdOf_(y + 1, p.month, p.day);
  }
  return '';
}

/* ── 20_Schema.gs ── */
/**
 * 내 업무관리 키트 — 시트 구조 (설치·업데이트·마이그레이션)
 *
 * 설정값은 숨김 시트 [_설정]에 저장한다. 스크립트 속성이 아니라 시트에 두는 이유:
 * 시트만 있으면 어떤 버전의 코드를 붙여도 상태를 그대로 읽을 수 있어야 하기 때문.
 */

// ── 설정 시트 ───────────────────────────────────────────────

function getSettingsSheet_(ss, create) {
  var sh = ss.getSheetByName(KIT.SETTINGS_SHEET);
  if (!sh && create) {
    sh = ss.insertSheet(KIT.SETTINGS_SHEET);
    sh.getRange(1, 1, 1, 2).setValues([['항목', '값']]);
    sh.getRange(1, 1, 1, 2).setFontWeight('bold');
    sh.setColumnWidth(1, 160);
    sh.setColumnWidth(2, 260);
    sh.hideSheet();
  }
  return sh;
}

// 한 번의 실행(요청) 안에서는 [_설정]을 한 번만 읽는다 (속도). 쓰면 캐시도 함께 고친다.
var SETTINGS_CACHE_ = null;

function readSettings_(ss) {
  if (SETTINGS_CACHE_ && SETTINGS_CACHE_.id === ss.getId()) return SETTINGS_CACHE_.data;
  var out = readSettingsRaw_(ss);
  SETTINGS_CACHE_ = { id: ss.getId(), data: out };
  return out;
}

function readSettingsRaw_(ss) {
  var sh = getSettingsSheet_(ss, false);
  var out = {};
  if (!sh || sh.getLastRow() < 2) return out;
  var rows = sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues();
  rows.forEach(function (r) {
    var k = String(r[0]).trim();
    if (k) out[k] = r[1];
  });
  return out;
}

function writeSetting_(ss, key, value) {
  bumpDataVersion_(ss.getId());
  if (SETTINGS_CACHE_ && SETTINGS_CACHE_.id === ss.getId()) SETTINGS_CACHE_.data[key] = value;
  var sh = getSettingsSheet_(ss, true);
  var last = sh.getLastRow();
  if (last >= 2) {
    var keys = sh.getRange(2, 1, last - 1, 1).getValues();
    for (var i = 0; i < keys.length; i++) {
      if (String(keys[i][0]).trim() === key) {
        sh.getRange(i + 2, 2).setValue(value);
        return;
      }
    }
  }
  sh.getRange(last + 1, 1, 1, 2).setValues([[key, value]]);
}

// ── 업무 시트 찾기 ───────────────────────────────────────────

/** 시트 ID로 먼저 찾고(사용자가 시트 이름을 바꿔도 동작), 없으면 이름으로 찾는다. */
function getTaskSheet_(ss, settings) {
  settings = settings || readSettings_(ss);
  var id = settings['업무시트ID'];
  if (id !== undefined && id !== '') {
    var sheets = ss.getSheets();
    for (var i = 0; i < sheets.length; i++) {
      if (String(sheets[i].getSheetId()) === String(id)) return sheets[i];
    }
  }
  return ss.getSheetByName(KIT.TASK_SHEET);
}

function readHeaders_(sheet) {
  var lastCol = sheet.getLastColumn();
  if (lastCol < 1) return [];
  return sheet.getRange(1, 1, 1, lastCol).getValues()[0];
}

function getColumnMap_(sheet) {
  return buildColumnMap_(readHeaders_(sheet));
}

// ── 설치·업데이트 ────────────────────────────────────────────

/**
 * 시트를 현재 코드 버전에 맞춘다. 여러 번 실행해도 안전하다(멱등).
 * - 업무 시트가 없으면 만든다.
 * - 빠진 열은 맨 오른쪽에 추가한다 (기존 열·데이터·사용자 열은 그대로).
 * - 시트 구조 버전이 낮으면 MIGRATIONS를 차례로 실행한다.
 * @return {{created:boolean, from:number, to:number, addedColumns:string[], changed:boolean}}
 */
function ensureSchema_(ss) {
  var settings = readSettings_(ss);
  var stored = Number(settings['시트버전'] || 0);

  if (stored > KIT.SCHEMA_VERSION) {
    throw new Error(
      '이 시트는 더 새로운 버전(시트 구조 v' + stored + ')에서 사용되었습니다. ' +
      '지금 코드는 v' + KIT.SCHEMA_VERSION + '입니다. 최신 코드로 바꿔 주세요. (시트 데이터는 그대로입니다)'
    );
  }

  var result = { created: false, from: stored, to: KIT.SCHEMA_VERSION, addedColumns: [], changed: false };

  var sheet = getTaskSheet_(ss, settings);
  if (!sheet) {
    sheet = ss.insertSheet(KIT.TASK_SHEET);
    result.created = true;
  }

  var headers = readHeaders_(sheet);
  var hasAnyHeader = headers.some(function (h) { return String(h).trim() !== ''; });
  var missing = missingColumns_(headers);

  if (missing.length) {
    var startCol = hasAnyHeader ? headers.length + 1 : 1;
    // 마지막 열 뒤에 빈 머리글 열이 있으면 그 자리부터 쓴다
    if (hasAnyHeader) {
      while (startCol > 1 && String(headers[startCol - 2]).trim() === '') startCol--;
    }
    var needed = startCol - 1 + missing.length;
    if (sheet.getMaxColumns() < needed) {
      sheet.insertColumnsAfter(sheet.getMaxColumns(), needed - sheet.getMaxColumns());
    }
    sheet.getRange(1, startCol, 1, missing.length).setValues([missing.map(function (c) { return c.header; })]);
    result.addedColumns = missing.map(function (c) { return c.header; });
  }

  var map = getColumnMap_(sheet);

  for (var v = stored + 1; v <= KIT.SCHEMA_VERSION; v++) {
    if (MIGRATIONS[v]) MIGRATIONS[v]({ ss: ss, sheet: sheet, map: map });
  }

  // 처음 설치할 때만: 시트 시간대를 서울로 (TODAY()·마감 계산 기준). 이후 사용자가 바꾼 시간대는 존중한다.
  if (stored === 0 && ss.getSpreadsheetTimeZone() !== 'Asia/Seoul') ss.setSpreadsheetTimeZone('Asia/Seoul');

  var needsFormat = result.created || stored < KIT.SCHEMA_VERSION || missing.length > 0;
  if (needsFormat) applyTaskSheetFormat_(ss, sheet, map, missing, result.created || stored === 0);

  if (String(settings['업무시트ID']) !== String(sheet.getSheetId())) writeSetting_(ss, '업무시트ID', sheet.getSheetId());
  if (stored !== KIT.SCHEMA_VERSION) writeSetting_(ss, '시트버전', KIT.SCHEMA_VERSION);
  if (String(settings['코드버전']) !== KIT.VERSION) writeSetting_(ss, '코드버전', KIT.VERSION);
  if (!settings['설치일']) writeSetting_(ss, '설치일', todayYmd_(ss.getSpreadsheetTimeZone()));
  getWebKey_(ss); // 휴대폰 웹앱 개인 키 (없거나 사본이면 새로 만든다)

  result.changed = result.created || stored !== KIT.SCHEMA_VERSION || missing.length > 0;
  return result;
}

/** 설정 시트가 있고 시트 구조가 최신이면 true (onOpen에서 빠르게 확인용) */
function isSchemaCurrent_(ss) {
  var s = readSettings_(ss);
  return Number(s['시트버전'] || 0) === KIT.SCHEMA_VERSION && !!getTaskSheet_(ss, s);
}

// ── 서식 ─────────────────────────────────────────────────────

/**
 * @param newColumns 이번에 새로 추가된 열 (너비·메모는 새 열에만 적용해 사용자가 바꾼 너비를 지킨다)
 * @param firstInstall 처음 설치면 머리글 스타일·고정행까지 적용
 */
function applyTaskSheetFormat_(ss, sheet, map, newColumns, firstInstall) {
  var lastCol = sheet.getLastColumn();
  var maxRows = Math.max(sheet.getMaxRows(), 2);
  var newKeys = {};
  (newColumns || []).forEach(function (c) { newKeys[c.key] = true; });

  if (firstInstall) {
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, lastCol)
      .setFontWeight('bold').setBackground('#5b5cf6').setFontColor('#ffffff');
  } else if (newColumns && newColumns.length) {
    // 새 열 머리글은 기존 첫 머리글 스타일을 따라간다
    var src = sheet.getRange(1, 1);
    newColumns.forEach(function (c) {
      sheet.getRange(1, map[c.key])
        .setFontWeight('bold').setBackground(src.getBackground()).setFontColor(src.getFontColor());
    });
  }

  COLUMNS.forEach(function (c) {
    var col = map[c.key];
    if (!col) return;
    var isNew = firstInstall || newKeys[c.key];
    if (isNew) {
      sheet.setColumnWidth(col, c.width);
      if (c.note) sheet.getRange(1, col).setNote(c.note);
    }
    var body = sheet.getRange(2, col, maxRows - 1, 1);
    if (c.type === 'date') {
      body.setNumberFormat('yyyy-mm-dd');
      body.setDataValidation(
        SpreadsheetApp.newDataValidation().requireDate().setAllowInvalid(false)
          .setHelpText('날짜를 넣어 주세요. 예) 2026-11-20').build()
      );
    }
    if (c.list) {
      body.setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(c.list, true).setAllowInvalid(true).build());
    }
    if (c.type === 'number') body.setNumberFormat('0');
    if (c.key === 'status') {
      body.setDataValidation(
        SpreadsheetApp.newDataValidation().requireValueInList(STATUS_LIST, true).setAllowInvalid(false).build()
      );
    }
  });

  if (map.id) sheet.getRange(2, map.id, maxRows - 1, 1).setFontColor('#999999');

  applyConditionalRules_(sheet, map, lastCol, maxRows);
}

/** 키트가 만든 규칙만 교체하고, 사용자가 만든 조건부 서식은 그대로 둔다. */
function applyConditionalRules_(sheet, map, lastCol, maxRows) {
  if (!map.status) return;
  var S = '$' + colLetter_(map.status) + '2';
  var D = map.due ? '$' + colLetter_(map.due) + '2' : null;
  var F = map.followUp ? '$' + colLetter_(map.followUp) + '2' : null;
  var whole = sheet.getRange(2, 1, maxRows - 1, lastCol);
  var mark = KIT.RULE_MARK;

  var ours = [];
  // 1) 완료·버림: 회색 + 취소선 (가장 먼저 = 우선)
  ours.push(SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=AND(' + mark + ',OR(' + S + '="' + STATUS.DONE + '",' + S + '="' + STATUS.DROPPED + '"))')
    .setFontColor('#9aa0a6').setStrikethrough(true).setRanges([whole]).build());
  // 2) 위임 확인일 지남: 주황
  if (F) {
    ours.push(SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=AND(' + mark + ',' + S + '="' + STATUS.DELEGATED + '",' + F + '<>"",' + F + '<=TODAY())')
      .setBackground('#fde7cf').setRanges([whole]).build());
  }
  // 3) 마감 지남: 빨강
  if (D) {
    ours.push(SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=AND(' + mark + ',' + D + '<>"",' + D + '<TODAY(),' + S + '<>"' + STATUS.SOMEDAY + '",' + S + '<>"' + STATUS.REFERENCE + '")')
      .setBackground('#fce1e1').setRanges([whole]).build());
  }
  // 4) 수집함: 상태 칸만 노랑
  ours.push(SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=AND(' + mark + ',' + S + '="' + STATUS.INBOX + '")')
    .setBackground('#fff4c2').setRanges([sheet.getRange(2, map.status, maxRows - 1, 1)]).build());

  var keep = sheet.getConditionalFormatRules().filter(function (r) {
    var bc = r.getBooleanCondition && r.getBooleanCondition();
    if (!bc) return true;
    var vals = bc.getCriteriaValues() || [];
    return !vals.some(function (v) { return String(v).indexOf(mark) !== -1; });
  });
  sheet.setConditionalFormatRules(ours.concat(keep));
}

// ── 마이그레이션 도우미 ───────────────────────────────────────

/** 상태값 일괄 변경. 예: renameStatusValues_(ctx, { '대기': '위임' }) */
function renameStatusValues_(ctx, mapping) {
  var col = ctx.map.status;
  var last = ctx.sheet.getLastRow();
  if (!col || last < 2) return;
  var range = ctx.sheet.getRange(2, col, last - 1, 1);
  var vals = range.getValues();
  var touched = false;
  vals.forEach(function (r) {
    var v = String(r[0]).trim();
    if (mapping.hasOwnProperty(v)) { r[0] = mapping[v]; touched = true; }
  });
  if (touched) range.setValues(vals);
}

/* ── 30_Tasks.gs ── */
/** 내 업무관리 키트 — 업무 읽기·쓰기 */

function taskContext_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var settings = readSettings_(ss);
  var sheet = getTaskSheet_(ss, settings);
  if (!sheet || !settings['시트버전']) {
    throw new Error('먼저 메뉴 [내 업무 ▸ 처음 설정 / 업데이트 적용]을 눌러 주세요.');
  }
  return { ss: ss, sheet: sheet, map: getColumnMap_(sheet), tz: ss.getSpreadsheetTimeZone() };
}

function readAllTasks_(ctx) {
  var last = ctx.sheet.getLastRow();
  if (last < 2) return [];
  var width = ctx.sheet.getLastColumn();
  var values = ctx.sheet.getRange(2, 1, last - 1, width).getValues();
  var out = [];
  for (var i = 0; i < values.length; i++) {
    var t = rowToTask_(values[i], ctx.map, ctx.tz, i + 2);
    if (t.title) out.push(t);
  }
  return out;
}

function findRowById_(ctx, id) {
  if (!ctx.map.id || !id) return 0;
  var last = ctx.sheet.getLastRow();
  if (last < 2) return 0;
  var ids = ctx.sheet.getRange(2, ctx.map.id, last - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]).trim() === String(id)) return i + 2;
  }
  return 0;
}

/** 실제 데이터가 있는 마지막 줄 (할일 열 기준. 서식만 있는 줄은 무시) */
function lastDataRow_(ctx) {
  var last = ctx.sheet.getLastRow();
  if (last < 2) return 1;
  var titles = ctx.sheet.getRange(2, ctx.map.title, last - 1, 1).getValues();
  for (var i = titles.length - 1; i >= 0; i--) {
    if (String(titles[i][0]).trim() !== '') return i + 2;
  }
  return 1;
}

function withLock_(fn) {
  var lock = LockService.getDocumentLock();
  if (!lock.tryLock(10000)) throw new Error('다른 작업이 진행 중입니다. 잠시 후 다시 시도해 주세요.');
  try { var r = fn(); bumpDataVersion_(SpreadsheetApp.getActiveSpreadsheet().getId()); return r; } finally { lock.releaseLock(); }
}

// ── 사이드바에서 부르는 공개 함수 (이름 바꾸지 말 것) ─────────────────

/** 여러 줄 텍스트 → 줄마다 수집함 항목 1개 */
function addTasks(text) {
  var lines = String(text || '').split(/\r?\n/)
    .map(function (s) { return s.replace(/^\s*[-*•·]\s*/, '').trim(); })
    .filter(function (s) { return s !== ''; });
  if (!lines.length) return { added: 0 };

  return withLock_(function () {
    var ctx = taskContext_();
    var today = todayYmd_(ctx.tz);
    var parsed = lines.map(function (line) { return parseCapture_(line, today); });
    appendTasks_(ctx, parsed.map(function (p) {
      var t = { title: p.title, status: STATUS.INBOX, created: today };
      ['due', 'context', 'project', 'priority', 'est'].forEach(function (k) { if (p[k]) t[k] = p[k]; });
      return t;
    }));
    return { added: lines.length, parsed: parsed };
  });
}

/**
 * 담을 때 한 줄에서 날짜·상황·프로젝트·중요도·예상 시간을 알아듣는다. 알아들은 말은 제목에서 뺀다.
 *   날짜: 오늘 · 내일 · 모레 · 글피 · (이번주/다음주) 금요일 · 주말 · 다음주 · 3일 뒤 · 11/20 · 11월 20일 · 20일  (뒤에 '까지'도 됨)
 *   @전화 → 상황 · #워크숍 → 프로젝트 · ! → 중요 · 30분 / 1시간 / 1시간 30분 → 예상 시간
 * 아무것도 못 알아들으면 제목만 그대로. 다 빼고 제목이 비면 원래 글을 제목으로 둔다.
 */
function parseCapture_(text, today) {
  var src = String(text || '').trim(), t = ' ' + src + ' ', out = {};
  var take = function (re, fn) {
    var m = t.match(re); if (!m) return false;
    var v = fn(m); if (v === false || v === null || v === undefined) return false;
    t = t.slice(0, m.index) + ' ' + t.slice(m.index + m[0].length); return true;
  };
  var E = '(?:까지)?(?=\\s)';
  var dow = function (ymd) { return new Date(ymd + 'T00:00:00Z').getUTCDay(); };
  var valid = function (y, m, d) { var x = new Date(Date.UTC(y, m - 1, d)); return x.getUTCMonth() === m - 1 && x.getUTCDate() === d ? x.toISOString().slice(0, 10) : null; };
  var DOW = { '일': 0, '월': 1, '화': 2, '수': 3, '목': 4, '금': 5, '토': 6 };
  take(/\s@([^\s@.,]+)(?=\s)/, function (m) { out.context = '@' + m[1]; return 1; });
  take(/\s#([^\s#\d][^\s#]*)(?=\s)/, function (m) { out.project = m[1]; return 1; });
  take(/\s!{1,3}(?=\s)/, function () { out.priority = '높음'; return 1; });
  take(/\s(\d+(?:\.\d+)?)\s?(시간|분)(?:\s?(\d+)\s?분)?(?=\s)/, function (m) {
    var n = m[2] === '시간' ? Number(m[1]) * 60 + Number(m[3] || 0) : Number(m[1]);
    if (!(n > 0 && n <= 24 * 60)) return false; out.est = Math.round(n); return 1;
  });
  var dueRules = [
    [new RegExp('\\s(오늘|내일|모레|글피)' + E), function (m) { return addDaysYmd_(today, { '오늘': 0, '내일': 1, '모레': 2, '글피': 3 }[m[1]]); }],
    [new RegExp('\\s(?:(이번\\s?주|다음\\s?주|담주)\\s?)?([월화수목금토일])요일' + E), function (m) {
      var w = DOW[m[2]], d0 = dow(today);
      if (!m[1]) return addDaysYmd_(today, (w - d0 + 7) % 7);
      var mon = addDaysYmd_(today, -((d0 + 6) % 7)), d = addDaysYmd_(mon, (w + 6) % 7);
      if (!/이번/.test(m[1])) d = addDaysYmd_(d, 7);
      return d < today ? addDaysYmd_(d, 7) : d; // 지난 요일이면 다음 주
    }],
    [new RegExp('\\s(?:이번\\s?)?주말' + E), function () { var d0 = dow(today); return d0 === 0 ? today : addDaysYmd_(today, 6 - d0); }],
    [new RegExp('\\s(?:다음\\s?주|담주)' + E), function () { var d0 = dow(today); return addDaysYmd_(today, 7 - ((d0 + 6) % 7)); }],
    [new RegExp('\\s(\\d{1,3})\\s?일\\s?(?:뒤|후)' + E), function (m) { return addDaysYmd_(today, Number(m[1])); }],
    [new RegExp('\\s(\\d{1,2})(?:/|월\\s?)(\\d{1,2})일?' + E), function (m) {
      var y = Number(today.slice(0, 4)), d = valid(y, Number(m[1]), Number(m[2]));
      if (d && d < today) d = valid(y + 1, Number(m[1]), Number(m[2]));
      return d;
    }],
    [new RegExp('\\s(\\d{1,2})일' + E), function (m) {
      var y = Number(today.slice(0, 4)), mo = Number(today.slice(5, 7)), d = valid(y, mo, Number(m[1]));
      if (d && d < today) d = mo === 12 ? valid(y + 1, 1, Number(m[1])) : valid(y, mo + 1, Number(m[1]));
      return d;
    }]
  ];
  for (var i = 0; i < dueRules.length; i++) { if (take(dueRules[i][0], function (m) { var d = dueRules[i][1](m); if (d) out.due = d; return d; })) break; }
  out.title = t.replace(/\s+/g, ' ').trim() || src;
  return out;
}

/** 업무 객체 여러 개를 마지막 데이터 줄 아래에 한 번에 쓴다 (ID 자동) */
function appendTasks_(ctx, tasks) {
  if (!tasks.length) return;
  var width = ctx.sheet.getLastColumn();
  var rows = tasks.map(function (t, i) {
    var r = new Array(width);
    for (var k = 0; k < width; k++) r[k] = '';
    Object.keys(t).forEach(function (key) { if (ctx.map[key] && t[key] !== undefined) r[ctx.map[key] - 1] = t[key]; });
    if (ctx.map.id) r[ctx.map.id - 1] = t.id || newId_(i + 1);
    return r;
  });
  var start = lastDataRow_(ctx) + 1;
  if (ctx.sheet.getMaxRows() < start + rows.length - 1) {
    ctx.sheet.insertRowsAfter(ctx.sheet.getMaxRows(), start + rows.length - 1 - ctx.sheet.getMaxRows());
  }
  ctx.sheet.getRange(start, 1, rows.length, width).setValues(rows);
}

var LAST_SPAWN_ID_ = '';

/**
 * 루틴 회차를 끝냈을(또는 건너뛴) 때 다음 회차를 만든다.  만든 회차의 ID는 LAST_SPAWN_ID_ (되돌리기용).
 * 같은 제목·같은 반복 규칙의 열린 회차가 이미 있으면 만들지 않는다(완료를 껐다 켰다 해도 중복 없음).
 * @return {string} 만든 다음 회차의 날짜 ('' = 안 만듦)
 */
function spawnNextOccurrence_(ctx, task, today, allTasks) {
  if (!task.repeat || !ctx.map.repeat) return '';
  var next = nextOccurrence_(task.repeat, task.due, today);
  if (!next) return '';
  var nid = newId_();
  var dup = (allTasks || readAllTasks_(ctx)).some(function (t) {
    return t.id !== task.id && t.title === task.title && t.repeat === task.repeat && !isClosedStatus_(t.status);
  });
  if (dup) return '';
  var delegated = task.status === STATUS.DELEGATED || (task.delegatee && task.followUp);
  LAST_SPAWN_ID_ = nid;
  appendTasks_(ctx, [{
    id: nid, title: task.title, status: delegated ? STATUS.DELEGATED : STATUS.SCHEDULED, due: next,
    context: task.context, delegatee: task.delegatee, followUp: delegated ? next : '',
    memo: task.memo, repeat: task.repeat, created: today
  }]);
  return next;
}

/** 수집함 목록 (오래된 순) */
function getInbox() {
  var ctx = taskContext_();
  var list = readAllTasks_(ctx).filter(function (t) { return t.status === STATUS.INBOX || t.status === ''; });
  // ID 없는 줄(시트에 직접 입력 후 onEdit이 못 돈 경우)에 ID를 붙여 사이드바가 다룰 수 있게 한다
  var missing = list.filter(function (t) { return !t.id; });
  if (missing.length && ctx.map.id) {
    withLock_(function () {
      missing.forEach(function (t, i) {
        t.id = newId_(i + 1);
        ctx.sheet.getRange(t.row, ctx.map.id).setValue(t.id);
      });
    });
  }
  return {
    today: todayYmd_(ctx.tz),
    items: list.map(function (t) {
      return { id: t.id, title: t.title, memo: t.memo, created: t.created };
    })
  };
}

/**
 * 수집함 항목 하나를 정리한다.
 * @param {string} id
 * @param {{status:string, title?:string, due?:string, context?:string, delegatee?:string, followUp?:string, memo?:string}} d
 */
function clarifyTask(id, d) {
  d = d || {};
  if (STATUS_LIST.indexOf(d.status) === -1) throw new Error('알 수 없는 상태입니다: ' + d.status);
  if (d.status === STATUS.DELEGATED && !String(d.delegatee || '').trim()) throw new Error('누구에게 맡겼는지 적어 주세요.');
  if (d.status === STATUS.SCHEDULED && !ymd_(d.due)) throw new Error('언제 할지 날짜를 골라 주세요.');
  if (d.repeat !== undefined && String(d.repeat).trim() && !parseRepeat_(d.repeat)) {
    throw new Error('반복 규칙을 이해하지 못했어요. 예) 매일, 평일, 매주 월, 매월 25일, 7일마다');
  }

  return withLock_(function () {
    var ctx = taskContext_();
    var row = findRowById_(ctx, id);
    if (!row) throw new Error('항목을 찾지 못했습니다. 시트에서 지워졌을 수 있습니다.');
    var today = todayYmd_(ctx.tz);
    var before = rowToTask_(ctx.sheet.getRange(row, 1, 1, ctx.sheet.getLastColumn()).getValues()[0], ctx.map, ctx.tz, row);
    var set = function (key, val) {
      if (ctx.map[key] && val !== undefined) ctx.sheet.getRange(row, ctx.map[key]).setValue(val);
    };
    if (d.title !== undefined && String(d.title).trim()) set('title', String(d.title).trim());
    set('status', d.status);
    if (d.due !== undefined) set('due', ymd_(d.due));
    if (d.context !== undefined) set('context', String(d.context).trim());
    if (d.delegatee !== undefined) set('delegatee', String(d.delegatee).trim());
    if (d.followUp !== undefined) set('followUp', ymd_(d.followUp));
    if (d.memo !== undefined && String(d.memo).trim()) set('memo', String(d.memo).trim());
    if (d.repeat !== undefined) set('repeat', String(d.repeat).trim());
    if (d.project !== undefined) set('project', String(d.project).trim());
    if (d.est !== undefined) set('est', Number(d.est) > 0 ? Math.round(Number(d.est)) : '');
    if (d.priority !== undefined) set('priority', ['높음', '보통', '낮음'].indexOf(d.priority) !== -1 ? d.priority : '');
    if (d.focus !== undefined) set('focus', d.focus === true ? today : ymd_(d.focus));
    set('completed', d.status === STATUS.DONE ? today : '');
    if (d.status === STATUS.DELEGATED && before.status !== STATUS.DELEGATED) set('delegatedOn', today);
    var next = '', nextId = '';
    if (d.status === STATUS.DONE || d.status === STATUS.DROPPED) {
      var t = rowToTask_(ctx.sheet.getRange(row, 1, 1, ctx.sheet.getLastColumn()).getValues()[0], ctx.map, ctx.tz, row);
      LAST_SPAWN_ID_ = '';
      if (t.repeat && (d.status === STATUS.DONE || d.skip)) { next = spawnNextOccurrence_(ctx, t, today); nextId = next ? LAST_SPAWN_ID_ : ''; }
    }
    return { ok: true, next: next, nextId: nextId, undo: { id: id, status: before.status, focus: before.focus, nextId: nextId } };
  });
}

/**
 * 루틴 바로 추가: 제목·반복 규칙·시작일. 수집함을 거치지 않고 '일정'으로 들어간다.
 */
function addRoutine(title, rule, start, context) {
  title = String(title || '').trim();
  if (!title) throw new Error('루틴 이름을 적어 주세요.');
  if (!parseRepeat_(rule)) throw new Error('반복 규칙을 이해하지 못했어요. 예) 매일, 평일, 매주 월, 매월 25일, 7일마다');
  return withLock_(function () {
    var ctx = taskContext_();
    if (!ctx.map.repeat) throw new Error('먼저 업데이트를 적용해 주세요.');
    var today = todayYmd_(ctx.tz);
    var due = ymd_(start) || today;
    appendTasks_(ctx, [{ title: title, status: STATUS.SCHEDULED, due: due, repeat: String(rule).trim(), context: String(context || '').trim(), created: today }]);
    return { ok: true, due: due };
  });
}

/**
 * 업무 일부만 고치기 (상태는 그대로). 허용: focus(★ 오늘 할 날, true=오늘, ''=해제), est, priority,
 * memoAppend(메모 뒤에 덧붙이기), due, context, project, title, followUp, delegatee
 */
function updateTask(id, patch) {
  patch = patch || {};
  return withLock_(function () {
    var ctx = taskContext_();
    var row = findRowById_(ctx, id);
    if (!row) throw new Error('항목을 찾지 못했습니다. 시트에서 지워졌을 수 있습니다.');
    var today = todayYmd_(ctx.tz);
    var set = function (key, val) { if (ctx.map[key]) ctx.sheet.getRange(row, ctx.map[key]).setValue(val); };
    if (patch.title !== undefined && String(patch.title).trim()) set('title', String(patch.title).trim());
    if (patch.focus !== undefined) set('focus', patch.focus === true ? today : ymd_(patch.focus));
    if (patch.est !== undefined) set('est', Number(patch.est) > 0 ? Math.round(Number(patch.est)) : '');
    if (patch.priority !== undefined) set('priority', ['높음', '보통', '낮음'].indexOf(patch.priority) !== -1 ? patch.priority : '');
    if (patch.due !== undefined) set('due', ymd_(patch.due));
    if (patch.context !== undefined) set('context', String(patch.context).trim());
    if (patch.project !== undefined) set('project', String(patch.project).trim());
    if (patch.followUp !== undefined) set('followUp', ymd_(patch.followUp));
    if (patch.delegatee !== undefined && String(patch.delegatee).trim()) set('delegatee', String(patch.delegatee).trim());
    if (patch.memoAppend && ctx.map.memo) {
      var cur = String(ctx.sheet.getRange(row, ctx.map.memo).getValue() || '').trim();
      var add = '[' + today.slice(5) + '] ' + String(patch.memoAppend).trim();
      set('memo', cur ? cur + '\n' + add : add);
    }
    return { ok: true };
  });
}

/** 여러 업무의 ★ 날짜를 한 번에 (오늘 마무리 → 내일, 주간 검토 → 다음 주 월요일). 한 번의 왕복으로 끝낸다 */
function setFocusMany(ids, focus) {
  ids = (ids || []).map(String);
  return withLock_(function () {
    var ctx = taskContext_();
    if (!ctx.map.focus) throw new Error('먼저 업데이트를 적용해 주세요.');
    var val = focus === true ? todayYmd_(ctx.tz) : ymd_(focus);
    var n = 0;
    readAllTasks_(ctx).forEach(function (t) { if (ids.indexOf(t.id) !== -1) { ctx.sheet.getRange(t.row, ctx.map.focus).setValue(val); n++; } });
    return { ok: true, count: n };
  });
}

/**
 * 하루 재설계: 고른 업무(최대 3개)만 오늘 꼭 할 일로 남기고, 나머지 ★는 내린다.
 */
function planDay(ids) {
  ids = (ids || []).slice(0, 3).map(String);
  return withLock_(function () {
    var ctx = taskContext_();
    if (!ctx.map.focus) throw new Error('먼저 업데이트를 적용해 주세요.');
    var today = todayYmd_(ctx.tz);
    readAllTasks_(ctx).forEach(function (t) {
      var want = ids.indexOf(t.id) !== -1;
      var has = t.focus && t.focus <= today && isActionable_(t.status);
      if (want && t.focus !== today) ctx.sheet.getRange(t.row, ctx.map.focus).setValue(today);
      if (!want && has) ctx.sheet.getRange(t.row, ctx.map.focus).setValue('');
    });
    return { ok: true, kept: ids.length };
  });
}

/**
 * 되돌리기: 완료·건너뛰기·버림 직후 이전 상태로. 그때 만든 루틴 다음 회차가 손대지 않은 채면 지운다.
 */
function undoTask(u) {
  u = u || {};
  if (!u.id || STATUS_LIST.indexOf(u.status) === -1) throw new Error('되돌릴 정보가 없어요.');
  return withLock_(function () {
    var ctx = taskContext_();
    var row = findRowById_(ctx, u.id);
    if (!row) throw new Error('항목을 찾지 못했습니다.');
    var set = function (key, val) { if (ctx.map[key]) ctx.sheet.getRange(row, ctx.map[key]).setValue(val); };
    set('status', u.status); set('completed', '');
    if (u.focus !== undefined) set('focus', ymd_(u.focus));
    if (u.nextId) {
      var nrow = findRowById_(ctx, u.nextId);
      if (nrow) {
        var n = rowToTask_(ctx.sheet.getRange(nrow, 1, 1, ctx.sheet.getLastColumn()).getValues()[0], ctx.map, ctx.tz, nrow);
        if (!isClosedStatus_(n.status)) ctx.sheet.deleteRow(nrow);
      }
    }
    return { ok: true };
  });
}

/** 루틴 이번 회차 건너뛰기: 이번 회차는 '버림'으로 남기고 다음 회차를 만든다 */
function skipTask(id) {
  return clarifyTask(id, { status: STATUS.DROPPED, skip: true });
}

// ── 시트에서 직접 편집할 때 (onEdit) ──────────────────────────

/**
 * - 할일을 새로 적으면: ID·등록일·상태(수집함)를 채운다.
 * - 상태를 '완료'로 바꾸면 완료일을 채우고, 다시 열면 지운다.
 */
function handleEdit_(e) {
  if (!e || !e.range) return;
  var sheet = e.range.getSheet();
  var ss = sheet.getParent();
  var settings = readSettings_(ss);
  if (!settings['업무시트ID'] || String(sheet.getSheetId()) !== String(settings['업무시트ID'])) return;
  bumpDataVersion_(ss.getId()); // 시트에서 직접 고쳐도 웹 화면 캐시가 바로 새로워진다

  var firstRow = Math.max(e.range.getRow(), 2);
  var lastRow = e.range.getLastRow();
  if (lastRow < firstRow) return;

  var map = getColumnMap_(sheet);
  if (!map.title) return;
  var tz = ss.getSpreadsheetTimeZone();
  var today = todayYmd_(tz);
  var width = sheet.getLastColumn();
  var n = lastRow - firstRow + 1;
  var range = sheet.getRange(firstRow, 1, n, width);
  var values = range.getValues();
  var changed = false;
  var spawn = [];

  for (var i = 0; i < n; i++) {
    var r = values[i];
    var title = String(r[map.title - 1]).trim();
    if (!title) continue;
    if (map.id && !String(r[map.id - 1]).trim()) { r[map.id - 1] = newId_(i + 1); changed = true; }
    if (map.created && !ymd_(r[map.created - 1], tz)) { r[map.created - 1] = today; changed = true; }
    if (map.status) {
      var st = normalizeStatus_(r[map.status - 1]);
      if (!st) { r[map.status - 1] = STATUS.INBOX; st = STATUS.INBOX; changed = true; }
      if (st === STATUS.DELEGATED && map.delegatedOn && !ymd_(r[map.delegatedOn - 1], tz)) { r[map.delegatedOn - 1] = today; changed = true; }
      if (map.completed) {
        var done = ymd_(r[map.completed - 1], tz);
        if (st === STATUS.DONE && !done) { r[map.completed - 1] = today; changed = true; if (map.repeat && String(r[map.repeat - 1]).trim()) spawn.push(i); }
        if (st !== STATUS.DONE && done) { r[map.completed - 1] = ''; changed = true; }
      }
    }
  }
  if (!changed) return;

  // 수식이 들어 있는 칸은 덮어쓰지 않도록, 키트 열만 칸 단위로 다시 쓴다
  ['id', 'created', 'status', 'completed', 'delegatedOn'].forEach(function (key) {
    var col = map[key];
    if (!col) return;
    sheet.getRange(firstRow, col, n, 1).setValues(values.map(function (r) { return [r[col - 1]]; }));
  });

  if (spawn.length) {
    var ctx = { ss: ss, sheet: sheet, map: map, tz: tz };
    var all = readAllTasks_(ctx);
    spawn.forEach(function (i) {
      spawnNextOccurrence_(ctx, rowToTask_(values[i], map, tz, firstRow + i), today, all);
      all = readAllTasks_(ctx);
    });
  }
}

/* ── 35_Projects.gs ── */
/**
 * 내 업무관리 키트 — 프로젝트 (완료 모습) · 다음 행동 바로 추가
 *
 * GTD에서 프로젝트는 "끝나면 어떤 모습인가"를 한 줄로 정해 둔다.
 * [프로젝트] 시트는 처음으로 완료 모습을 적을 때 생긴다. 열은 머리글 이름으로 찾는다.
 * 프로젝트 이름은 [업무] 시트의 '프로젝트' 열과 같은 글자로 맞춘다.
 */

var PROJECT_HEADERS = ['프로젝트', '완료 모습', '만든 날'];

/** { 프로젝트 이름: 완료 모습 } */
function readProjectOutcomes_(ss) {
  var sh = ss.getSheetByName(KIT.PROJECT_SHEET);
  if (!sh || sh.getLastRow() < 2) return {};
  var width = Math.max(sh.getLastColumn(), 2);
  var head = sh.getRange(1, 1, 1, width).getValues()[0].map(function (h) { return String(h).trim(); });
  var cName = head.indexOf(PROJECT_HEADERS[0]), cOut = head.indexOf(PROJECT_HEADERS[1]);
  if (cName < 0 || cOut < 0) return {};
  var out = {};
  sh.getRange(2, 1, sh.getLastRow() - 1, width).getValues().forEach(function (r) {
    var n = String(r[cName]).trim();
    if (n) out[n] = String(r[cOut] || '').trim();
  });
  return out;
}

/** 프로젝트 현황(projectStats_)에 완료 모습을 붙인다 */
function withOutcomes_(ss, projects) {
  var o = readProjectOutcomes_(ss);
  return (projects || []).map(function (p) { p.outcome = o[p.name] || ''; return p; });
}

/** 프로젝트 완료 모습 저장 (없으면 시트·줄을 만든다) */
function setProjectOutcome(name, outcome) {
  name = String(name || '').trim();
  outcome = String(outcome || '').trim();
  if (!name) throw new Error('프로젝트 이름을 적어 주세요.');
  return withLock_(function () {
    var ctx = taskContext_();
    var sh = ctx.ss.getSheetByName(KIT.PROJECT_SHEET);
    if (!sh) {
      sh = ctx.ss.insertSheet(KIT.PROJECT_SHEET);
      sh.getRange(1, 1, 1, PROJECT_HEADERS.length).setValues([PROJECT_HEADERS]).setFontWeight('bold').setBackground('#EEEEFF');
      sh.setFrozenRows(1);
      sh.setColumnWidth(1, 180); sh.setColumnWidth(2, 360); sh.setColumnWidth(3, 100);
    }
    var width = Math.max(sh.getLastColumn(), PROJECT_HEADERS.length);
    var head = sh.getRange(1, 1, 1, width).getValues()[0].map(function (h) { return String(h).trim(); });
    // 사용자가 열을 지웠거나 옮겼어도 머리글로 찾고, 없으면 오른쪽에 붙인다
    var col = PROJECT_HEADERS.map(function (h) {
      var i = head.indexOf(h);
      if (i >= 0) return i + 1;
      width++; sh.getRange(1, width).setValue(h); head.push(h); return width;
    });
    var last = sh.getLastRow();
    if (last >= 2) {
      var names = sh.getRange(2, col[0], last - 1, 1).getValues();
      for (var i = 0; i < names.length; i++) {
        if (String(names[i][0]).trim() === name) { sh.getRange(i + 2, col[1]).setValue(outcome); return { ok: true }; }
      }
    }
    sh.getRange(last + 1, col[0]).setValue(name);
    sh.getRange(last + 1, col[1]).setValue(outcome);
    sh.getRange(last + 1, col[2]).setValue(todayYmd_(ctx.tz));
    return { ok: true };
  });
}

/**
 * 수집함을 거치지 않고 바로 '다음 행동'으로 담기 (주간 검토의 프로젝트 단계, 수집함의 프로젝트 만들기).
 * d: { project, context, due } — due가 있으면 그날의 '일정'으로 담는다 (캘린더에서 추가)
 */
function addAction(title, d) {
  d = d || {};
  title = String(title || '').trim();
  if (!title) throw new Error('할 일을 적어 주세요.');
  return withLock_(function () {
    var ctx = taskContext_();
    var today = todayYmd_(ctx.tz);
    var due = ymd_(d.due);
    appendTasks_(ctx, [{ title: title, status: due ? STATUS.SCHEDULED : STATUS.NEXT, due: due, created: today,
      project: String(d.project || '').trim(), context: String(d.context || '').trim() }]);
    return { ok: true };
  });
}

/* ── 40_Dashboard.gs ── */
/**
 * 내 업무관리 키트 — [오늘] 시트
 *
 * 이 시트는 키트가 매번 다시 그린다(시트를 열 때 자동). 사용자는 [업무] 시트만 고치면 된다.
 * 수식은 열 위치를 그릴 때마다 머리글로 다시 찾으므로, 열 순서를 바꿔도 깨지지 않는다.
 */

/** [오늘] 시트가 없거나 열 구성·버전이 바뀌었을 때만 다시 그린다. 수식은 실시간이라 평소엔 그릴 필요 없음 */
function ensureDashboard_(ss) {
  var settings = readSettings_(ss);
  var tasks = getTaskSheet_(ss, settings);
  if (!tasks) return false;
  var sig = KIT.VERSION + '|' + tasks.getName() + '|' + JSON.stringify(getColumnMap_(tasks));
  if (ss.getSheetByName(KIT.DASH_SHEET) && String(settings['대시보드서명']) === sig) return false;
  buildDashboard_(ss);
  writeSetting_(ss, '대시보드서명', sig);
  return true;
}

function buildDashboard_(ss) {
  var settings = readSettings_(ss);
  var tasks = getTaskSheet_(ss, settings);
  if (!tasks) return;
  var map = getColumnMap_(tasks);
  if (!map.title || !map.status) return;

  var sh = ss.getSheetByName(KIT.DASH_SHEET);
  var fresh = false;
  if (!sh) {
    sh = ss.insertSheet(KIT.DASH_SHEET, 0);
    fresh = true;
  }
  sh.clear();
  sh.clearConditionalFormatRules();

  var f = dashboardFormulas_(tasks.getName(), map);

  // 제목
  sh.getRange('A1').setValue('오늘 할 일').setFontSize(18).setFontWeight('bold');
  sh.getRange('A2').setFormula('="' + KIT.NAME + ' v' + KIT.VERSION + ' · "&TEXT(TODAY(),"yyyy-mm-dd (ddd)")');
  sh.getRange('A2').setFontColor('#666666');

  // 숫자 요약
  var tiles = [
    ['★ 오늘 꼭', f.countFocus],
    ['수집함', f.countInbox],
    ['지금 할 일', f.countNow],
    ['마감 지남', f.countOverdue],
    ['확인할 위임', f.countFollowUp],
    ['이번 주 완료', f.countDoneWeek]
  ];
  if (!map.focus) tiles.shift();
  tiles.forEach(function (t, i) {
    var col = 1 + i * 2;
    sh.getRange(4, col).setValue(t[0]).setFontColor('#666666');
    sh.getRange(5, col).setFormula(t[1]).setFontSize(20).setFontWeight('bold').setHorizontalAlignment('left');
  });

  // 목록 (서로 겹치지 않게 가로로 나란히 배치, 사이에 좁은 빈 열 하나)
  var W = { title: 220, date: 95, short: 90, gap: 24 };
  var sections = dashboardSections_(map, f);
  var widths = {}, dateCols = [], c = 1;
  sections.forEach(function (s) {
    sh.getRange(7, c).setValue(s.title).setFontWeight('bold').setFontColor(s.color).setFontSize(12);
    sh.getRange(8, c, 1, s.heads.length).setValues([s.heads])
      .setFontWeight('bold').setBackground('#f1f3f4');
    sh.getRange(9, c).setFormula(s.formula);
    s.kinds.forEach(function (k, i) {
      widths[c + i] = k === 'title' ? (i === 0 && c === 1 ? 260 : W.title) : k === 'date' ? W.date : W.short;
      if (k === 'date') dateCols.push(c + i);
    });
    widths[c + s.heads.length] = W.gap;
    c += s.heads.length + 1;
  });

  // 날짜 표시 형식
  dateCols.forEach(function (n) { var L = colLetter_(n); sh.getRange(L + '9:' + L).setNumberFormat('yyyy-mm-dd'); });

  // 너비
  Object.keys(widths).forEach(function (n) { sh.setColumnWidth(Number(n), widths[n]); });

  sh.getRange('A3').setValue('※ 이 시트는 자동으로 다시 그려집니다. 업무 추가·수정은 [' + tasks.getName() + '] 시트나 메뉴 [내 업무]에서 하세요.')
    .setFontColor('#999999').setFontSize(9);
  sh.setFrozenRows(8);
  if (fresh) sh.setTabColor('#5b5cf6');
}

/** [오늘] 시트의 목록 구역 (순수 함수 — 테스트 대상). 없는 열에 기대는 구역은 빼거나 줄인다 */
function dashboardSections_(map, f) {
  var out = [];
  if (map.focus) out.push({ title: '★ 오늘 꼭 할 일', heads: ['할일', '마감일', '상황'], kinds: ['title', 'date', 'short'], formula: f.listFocus, color: '#d97706' });
  out.push({ title: '지금 할 일', heads: ['할일', '마감일', '상황'], kinds: ['title', 'date', 'short'], formula: f.listNow, color: '#5b5cf6' });
  out.push(map.delegatedOn
    ? { title: '확인할 위임', heads: ['할일', '위임 대상', '맡긴 날', '확인일'], kinds: ['title', 'short', 'date', 'date'], formula: f.listFollowUp, color: '#b45309' }
    : { title: '확인할 위임', heads: ['할일', '위임 대상', '확인일'], kinds: ['title', 'short', 'date'], formula: f.listFollowUp, color: '#b45309' });
  out.push({ title: '마감 지남 · 오늘 마감', heads: ['할일', '마감일', '상태'], kinds: ['title', 'date', 'short'], formula: f.listDue, color: '#b91c1c' });
  out.push({ title: '수집함 (정리 전)', heads: ['할일'], kinds: ['title'], formula: f.listInbox, color: '#a16207' });
  out.push({ title: '오늘의 루틴', heads: ['루틴', '반복'], kinds: ['title', 'short'], formula: f.listRoutine, color: '#5b5cf6' });
  if (map.project) out.push({ title: '프로젝트', heads: ['프로젝트', '남은 일', '멈춤'], kinds: ['title', 'short', 'short'], formula: f.listProjects, color: '#6b4fbb' });
  return out;
}

/** 대시보드 수식 문자열 생성 (순수 함수 — 테스트 대상) */
function dashboardFormulas_(sheetName, map) {
  var q = "'" + String(sheetName).replace(/'/g, "''") + "'!";
  var col = function (key) {
    if (!map[key]) return null;
    var L = colLetter_(map[key]);
    return q + L + '2:' + L;
  };
  var title = col('title'), status = col('status');
  var due = col('due') || title, context = col('context') || title;
  var delegatee = col('delegatee') || title, followUp = col('followUp') || title;
  var completed = col('completed');
  var repeat = col('repeat');
  var focus = col('focus'), delegatedOn = col('delegatedOn'), project = col('project');
  var hasDue = !!map.due, hasFollow = !!map.followUp;

  var st = function (s) { return '(' + status + '="' + s + '")'; };
  var nonEmpty = '(' + title + '<>"")';
  var open = '(' + status + '<>"' + STATUS.DONE + '")*(' + status + '<>"' + STATUS.DROPPED + '")*(' + status + '<>"' + STATUS.SOMEDAY + '")*(' + status + '<>"' + STATUS.REFERENCE + '")';
  var dueReached = hasDue ? '(' + due + '<>"")*(' + due + '<=TODAY())' : '0';
  var dueOver = hasDue ? '(' + due + '<>"")*(' + due + '<TODAY())' : '0';
  var followReached = hasFollow ? '(' + followUp + '<>"")*(' + followUp + '<=TODAY())' : '0';

  var nowCond = nonEmpty + '*(' + st(STATUS.NEXT) + '+' + st(STATUS.SCHEDULED) + '*' + dueReached + '>0)';
  var followCond = nonEmpty + '*' + st(STATUS.DELEGATED) + '*' + followReached;
  var dueCond = nonEmpty + '*' + open + '*' + dueReached;
  var inboxCond = nonEmpty + '*(' + st(STATUS.INBOX) + '+(' + status + '=""))';
  // ★ 오늘 꼭 할 일: '오늘 할 날'이 오늘이거나 지난 열린 일 (위임한 일은 '확인할 위임'에서 본다)
  var focusCond = focus
    ? nonEmpty + '*' + open + '*(' + status + '<>"' + STATUS.DELEGATED + '")*(' + focus + '<>"")*(' + focus + '<=TODAY())'
    : null;

  var empty = '"없음"';
  var weekStart = '(TODAY()-WEEKDAY(TODAY(),3))';

  return {
    countInbox: '=SUMPRODUCT(' + inboxCond + ')',
    countNow: '=SUMPRODUCT(' + nowCond + ')',
    countOverdue: '=SUMPRODUCT(' + nonEmpty + '*' + open + '*' + dueOver + ')',
    countFollowUp: '=SUMPRODUCT(' + followCond + ')',
    countDoneWeek: completed
      ? '=SUMPRODUCT(' + nonEmpty + '*' + st(STATUS.DONE) + '*(' + completed + '<>"")*(' + completed + '>=' + weekStart + '))'
      : '=0',
    listNow: '=IFERROR(SORT(FILTER({' + title + ',' + due + ',' + context + '},' + nowCond + '),2,TRUE),' + empty + ')',
    countFocus: focusCond ? '=SUMPRODUCT(' + focusCond + ')' : '=0',
    listFocus: focusCond
      ? '=IFERROR(SORT(FILTER({' + title + ',' + due + ',' + context + '},' + focusCond + '),2,TRUE),' + empty + ')'
      : '="오늘 할 날 열 없음"',
    listFollowUp: delegatedOn
      ? '=IFERROR(SORT(FILTER({' + title + ',' + delegatee + ',' + delegatedOn + ',' + followUp + '},' + followCond + '),4,TRUE),' + empty + ')'
      : '=IFERROR(SORT(FILTER({' + title + ',' + delegatee + ',' + followUp + '},' + followCond + '),3,TRUE),' + empty + ')',
    listDue: '=IFERROR(SORT(FILTER({' + title + ',' + due + ',' + status + '},' + dueCond + '),2,TRUE),' + empty + ')',
    listInbox: '=IFERROR(FILTER(' + title + ',' + inboxCond + '),' + empty + ')',
    listRoutine: repeat
      ? '=IFERROR(FILTER({' + title + ',' + repeat + '},' + nonEmpty + '*(' + repeat + '<>"")*' + open + '*((' + (hasDue ? due : title) + '="")+' + dueReached + '>0)),' + empty + ')'
      : '="반복 열 없음"',
    listProjects: project ? projectListFormula_(title, status, project, nonEmpty, open, empty) : '="프로젝트 열 없음"'
  };
}

/**
 * 프로젝트 목록: 열린 일이 있는 프로젝트 이름 · 남은 일 수 · 멈춤 표시.
 * 멈춤 = 다음 행동·일정·위임이 하나도 없음 (주간 검토 projectStats_ 와 같은 기준)
 */
function projectListFormula_(title, status, project, nonEmpty, open, empty) {
  var c = function (extra) { return 'COUNTIFS(' + project + ',p,' + title + ',"<>"' + extra + ')'; };
  var notClosed = [STATUS.DONE, STATUS.DROPPED, STATUS.SOMEDAY, STATUS.REFERENCE]
    .map(function (s) { return ',' + status + ',"<>' + s + '"'; }).join('');
  var moving = [STATUS.NEXT, STATUS.SCHEDULED, STATUS.DELEGATED]
    .map(function (s) { return c(',' + status + ',"' + s + '"'); }).join('+');
  return '=IFERROR(ARRAYFORMULA(LET(p,SORT(UNIQUE(FILTER(' + project + ',' + nonEmpty + '*' + open + '*(' + project + '<>"")))),' +
    '{p,' + c(notClosed) + ',IF(' + moving + '=0,"멈춤","")})),' + empty + ')';
}

/* ── 50_Weekly.gs ── */
/** 내 업무관리 키트 — 주간 검토 메일 (매주 금요일, 나에게만) */

/** 업무 목록 → 주간 검토 요약 (순수 함수 — 테스트 대상) */
function buildWeeklySummary_(tasks, today) {
  var weekStart = weekStartYmd_(today);
  var nextWeekEnd = addDaysYmd_(weekStart, 13);
  var byDue = function (a, b) { return (a.due || '9999') < (b.due || '9999') ? -1 : (a.due || '9999') > (b.due || '9999') ? 1 : 0; };
  var open = function (t) { return isActionable_(t.status); };

  return {
    today: today,
    weekStart: weekStart,
    done: tasks.filter(function (t) { return t.status === STATUS.DONE && t.completed && t.completed >= weekStart && t.completed <= today; }),
    next: tasks.filter(function (t) { return t.status === STATUS.NEXT; }).sort(byDue),
    overdue: tasks.filter(function (t) { return open(t) && t.due && t.due < today; }).sort(byDue),
    followUp: tasks.filter(function (t) { return t.status === STATUS.DELEGATED && t.followUp && t.followUp <= today; })
      .sort(function (a, b) { return a.followUp < b.followUp ? -1 : 1; }),
    delegated: tasks.filter(function (t) { return t.status === STATUS.DELEGATED; }),
    upcoming: tasks.filter(function (t) { return open(t) && t.due && t.due > today && t.due <= nextWeekEnd; }).sort(byDue),
    inbox: tasks.filter(function (t) { return t.status === STATUS.INBOX || t.status === ''; }),
    someday: tasks.filter(function (t) { return t.status === STATUS.SOMEDAY; }),
    routineDone: routineStats_(tasks, weekStart, today),
    projects: projectStats_(tasks),
    reference: tasks.filter(function (t) { return t.status === STATUS.REFERENCE; })
  };
}

/**
 * 프로젝트별 현황. '다음 행동'이 하나도 없는 열린 프로젝트는 멈춘 프로젝트(stalled)로 표시한다.
 * (일정·위임만 있으면 기다리는 중이므로 멈춘 것으로 보지 않는다)
 */
function projectStats_(tasks) {
  var by = {}, order = [];
  tasks.forEach(function (t) {
    if (!t.project) return;
    if (!by[t.project]) { by[t.project] = { name: t.project, open: 0, done: 0, next: 0, waiting: 0 }; order.push(t.project); }
    var g = by[t.project];
    if (t.status === STATUS.DONE) g.done++;
    else if (isActionable_(t.status)) {
      g.open++;
      if (t.status === STATUS.NEXT) g.next++;
      if (t.status === STATUS.DELEGATED || t.status === STATUS.SCHEDULED) g.waiting++;
    }
  });
  return order.map(function (k) { var g = by[k]; g.stalled = g.open > 0 ? g.next === 0 && g.waiting === 0 : false; g.finished = g.open === 0; return g; });
}

/** 이번 주 루틴 달성: 반복 업무를 제목별로 완료·건너뜀 횟수 집계 */
function routineStats_(tasks, weekStart, today) {
  var by = {}, order = [];
  tasks.forEach(function (t) {
    if (!t.repeat) return;
    if (!by[t.title]) { by[t.title] = { title: t.title, repeat: t.repeat, done: 0, skipped: 0, nextDue: '' }; order.push(t.title); }
    var g = by[t.title];
    if (t.status === STATUS.DONE && t.completed >= weekStart && t.completed <= today) g.done++;
    if (t.status === STATUS.DROPPED && t.created >= weekStart) g.skipped++;
    if (!isClosedStatus_(t.status) && t.due && (!g.nextDue || t.due < g.nextDue)) g.nextDue = t.due;
  });
  return order.map(function (k) { return by[k]; });
}

function renderWeeklyHtml_(s, sheetUrl) {
  var li = function (t, extra) {
    return '<li>' + escapeHtml_(t.title) + (extra ? ' <span style="color:#888">' + escapeHtml_(extra) + '</span>' : '') + '</li>';
  };
  var block = function (title, color, items, fmt, emptyText, limit) {
    limit = limit || 15;
    var body = items.length
      ? '<ul style="margin:6px 0 0;padding-left:20px">' + items.slice(0, limit).map(fmt).join('') +
        (items.length > limit ? '<li style="color:#888">외 ' + (items.length - limit) + '건</li>' : '') + '</ul>'
      : '<p style="margin:6px 0 0;color:#888">' + emptyText + '</p>';
    return '<h3 style="margin:22px 0 0;font-size:15px;color:' + color + '">' + title + ' (' + items.length + ')</h3>' + body;
  };
  var stat = function (label, n) {
    return '<td style="padding:10px 14px;background:#F4F4FF;border-radius:8px;text-align:center">' +
      '<div style="font-size:22px;font-weight:bold">' + n + '</div><div style="font-size:12px;color:#666">' + label + '</div></td>';
  };

  return '<div style="font-family:Apple SD Gothic Neo,Malgun Gothic,sans-serif;max-width:640px;color:#222;line-height:1.5">' +
    '<h2 style="margin:0;color:#5b5cf6">이번 주 검토 · ' + s.today + '</h2>' +
    '<p style="margin:6px 0 16px;color:#555">10분만 내서 아래 순서로 보세요: 수집함 비우기 → 확인할 위임 챙기기 → 다음 주 할 일 고르기.</p>' +
    '<table style="border-collapse:separate;border-spacing:6px"><tr>' +
    stat('이번 주 완료', s.done.length) + stat('수집함', s.inbox.length) + stat('마감 지남', s.overdue.length) +
    stat('확인할 위임', s.followUp.length) + '</tr></table>' +
    block('① 수집함 — 아직 정리 안 됨', '#a16207', s.inbox, function (t) { return li(t, t.created); }, '비어 있습니다. 좋습니다!') +
    block('② 확인할 위임', '#b45309', s.followUp, function (t) { return li(t, t.delegatee + ' · ' + t.followUp); }, '확인할 위임이 없습니다.') +
    block('③ 마감 지남', '#b91c1c', s.overdue, function (t) { return li(t, t.due); }, '마감 지난 일이 없습니다.') +
    block('④ 다음 2주 마감', '#1d4ed8', s.upcoming, function (t) { return li(t, t.due); }, '다가오는 마감이 없습니다.') +
    block('⑤ 다음 행동', '#5b5cf6', s.next, function (t) { return li(t, [t.due, t.context].filter(String).join(' · ')); }, '다음 행동이 없습니다.') +
    block('📁 다음 행동이 없는 프로젝트', '#6B4FBB', s.projects.filter(function (p) { return p.stalled; }), function (p) { return '<li>' + escapeHtml_(p.name) + ' <span style="color:#888">남은 일 ' + p.open + '건 — 다음 행동을 하나 정하세요</span></li>'; }, '멈춘 프로젝트가 없습니다.') +
    block('🔁 이번 주 루틴', '#5b5cf6', s.routineDone, function (r) { return li(r, r.repeat + ' · 완료 ' + r.done + '회' + (r.skipped ? ' · 건너뜀 ' + r.skipped + '회' : '') + (r.nextDue ? ' · 다음 ' + r.nextDue : '')); }, '등록된 루틴이 없습니다.') +
    block('이번 주에 끝낸 일', '#555', s.done, function (t) { return li(t, t.completed); }, '이번 주 완료 기록이 없습니다.', 30) +
    '<p style="margin:22px 0 0;font-size:13px;color:#666">언젠가 목록 ' + s.someday.length + '건 · 맡긴 일 ' + s.delegated.length + '건</p>' +
    (sheetUrl ? '<p style="margin:16px 0 0"><a href="' + escapeHtml_(sheetUrl) + '" style="background:#5b5cf6;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">내 업무 시트 열기</a></p>' : '') +
    '<p style="margin:24px 0 0;font-size:11px;color:#aaa">' + KIT.NAME + ' v' + KIT.VERSION + ' · 이 메일은 내 구글 시트에서 나에게만 보낸 것입니다.</p>' +
    '</div>';
}

/**
 * 트리거·메뉴에서 부르는 공개 함수. 이름을 바꾸지 말 것(예전 트리거가 이 이름을 부른다).
 */
function sendWeeklyReview() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var settings = readSettings_(ss);
  var sheet = getTaskSheet_(ss, settings);
  if (!sheet) return { sent: false, reason: '업무 시트가 없습니다.' };
  var ctx = { ss: ss, sheet: sheet, map: getColumnMap_(sheet), tz: ss.getSpreadsheetTimeZone() };
  var today = todayYmd_(ctx.tz);
  var summary = buildWeeklySummary_(readAllTasks_(ctx), today);
  var to = Session.getEffectiveUser().getEmail();
  if (!to) return { sent: false, reason: '받는 사람 이메일을 확인하지 못했습니다.' };
  MailApp.sendEmail({
    to: to,
    subject: '[내 업무] 주간 검토 · ' + today + ' (수집함 ' + summary.inbox.length + ' · 확인할 위임 ' + summary.followUp.length + ')',
    htmlBody: renderWeeklyHtml_(summary, ss.getUrl()),
    name: KIT.NAME
  });
  writeSetting_(ss, '주간메일_마지막발송', today);
  return { sent: true, to: to };
}

function setWeeklyTrigger_(on) {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === KIT.WEEKLY_HANDLER) ScriptApp.deleteTrigger(t);
  });
  if (on) {
    ScriptApp.newTrigger(KIT.WEEKLY_HANDLER).timeBased()
      .onWeekDay(ScriptApp.WeekDay.FRIDAY).atHour(KIT.WEEKLY_HOUR).create();
  }
  writeSetting_(SpreadsheetApp.getActiveSpreadsheet(), '주간메일', on ? '켜짐' : '꺼짐');
}

function isWeeklyOn_() {
  return ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === KIT.WEEKLY_HANDLER; });
}

/* ── 55_Daily.gs ── */
/** 내 업무관리 키트 — 아침 브리핑 메일 (평일 아침, 나에게만) */

var DAILY_HANDLER = 'sendDailyBriefing';
var DAILY_HOUR = 8;

/** 오늘 화면 데이터 → 메일 HTML (순수 함수 — 테스트 대상) */
function renderDailyHtml_(v, link) {
  var esc = escapeHtml_;
  var list = (v.focus || []).concat(v.routines || [], v.now || []);
  var item = function (t, tail) {
    return '<tr><td style="padding:12px 0;border-bottom:1px solid #F2F4F6;font-size:16px;font-weight:600;color:#191F28">' +
      (t.focus && t.focus <= v.today ? '<span style="color:#F2A20C">★ </span>' : '') + esc(t.title) +
      (tail ? '<div style="font-size:13px;color:#6B7684;font-weight:500;margin-top:3px">' + esc(tail) + '</div>' : '') + '</td></tr>';
  };
  var section = function (title, rows) {
    return rows ? '<div style="font-size:14px;font-weight:700;color:#6B7684;margin:26px 0 4px">' + title + '</div><table style="width:100%;border-collapse:collapse">' + rows + '</table>' : '';
  };
  var due = function (t) { return t.due ? (t.due < v.today ? '마감 지남 ' + t.due.slice(5) : t.due === v.today ? '오늘 마감' : '') : ''; };
  var ev = ((v.events && v.events.items) || []).map(function (e) { return item({ title: e.title }, e.allDay ? '종일' : e.start + ' – ' + e.end); }).join('');
  var dt = v.today.split('-');
  return '<div style="font-family:Pretendard,-apple-system,\'Apple SD Gothic Neo\',\'Malgun Gothic\',sans-serif;max-width:520px;margin:0 auto;padding:28px 22px;background:#fff;color:#191F28">' +
    '<div style="font-size:14px;color:#6B7684;font-weight:600">' + (+dt[1]) + '월 ' + (+dt[2]) + '일 아침 브리핑</div>' +
    '<div style="font-size:28px;font-weight:800;letter-spacing:-0.03em;margin-top:4px">' + (list.length ? '오늘 할 일 <span style="color:#5B5CF6">' + list.length + '개</span>' : '오늘은 여유로워요') + '</div>' +
    (v.counts && v.counts.inbox ? '<div style="margin-top:10px;font-size:15px;color:#C27C00;font-weight:600">수집함에 정리할 일 ' + v.counts.inbox + '개가 있어요</div>' : '') +
    section('오늘 일정', ev) +
    section('할 일', list.slice(0, 12).map(function (t) { return item(t, [t.repeat ? '반복 · ' + t.repeat : '', due(t)].filter(String).join(' · ')); }).join('')) +
    section('확인할 맡긴 일', (v.followUp || []).map(function (t) { return item(t, (t.delegatee || '') + ' · 확인일 ' + (t.followUp || '').slice(5)); }).join('')) +
    (link ? '<a href="' + esc(link) + '" style="display:block;margin-top:28px;background:#5B5CF6;color:#fff;text-align:center;padding:16px;border-radius:14px;font-weight:700;font-size:16px;text-decoration:none">오늘 할 일 열기</a>' : '') +
    '<div style="margin-top:22px;font-size:12px;color:#A3ACB6">' + escapeHtml_(KIT.NAME) + ' · 내 구글 시트에서 나에게만 보낸 메일이에요. 끄려면 앱 ▸ 더보기 ▸ 알림.</div></div>';
}

/** 트리거가 부르는 공개 함수. 이름을 바꾸지 말 것. 주말에는 보내지 않는다. */
function sendDailyBriefing(force) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ctx = taskContext_();
  var today = todayYmd_(ctx.tz);
  var dow = dowOf_(today);
  if (!force && (dow === 0 || dow === 6)) return { sent: false, reason: '주말' };
  var v = buildAppView_(ctx, today);
  var to = Session.getEffectiveUser().getEmail();
  if (!to) return { sent: false, reason: '받는 사람 이메일을 확인하지 못했습니다.' };
  var n = (v.focus || []).length + (v.routines || []).length + (v.now || []).length;
  MailApp.sendEmail({ to: to, subject: '[내 업무] 오늘 할 일 ' + n + '개' + ((v.followUp || []).length ? ' · 확인할 맡긴 일 ' + v.followUp.length + '개' : ''),
    htmlBody: renderDailyHtml_(v, webAppLink_(ss)), name: KIT.NAME });
  return { sent: true, to: to };
}

function setDailyTrigger_(on) {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === DAILY_HANDLER) ScriptApp.deleteTrigger(t); });
  if (on) ScriptApp.newTrigger(DAILY_HANDLER).timeBased().everyDays(1).atHour(DAILY_HOUR).create();
  writeSetting_(SpreadsheetApp.getActiveSpreadsheet(), '아침알림', on ? '켜짐' : '꺼짐');
}

/* ── 60_Menu.gs ── */
/**
 * 내 업무관리 키트 — 메뉴·트리거 진입점
 * 여기 있는 공개 함수 이름(onOpen, onEdit, menu*)은 바꾸지 말 것.
 */

function onOpen(e) {
  SpreadsheetApp.getUi().createMenu('✅ 내 업무')
    .addItem('📥 빠른 수집 (사이드바)', 'menuOpenSidebar')
    .addItem('📱 휴대폰·웹 화면 링크', 'menuShowWebLink')
    .addItem('🔑 휴대폰 링크 새로 만들기', 'menuRotateWebLink')
    .addItem('🔄 [오늘] 시트 새로 그리기', 'menuRefreshDashboard')
    .addSeparator()
    .addItem('📧 주간 검토 메일 지금 받기', 'menuWeeklyNow')
    .addItem('⏰ 주간 검토 메일 켜기 (매주 금요일)', 'menuWeeklyOn')
    .addItem('🔕 주간 검토 메일 끄기', 'menuWeeklyOff')
    .addSeparator()
    .addItem('⚙️ 처음 설정 / 업데이트 적용', 'menuSetup')
    .addItem('🧪 예시 업무 넣기 (빈 시트일 때만)', 'menuInsertSamples')
    .addItem('🐞 문제 제보 · 처리 확인', 'menuReport')
    .addItem('ℹ️ 버전 정보·도움말', 'menuAbout')
    .addToUi();

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  try {
    var settings = readSettings_(ss);
    if (!settings['시트버전']) {
      if (hasKitHeaders_(ss, settings)) {
        // 업무 시트는 있는데 설치가 끝나지 않은 상태(외부에서 데이터를 미리 채운 원본 등): 마무리만 한다
        ensureSchema_(ss);
        buildDashboard_(ss);
        return;
      }
      if (isBlankSpreadsheet_(ss)) {
        // 빈 새 시트: 자동으로 설치하고 예시 업무까지 넣는다 (권한 승인 없이 동작)
        ensureSchema_(ss);
        insertSampleTasks_(ss, false);
        buildDashboard_(ss);
        removeEmptyDefaultSheets_(ss);
        ss.setActiveSheet(ss.getSheetByName(KIT.DASH_SHEET));
        ss.toast('준비됐습니다! 예시 업무를 넣어 두었어요. 메뉴 [✅ 내 업무 ▸ 📱 휴대폰·웹 화면 링크]로 앱 화면을 열어 보세요.', KIT.NAME, 12);
      } else {
        ss.toast('메뉴 [✅ 내 업무 ▸ ⚙️ 처음 설정]을 한 번 눌러 주세요.', KIT.NAME, 10);
      }
      return;
    }
    var r = ensureSchema_(ss); // 새 코드를 붙여 넣었으면 여기서 시트가 자동으로 맞춰진다
    ensureDashboard_(ss);      // 바뀐 게 있을 때만 다시 그림 (여는 속도)
    if (r.from !== r.to || r.addedColumns.length) {
      ss.toast('v' + KIT.VERSION + ' 업데이트를 적용했습니다. 기존 데이터는 그대로입니다.', KIT.NAME, 8);
    }
  } catch (err) {
    ss.toast(String(err.message || err), KIT.NAME + ' 알림', 15);
  }
}

/** 업무 시트가 있고 키트 열(할일·상태)이 이미 있는가 */
function hasKitHeaders_(ss, settings) {
  var sh = getTaskSheet_(ss, settings);
  if (!sh) return false;
  var map = getColumnMap_(sh);
  return !!(map.title && map.status);
}

/** 키트가 아직 없고, 시트가 전부 비어 있는 새 스프레드시트인가 */
function isBlankSpreadsheet_(ss) {
  return ss.getSheets().every(function (sh) { return sh.getLastRow() === 0 && sh.getLastColumn() === 0; });
}

/** 새 스프레드시트에 기본으로 생기는 빈 '시트1'/'Sheet1'을 정리 (내용이 있으면 두지 않고 건드리지 않음) */
function removeEmptyDefaultSheets_(ss) {
  ss.getSheets().forEach(function (sh) {
    var name = sh.getName();
    if (/^(Sheet|시트)\s?\d+$/.test(name) && sh.getLastRow() === 0 && sh.getLastColumn() === 0 && ss.getSheets().length > 1) {
      ss.deleteSheet(sh);
    }
  });
}

function onEdit(e) {
  try { handleEdit_(e); } catch (err) { console.error(err); }
}

function menuOpenSidebar() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!isSchemaCurrent_(ss)) ensureSchema_(ss);
  var html = HtmlService.createTemplateFromFile('Sidebar');
  html.kitName = KIT.NAME;
  html.kitVersion = KIT.VERSION;
  html.status = STATUS;
  html.webLink = webAppLink_(ss);
  SpreadsheetApp.getUi().showSidebar(html.evaluate().setTitle(KIT.NAME));
}

function menuRefreshDashboard() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureSchema_(ss);
  buildDashboard_(ss);
  ss.setActiveSheet(ss.getSheetByName(KIT.DASH_SHEET));
  ss.toast('[오늘] 시트를 새로 그렸습니다.', KIT.NAME, 4);
}

function menuSetup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ui = null;
  try { ui = SpreadsheetApp.getUi(); } catch (e) {} // 편집기에서 직접 실행하면 화면이 없다 → 로그로 알린다
  var r = ensureSchema_(ss);
  buildDashboard_(ss);
  var lines = [];
  if (r.created) lines.push('· [' + KIT.TASK_SHEET + '] 시트를 만들었습니다.');
  if (r.addedColumns.length && !r.created) lines.push('· 새 열을 오른쪽 끝에 추가했습니다: ' + r.addedColumns.join(', '));
  if (r.from && r.from !== r.to) lines.push('· 시트 구조를 v' + r.from + ' → v' + r.to + '로 업데이트했습니다.');
  if (!lines.length) lines.push('· 이미 최신입니다. 바뀐 것이 없습니다.');
  lines.push('');
  lines.push('기존에 적어 둔 업무와 직접 추가한 열은 그대로 둡니다.');
  lines.push('이제 메뉴 [✅ 내 업무 ▸ 📱 휴대폰·웹 화면 링크]로 앱 화면을 열어 시작하세요.');
  if (ui) ui.alert(KIT.NAME + ' v' + KIT.VERSION, lines.join('\n'), ui.ButtonSet.OK);
  else console.log(lines.join('\n'));
  return lines.join('\n');
}

function menuWeeklyNow() {
  var r = sendWeeklyReview();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.toast(r.sent ? r.to + ' 로 보냈습니다.' : r.reason, KIT.NAME, 6);
}

function menuWeeklyOn() {
  setWeeklyTrigger_(true);
  SpreadsheetApp.getUi().alert('주간 검토 메일을 켰습니다.\n매주 금요일 ' + KIT.WEEKLY_HOUR + '시쯤 나에게만 보냅니다.');
}

function menuWeeklyOff() {
  setWeeklyTrigger_(false);
  SpreadsheetApp.getUi().alert('주간 검토 메일을 껐습니다.');
}

/** 메뉴: 제보 게시판 열기 (버전을 미리 채워서) */
function menuReport() {
  var page = KIT.WEB_PAGE_URL || 'https://kkokio88-creator.github.io/my-task-kit/';
  var url = page.replace(/\/?$/, '/') + 'board.html?from=sheet&v=' + encodeURIComponent(KIT.VERSION);
  var html = HtmlService.createHtmlOutput('<div style="font-family:sans-serif;padding:8px 4px;line-height:1.6">' +
    '<p style="margin:0 0 14px">불편하거나 안 되는 걸 알려 주세요. 처리 상태도 게시판에서 볼 수 있어요.</p>' +
    '<a href="' + url + '" target="_blank" style="display:inline-block;background:#5B5CF6;color:#fff;padding:12px 18px;border-radius:12px;text-decoration:none;font-weight:700">제보 게시판 열기</a></div>')
    .setWidth(360).setHeight(150);
  SpreadsheetApp.getUi().showModalDialog(html, '문제 제보');
}

function menuAbout() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var s = readSettings_(ss);
  var ui = SpreadsheetApp.getUi();
  ui.alert(KIT.NAME,
    '코드 버전: v' + KIT.VERSION + '\n' +
    '시트 구조: v' + (s['시트버전'] || '-') + ' (코드 기준 v' + KIT.SCHEMA_VERSION + ')\n' +
    '설치일: ' + (ymd_(s['설치일'], ss.getSpreadsheetTimeZone()) || '-') + '\n' +
    '주간 메일: ' + (isWeeklyOn_() ? '켜짐 (매주 금요일)' : '꺼짐') + '\n\n' +
    '사용 순서\n' +
    '1) 떠오르는 일은 전부 [수집하기]에 한 줄씩 적습니다.\n' +
    '2) 하루 한 번 [정리하기]로 수집함을 비웁니다.\n' +
    '   2분 안에 끝나면 바로 하고 완료, 남이 할 일은 위임, 날짜가 정해진 일은 일정.\n' +
    '3) [오늘] 시트에서 지금 할 일과 확인할 위임을 봅니다.\n' +
    '4) 금요일엔 주간 검토 메일로 한 주를 정리합니다.\n\n' +
    '새 버전으로 업데이트해도 이 시트의 데이터는 그대로 유지됩니다.',
    ui.ButtonSet.OK);
}

/* ── 70_Sample.gs ── */
/**
 * 내 업무관리 키트 — 예시 업무 (처음 써 보는 사람·영상 시연용)
 * 업무 시트가 비어 있을 때만 넣는다. 실제 데이터 위에 덮어쓰지 않는다.
 */

/** 날짜는 오늘 기준 상대값(일). 순수 함수 — 테스트 대상 */
function sampleTasks_(today) {
  var d = function (n) { return addDaysYmd_(today, n); };
  return [
    { title: '거래처 견적서 비교표 만들기', status: STATUS.INBOX, created: d(0) },
    { title: '다음 달 워크숍 장소 알아보기', status: STATUS.INBOX, created: d(0) },
    { title: '노트북 배터리 교체 문의', status: STATUS.INBOX, created: d(-1) },
    { title: '주간회의 안건 3개 정리해서 공유', status: STATUS.NEXT, context: '@컴퓨터', due: d(1), created: d(-2) },
    { title: '세무사님께 부가세 자료 일정 전화로 확인', status: STATUS.NEXT, context: '@전화', created: d(-1) },
    { title: '분기 보고서 초안 목차 쓰기', status: STATUS.NEXT, context: '@컴퓨터', due: d(-1), created: d(-6) },
    { title: '신규 입사자 계정 발급 요청', status: STATUS.DELEGATED, delegatee: '김대리', followUp: d(-1), created: d(-4) },
    { title: '홈페이지 배너 시안 받기', status: STATUS.DELEGATED, delegatee: '디자인 외주', followUp: d(3), due: d(7), created: d(-2) },
    { title: '건강검진 예약', status: STATUS.SCHEDULED, due: d(0), created: d(-5) },
    { title: '연말정산 서류 챙기기', status: STATUS.SCHEDULED, due: d(14), created: d(-3) },
    { title: '엑셀 피벗테이블 제대로 배우기', status: STATUS.SOMEDAY, created: d(-10) },
    { title: '사무실 프린터 토너 주문', status: STATUS.DONE, created: d(-3), completed: d(-1) },
    { title: '지난주 회의록 공유', status: STATUS.DONE, created: d(-4), completed: d(-2) },
    { title: '받은 메일함 정리', status: STATUS.SCHEDULED, due: d(0), context: '@컴퓨터', repeat: '평일', created: d(-7) },
    { title: '주간 경비 정산', status: STATUS.SCHEDULED, due: d(3), repeat: '매주 목', created: d(-7) }
  ];
}

/** 메뉴에서 부르는 공개 함수 (이름 바꾸지 말 것) */
function menuInsertSamples() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureSchema_(ss);
  var r = insertSampleTasks_(ss, true);
  buildDashboard_(ss);
  ss.toast(r.added ? '예시 업무 ' + r.added + '건을 넣었습니다. [오늘] 시트를 보세요.' : r.reason, KIT.NAME, 8);
}

/** @param useLock 메뉴에서 부를 땐 true. onOpen(단순 트리거)에서는 false */
function insertSampleTasks_(ss, useLock) {
  var run = function () {
    var ctx = taskContext_();
    if (readAllTasks_(ctx).length) return { added: 0, reason: '이미 업무가 있어서 예시를 넣지 않았습니다.' };
    var width = ctx.sheet.getLastColumn();
    var rows = sampleTasks_(todayYmd_(ctx.tz)).map(function (t, i) {
      var r = new Array(width);
      for (var k = 0; k < width; k++) r[k] = '';
      Object.keys(t).forEach(function (key) { if (ctx.map[key]) r[ctx.map[key] - 1] = t[key]; });
      if (ctx.map.id) r[ctx.map.id - 1] = newId_(i + 1);
      return r;
    });
    ctx.sheet.getRange(2, 1, rows.length, width).setValues(rows);
    return { added: rows.length };
  };
  return useLock === false ? run() : withLock_(run);
}

/* ── 80_WebApp.gs ── */
/**
 * 내 업무관리 키트 — 웹앱 (휴대폰·PC 브라우저에서 여는 화면)
 * 시트 모바일 앱은 앱스크립트를 실행하지 않으므로, 휴대폰에서는 이 웹앱 링크로 쓴다.
 * 공개 함수 이름(doGet, getAppData, completeTask, postponeFollowUp, installFromEditor)은 바꾸지 말 것.
 */

function doGet(e) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var key = (e && e.parameter && e.parameter.k) || '';
  if (!ss || (KIT.WEB_KEY_REQUIRED && (!key || key !== getWebKey_(ss)))) {
    return HtmlService.createHtmlOutput(
      '<div style="font-family:sans-serif;padding:40px 20px;text-align:center;color:#555">' +
      '<h2 style="color:#5B5CF6">링크를 확인해 주세요</h2>' +
      '<p>내 업무 웹앱은 개인 링크(끝에 ?k=…가 붙은 주소)로만 열립니다.<br>시트 메뉴 [✅ 내 업무 ▸ 📱 휴대폰 링크 보기]에서 확인하세요.</p></div>')
      .setTitle(KIT.NAME).addMetaTag('viewport', 'width=device-width, initial-scale=1');
  }
  var t = HtmlService.createTemplateFromFile('App');
  t.kitName = KIT.NAME;
  t.kitVersion = KIT.VERSION;
  t.status = STATUS;
  t.webKey = key;
  var initial = null;
  try { initial = getAppData(); } catch (err) { initial = null; }
  t.initialJson = JSON.stringify(initial).replace(/</g, '\\u003c');
  return t.evaluate()
    .setTitle(KIT.NAME)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1');
}

/**
 * 웹앱 개인 키. 시트마다 다르고 [_설정]에 저장한다.
 * 원본을 복사한 사본이면(시트 ID가 달라지면) 새 키를 만든다 → 원본 키로는 사본에 못 들어간다.
 */
function getWebKey_(ss) {
  var s = readSettings_(ss);
  if (s['웹앱키'] && String(s['웹앱키_시트']) === ss.getId()) return String(s['웹앱키']);
  return rotateWebKey_(ss);
}

/** 새 개인 키를 만든다. 예전 링크는 즉시 막힌다. */
function rotateWebKey_(ss) {
  var key = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '').slice(0, 8);
  writeSetting_(ss, '웹앱키', key);
  writeSetting_(ss, '웹앱키_시트', ss.getId());
  return key;
}

var EXEC_URL_RE_ = /^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/;

/** 웹앱 주소: 사용자가 [_설정]에 저장한 주소(배포할 때 받은 …/exec). 사본이면 무효(사본은 자기 배포가 필요). */
function savedExecUrl_(ss) {
  var s = readSettings_(ss);
  var url = String(s['웹앱주소'] || '').trim();
  return EXEC_URL_RE_.test(url) && String(s['웹앱주소_시트']) === ss.getId() ? url : '';
}

/** 올바른 키로 웹앱이 불렸으면, 그 배포 주소(…/exec)를 기억해 둔다 (시트 메뉴 링크용) */
function rememberExecUrl_(ss) {
  if (savedExecUrl_(ss)) return;
  try {
    var url = ScriptApp.getService().getUrl();
    if (url && EXEC_URL_RE_.test(url)) { writeSetting_(ss, '웹앱주소', url); writeSetting_(ss, '웹앱주소_시트', ss.getId()); }
  } catch (e) { /* 주소를 못 얻으면 사용자가 설정 창에서 붙여 넣는다 */ }
}

/** 설치 안내 창에서 부르는 공개 함수: 배포한 웹앱 주소 저장 */
function saveWebAppUrl(url) {
  url = String(url || '').trim().replace(/\?.*$/, '').replace(/\/dev$/, '/exec');
  if (!EXEC_URL_RE_.test(url)) throw new Error('웹 앱 URL 형식이 아니에요. https://script.google.com/macros/s/…/exec 를 붙여 넣어 주세요.');
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  writeSetting_(ss, '웹앱주소', url);
  writeSetting_(ss, '웹앱주소_시트', ss.getId());
  return { link: webAppLink_(ss) };
}

function webAppLink_(ss) {
  var url = savedExecUrl_(ss);
  if (!url) return '';
  url = url.replace(/\/dev$/, '/exec');
  if (KIT.WEB_PAGE_URL) return KIT.WEB_PAGE_URL + '#api=' + encodeURIComponent(url) + '&k=' + getWebKey_(ss);
  return KIT.WEB_KEY_REQUIRED ? url + '?k=' + getWebKey_(ss) : url;
}

function checkKey_(k) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('연결된 시트를 찾지 못했습니다.');
  if (KIT.WEB_KEY_REQUIRED && (!k || k !== getWebKey_(ss))) throw new Error('링크가 올바르지 않습니다.');
  rememberExecUrl_(ss);
}

// 웹앱 화면이 부르는 함수 (개인 키 확인 후 실행).
// 바꾸는 함수는 바뀐 뒤의 '오늘' 화면 데이터를 함께 돌려준다 → 화면이 서버를 한 번만 부른다(속도).
function webData(k) { checkKey_(k); return getAppData(); }
function webInbox(k) { checkKey_(k); appContext_(); return getInbox(); }
function webAdd(k, text) { checkKey_(k); appContext_(); var r = addTasks(text); return withView_(r); }
function webClarify(k, id, d) { checkKey_(k); var r = clarifyTask(id, d); return withView_(r); }
function webComplete(k, id) { checkKey_(k); var r = completeTask(id); return withView_(r); }
function webPostpone(k, id, days) { checkKey_(k); var r = postponeFollowUp(id, days); return withView_(r); }
function webUpdate(k, id, patch) { checkKey_(k); var r = updateTask(id, patch); return withView_(r); }
function webPlanDay(k, ids) { checkKey_(k); var r = planDay(ids); return withView_(r); }
function webUndo(k, u) { checkKey_(k); var r = undoTask(u); return withView_(r); }
/** 알림 켜고 끄기: kind = 'daily'(아침 브리핑) | 'weekly'(주간 검토 메일) | 'test'(아침 브리핑 지금 받기) */
function webNotify(k, kind, on) {
  checkKey_(k); appContext_();
  if (kind === 'test') return sendDailyBriefing(true);
  if (kind === 'daily') setDailyTrigger_(!!on);
  else if (kind === 'weekly') setWeeklyTrigger_(!!on);
  else throw new Error('알 수 없는 알림입니다.');
  return withView_({ ok: true });
}
function webSkip(k, id) { checkKey_(k); var r = skipTask(id); return withView_(r); }
function webAddAction(k, title, d) { checkKey_(k); appContext_(); var r = addAction(title, d); return withView_(r); }
function webFocusMany(k, ids, focus) { checkKey_(k); var r = setFocusMany(ids, focus); return withView_(r); }
function webSetProject(k, name, outcome) { checkKey_(k); appContext_(); var r = setProjectOutcome(name, outcome); return withView_(r); }
// 바꾼 직후의 화면은 캐시를 읽지 않고 시트에서 새로 만든다 (방금 바꾼 내용이 반드시 보이게). 만든 화면은 캐시에 넣어 다음 열기에 쓴다.
function withView_(r) { r = r || {}; r.view = getAppData(true); return r; }

/**
 * 외부 웹 화면(GitHub Pages 등)용 데이터 입구. 구글 로그인 쿠키 없이 fetch로 부른다.
 * 요청: POST 본문(text/plain) {"fn": "getAppData", "k": "<개인 키>", "args": [...]}
 * 응답: {"ok": true, "result": ...} 또는 {"ok": false, "error": "..."}
 * 모든 함수가 개인 키를 확인한다(checkKey_). 목록에 없는 함수는 부를 수 없다.
 */
function doPost(e) {
  var api = {
    getAppData: webData, getInbox: webInbox, addTasks: webAdd, clarifyTask: webClarify,
    completeTask: webComplete, postponeFollowUp: webPostpone, skipTask: webSkip,
    getAll: webAll, getWeekly: webWeekly, sendWeekly: webSendWeekly,
    getCalendar: webCalendar, addRoutine: webAddRoutine, reviewDone: webReviewDone,
    updateTask: webUpdate, planDay: webPlanDay, undoTask: webUndo, notify: webNotify,
    addAction: webAddAction, setProject: webSetProject, focusMany: webFocusMany,
    getCalendars: webCalendars, setCalendars: webSetCalendars, timebox: webTimebox,
    placeTask: webPlaceTask, unplaceTask: webUnplaceTask
  };
  var out;
  try {
    var req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var fn = api.hasOwnProperty(req.fn) ? api[req.fn] : null;
    if (!fn) throw new Error('알 수 없는 요청입니다.');
    var args = Array.isArray(req.args) ? req.args : [];
    out = { ok: true, result: fn.apply(null, [String(req.k || '')].concat(args)) };
  } catch (err) {
    out = { ok: false, error: String((err && err.message) || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

// ── 구글 캘린더 ─────────────────────────────────────────────
// 읽기: [_설정] '캘린더'에 고른 캘린더 ID들(쉼표). 비어 있으면 기본 캘린더만.
// 쓰기: 시간표를 기본 캘린더에 넣을 때만. 키트가 만든 일정은 설명에 KIT_EVENT_TAG_ + 업무 ID를 남긴다.
var KIT_EVENT_TAG_ = '[내 업무관리 키트] ';

function selectedCalendarIds_() {
  var raw = String(readSettings_(SpreadsheetApp.getActiveSpreadsheet())['캘린더'] || '').trim();
  return raw ? raw.split(',').map(function (s) { return s.trim(); }).filter(String) : [];
}

/**
 * 고른 캘린더(없으면 기본 캘린더)의 일정을 읽는다. 권한이 없거나 실패하면 빈 목록 + 사유.
 * @return {{ok:boolean, reason?:string, items:Array}}
 */
function readCalendar_(startYmd, days, tz) {
  var c = cache_(), cv = (c && c.get('calv')) || '0';
  var ckey = 'cal:' + cv + ':' + startYmd + ':' + days + ':' + selectedCalendarIds_().join('|').slice(0, 120);
  var hit = cacheGetJson_(ckey);
  if (hit) return hit;
  var r = readCalendarRaw_(startYmd, days, tz);
  if (r.ok) cachePutJson_(ckey, r, 600); // 캘린더는 10분 캐시
  return r;
}

function readCalendarRaw_(startYmd, days, tz) {
  try {
    var start = Utilities.parseDate(startYmd + ' 00:00', tz, 'yyyy-MM-dd HH:mm');
    var end = new Date(start.getTime() + days * 864e5);
    var ids = selectedCalendarIds_(), cals = [];
    ids.forEach(function (id) { try { var c = CalendarApp.getCalendarById(id); if (c) cals.push(c); } catch (e) {} });
    if (!cals.length) cals = [CalendarApp.getDefaultCalendar()];
    var multi = cals.length > 1, items = [];
    cals.forEach(function (cal) {
      var cname = multi && cal.getName ? cal.getName() : '';
      var color = multi && cal.getColor ? cal.getColor() : '';
      cal.getEvents(start, end).forEach(function (ev) {
        var allDay = ev.isAllDayEvent();
        var s = ev.getStartTime(), e = ev.getEndTime();
        var desc = ev.getDescription ? String(ev.getDescription() || '') : '';
        var kit = desc.indexOf(KIT_EVENT_TAG_) === 0 ? desc.slice(KIT_EVENT_TAG_.length).split(/\s/)[0] : '';
        items.push({
          title: ev.getTitle() || '(제목 없음)',
          allDay: allDay,
          date: Utilities.formatDate(s, tz, 'yyyy-MM-dd'),
          start: allDay ? '' : Utilities.formatDate(s, tz, 'HH:mm'),
          end: allDay ? '' : Utilities.formatDate(e, tz, 'HH:mm'),
          location: ev.getLocation() || '',
          cal: cname, color: color, kit: kit
        });
      });
    });
    items.sort(function (a, b) { return (a.date + (a.allDay ? '00' : a.start)) < (b.date + (b.allDay ? '00' : b.start)) ? -1 : 1; });
    return { ok: true, items: items };
  } catch (err) {
    return { ok: false, reason: String((err && err.message) || err), items: [] };
  }
}

/** 캘린더 캐시 무효화 */
function bumpCalendar_() { var c = cache_(); if (c) try { c.put('calv', String(Date.now()), 21600); } catch (e) {} }

/** 내 캘린더 목록 (고르기 화면용) */
function webCalendars(k) {
  checkKey_(k);
  appContext_();
  var sel = selectedCalendarIds_(), def = CalendarApp.getDefaultCalendar(), defId = def.getId();
  return CalendarApp.getAllCalendars().map(function (c) {
    var id = c.getId();
    return { id: id, name: c.getName(), color: c.getColor ? c.getColor() : '', primary: id === defId, on: sel.length ? sel.indexOf(id) !== -1 : id === defId };
  }).sort(function (a, b) { return a.primary ? -1 : b.primary ? 1 : a.name < b.name ? -1 : 1; });
}

/** 보이는 캘린더 저장 (기본 캘린더만이면 비워 둔다) */
function webSetCalendars(k, ids) {
  checkKey_(k);
  var ctx = appContext_();
  ids = (ids || []).map(String).filter(String);
  var defId = CalendarApp.getDefaultCalendar().getId();
  writeSetting_(ctx.ss, '캘린더', ids.length === 1 && ids[0] === defId ? '' : ids.join(','));
  bumpCalendar_();
  return withView_({ ok: true });
}

/**
 * 시간표를 기본 캘린더에 넣는다. 오늘 키트가 넣었던 일정은 먼저 지우고 다시 넣는다(다시 배치해도 겹치지 않게).
 * blocks: [{id, title, start:'HH:mm', end:'HH:mm'}]
 */
function webTimebox(k, blocks) {
  checkKey_(k);
  var ctx = appContext_();
  var today = todayYmd_(ctx.tz);
  var cal = CalendarApp.getDefaultCalendar();
  // 시트 시간대 기준으로 시각을 만든다 (스크립트 시간대가 달라도 어긋나지 않게)
  var at = function (hm) { return Utilities.parseDate(today + ' ' + hm, ctx.tz, 'yyyy-MM-dd HH:mm'); };
  var dayStart = at('00:00'), dayEnd = new Date(dayStart.getTime() + 864e5);
  var removed = 0;
  cal.getEvents(dayStart, dayEnd).forEach(function (ev) {
    if (String(ev.getDescription() || '').indexOf(KIT_EVENT_TAG_) === 0) { ev.deleteEvent(); removed++; }
  });
  var added = 0;
  (blocks || []).slice(0, 30).forEach(function (b) {
    if (!b || !b.title || !/^\d\d:\d\d$/.test(b.start) || !/^\d\d:\d\d$/.test(b.end)) return;
    cal.createEvent('▶ ' + String(b.title).slice(0, 200), at(b.start), at(b.end), { description: KIT_EVENT_TAG_ + String(b.id || '') + '\n시간표에서 넣은 일정입니다. 다시 넣으면 바뀝니다.' });
    added++;
  });
  bumpCalendar_(); bumpDataVersion_(ctx.ss.getId());
  return withView_({ ok: true, added: added, removed: removed });
}

/**
 * 오늘 시간표에서 할 일 하나를 원하는 시각에 놓기 (드래그). 같은 할 일을 이미 놓았으면 옮긴다.
 * 기본 캘린더에 '▶ 제목' 일정으로 넣고, 설명에 KIT_EVENT_TAG_ + 업무 ID를 남긴다.
 */
function webPlaceTask(k, id, title, date, start, end) {
  checkKey_(k);
  var ctx = appContext_();
  date = ymd_(date) || todayYmd_(ctx.tz);
  if (!/^\d\d:\d\d$/.test(start) || !/^\d\d:\d\d$/.test(end) || end <= start) throw new Error('시간을 확인해 주세요.');
  id = String(id || ''); title = String(title || '').trim().slice(0, 200);
  if (!id || !title) throw new Error('할 일을 찾지 못했습니다.');
  var cal = CalendarApp.getDefaultCalendar();
  removePlaced_(cal, id, date, ctx.tz);
  var at = function (hm) { return Utilities.parseDate(date + ' ' + hm, ctx.tz, 'yyyy-MM-dd HH:mm'); };
  cal.createEvent('▶ ' + title, at(start), at(end), { description: KIT_EVENT_TAG_ + id + '\n시간표에서 넣은 일정입니다.' });
  bumpCalendar_(); bumpDataVersion_(ctx.ss.getId());
  return withView_({ ok: true });
}

/** 시간표에서 뺀다 (키트가 넣은 그 할 일의 일정만 지움) */
function webUnplaceTask(k, id, date) {
  checkKey_(k);
  var ctx = appContext_();
  date = ymd_(date) || todayYmd_(ctx.tz);
  var n = removePlaced_(CalendarApp.getDefaultCalendar(), String(id || ''), date, ctx.tz);
  bumpCalendar_(); bumpDataVersion_(ctx.ss.getId());
  return withView_({ ok: true, removed: n });
}

function removePlaced_(cal, id, date, tz) {
  if (!id) return 0;
  var s = Utilities.parseDate(date + ' 00:00', tz, 'yyyy-MM-dd HH:mm'), e = new Date(s.getTime() + 864e5), n = 0;
  cal.getEvents(s, e).forEach(function (ev) {
    var d = String(ev.getDescription() || '');
    if (d.indexOf(KIT_EVENT_TAG_) === 0 && d.slice(KIT_EVENT_TAG_.length).split(/\s/)[0] === id) { ev.deleteEvent(); n++; }
  });
  return n;
}

/** 캘린더 화면: start부터 days일의 일정 + 그 기간 마감 업무 */
function webCalendar(k, startYmd, days) {
  checkKey_(k);
  return calendarRange_(appContext_(), startYmd, days);
}

/** start부터 days일: 캘린더 일정 + 그 기간 업무(마감·위임 확인일) */
function calendarRange_(ctx, startYmd, days, tasksOpt) {
  var today = todayYmd_(ctx.tz);
  var start = ymd_(startYmd) || weekStartYmd_(today);
  days = Math.min(Math.max(Number(days) || 7, 1), 42);
  var end = addDaysYmd_(start, days - 1);
  var tasks = (tasksOpt || readAllTasks_(ctx)).filter(function (t) {
    var d = t.status === STATUS.DELEGATED && t.followUp ? t.followUp : t.due;
    return d && d >= start && d <= end && t.status !== STATUS.DROPPED && t.status !== STATUS.REFERENCE;
  }).map(function (t) {
    return { id: t.id, title: t.title, status: t.status, date: t.status === STATUS.DELEGATED && t.followUp ? t.followUp : t.due, repeat: t.repeat, project: t.project, delegatee: t.delegatee };
  });
  return { today: today, start: start, days: days, events: readCalendar_(start, days, ctx.tz), tasks: tasks };
}

function webAddRoutine(k, title, rule, start, context) { checkKey_(k); appContext_(); var r = addRoutine(title, rule, start, context); return withView_(r); }

/** 주간 검토 완료 기록 */
function webReviewDone(k) {
  checkKey_(k);
  var ctx = appContext_();
  writeSetting_(ctx.ss, '마지막주간검토', todayYmd_(ctx.tz));
  return withView_({ ok: true });
}

/** PC 화면: 전체 업무 표 */
function webAll(k) {
  checkKey_(k);
  var ctx = appContext_();
  return {
    today: todayYmd_(ctx.tz),
    items: readAllTasks_(ctx).map(function (t) {
      return { id: t.id, title: t.title, status: t.status, due: t.due, context: t.context, delegatee: t.delegatee,
        followUp: t.followUp, memo: t.memo, created: t.created, completed: t.completed, repeat: t.repeat, project: t.project,
        focus: t.focus, est: t.est, priority: t.priority, delegatedOn: t.delegatedOn };
    })
  };
}

/** PC 화면: 주간 검토 */
function webWeekly(k) {
  checkKey_(k);
  var ctx = appContext_();
  var s = buildWeeklySummary_(readAllTasks_(ctx), todayYmd_(ctx.tz));
  var slim = function (list) {
    return list.map(function (t) { return { id: t.id, title: t.title, status: t.status, due: t.due, delegatee: t.delegatee, followUp: t.followUp, created: t.created, completed: t.completed, context: t.context, project: t.project, repeat: t.repeat, delegatedOn: t.delegatedOn }; });
  };
  return { today: s.today, weekStart: s.weekStart, done: slim(s.done), next: slim(s.next), overdue: slim(s.overdue),
    followUp: slim(s.followUp), delegated: slim(s.delegated), upcoming: slim(s.upcoming), inbox: slim(s.inbox), someday: slim(s.someday), routineDone: s.routineDone, projects: withOutcomes_(ctx.ss, s.projects), reference: slim(s.reference),
    lastReview: ymd_(readSettings_(ctx.ss)['마지막주간검토'], ctx.tz) };
}

function webSendWeekly(k) { checkKey_(k); return sendWeeklyReview(); }

/** 시트 메뉴: 휴대폰 링크 보기. 웹앱 주소가 아직 없으면 배포 안내(설치 마법사)를 먼저 보여준다. */
function menuShowWebLink() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureSchema_(ss);
  var t = HtmlService.createTemplateFromFile('Setup');
  t.link = webAppLink_(ss);
  t.scriptUrl = 'https://script.google.com/home/projects/' + ScriptApp.getScriptId() + '/edit';
  SpreadsheetApp.getUi().showModalDialog(t.evaluate().setWidth(520).setHeight(t.link ? 380 : 600), t.link ? '📱 내 업무 휴대폰 링크' : '📱 휴대폰·웹 화면 설정 (1회)');
}

/** 시트 메뉴: 링크 새로 만들기 (키 교체) */
function menuRotateWebLink() {
  var ui = SpreadsheetApp.getUi();
  var r = ui.alert('휴대폰 링크 새로 만들기', '새 링크를 만들면 지금 쓰는 링크(홈 화면 아이콘 포함)는 바로 막힙니다.\n링크가 남에게 넘어갔을 때 쓰세요. 계속할까요?', ui.ButtonSet.YES_NO);
  if (r !== ui.Button.YES) return;
  rotateWebKey_(SpreadsheetApp.getActiveSpreadsheet());
  menuShowWebLink();
}

/** 시트가 설치 전이면 설치까지 마치고 컨텍스트를 돌려준다 */
function appContext_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('연결된 시트를 찾지 못했습니다.');
  if (!isSchemaCurrent_(ss)) { ensureSchema_(ss); ensureDashboard_(ss); }
  return taskContext_();
}

/** 오늘 화면에 필요한 모든 데이터 (순수 계산은 buildTodayView_) */
function getAppData(fresh) {
  var ctx = appContext_();
  var today = todayYmd_(ctx.tz);
  var ckey = 'view:' + ctx.ss.getId() + ':' + dataVersion_(ctx.ss.getId()) + ':' + today;
  var hit = fresh === true ? null : cacheGetJson_(ckey);
  if (hit) return hit;
  var view = buildAppView_(ctx, today);
  cachePutJson_(ckey, view, 300);
  return view;
}

function buildAppView_(ctx, today) {
  var all = readAllTasks_(ctx);
  var view = buildTodayView_(all, today);
  view.sheetUrl = ctx.ss.getUrl();
  view.kitVersion = KIT.VERSION;
  view.pageUrl = KIT.WEB_PAGE_URL ? KIT.WEB_PAGE_URL.replace(/\/?$/, '/') : '';
  view.projects = withOutcomes_(ctx.ss, view.projects);
  view.week = calendarRange_(ctx, weekStartYmd_(today), 7, all);
  view.events = { ok: view.week.events.ok, reason: view.week.events.reason,
    items: view.week.events.items.filter(function (e) { return e.date === today; }) };
  var last = ymd_(readSettings_(ctx.ss)['마지막주간검토'], ctx.tz);
  view.lastReview = last;
  var st = readSettings_(ctx.ss);
  view.notify = { daily: st['아침알림'] === '켜짐', weekly: st['주간메일'] === '켜짐' };
  view.reviewDue = !last || last <= addDaysYmd_(today, -7);
  return view;
}

/** 업무 목록 → 오늘 화면 (순수 함수 — 테스트 대상) */
function buildTodayView_(tasks, today) {
  var s = buildWeeklySummary_(tasks, today);
  var pick = function (t) {
    return { id: t.id, title: t.title, due: t.due, context: t.context, delegatee: t.delegatee, followUp: t.followUp, status: t.status, repeat: t.repeat || '', project: t.project || '',
      focus: t.focus || '', est: t.est || 0, priority: t.priority || '', delegatedOn: t.delegatedOn || '', memo: t.memo || '' };
  };
  var isRoutineToday = function (t) { return !!t.repeat && isActionable_(t.status) && (!t.due || t.due <= today); };
  var byDue = function (a, b) { return (a.due || '9999') < (b.due || '9999') ? -1 : (a.due || '9999') > (b.due || '9999') ? 1 : 0; };
  var byPrio = function (a, b) {
    var pa = PRIORITY_ORDER[a.priority] === undefined ? 1 : PRIORITY_ORDER[a.priority];
    var pb = PRIORITY_ORDER[b.priority] === undefined ? 1 : PRIORITY_ORDER[b.priority];
    return pa !== pb ? pa - pb : byDue(a, b);
  };
  var isFocus = function (t) { return isActionable_(t.status) && t.focus && t.focus <= today; };
  var focus = tasks.filter(isFocus).sort(byPrio);
  var routines = tasks.filter(function (t) { return isRoutineToday(t) && !isFocus(t); }).sort(byDue);
  var now = tasks.filter(function (t) {
    if (isRoutineToday(t) || isFocus(t)) return false;
    return t.status === STATUS.NEXT || (t.status === STATUS.SCHEDULED && t.due && t.due <= today);
  }).sort(byPrio);
  var mins = function (list) { return list.reduce(function (s, t) { return s + (t.est || 30); }, 0); };
  var dueToday = tasks.filter(function (t) {
    return isActionable_(t.status) && t.due && t.due <= today;
  }).sort(byDue);
  return {
    today: today,
    focus: focus.map(pick),
    estMinutes: { focus: mins(focus), now: mins(now), routines: mins(routines) },
    counts: { doneToday: s.done.filter(function (t) { return t.completed === today; }).length, inbox: s.inbox.length, focus: focus.length, now: now.length, routines: routines.length, overdue: s.overdue.length, followUp: s.followUp.length, doneWeek: s.done.length },
    routines: routines.map(pick),
    routineDone: s.routineDone,
    now: now.map(pick),
    followUp: s.followUp.map(pick),
    due: dueToday.map(pick),
    upcoming: s.upcoming.map(pick),
    delegated: s.delegated.slice().sort(function (a, b) {
      return (a.followUp || '9999') < (b.followUp || '9999') ? -1 : (a.followUp || '9999') > (b.followUp || '9999') ? 1 : 0;
    }).map(pick),
    inbox: s.inbox.map(pick),
    someday: s.someday.length,
    reference: s.reference.length,
    projects: s.projects,
    contexts: uniq_(tasks.filter(function (t) { return isActionable_(t.status) && t.context; }).map(function (t) { return t.context; })),
    projectNames: uniq_(tasks.filter(function (t) { return t.project; }).map(function (t) { return t.project; }))
  };
}

function uniq_(list) { var seen = {}; return list.filter(function (x) { if (seen[x]) return false; seen[x] = true; return true; }); }

function completeTask(id) {
  return clarifyTask(id, { status: STATUS.DONE });
}

/** 위임 확인일 미루기 */
function postponeFollowUp(id, days) {
  return withLock_(function () {
    var ctx = taskContext_();
    var row = findRowById_(ctx, id);
    if (!row || !ctx.map.followUp) throw new Error('항목을 찾지 못했습니다.');
    ctx.sheet.getRange(row, ctx.map.followUp).setValue(addDaysYmd_(todayYmd_(ctx.tz), Number(days) || 3));
    return { ok: true };
  });
}

/**
 * Apps Script 편집기에서 ▶ 실행용. 권한을 승인하고 설치를 마무리한다.
 * (시트 모바일 앱만 쓰는 사람도 편집기에서 한 번 실행하면 된다)
 */
function installFromEditor() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var r = ensureSchema_(ss);
  buildDashboard_(ss);
  console.log('설치 완료. 시트 구조 v' + r.to + ', 추가된 열: ' + (r.addedColumns.join(', ') || '없음'));
  console.log('휴대폰 링크(남에게 공유 금지): ' + (webAppLink_(ss) || '웹앱 배포 후 다시 실행하세요'));
  return r;
}

    KIT.WEB_KEY_REQUIRED = false;
    // v2: 캘린더는 미리 읽어 둔 것을 쓴다
    readCalendar_ = function (startYmd, days, tz) { return env.__cal(startYmd, days); };
    // v2: 시트 안 [오늘] 탭은 그리지 않는다 (앱이 화면)
    ensureDashboard_ = function () { return false; };
    buildDashboard_ = function () {};
    return {
      KIT: KIT, STATUS: STATUS,
      fn: function (name) { return eval(name); }, // eslint-disable-line no-eval
      ensureSchema_: ensureSchema_, insertSampleTasks_: insertSampleTasks_, readSettings_: readSettings_, writeSetting_: writeSetting_,
      todayYmd_: todayYmd_, weekStartYmd_: weekStartYmd_, addDaysYmd_: addDaysYmd_, selectedCalendarIds_: selectedCalendarIds_, getAppData: getAppData,
      KIT_EVENT_TAG_: KIT_EVENT_TAG_, bumpDataVersion_: bumpDataVersion_,
      // 앱스크립트는 요청마다 새로 시작한다. 엔진은 계속 살아 있으므로 요청마다 실행 단위 기억을 비운다
      freshExecution: function () { SETTINGS_CACHE_ = null; DATA_VER_ = {}; LAST_SPAWN_ID_ = ''; }
    };
  })(env);
  env.__cal = function (start, days) {
    var key = calKey(start, days);
    return calData[key] || { ok: true, items: [] };
  };
  function calKey(start, days) { return start + '|' + days + '|' + (book ? K.selectedCalendarIds_().join(',') : ''); }

  // ── 캘린더 API ──────────────────────────────────────────────
  var calList = null;
  async function calendars() {
    if (calList) return calList;
    var r = await gapi('GET', API.cal + '/users/me/calendarList?minAccessRole=reader&fields=' + enc('items(id,summary,backgroundColor,primary)'));
    calList = (r.items || []).map(function (c) { return { id: c.id, name: c.summary, color: c.backgroundColor || '', primary: !!c.primary }; });
    return calList;
  }
  async function readEvents(calId, startYmd, days, tz) {
    var s = utils.parseDate(startYmd + ' 00:00', tz), e = new Date(s.getTime() + days * 864e5);
    var r = await gapi('GET', API.cal + '/calendars/' + enc(calId) + '/events?singleEvents=true&orderBy=startTime&maxResults=2500&timeMin=' + enc(s.toISOString()) + '&timeMax=' + enc(e.toISOString()) + '&fields=' + enc('items(id,summary,start,end,location,description,status)'));
    return (r.items || []).filter(function (ev) { return ev.status !== 'cancelled'; });
  }
  // 5분 안: 그대로 · 그보다 오래됐으면 있는 것을 바로 쓰고 뒤에서 새로 받기(바뀌면 화면에 알림)
  // · 아예 없으면 잠깐(calWaitMs)만 기다리고, 늦게 오면 받은 뒤 화면에 알림
  var calFetching = {}, calNotify = {};
  async function preloadCal(startYmd, days) {
    if (!book) return;
    var key = calKey(startYmd, days), c = calData[key], age = c ? Date.now() - c.at : Infinity;
    if (age < 5 * 60e3) return;
    if (c && c.ok && c.items) { fetchCal(startYmd, days, key, true); return; }
    var p = fetchCal(startYmd, days, key, false), tm = null;
    await Promise.race([p, new Promise(function (res) { tm = setTimeout(function () { if (calFetching[key]) calNotify[key] = 1; res(); }, opts.calWaitMs === undefined ? 3000 : opts.calWaitMs); })]);
    clearTimeout(tm);
  }
  function fetchCal(startYmd, days, key, bg) {
    if (!calFetching[key]) calFetching[key] = fetchCal0(startYmd, days, key, bg).then(function () { delete calFetching[key]; }, function () { delete calFetching[key]; });
    return calFetching[key];
  }
  async function fetchCal0(startYmd, days, key, bg) {
    var tz = book.tz, prev = calData[key];
    try {
      var ids = K.selectedCalendarIds_();
      if (!ids.length) ids = ['primary'];
      var multi = ids.length > 1, items = [];
      // 캘린더 목록과 각 캘린더 일정을 한꺼번에 받는다 (차례로 받으면 캘린더 수만큼 느려진다)
      var got = await Promise.all([multi ? calendars().catch(function () { return []; }) : Promise.resolve([])].concat(ids.map(function (cid) { return readEvents(cid, startYmd, days, tz); })));
      var list = got[0];
      for (var i = 0; i < ids.length; i++) {
        var meta = list.filter(function (c) { return c.id === ids[i] || (ids[i] === 'primary' && c.primary); })[0] || {};
        var evs = got[i + 1];
        evs.forEach(function (ev) {
          var allDay = !ev.start.dateTime, s = allDay ? null : new Date(ev.start.dateTime), en = allDay ? null : new Date(ev.end.dateTime);
          var desc = String(ev.description || ''), kit = desc.indexOf(K.KIT_EVENT_TAG_) === 0 ? desc.slice(K.KIT_EVENT_TAG_.length).split(/\s/)[0] : '';
          items.push({ title: ev.summary || '(제목 없음)', allDay: allDay, date: allDay ? ev.start.date : utils.formatDate(s, tz, 'yyyy-MM-dd'), start: allDay ? '' : utils.formatDate(s, tz, 'HH:mm'), end: allDay ? '' : utils.formatDate(en, tz, 'HH:mm'),
            location: ev.location || '', cal: multi ? (meta.name || '') : '', color: multi ? (meta.color || '') : '', kit: kit, eventId: ev.id, calId: ids[i] });
        });
      }
      items.sort(function (a, b) { return (a.date + (a.allDay ? '00' : a.start)) < (b.date + (b.allDay ? '00' : b.start)) ? -1 : 1; });
      calData[key] = { ok: true, items: items, at: Date.now() };
      cache = {};
      if ((bg || calNotify[key]) && JSON.stringify((prev && prev.items) || []) !== JSON.stringify(items)) changed();
      delete calNotify[key];
      saveCal();
    } catch (e) {
      delete calNotify[key];
      if (bg) return; // 뒤에서 받다 실패하면 있던 일정을 그대로 둔다
      calData[key] = { ok: false, reason: e.status === 403 || e.status === 401 ? '캘린더 권한이 없어요. 다시 로그인해 주세요.' : '캘린더를 읽지 못했어요: ' + e.message, items: [], at: Date.now() };
    }
  }
  function dropCal() { calData = {}; cache = {}; saveCal(); }
  function saveCal() {
    if (!book) return;
    var keep = {}; Object.keys(calData).filter(function (k) { return calData[k].ok; }).sort(function (a, b) { return calData[b].at - calData[a].at; }).slice(0, 6).forEach(function (k) { keep[k] = calData[k]; });
    try { store.set('kitCal:' + book.id, JSON.stringify(keep)); } catch (e) {}
  }
  function readCal(id) { try { var o = JSON.parse(store.get('kitCal:' + id) || 'null'); if (o && typeof o === 'object') { Object.keys(o).forEach(function (k) { if (Date.now() - o[k].at > 7 * 864e5) delete o[k]; }); return o; } } catch (e) {} return {}; }
  // 뒤에서 받은 내용이 화면과 달라졌을 때 (여러 번이면 한 번으로)
  var changeT = null;
  function changed() { if (changeT) return; changeT = setTimeout(function () { changeT = null; if (opts.onChange) try { opts.onChange(); } catch (e) {} }, opts.changeMs === undefined ? 250 : opts.changeMs); }
  async function removePlaced(id, date) {
    var tz = book.tz, evs = await readEvents('primary', date, 1, tz), n = 0;
    for (var i = 0; i < evs.length; i++) {
      var d = String(evs[i].description || '');
      if (d.indexOf(K.KIT_EVENT_TAG_) === 0 && (!id || d.slice(K.KIT_EVENT_TAG_.length).split(/\s/)[0] === id)) { await gapi('DELETE', API.cal + '/calendars/primary/events/' + enc(evs[i].id)); n++; }
    }
    return n;
  }
  async function insertPlaced(id, title, date, start, end) {
    var tz = book.tz;
    await gapi('POST', API.cal + '/calendars/primary/events', { summary: '▶ ' + title, description: K.KIT_EVENT_TAG_ + id + '\n시간표에서 넣은 일정입니다.',
      start: { dateTime: utils.parseDate(date + ' ' + start, tz).toISOString(), timeZone: tz }, end: { dateTime: utils.parseDate(date + ' ' + end, tz).toISOString(), timeZone: tz } });
  }

  // ── 앱 화면이 부르는 함수 (App.html 의 call(fn) 이름과 같다) ────
  var WEB = { getAppData: 'webData', getInbox: 'webInbox', addTasks: 'webAdd', clarifyTask: 'webClarify', completeTask: 'webComplete', postponeFollowUp: 'webPostpone', skipTask: 'webSkip',
    getCalendar: 'webCalendar', addRoutine: 'webAddRoutine', reviewDone: 'webReviewDone', updateTask: 'webUpdate', planDay: 'webPlanDay', undoTask: 'webUndo', getAll: 'webAll',
    getWeekly: 'webWeekly', addAction: 'webAddAction', setProject: 'webSetProject', focusMany: 'webFocusMany', setCalendars: 'webSetCalendars' };
  var queue = Promise.resolve(); // 시트 쓰기는 한 번에 하나씩
  function serial(job) { var p = queue.then(job, job); queue = p.catch(function () {}); return p; }
  function clone(x) { return x === undefined ? null : JSON.parse(JSON.stringify(x)); }
  var readyResolve, ready = new Promise(function (res) { readyResolve = res; }); // 로그인 뒤 start()가 열어 준다

  async function setup(created, background) {
    var ss = book.api;
    var r = K.ensureSchema_(ss);
    if (created) {
      K.insertSampleTasks_(ss, false);
      // 새 시트의 빈 기본 탭(Sheet1/시트1) 정리
      book.sheets.filter(function (sh) { return !sh._s.isNew && sh.getLastRow() === 0 && book.sheets.length > 1; }).forEach(function (sh) { ss.deleteSheet(sh); });
    }
    // 구글에 쓰는 것은 기다리지 않는다: 메모리·이 기기 저장본에 먼저 있고, 뒤에서 보낸다(실패하면 다시 시도·알림)
    if (background) { saveLater(); writeSnap(); } else await flushOne();
    return r;
  }
  function isStale() { return book && Date.now() - loadedAt >= (opts.staleMs === undefined ? 60e3 : opts.staleMs); }
  // 시트를 다시 읽는 일은 화면 동작을 막지 않는다. 받는 동안 고친 것이 있으면 이번 결과는 버리고 다음에 다시 받는다
  // (못 보낸 변경을 덮지 않기 위해). 받은 내용이 화면과 다르면 opts.onChange 로 알린다.
  var reloading = null;
  function bgReload() {
    if (!book) return Promise.resolve();
    if (reloading) return reloading;
    reloading = (async function () {
      await saving;
      if (hasChanges()) await flushOne();
      var id = book.id, seq = editSeq, at = Date.now();
      var fresh = await fetchBook(id);
      await serial(async function () {
        if (!book || book.id !== id || editSeq !== seq || hasChanges()) return;
        var before = sig(book); applyBook(fresh, at);
        if (sig(book) !== before) changed();
      });
    })().then(function () { reloading = null; }, function () { reloading = null; });
    return reloading;
  }
  function sig(b) { return JSON.stringify([b.tz, b.sheets.map(function (sh) { return [sh._s.name, sh._s.data.map(function (r) { return (r || []).map(toCell); })]; })]); }
  function refreshIfStale() { if (isStale()) bgReload(); }

  // ── 뒤에서 저장 ──
  // 앱스크립트 시절에는 저장이 끝나야 화면이 바뀌었다. 지금은 메모리 시트가 바로 바뀌므로 결과를 먼저 돌려주고
  // 구글 시트 저장은 따로 한 줄로(한 번에 하나씩) 한다. 저장 중에 누른 것은 다음 저장에 묶인다.
  // 실패하면 한 번 더, 그래도 안 되면 알린다(opts.onSaveError). 다음 저장이 성공하면 opts.onSaved.
  var saving = Promise.resolve(), saveQueued = false, saveFailed = null;
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function flushOne() { var p = saving.then(flush); saving = p.catch(function () {}); return p; }
  function saveLater() {
    if (saveQueued) return saving;
    saveQueued = true;
    var p = saving.then(async function () {
      saveQueued = false;
      try { await flush(); }
      catch (e) {
        await wait(opts.retryMs === undefined ? 1500 : opts.retryMs);
        try { await flush(); } catch (e2) { saveFailed = e2; if (opts.onSaveError) try { opts.onSaveError(e2); } catch (x) {} return; }
      }
      if (saveFailed && !hasChanges()) { saveFailed = null; if (opts.onSaved) try { opts.onSaved(); } catch (x) {} }
      writeSnap();
    });
    saving = p.catch(function () {});
    return saving;
  }
  async function idle() { var q0, s0, r0; do { q0 = queue; s0 = saving; r0 = reloading; await q0; await s0; if (r0) await r0; await Promise.all(Object.keys(calFetching).map(function (k) { return calFetching[k]; })); } while (q0 !== queue || s0 !== saving || r0 !== reloading); if (snapT) writeSnap(); }
  function today() { return K.todayYmd_(book.tz); }

  async function call(fn, args) {
    await ready;
    return serial(async function () {
      K.freshExecution();
      refreshIfStale();
      var t = today();
      // 화면에 필요한 캘린더를 먼저 읽어 둔다 (이번 주 + 요청 범위)
      await preloadCal(K.weekStartYmd_(t), 7);
      if (fn === 'getCalendar') await preloadCal(args[0] || K.weekStartYmd_(t), Math.min(Math.max(Number(args[1]) || 7, 1), 42));
      if (fn === 'getCalendars') { var sel = K.selectedCalendarIds_(), list = await calendars(); return list.map(function (c) { return { id: c.id, name: c.name, color: c.color, primary: c.primary, on: sel.length ? sel.indexOf(c.id) !== -1 : c.primary }; }); }
      if (fn === 'placeTask' || fn === 'unplaceTask' || fn === 'timebox') {
        if (fn === 'placeTask') {
          var id = String(args[0]), title = String(args[1] || '').trim(), date = args[2] || t, st = args[3], en = args[4];
          if (!/^\d\d:\d\d$/.test(st) || !/^\d\d:\d\d$/.test(en) || en <= st) throw new Error('시간을 확인해 주세요.');
          await removePlaced(id, date); await insertPlaced(id, title, date, st, en);
        } else if (fn === 'unplaceTask') await removePlaced(String(args[0]), args[1] || t);
        else { await removePlaced('', t); for (var i = 0; i < (args[0] || []).length; i++) { var b = args[0][i]; await insertPlaced(b.id, b.title, t, b.start, b.end); } }
        dropCal(); await preloadCal(K.weekStartYmd_(t), 7);
        return { ok: true, view: clone(K.getAppData()) };
      }
      if (fn === 'notify' || fn === 'sendWeekly') throw new Error('메일 알림은 곧 지원해요. 지금은 캘린더 알림을 써 주세요.');
      var name = WEB[fn]; if (!name) throw new Error('알 수 없는 요청입니다: ' + fn);
      var res = K.fn(name).apply(null, [''].concat(args || []));
      if (fn === 'setCalendars') { dropCal(); await preloadCal(K.weekStartYmd_(t), 7); res = { ok: true, view: clone(K.getAppData()) }; }
      saveLater(); saveSnap();
      return clone(res);
    });
  }

  return {
    /** 로그인 직후 한 번: 내 시트 찾기·만들기, 구조 맞추기 */
    start: function (email) {
      userEmail = email || '';
      var t0 = Date.now(), log = [];
      var mark = function (what) { log.push(what + ' ' + ((Date.now() - t0) / 1000).toFixed(1) + 's'); };
      var p = (async function () {
        var saved = store.get('kitSheetId'), snap = saved && opts.localFirst !== false ? readSnap(saved) : null;
        if (snap) {
          cache = {}; book = snap.book; loadedAt = 0; calData = readCal(saved);
          K.freshExecution(); K.ensureSchema_(book.api);
          mark('이 기기 저장본으로 열기');
          startLog = log.join(' · ');
          // 뒤에서: 못 보낸 변경 보내기 → 시트 다시 받기 → 캘린더 새로 받기 (바뀌면 화면에 알림)
          if (hasChanges()) saveLater();
          bgReload().then(function () { mark('시트 새로 받음'); startLog = log.join(' · '); });
          preloadCal(K.weekStartYmd_(today()), 7).catch(function () {});
          return { id: saved, created: false, local: true };
        }
        var f = await findOrCreateSheet(); mark(f.created ? '시트 만듦' : '시트 읽음');
        step(f.created ? '예시 할 일을 넣는 중이에요' : '거의 다 됐어요');
        // 구조 맞추기 저장과 첫 화면 캘린더 읽기를 동시에 (캘린더는 실패해도 시작은 계속)
        await setup(f.created, opts.localFirst !== false); mark('구조 맞춤');
        // 첫 화면 캘린더는 기다리지 않고 받기 시작만 (오면 화면에 알림). 첫 화면 요청이 남은 만큼만 기다린다
        var wk = K.weekStartYmd_(today()), ck = calKey(wk, 7); if (!calData[ck]) { calNotify[ck] = 1; fetchCal(wk, 7, ck, false).then(function () { mark('캘린더'); startLog = log.join(' · '); }); }
        // 다음에 열 때 탭 목록·값을 동시에 읽도록 탭 이름을 기억
        store.set('kitTabs:' + f.id, JSON.stringify(book.sheets.map(function (sh) { return sh.getName(); })));
        writeSnap(); saveCal();
        startLog = log.join(' · '); try { console.info('[내 업무관리 키트] 시작: ' + startLog); } catch (e) {}
        return f;
      })();
      readyResolve(p);
      return p;
    },
    call: call,
    useSheet: useSheet,
    sheetUrl: function () { return book ? book.url : ''; },
    startLog: function () { return startLog; },
    reload: async function () { if (book) { await idle(); if (hasChanges()) await flushOne(); await loadBook(book.id); dropCal(); } },
    /** 앱으로 돌아왔을 때: 오래된 시트·캘린더를 미리 새로 받아 두어 다음 누름이 기다리지 않게 */
    warm: function () { if (!book) return; refreshIfStale(); preloadCal(K.weekStartYmd_(today()), 7).catch(function () {}); },
    /** 창을 닫거나 다른 앱으로 갈 때: 이 기기 저장본을 바로 쓴다 */
    persist: function () { writeSnap(); },
    saveFailed: function () { return !!saveFailed; },
    /** 저장 실패 뒤 다시 시도 */
    retrySave: function () { saveLater(); return idle(); },
    /** 아직 구글 시트에 못 보낸 변경이 있는지 (창을 닫기 전 확인용) */
    unsaved: function () { return saveQueued || sending > 0 || !!saveFailed || hasChanges(); },
    idle: idle,
    _book: function () { return book; }, _K: K, _flush: flush
  };
}
if (typeof module !== 'undefined') module.exports = { createKitEngine: createKitEngine };
