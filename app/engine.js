/* 자동 생성 파일 — tools/build-web2.js. 직접 고치지 말 것 */
/*
 * GTD 워크 v2 엔진 — 서버 없이 브라우저에서 동작
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
  var SHEET_NAME = 'GTD 워크';

  // ── 구글 API 호출 ──────────────────────────────────────────
  async function gapi(method, url, body, retry) {
    var tok = await getToken();
    var r = await fetchFn(url, { method: method, headers: Object.assign({ Authorization: 'Bearer ' + tok }, body ? { 'Content-Type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined });
    if (r.status === 401 && !retry && opts.onUnauthorized) { await opts.onUnauthorized(tok); return gapi(method, url, body, true); }
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
      var s = { name: name, id: id, data: rows || [], hidden: !!hidden, hiddenChanged: false, isNew: !!isNew, dirty: {}, orig: {}, full: false, prevRows: (rows || []).length, prevCols: 0, rules: [], formulas: {} };
      (rows || []).forEach(function (r) { s.prevCols = Math.max(s.prevCols, r.length); });
      var cell = function (r, c) { return s.data[r - 1] && s.data[r - 1][c - 1] !== undefined && s.data[r - 1][c - 1] !== null ? s.data[r - 1][c - 1] : ''; };
      // 바꾼 '칸'만 기억한다(dirty: 줄 → 칸 번호들). 바뀌기 전 줄 모습(orig)도 함께 둔다 → 저장 직전 시트와 비교하는 기준.
      // 같은 값을 다시 쓰는 것은 바뀐 것이 아니다.
      var blank = function (x) { return x === '' || x === undefined || x === null; };
      var setCell = function (r, c, v) {
        while (s.data.length < r) s.data.push([]);
        var old = s.data[r - 1][c - 1];
        if (old === v || (blank(old) && blank(v))) return;
        if (!s.orig[r]) s.orig[r] = (s.data[r - 1] || []).slice();
        s.data[r - 1][c - 1] = v; (s.dirty[r] = s.dirty[r] || {})[c] = 1; editSeq++;
      };
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
        // 줄을 밀어 올리지 않고 그 줄의 칸만 비운다: 줄 번호가 바뀌면 다른 곳(에이전트·다른 기기)이 가리키는 줄이 어긋난다
        deleteRow: function (r) { var w = Math.max(((s.data[r - 1] || []).length), 1); for (var j = 1; j <= w; j++) setCell(r, j, ''); return api; },
        getConditionalFormatRules: function () { return s.rules.slice(); }, setConditionalFormatRules: function (x) { s.rules = x; },
        clear: function () { s.data = []; s.formulas = {}; s.full = true; s.dirty = {}; s.orig = {}; editSeq++; return api; }, clearConditionalFormatRules: function () { s.rules = []; },
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
    (meta.sheets || []).forEach(function (m) { var sh = makeSheet(m.title, m.sheetId, m.rows, m.hidden, !!m.isNew); sh._s.gridR = m.gridR; sh._s.gridC = m.gridC; book.sheets.push(sh); });
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
  var conflictLog = []; // 저장 직전 확인에서 '다른 곳에서 먼저 바뀜'으로 저장하지 않은 줄 (takeConflicts 로 가져간다)
  async function flush0() {
    if (!book) return 0;
    if (!hasChanges()) return 0;
    await getToken(); // 로그인을 기다리는 동안에는 바뀜 표시를 그대로 둔다
    var bk = book, reqs = [], data = [], n = 0, marks = [];
    var st = { tz: bk.tzChanged, removed: bk.removed.slice(), sheets: [] };
    if (bk.tzChanged) reqs.push({ updateSpreadsheetProperties: { properties: { timeZone: bk.tz }, fields: 'timeZone' } });
    var fresh = [];
    bk.sheets.forEach(function (sh, idx) {
      var s = sh._s;
      if (s.isNew) {
        // 새 탭은 쓸 칸 수에 맞춰 처음부터 넉넉히 만든다 (구글 기본은 26열 · 1000줄)
        var w0 = 0; s.data.forEach(function (r) { w0 = Math.max(w0, (r || []).length); });
        s.gridC = Math.max(26, w0); s.gridR = Math.max(1000, s.data.length);
        reqs.push({ addSheet: { properties: { sheetId: s.id, title: s.name, index: idx, hidden: s.hidden, gridProperties: { rowCount: s.gridR, columnCount: s.gridC } } } }); fresh.push(s);
      }
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
        // 탭 통째로 다시 쓰기는 clear() 뒤에만 쓴다 (줄을 밀지 않으므로 보통은 오지 않는다)
        var rows = Math.max(s.data.length, s.prevRows), vals = [];
        for (var i = 1; i <= rows; i++) vals.push(rowVals(i));
        if (vals.length) data.push({ range: q(s.name) + '!A1:' + colName(width) + rows, values: vals });
      }
      // 보내는 순간의 줄 모습을 떠 둔다: 보내는 동안 화면이 같은 줄을 또 고쳐도 이번에 보낼 것은 이 모습이다(그 변경은 다음 저장에 실린다)
      var snap = {}; if (!s.full) Object.keys(s.dirty).forEach(function (r) { snap[r] = (s.data[r - 1] || []).slice(); });
      marks.push({ s: s, snap: snap, full: s.full, dirty: s.full ? {} : s.dirty, orig: s.full ? {} : s.orig, fresh: fresh.indexOf(s) >= 0, prevRows: s.prevRows, prevCols: s.prevCols });
      s.full = false; s.dirty = {}; s.orig = {}; s.prevRows = s.data.length; s.prevCols = width;
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
    var moved = false, conflicts = [];
    try {
      // 저장 직전: 바꾼 줄을 시트에서 다시 읽어 내가 알던 모습과 같은지 확인한다 (다른 곳에서 먼저 바뀐 줄은 덮어쓰지 않는다)
      var plan = await verifyRows(bk, marks);
      moved = plan.moved; conflicts = plan.conflicts;
      await ensureGrid(bk, plan.writes); // 시트 칸(격자) 밖에는 쓸 수 없다: 열·줄이 모자라면 먼저 늘린다
      var cellData = cellRanges(plan.writes);
      cellData.forEach(function (d) { data.push(d); });
    } catch (e) { restore(marks); throw e; }
    if (data.length) {
      try { await gapi('POST', API.sheets + '/' + bk.id + '/values:batchUpdate', { valueInputOption: 'RAW', data: data }); n += data.length; }
      catch (e) { restore(marks); saveSnap(); throw e; }
    }
    if (conflicts.length) {
      conflicts.forEach(function (c) { marks.forEach(function (m) { if (m.s.name === c.tab) delete m.dirty[c.row]; }); }); // 저장하지 않은 줄은 다시 보내지 않는다
      conflictLog = conflictLog.concat(conflicts);
      if (opts.onConflict) try { opts.onConflict(conflicts); } catch (x) {}
    }
    if (n || conflicts.length) saveSnap();
    if (moved || conflicts.length) setTimeout(function () { bgReload(); }, 0); // 시트와 화면의 줄이 어긋났을 수 있으니 새로 받는다
    return n;
    }
  }
  // 칸 목록 → 구글 시트 범위 묶음: 줄마다 이어진 칸을 한 범위로, 같은 칸 범위가 이어진 줄은 한 덩어리로
  function cellRanges(writes) {
    var out = [], byKey = {};
    writes.forEach(function (w) {
      var runs = [], cs = w.cols.slice().sort(function (a, b) { return a - b; });
      cs.forEach(function (c) { var r = runs[runs.length - 1]; if (r && c === r[1] + 1) r[1] = c; else runs.push([c, c]); });
      runs.forEach(function (rg) {
        var vals = []; for (var c = rg[0]; c <= rg[1]; c++) vals.push(toCell(w.vals[c - 1]));
        var key = w.tab + '|' + rg[0] + '|' + rg[1], list = byKey[key] = byKey[key] || [];
        list.push({ row: w.row, vals: vals, c0: rg[0], c1: rg[1], tab: w.tab });
      });
    });
    Object.keys(byKey).forEach(function (k) {
      var list = byKey[k].sort(function (a, b) { return a.row - b.row; }), blk = null;
      var push = function () { if (blk) out.push({ range: q(blk.tab) + '!' + colName(blk.c0) + blk.r0 + ':' + colName(blk.c1) + blk.r1, values: blk.vals }); };
      list.forEach(function (x) { if (blk && x.row === blk.r1 + 1) { blk.vals.push(x.vals); blk.r1 = x.row; } else { push(); blk = { tab: x.tab, c0: x.c0, c1: x.c1, r0: x.row, r1: x.row, vals: [x.vals] }; } });
      push();
    });
    return out;
  }
  // 쓸 칸이 시트의 열·줄 수를 넘으면 먼저 늘린다 (새 열을 붙이는 시트 구조 업데이트, 줄이 1000을 넘는 경우). 칸 수를 모르면 구글에 물어본다
  async function ensureGrid(bk, writes) {
    var need = {};
    writes.forEach(function (w) { var n = need[w.tab] = need[w.tab] || { r: 0, c: 0 }; n.r = Math.max(n.r, w.row); w.cols.forEach(function (c) { n.c = Math.max(n.c, c); }); });
    var reqs = [], learn = [];
    bk.sheets.forEach(function (sh) { var s = sh._s, n = need[s.name]; if (n && !s.gridR && n.r > 1000 || n && !s.gridC && n.c > 26) learn.push(s); });
    if (learn.length) {
      var m = await gapi('GET', API.sheets + '/' + bk.id + '?fields=' + enc('sheets(properties(sheetId,gridProperties(rowCount,columnCount)))'));
      (m.sheets || []).forEach(function (x) { var p = x.properties || {}, g = p.gridProperties || {}; bk.sheets.forEach(function (sh) { if (sh._s.id === p.sheetId) { sh._s.gridR = g.rowCount; sh._s.gridC = g.columnCount; } }); });
    }
    bk.sheets.forEach(function (sh) {
      var s = sh._s, n = need[s.name]; if (!n) return;
      var gr = s.gridR || 1000, gc = s.gridC || 26;
      if (n.c > gc) reqs.push({ appendDimension: { sheetId: s.id, dimension: 'COLUMNS', length: n.c - gc } });
      if (n.r > gr) reqs.push({ appendDimension: { sheetId: s.id, dimension: 'ROWS', length: n.r - gr } });
    });
    if (!reqs.length) return;
    await gapi('POST', API.sheets + '/' + bk.id + ':batchUpdate', { requests: reqs });
    bk.sheets.forEach(function (sh) { var s = sh._s, n = need[s.name]; if (!n) return; s.gridC = Math.max(s.gridC || 26, n.c); s.gridR = Math.max(s.gridR || 1000, n.r); });
  }
  var NOID = -1;
  function same(a, b) { return String(a === undefined || a === null ? '' : a) === String(b === undefined || b === null ? '' : b); }
  function isBlankRow(r) { return !(r || []).some(function (v) { return v !== '' && v !== undefined && v !== null; }); }
  async function readRanges(id, ranges) {
    if (!ranges.length) return [];
    var v = await gapi('GET', API.sheets + '/' + id + '/values:batchGet?' + ranges.map(function (r) { return 'ranges=' + enc(r); }).join('&') + '&valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING');
    return (v.valueRanges || []).map(function (x) { return x.values || []; });
  }
  // 바꾼 칸을 쓰기 전에 그 줄을 시트에서 다시 읽어 확인한다.
  //  · 줄 번호의 ID가 내가 알던 ID와 다르면(다른 곳에서 줄을 끼우거나 지움) ID로 다시 찾아 그 줄에 쓴다. 못 찾으면 쓰지 않는다.
  //  · 내가 쓸 칸과 [상태]·[상세] 칸이 내가 알던 값과 달라졌으면(다른 곳에서 먼저 고침) 그 줄은 저장을 멈추고 알린다.
  //  · 새 줄을 추가하려는 자리에 이미 다른 줄이 생겼으면 시트의 맨 아래로 옮겨 쓴다.
  async function verifyRows(bk, marks) {
    var res = { writes: [], conflicts: [], moved: false };
    var work = marks.filter(function (m) { return !m.full && !m.fresh && Object.keys(m.dirty).length; });
    // 줄 번호가 없는 탭([_설정] 등)·새 탭은 확인 없이 칸만 쓴다
    marks.forEach(function (m) {
      if (work.indexOf(m) >= 0) return;
      Object.keys(m.dirty).forEach(function (r) { res.writes.push({ tab: m.s.name, row: +r, cols: Object.keys(m.dirty[r]).map(Number), vals: m.snap[r] || m.s.data[r - 1] || [] }); });
    });
    if (!work.length) return res;
    var info = work.map(function (m) {
      var hdr = (m.s.data[0] || []).map(function (h) { return String(h === undefined || h === null ? '' : h).trim(); });
      var rows = Object.keys(m.dirty).map(Number).sort(function (a, b) { return a - b; });
      var width = 0; m.s.data.forEach(function (r) { width = Math.max(width, (r || []).length); }); width = Math.max(width, m.prevCols || 0, 1);
      return { m: m, s: m.s, hdr: hdr, rows: rows, width: width, idc: hdr.indexOf('ID'), guard: ['상태', '상세'].map(function (h) { return hdr.indexOf(h) + 1; }).filter(function (c) { return c > 0; }) };
    });
    // 1) 바꾼 줄 읽기 (이어진 줄은 한 범위로)
    var ranges = [], owner = [];
    info.forEach(function (t) {
      var blk = null;
      var push = function () { if (blk) { ranges.push(q(t.s.name) + '!A' + blk[0] + ':' + colName(t.width) + blk[1]); owner.push({ t: t, r0: blk[0], r1: blk[1] }); } };
      t.rows.forEach(function (r) { if (blk && r === blk[1] + 1) blk[1] = r; else { push(); blk = [r, r]; } });
      push();
    });
    var got = await readRanges(bk.id, ranges);
    info.forEach(function (t) { t.remote = {}; });
    owner.forEach(function (o, i) { for (var r = o.r0; r <= o.r1; r++) o.t.remote[r] = (got[i] || [])[r - o.r0] || []; });
    // 2) 어긋난 줄 찾기
    var lost = [];
    info.forEach(function (t) {
      t.work = [];
      t.rows.forEach(function (r) {
        var orig = t.m.orig[r], cols = Object.keys(t.m.dirty[r]).map(Number);
        if (r === 1) { t.work.push({ r: r, to: r, cols: cols, orig: null }); return; } // 머리글 줄
        if (!orig) { t.work.push({ r: r, to: r, cols: cols, orig: null }); return; } // 바꾸기 전 모습을 모르면(옛 저장본) 칸만 쓴다
        var oid = t.idc >= 0 ? String(orig[t.idc] === undefined || orig[t.idc] === null ? '' : orig[t.idc]).trim() : '';
        var rem = t.remote[r] || [];
        var item = { r: r, to: r, cols: cols, orig: orig, oid: oid, append: isBlankRow(orig) };
        var sr0 = t.m.snap[r] || t.s.data[r - 1] || [], sid = t.idc >= 0 ? String(sr0[t.idc] === undefined || sr0[t.idc] === null ? '' : sr0[t.idc]).trim() : '';
        item.sid = sid;
        // 새 줄 자리에 이미 같은 ID의 줄이 있으면 같은 줄이다(다른 창이 먼저 저장함). 다른 줄이면 시트 맨 아래로 옮긴다
        if (item.append) { if (!isBlankRow(rem) && !(sid && String(rem[t.idc] === undefined || rem[t.idc] === null ? '' : rem[t.idc]).trim() === sid)) { item.to = 0; lost.push([t, item]); } }
        else if (oid && String(rem[t.idc] === undefined || rem[t.idc] === null ? '' : rem[t.idc]).trim() !== oid) { item.to = 0; lost.push([t, item]); }
        t.work.push(item);
      });
    });
    // 3) 어긋난 줄이 있으면 그 탭의 ID·제목 칸을 읽어 다시 찾는다
    if (lost.length) {
      res.moved = true;
      var tabs = [];
      lost.forEach(function (x) { if (tabs.indexOf(x[0]) < 0) tabs.push(x[0]); });
      var cranges = [];
      tabs.forEach(function (t) { var c1 = t.idc >= 0 ? t.idc + 1 : 1, c2 = Math.max(t.hdr.indexOf('할일') + 1, 1); cranges.push(q(t.s.name) + '!' + colName(c1) + '1:' + colName(c1)); cranges.push(q(t.s.name) + '!' + colName(c2) + '1:' + colName(c2)); });
      var cg = await readRanges(bk.id, cranges);
      var fetchRows = [];
      tabs.forEach(function (t, i) {
        var ids = cg[i * 2] || [], tit = cg[i * 2 + 1] || [], last = Math.max(ids.length, tit.length), at = {};
        ids.forEach(function (v, j) { var k = String((v || [])[0] === undefined || (v || [])[0] === null ? '' : v[0]).trim(); if (k && !at[k]) at[k] = j + 1; });
        var next = last + 1;
        lost.filter(function (x) { return x[0] === t; }).forEach(function (x) {
          var it = x[1];
          if (it.append) { it.to = (it.sid && at[it.sid]) || next++; it.rem = []; return; }
          it.to = at[it.oid] || 0;
          if (it.to) fetchRows.push([t, it]);
        });
      });
      var rg = fetchRows.map(function (x) { return q(x[0].s.name) + '!A' + x[1].to + ':' + colName(x[0].width) + x[1].to; });
      var rgot = await readRanges(bk.id, rg);
      fetchRows.forEach(function (x, i) { x[1].rem = (rgot[i] || [])[0] || []; });
    }
    // 4) 칸마다 확인하고 쓸 것을 정한다
    info.forEach(function (t) {
      t.work.forEach(function (it) {
        var src = t.m.snap[it.r] || t.s.data[it.r - 1] || [];
        if (!it.orig) { res.writes.push({ tab: t.s.name, row: it.to, cols: it.cols, vals: src }); return; }
        if (!it.to) { res.conflicts.push(conflictOf(t, it, src, '줄을 찾지 못함')); return; }
        if (it.append) { res.writes.push({ tab: t.s.name, row: it.to, cols: it.cols, vals: src }); return; }
        var rem = it.rem || t.remote[it.r] || [], guard = it.cols.concat(t.guard), bad = [];
        guard.forEach(function (c) {
          if (bad.indexOf(c) >= 0) return;
          var mine = same(src[c - 1], it.orig[c - 1]) ? null : src[c - 1]; // 내가 바꾼 값 (안 바꾼 칸은 null)
          if (!same(rem[c - 1], it.orig[c - 1]) && (mine === null || !same(rem[c - 1], mine))) bad.push(c);
        });
        if (bad.length) {
          res.conflicts.push(conflictOf(t, it, src, '다른 곳에서 먼저 바뀜', bad, rem));
          if (!res.moved && it.to === it.r) { // 줄 번호가 그대로면 화면의 그 줄을 시트의 모습으로 맞춘다
            var arr = t.s.data[it.r - 1] = (t.s.data[it.r - 1] || []).slice();
            for (var j = 0; j < Math.max(arr.length, rem.length); j++) arr[j] = rem[j] === undefined ? '' : rem[j];
          }
          return;
        }
        res.writes.push({ tab: t.s.name, row: it.to, cols: it.cols, vals: src });
      });
    });
    return res;
  }
  function conflictOf(t, it, src, why, bad, rem) {
    var tc = t.hdr.indexOf('할일'), ic = t.idc;
    var pick = function (r, c) { return c >= 0 && r && r[c] !== undefined && r[c] !== null ? String(r[c]) : ''; };
    return { tab: t.s.name, row: it.r, id: pick(it.orig, ic) || pick(src, ic), title: pick(src, tc) || pick(it.orig, tc), why: why, cols: (bad || it.cols).map(function (c) { return t.hdr[c - 1] || ''; }).filter(String) };
  }
  function restore(marks) {
    marks.forEach(function (m) {
      var s = m.s; if (m.full) s.full = true;
      Object.keys(m.dirty).forEach(function (r) { var d = s.dirty[r] = s.dirty[r] || {}; Object.keys(m.dirty[r]).forEach(function (c) { d[c] = 1; }); if (m.orig[r]) s.orig[r] = m.orig[r]; });
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
    var metaP = gapi('GET', API.sheets + '/' + id + '?fields=' + enc('properties(timeZone),sheets(properties(sheetId,title,hidden,index,gridProperties(rowCount,columnCount)))'));
    var valsP = hint && hint.length ? getVals(hint) : null;
    if (valsP) valsP.catch(function () {}); // 탭 이름이 바뀌었으면 아래에서 다시 읽는다
    var meta = await metaP;
    var sheets = (meta.sheets || []).map(function (x) { return x.properties; }).sort(function (a, b) { return (a.index || 0) - (b.index || 0); });
    var titles = sheets.map(function (s) { return s.title; });
    var vals = null;
    if (valsP && titles.every(function (t) { return hint.indexOf(t) >= 0; })) { try { vals = await valsP; } catch (e) { vals = null; } }
    if (!vals) vals = await getVals(titles);
    store.set('kitTabs:' + id, JSON.stringify(titles));
    return { id: id, tz: meta.properties && meta.properties.timeZone, sheets: sheets.map(function (s) { var g = s.gridProperties || {}; return { title: s.title, sheetId: s.sheetId, hidden: s.hidden, rows: vals[s.title] || [], gridR: g.rowCount, gridC: g.columnCount }; }) };
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
        var x = sh._s, fl = inflight.filter(function (m) { return m.s === x; })[0], dc = {}, od = {};
        var addCols = function (src) { Object.keys(src).forEach(function (r) { var c = dc[r] = dc[r] || []; Object.keys(src[r]).forEach(function (k) { if (c.indexOf(+k) < 0) c.push(+k); }); }); };
        addCols(x.dirty); if (fl) addCols(fl.dirty);
        Object.keys(x.orig).forEach(function (r) { od[r] = x.orig[r].map(toCell); });
        if (fl) Object.keys(fl.orig).forEach(function (r) { od[r] = fl.orig[r].map(toCell); }); // 아직 못 보낸 쪽의 '바뀌기 전 모습'이 기준
        return { t: x.name, id: x.id, h: x.hidden, hc: x.hiddenChanged, n: x.isNew, f: x.full || !!(fl && fl.full), dc: dc, od: od, pr: x.prevRows, pc: x.prevCols, r: x.data.map(function (row) { return (row || []).map(toCell); }) };
      }) }));
    } catch (e) {}
  }
  function readSnap(id) {
    var o = null; try { o = JSON.parse(store.get('kitBook:' + id) || 'null'); } catch (e) { o = null; }
    if (!o || o.v !== 1 || !o.sheets || !o.sheets.length) return null;
    var b = makeBook({ id: id, tz: o.tz, sheets: o.sheets.map(function (x) { return { title: x.t, sheetId: x.id, hidden: x.h, rows: x.r, isNew: x.n }; }) });
    b.tzChanged = !!o.tzc; b.removed = o.rm || [];
    b.sheets.forEach(function (sh, i) { var x = o.sheets[i], st = sh._s; st.isNew = !!x.n; st.hiddenChanged = !!x.hc; st.full = !!x.f; 
      if (x.dc) { Object.keys(x.dc).forEach(function (r) { st.dirty[r] = {}; x.dc[r].forEach(function (c) { st.dirty[r][c] = 1; }); }); Object.keys(x.od || {}).forEach(function (r) { st.orig[r] = x.od[r]; }); }
      else (x.d || []).forEach(function (r) { st.dirty[r] = {}; for (var c = 1; c <= (x.r[r - 1] || []).length; c++) st.dirty[r][c] = 1; }); // 옛 저장본: 그 줄 전체
      st.prevRows = x.pr || 0; st.prevCols = x.pc || 0; });
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
    var f = await gapi('POST', API.drive + '/files?fields=id', { name: SHEET_NAME, mimeType: 'application/vnd.google-apps.spreadsheet', appProperties: { myTaskKit: '1' }, description: 'GTD 워크가 만든 시트예요. 지우면 앱의 데이터도 사라져요.' });
    store.set('kitSheetId', f.id);
    // 방금 만든 빈 시트는 다시 읽지 않는다: 기본 탭(sheetId 0) 하나뿐이다. 시간대는 setup 이 서울로 맞춘다
    applyBook({ id: f.id, tz: 'Etc/UTC', sheets: [{ title: 'Sheet1', sheetId: 0, hidden: false, rows: [], gridR: 1000, gridC: 26 }] });
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
 * GTD 워크 — 설정
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
 *
 * ※ 열(COLUMNS)·상태(STATUS)·탭 이름을 바꾸거나 추가하면 AI 연결 안내문(App.html aiPrompt)도 같이 고친다.
 *   기준 문서: docs/AI-연결.md · 빠뜨리면 tests/v2-tests.js 'AI 연결 안내문이 시트 구조와 맞음'이 실패한다.
 */

var KIT = {
  NAME: 'GTD 워크',
  VERSION: '1.17.3',       // 코드 버전 (화면 표시용)
  SCHEMA_VERSION: 9,      // 시트 구조 버전 (구조가 바뀔 때만 올림) — v2: '반복' 열, v3: '프로젝트' 열·'참고' 상태, v4: '오늘 할 날'·'예상(분)'·'우선순위' 열, v5: '맡긴 날' 열, v6: '긴급'·'쓴 시간(분)'·'미룬 횟수' 열, v7: '상세'·'출처'·'분류일'·'프로젝트ID'·'단계'·'★다음'·'에너지'·'확인 횟수' 열 + [프로젝트] 탭 새 열, v8: [AI기록]·[AI제안] 탭 (앱이 만든다), v9: [업무] 맨 끝 'AI 처리' 열(요청/처리중/완료/막힘)
  TASK_SHEET: '업무',
  DASH_SHEET: '오늘',
  SETTINGS_SHEET: '_설정',
  PROJECT_SHEET: '프로젝트', // 프로젝트 이름 · 완료 모습 (처음 적을 때 생긴다)
  AI_LOG_SHEET: 'AI기록',     // v8: AI가 시트를 바꿀 때마다 한 줄씩 추가(되돌리기용). 앱이 만든다
  AI_PROPOSAL_SHEET: 'AI제안', // v8: AI가 올리는 제안(적용·거절은 앱에서). 앱이 만든다
  AI_RULES_VERSION: 5,        // AI 규칙 파일 버전: AI 안내(규칙 파일·요청 팩)를 바꾸면 올린다 (요청 팩이 이 번호와 맞는지 AI에게 확인시킨다)
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
    note: '2단계 이상 걸리는 일의 묶음 이름. 같은 이름을 적으면 한 프로젝트로 묶입니다.\n주간 정리에서 "다음 행동이 없는 프로젝트"를 알려 줍니다.' },
  { key: 'focus',     header: '오늘 할 날', width: 100, since: 4, aliases: [], type: 'date',
    note: '★ 오늘로 올린 날. 이 날짜가 되면 [오늘 꼭 할 일]에 맨 위로 올라옵니다.' },
  { key: 'est',       header: '예상(분)',   width: 80,  since: 4, aliases: [], type: 'number',
    note: '예상 소요 시간(분). 타임박스 자동 배치에 씁니다. 비우면 30분으로 계산합니다.' },
  { key: 'priority',  header: '우선순위',   width: 80,  since: 4, aliases: [], list: ['높음', '보통', '낮음'] },
  { key: 'delegatedOn', header: '맡긴 날',  width: 100, since: 5, aliases: [], type: 'date',
    note: '위임으로 바꾼 날. 자동으로 적힙니다. "며칠째 기다리는지" 계산에 씁니다.' },
  { key: 'urgent',    header: '긴급',       width: 60,  since: 6, aliases: [], list: ['급함'],
    note: '급한 일(↑). 우선순위 "높음"(★ 중요)과 함께 중요·긴급 4분면을 만듭니다.' },
  { key: 'spent',     header: '쓴 시간(분)', width: 90, since: 6, aliases: [], type: 'number',
    note: '실제로 쓴 시간(분). 시간표에서 끝낸 블록의 길이가 자동으로 적힙니다.' },
  { key: 'postponed', header: '미룬 횟수',  width: 80,  since: 6, aliases: [], type: 'number',
    note: '내일·다른 날로 미룬 횟수. 자동으로 셉니다.' },
  { key: 'detail',    header: '상세',       width: 360, since: 7, aliases: [],
    note: '할 일의 자세한 글(마크다운). 배경·출처·다음 단계·완료 기준 등. 첫 글자는 ## 로 시작해 주세요(=,+,-,@로 시작하면 시트가 수식으로 읽을 수 있어요).' },
  { key: 'source',    header: '출처',       width: 90,  since: 7, aliases: [],
    note: '누가 넣었는지. 직접 / AI:Claude / AI:Grok / 머리비우기:사람 등.' },
  { key: 'triaged',   header: '분류일',     width: 100, since: 7, aliases: [], type: 'date',
    note: '분류를 마친 날. 비어 있으면 오늘 화면의 "분류 대기"에 보입니다. 앱의 분류 버튼이 오늘 날짜를 적습니다.' },
  { key: 'projectId', header: '프로젝트ID', width: 90,  since: 7, aliases: [],
    note: '[프로젝트] 탭의 ID(P-로 시작). 프로젝트 이름이 바뀌어도 이 번호로 이어집니다. 앱이 채웁니다.' },
  { key: 'stage',     header: '단계',       width: 80,  since: 7, aliases: [],
    note: '프로젝트 안의 단계 이름 또는 번호.' },
  { key: 'nextMark',  header: '★다음',      width: 70,  since: 7, aliases: [], list: ['★'],
    note: '이 프로젝트의 다음 행동 표시(★). 프로젝트마다 하나만. 앱의 호박색 "다음" 칩입니다. (★ 중요=우선순위 높음 과는 다릅니다)' },
  { key: 'energy',    header: '에너지',     width: 70,  since: 7, aliases: [], list: ['높음', '보통', '낮음'],
    note: '이 일에 드는 에너지.' },
  { key: 'checks',    header: '확인 횟수',  width: 80,  since: 7, aliases: [], type: 'number',
    note: '맡긴 일을 확인한 횟수. 자동으로 셉니다.' },
  { key: 'aiProcess', header: 'AI 처리',    width: 80,  since: 9, aliases: [], list: ['요청', '처리중', '완료', '막힘'],
    note: 'AI에게 맡긴 일의 상태. 빈칸 = 요청 아님. 요청(앱의 AI 버튼) → 처리중 → 완료 / 막힘(사람 확인이 필요해 초안만 남김). AI 에이전트가 정기적으로 시트를 볼 때 "요청"인 일을 스스로 처리합니다.' }
];

var PRIORITY_ORDER = { '높음': 0, '보통': 1, '': 1, '낮음': 2 };

/**
 * 시트 구조 변환. 키 = 도달할 SCHEMA_VERSION.
 * ctx = { ss, sheet, map } (map: 열 key → 열 번호, 새 열 추가 후의 상태)
 * 규칙: 기존 데이터를 지우지 말 것. 여러 번 실행돼도 결과가 같게(멱등) 짤 것.
 *
 * 예) 2: function (ctx) { renameStatusValues_(ctx, { '대기': '위임' }); }
 */
var MIGRATIONS = {
  // v7: 프로젝트 ID 부여 · 업무 줄의 프로젝트ID 채움 · 기존 줄은 분류일을 채워 '분류 대기'로 쏟아지지 않게 (35_Projects.gs)
  7: function (ctx) { migrateToV7_(ctx); },
  // v8: [AI기록]·[AI제안] 탭 만들기 (없는 탭만. 기존 탭·열·값은 그대로) (37_Ai.gs)
  8: function (ctx) { ensureAiSheets_(ctx.ss); },
  // v9: [업무] 맨 끝에 'AI 처리' 열 머리글만 더한다(빈 머리글이 없을 때만. 기존 줄의 값은 비워 둔다 = 요청 아님)
  9: function (ctx) { if (!ctx.map.aiProcess) { var col = ctx.sheet.getLastColumn() + 1; ctx.sheet.getRange(1, col).setValue('AI 처리'); } }
};

/* ── 10_Util.gs ── */
/** GTD 워크 — 공통 도우미 (시트에 의존하지 않는 순수 함수) */

function colLetter_(n) {
  var s = '';
  while (n > 0) {
    var m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** 시트가 수식으로 읽지 않게: =,+,-,@로 시작하는 글 앞에 공백 (상세 글·AI 경로와 같은 방식) */
function textCell_(v, key) {
  if (typeof v !== 'string') return v;
  // 상황 칸의 '@컴퓨터'는 앱이 쓰는 정식 표기라 @는 막지 않는다
  return (key === 'context' ? /^[=+\-]/ : /^[=+\-@]/).test(v) ? ' ' + v : v;
}
var TEXT_KEYS_ = { title: 1, memo: 1, context: 1, delegatee: 1, project: 1 };

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
    delegatedOn: ymd_(get('delegatedOn'), tz),
    urgent: str('urgent'),
    spent: Math.max(0, Math.round(Number(get('spent')) || 0)),
    postponed: Math.max(0, Math.round(Number(get('postponed')) || 0)),
    detail: (function () { var v = get('detail'); return v === null || v === undefined ? '' : String(v); })(),
    source: str('source'),
    triaged: ymd_(get('triaged'), tz),
    projectId: str('projectId'),
    stage: str('stage'),
    nextMark: str('nextMark') === '★',
    energy: str('energy'),
    checks: Math.max(0, Math.round(Number(get('checks')) || 0)),
    aiProcess: str('aiProcess')
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
 * GTD 워크 — 시트 구조 (설치·업데이트·마이그레이션)
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
/** GTD 워크 — 업무 읽기·쓰기 */

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
  // 프로젝트ID를 먼저, 없으면 이름으로 프로젝트에 잇는다 (이름이 달라도 안 끊김)
  return ctx.ss ? linkProjects_(out, readProjectRows_(ctx.ss)) : out;
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
/** 등록할 때 넣는 상세 글: 첫 글자가 '## '가 아니면 '## 메모'로 감싼다(=·+·-·@로 시작하면 시트가 수식으로 읽을 수 있음). 4만 자까지 */
function normDetail_(v) {
  var d = String(v === null || v === undefined ? '' : v).replace(/\r\n?/g, '\n').trim();
  if (!d) return '';
  if (d.length > 40000) throw new Error('상세 글이 너무 길어요(4만 자까지).');
  return /^##\s/.test(d) ? d : '## 메모\n' + d;
}

function addTasks(text, opts) {
  var source = (opts && String(opts.source || '').trim()) || '직접';
  var detailIn = opts && opts.detail !== undefined ? normDetail_(opts.detail) : '';
  var lines = String(text || '').split(/\r?\n/)
    .map(function (s) { return s.replace(/^\s*[-*•·]\s*/, '').trim(); })
    .filter(function (s) { return s !== ''; });
  if (!lines.length) return { added: 0 };

  return withLock_(function () {
    var ctx = taskContext_();
    var today = todayYmd_(ctx.tz);
    var names = readProjectRows_(ctx.ss).filter(function (r) { return !r.dropped && r.state !== '끝남' && r.state !== '보류'; }).map(function (r) { return r.name; });
    var parsed = lines.map(function (line) { return parseCapture_(line, today, names); });
    appendTasks_(ctx, parsed.map(function (p) {
      // 담은 일은 곧 오늘 할 일(★). 날짜를 적었으면 그날의 일정으로 (따로 '정리하기' 단계 없음)
      var later = p.due && p.due > today;
      var t = { title: p.title, status: later ? STATUS.SCHEDULED : STATUS.NEXT, created: today, source: source };
      if (!later) t.focus = today;
      ['due', 'context', 'project', 'priority', 'est'].forEach(function (k) { if (p[k]) t[k] = p[k]; });
      // 날짜·@상황·#프로젝트를 직접 적었으면 사람이 정한 것으로 본다: 분류 대기(정리할 것)를 건너뛴다. '!'·'30분'만 있으면 그대로 정리할 것
      if (p.due || p.context || p.project) t.triaged = today;
      if (t.project) t.projectId = projectIdForName_(ctx.ss, t.project);
      if (detailIn && lines.length === 1) t.detail = detailIn; // 한 건을 담을 때만 상세를 같이 쓴다(여러 줄이면 어느 줄의 상세인지 알 수 없음)
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
function parseCapture_(text, today, names) {
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
  // 이미 있는 프로젝트 이름이면 띄어쓰기·숫자로 시작해도 알아듣는다(긴 이름부터). 없는 이름은 아래 일반 규칙만.
  var known = (names || []).map(function (n) { return String(n || '').trim(); }).filter(String).sort(function (a, b) { return b.length - a.length; });
  for (var ni = 0; ni < known.length; ni++) {
    if (t.indexOf(' #' + known[ni] + ' ') >= 0) { out.project = known[ni]; t = t.replace(' #' + known[ni] + ' ', '  '); break; }
  }
  if (!out.project) take(/\s#([^\s#\d][^\s#]*)(?=\s)/, function (m) { out.project = m[1]; return 1; });
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
    Object.keys(t).forEach(function (key) { if (ctx.map[key] && t[key] !== undefined) r[ctx.map[key] - 1] = TEXT_KEYS_[key] ? textCell_(t[key], key) : t[key]; });
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
    memo: task.memo, repeat: task.repeat, created: today, triaged: today
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
    // 이미 '완료'인 줄을 또 완료하면(연타·두 기기) 아무것도 쓰지 않는다: 완료일을 덮지 않고 다음 회차도 또 만들지 않는다
    if (d.onlyIfOpen && before.status === STATUS.DONE) return { ok: true, noop: true, next: '', nextId: '', askNext: null };
    var set = function (key, val) {
      if (ctx.map[key] && val !== undefined) ctx.sheet.getRange(row, ctx.map[key]).setValue(TEXT_KEYS_[key] ? textCell_(val, key) : val);
    };
    if (d.title !== undefined && String(d.title).trim()) set('title', String(d.title).trim());
    set('status', d.status);
    if (d.due !== undefined) set('due', ymd_(d.due));
    if (d.context !== undefined) set('context', String(d.context).trim());
    if (d.delegatee !== undefined) set('delegatee', String(d.delegatee).trim());
    if (d.followUp !== undefined) set('followUp', ymd_(d.followUp));
    if (d.memo !== undefined && String(d.memo).trim()) set('memo', String(d.memo).trim());
    if (d.repeat !== undefined) set('repeat', String(d.repeat).trim());
    if (d.project !== undefined) { set('project', String(d.project).trim()); set('projectId', projectIdForName_(ctx.ss, d.project)); }
    if (d.est !== undefined) set('est', Number(d.est) > 0 ? Math.round(Number(d.est)) : '');
    if (d.priority !== undefined) set('priority', ['높음', '보통', '낮음'].indexOf(d.priority) !== -1 ? d.priority : '');
    if (d.focus !== undefined) set('focus', d.focus === true ? today : ymd_(d.focus));
    if (!before.triaged) set('triaged', today); // 상태를 정한 것 = 분류를 마친 것
    applyTrack_(ctx, row, d);
    set('completed', d.status === STATUS.DONE ? today : '');
    if (d.status === STATUS.DELEGATED && before.status !== STATUS.DELEGATED) set('delegatedOn', today);
    var next = '', nextId = '', proj = null;
    if (d.status === STATUS.DONE || d.status === STATUS.DROPPED) {
      var t = rowToTask_(ctx.sheet.getRange(row, 1, 1, ctx.sheet.getLastColumn()).getValues()[0], ctx.map, ctx.tz, row);
      LAST_SPAWN_ID_ = '';
      if (t.repeat && (d.status === STATUS.DONE || d.skip)) { next = spawnNextOccurrence_(ctx, t, today); nextId = next ? LAST_SPAWN_ID_ : ''; }
      // 프로젝트 할 일을 끝냈을 때만 "이 프로젝트의 다음은?"을 물을 수 있게 알려 준다 (프로젝트 밖 할 일에는 없음)
      if (d.status === STATUS.DONE && !isClosedStatus_(before.status)) {
        var me = readAllTasks_(ctx).filter(function (x) { return x.id === id; })[0];
        if (me && me.project) {
          var pr = readProjectRows_(ctx.ss).filter(function (r) { return r.id && r.id === me.pid; })[0];
          if (!pr || pr.state === '진행') proj = { name: me.project, id: me.pid || '', wasNext: !!before.nextMark };
        }
      }
      if (before.nextMark && ctx.map.nextMark) set('nextMark', ''); // 끝낸 일의 '다음' 칩은 내린다
    }
    return { ok: true, next: next, nextId: nextId, askNext: proj, undo: undoOf_(id, before, nextId, d) };
  });
}

/**
 * 정리 안 한 일(분류일이 빈 줄)을 한 번에 정리한다 ('모두 오늘 할 일로').
 *  - 수집함·빈칸·나중에: 다음 행동 + 오늘 할 날=오늘
 *  - 미래 마감 일정(일정·다음 행동): 상태·날짜 그대로(오늘 할 날을 쓰지 않음)
 *  - 맡긴 일: 상태·날짜 그대로
 *  - 그 밖: 오늘 할 날=오늘
 * 모두 분류일=오늘. 분류일이 이미 있는 줄은 건드리지 않는다. 쓴 칸의 원래 값은 undo.triage로 돌려준다.
 */
function triageMany(ids, mode) {
  ids = (Array.isArray(ids) ? ids : []).map(String);
  if (!ids.length) throw new Error('정리할 일을 골라 주세요.');
  return withLock_(function () {
    var ctx = taskContext_();
    if (!ctx.map.triaged) throw new Error('먼저 업데이트를 적용해 주세요.');
    var today = todayYmd_(ctx.tz), n = 0, before = [];
    var day = mode === 'tomorrow' ? addDaysYmd_(today, 1) : today; // 'tomorrow': 오늘 정리에서 '모두 내일 할 일로'
    readAllTasks_(ctx).forEach(function (t) {
      if (ids.indexOf(t.id) < 0 || t.triaged || isClosedStatus_(t.status)) return;
      var rec = { id: t.id, status: t.status, focus: t.focus || '' };
      var set = function (key, val) { if (ctx.map[key]) ctx.sheet.getRange(t.row, ctx.map[key]).setValue(val); };
      var loose = t.status === STATUS.INBOX || t.status === '' || t.status === STATUS.SOMEDAY;
      var future = !!t.due && t.due > today && (t.status === STATUS.SCHEDULED || t.status === STATUS.NEXT);
      // '모두 나중에': 맡긴 일·참고·미래 일정은 분류일만 채우고 상태·오늘 할 날은 그대로(맡긴 일·확인할 것에서 사라지지 않게)
      if (mode === 'later') { if (!(future || t.status === STATUS.DELEGATED || t.status === STATUS.REFERENCE)) { set('status', STATUS.SOMEDAY); set('focus', ''); } set('triaged', today); before.push(rec); n++; return; }
      if (loose) { set('status', STATUS.NEXT); }
      if ((loose || (!future && t.status !== STATUS.DELEGATED && t.status !== STATUS.REFERENCE)) && t.focus !== day) set('focus', day);
      set('triaged', today);
      before.push(rec); n++;
    });
    return { ok: true, count: n, undo: before.length ? { triage: before } : undefined };
  });
}

/** '모두 오늘 할 일로' 되돌리기: 상태·오늘 할 날을 원래 값으로, 분류일은 다시 비운다 (그 줄이 아직 이 호출로 정리된 그대로일 때만) */
function restoreTriage_(list) {
  return withLock_(function () {
    var ctx = taskContext_(), n = 0, by = {};
    (list || []).forEach(function (x) { by[String(x.id)] = x; });
    readAllTasks_(ctx).forEach(function (t) {
      var x = by[t.id]; if (!x) return;
      if (ctx.map.status && x.status !== t.status && !isClosedStatus_(t.status)) ctx.sheet.getRange(t.row, ctx.map.status).setValue(x.status);
      if (ctx.map.focus && (x.focus || '') !== (t.focus || '')) ctx.sheet.getRange(t.row, ctx.map.focus).setValue(x.focus ? ymd_(x.focus) : '');
      if (ctx.map.triaged && t.triaged) ctx.sheet.getRange(t.row, ctx.map.triaged).setValue('');
      n++;
    });
    return { ok: true, count: n };
  });
}

/** 되돌리기 정보. 분류 버튼으로 정한 것(d.triage)은 되돌리면 다시 '분류 대기'가 되게 untriage를 싣는다 */
function undoOf_(id, before, nextId, d) {
  var u = { id: id, status: before.status, focus: before.focus, nextId: nextId };
  if (before.nextMark) u.nextMark = '★';
  if (!before.triaged) u.untriage = true; // 분류 버튼이든 완료든 이 호출이 분류일을 채웠으면, 되돌릴 때 다시 비운다
  return u;
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
    appendTasks_(ctx, [{ title: title, status: STATUS.SCHEDULED, due: due, repeat: String(rule).trim(), context: String(context || '').trim(), created: today, triaged: today, source: '직접' }]);
    return { ok: true, due: due };
  });
}

/**
 * 업무 일부만 고치기 (상태는 그대로). 허용: focus(★ 오늘 할 날, true=오늘, ''=해제), est, priority,
 * memoAppend(메모 뒤에 덧붙이기), due, context, project, title, followUp, delegatee, stage, energy, triage(true면 분류일=오늘)
 */
function updateTask(id, patch) {
  patch = patch || {};
  return withLock_(function () {
    var ctx = taskContext_();
    var row = findRowById_(ctx, id);
    if (!row) throw new Error('항목을 찾지 못했습니다. 시트에서 지워졌을 수 있습니다.');
    var today = todayYmd_(ctx.tz);
    var set = function (key, val) { if (ctx.map[key]) ctx.sheet.getRange(row, ctx.map[key]).setValue(TEXT_KEYS_[key] ? textCell_(val, key) : val); };
    if (patch.title !== undefined && String(patch.title).trim()) set('title', String(patch.title).trim());
    if (patch.focus !== undefined) set('focus', patch.focus === true ? today : ymd_(patch.focus));
    if (patch.est !== undefined) set('est', Number(patch.est) > 0 ? Math.round(Number(patch.est)) : '');
    if (patch.priority !== undefined) set('priority', ['높음', '보통', '낮음'].indexOf(patch.priority) !== -1 ? patch.priority : '');
    if (patch.due !== undefined) set('due', ymd_(patch.due));
    if (patch.context !== undefined) set('context', String(patch.context).trim());
    if (patch.project !== undefined) { set('project', String(patch.project).trim()); set('projectId', projectIdForName_(ctx.ss, patch.project)); if (!String(patch.project).trim()) set('nextMark', ''); }
    if (patch.followUp !== undefined) set('followUp', ymd_(patch.followUp));
    if (patch.delegatee !== undefined && String(patch.delegatee).trim()) set('delegatee', String(patch.delegatee).trim());
    if (patch.stage !== undefined) set('stage', String(patch.stage).trim());
    if (patch.energy !== undefined) set('energy', ['높음', '보통', '낮음'].indexOf(patch.energy) !== -1 ? patch.energy : '');
    if (patch.aiProcess !== undefined) set('aiProcess', ['요청', '처리중', '완료', '막힘'].indexOf(patch.aiProcess) !== -1 ? patch.aiProcess : '');
    if (patch.triage) set('triaged', today);
    applyTrack_(ctx, row, patch);
    if (patch.memoAppend && ctx.map.memo) {
      var cur = String(ctx.sheet.getRange(row, ctx.map.memo).getValue() || '').trim();
      var add = '[' + today.slice(5) + '] ' + String(patch.memoAppend).trim();
      set('memo', cur ? cur + '\n' + add : add);
    }
    return { ok: true };
  });
}

/** 긴급(↑)·쓴 시간·미룬 횟수: patch.urgent(true/false), patch.spent(분), patch.postpone(true면 +1) */
function applyTrack_(ctx, row, p) {
  var set = function (key, val) { if (ctx.map[key]) ctx.sheet.getRange(row, ctx.map[key]).setValue(val); };
  if (p.urgent !== undefined) set('urgent', p.urgent ? '급함' : '');
  if (p.spent !== undefined) set('spent', Number(p.spent) > 0 ? Math.round(Number(p.spent)) : '');
  if (p.check && ctx.map.checks) {
    var cc = Number(ctx.sheet.getRange(row, ctx.map.checks).getValue()) || 0;
    set('checks', cc + 1);
  }
  if (p.postpone && ctx.map.postponed) {
    var cur = Number(ctx.sheet.getRange(row, ctx.map.postponed).getValue()) || 0;
    set('postponed', cur + 1);
  }
}

/** 여러 업무의 ★ 날짜를 한 번에 (오늘 마무리 → 내일, 주간 정리 → 다음 주 월요일). 한 번의 왕복으로 끝낸다 */
function setFocusMany(ids, focus) {
  ids = (ids || []).map(String);
  return withLock_(function () {
    var ctx = taskContext_();
    if (!ctx.map.focus) throw new Error('먼저 업데이트를 적용해 주세요.');
    var today = todayYmd_(ctx.tz), val = focus === true ? today : ymd_(focus);
    var n = 0;
    readAllTasks_(ctx).forEach(function (t) {
      if (ids.indexOf(t.id) === -1) return;
      ctx.sheet.getRange(t.row, ctx.map.focus).setValue(val);
      // 오늘(또는 그 이전) ★였던 일을 더 늦은 날로 보내면 미룬 횟수 +1. 같은 날로 다시 지정하거나 ★가 없던 일은 세지 않는다(두 번 불러도 한 번만)
      if (ctx.map.postponed && t.focus && t.focus <= today && val && val > t.focus) {
        ctx.sheet.getRange(t.row, ctx.map.postponed).setValue((Number(t.postponed) || 0) + 1);
      }
      n++;
    });
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
  if (u.triage) return restoreTriage_(u.triage);
  if (u.ai) return undoAiApply_(u.ai);
  if (!u.id || STATUS_LIST.indexOf(u.status) === -1) throw new Error('되돌릴 정보가 없어요.');
  return withLock_(function () {
    var ctx = taskContext_();
    var row = findRowById_(ctx, u.id);
    if (!row) throw new Error('항목을 찾지 못했습니다.');
    var set = function (key, val) { if (ctx.map[key]) ctx.sheet.getRange(row, ctx.map[key]).setValue(val); };
    set('status', u.status); set('completed', u.completed !== undefined ? ymd_(u.completed) : '');
    if (u.focus !== undefined) set('focus', ymd_(u.focus));
    if (u.nextMark !== undefined) set('nextMark', u.nextMark);
    if (u.untriage) set('triaged', '');
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

/** 완료한 일을 다시 할 일로 (시간표에서 완료 → 계획으로 끌었을 때). 반복 일은 완료하며 생긴 다음 회차를 지운다. */
function reopenTask(id) {
  var ctx = taskContext_(), today = todayYmd_(ctx.tz);
  var all = readAllTasks_(ctx), t = all.filter(function (x) { return x.id === id; })[0];
  if (!t) throw new Error('항목을 찾지 못했습니다.');
  var nextId = '';
  if (t.repeat) {
    var sib = all.filter(function (x) { return x.id !== t.id && x.title === t.title && x.repeat === t.repeat && !isClosedStatus_(x.status) && x.created === today; })[0];
    nextId = sib ? sib.id : '';
  }
  undoTask({ id: id, status: STATUS.NEXT, focus: today, nextId: nextId });
  // 되돌리기로 완료 상태를 복구할 때 완료일도 원래대로 (없으면 오늘)
  return { ok: true, undo: { id: id, status: STATUS.DONE, focus: t.focus || '', completed: t.completed || today } };
}

/** 루틴 이번 회차 건너뛰기: 이번 회차는 '버림'으로 남기고 다음 회차를 만든다 */
function skipTask(id) {
  return clarifyTask(id, { status: STATUS.DROPPED, skip: true });
}

/** 할 일 하나의 상세 글(마크다운)과 메모. 화면 목록에는 글 전체를 싣지 않고 열 때만 읽는다 */
function getTaskDetail(id) {
  var ctx = taskContext_(), t = readAllTasks_(ctx).filter(function (x) { return x.id === id; })[0];
  if (!t) throw new Error('항목을 찾지 못했습니다. 시트에서 지워졌을 수 있습니다.');
  return { id: t.id, title: t.title, detail: t.detail, memo: t.memo, source: t.source, project: t.project, projectId: t.pid || '', stage: t.stage, energy: t.energy, nextMark: t.nextMark, checks: t.checks };
}

/**
 * 상세 글 저장 (편집·체크박스). base = 화면이 열 때 읽은 글. 저장 직전에 시트의 글을 다시 읽어 base와 다르면
 * (그 사이 다른 곳에서 고침) 저장하지 않고 최신 글을 돌려준다(conflict).
 */
function saveDetail(id, text, base) {
  text = String(text === null || text === undefined ? '' : text);
  if (text.length > 40000) throw new Error('상세 글이 너무 길어요(4만 자까지).');
  return withLock_(function () {
    var ctx = taskContext_();
    if (!ctx.map.detail) throw new Error('먼저 업데이트를 적용해 주세요.');
    var row = findRowById_(ctx, id);
    if (!row) throw new Error('항목을 찾지 못했습니다. 시트에서 지워졌을 수 있습니다.');
    var cur = ctx.sheet.getRange(row, ctx.map.detail).getValue();
    cur = cur === null || cur === undefined ? '' : String(cur);
    if (base !== undefined && base !== null && String(base) !== cur) return { ok: false, conflict: true, detail: cur };
    if (/^[=+\-@]/.test(text)) text = ' ' + text; // 시트가 수식으로 읽지 않게
    if (text !== cur) ctx.sheet.getRange(row, ctx.map.detail).setValue(text);
    return { ok: true, detail: text };
  });
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
 * GTD 워크 — 프로젝트 (완료 모습 · ID · 단계 · 다음 행동) · 다음 행동 바로 추가
 *
 * GTD에서 프로젝트는 "끝나면 어떤 모습인가"를 한 줄로 정해 둔다.
 * [프로젝트] 시트는 처음으로 프로젝트를 적을 때 생긴다. 열은 머리글 이름으로 찾고, 없는 열은 오른쪽 끝에 붙인다.
 * 프로젝트 이름은 [업무] 시트의 '프로젝트' 열과 같은 글자로 맞춘다. v1.8.0부터 '프로젝트ID'(P-xxxxxx)로도 잇는다:
 * 앱은 프로젝트ID를 먼저 보고, 없으면 이름으로 찾는다 (이름을 고치거나 철자가 달라도 할 일이 끊기지 않게).
 */

var PROJECT_HEADERS = ['프로젝트', '완료 모습', '만든 날', 'ID', '상태', '기한', '마지막 검토일', '단계', '현재 단계', '링크'];
var PROJECT_STATES = ['진행', '보류', '끝남'];

/** 합쳐서 없앤 프로젝트는 행을 지우지 않고 '완료 모습' 칸 앞에 이 표시를 붙인다 (열을 새로 만들지 않기 위해) */
var PROJECT_DROPPED_TAG = '[버림]';
function isDroppedOutcome_(v) { return String(v || '').indexOf(PROJECT_DROPPED_TAG) === 0; }
var PROJECT_MERGED_MARK = '(으)로 합침';
var PROJECT_REVERTED_MARK = 'AI 제안 되돌림';
/** '[버림] 대상(으)로 합침 · 원래 목표' 에서 원래 목표 글만. 대상 이름 안에 ' · '가 있어도 '(으)로 합침' 바로 뒤의 ' · '만 경계로 본다 */
function droppedOriginalGoal_(outcome) {
  var s = String(outcome || ''), mark = PROJECT_MERGED_MARK, i = s.indexOf(mark);
  if (i < 0) { mark = PROJECT_REVERTED_MARK; i = s.indexOf(mark); }
  if (i < 0) return '';
  var rest = s.slice(i + mark.length);
  return rest.indexOf(' · ') === 0 ? rest.slice(3) : '';
}

/**
 * [프로젝트] 시트와 열 번호. create=true면 시트가 없을 때 만들고, 없는 열은 오른쪽 끝에 붙인다.
 * @return {{sh:Object, col:Object, width:number}|null}
 */
function projectSheetInfo_(ss, create) {
  var sh = ss.getSheetByName(KIT.PROJECT_SHEET);
  if (!sh) {
    if (!create) return null;
    sh = ss.insertSheet(KIT.PROJECT_SHEET);
    sh.getRange(1, 1, 1, PROJECT_HEADERS.length).setValues([PROJECT_HEADERS]).setFontWeight('bold').setBackground('#EEEEFF');
    sh.setFrozenRows(1);
    sh.setColumnWidth(1, 180); sh.setColumnWidth(2, 360); sh.setColumnWidth(3, 100);
  }
  var width = Math.max(sh.getLastColumn(), 1);
  var head = sh.getRange(1, 1, 1, width).getValues()[0].map(function (h) { return String(h).trim(); });
  var col = {};
  PROJECT_HEADERS.forEach(function (h) {
    var i = head.indexOf(h);
    if (i >= 0) { col[h] = i + 1; return; }
    if (!create) return;
    width++; sh.getRange(1, width).setValue(h); head.push(h); col[h] = width;
  });
  return { sh: sh, col: col, width: width };
}

function splitStages_(v) {
  return String(v || '').split('|').map(function (s) { return s.trim(); }).filter(String);
}

/** [프로젝트] 줄 전부. 합쳐서 없앤 줄(dropped)도 들어 있다 */
function readProjectRows_(ss) {
  var info = projectSheetInfo_(ss, false);
  if (!info || !info.col['프로젝트']) return [];
  var sh = info.sh, last = sh.getLastRow();
  if (last < 2) return [];
  var tz = ss.getSpreadsheetTimeZone();
  var vals = sh.getRange(2, 1, last - 1, info.width).getValues();
  var g = function (r, h) { var c = info.col[h]; if (!c) return ''; var v = r[c - 1]; return v === null || v === undefined ? '' : v; };
  var out = [];
  vals.forEach(function (r, i) {
    var name = String(g(r, '프로젝트')).trim();
    if (!name) return;
    var outcome = String(g(r, '완료 모습')).trim();
    var state = String(g(r, '상태')).trim();
    out.push({
      row: i + 2, name: name, outcome: outcome, dropped: isDroppedOutcome_(outcome),
      id: String(g(r, 'ID')).trim(), state: PROJECT_STATES.indexOf(state) >= 0 ? state : '진행',
      due: ymd_(g(r, '기한'), tz), reviewed: ymd_(g(r, '마지막 검토일'), tz), created: ymd_(g(r, '만든 날'), tz),
      stages: splitStages_(g(r, '단계')), stage: Math.max(0, Math.round(Number(g(r, '현재 단계')) || 0)),
      links: String(g(r, '링크')).split(/\r?\n/).map(function (s) { return s.trim(); }).filter(String)
    });
  });
  return out;
}

/** { 프로젝트 이름: 완료 모습 } (옛 모양 그대로) */
function readProjectOutcomes_(ss) {
  var out = {};
  readProjectRows_(ss).forEach(function (r) { out[r.name] = r.outcome; });
  return out;
}

function newProjectId_(rows) {
  var used = {};
  (rows || []).forEach(function (r) { if (r.id) used[r.id] = 1; });
  var A = '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ', id;
  do {
    id = 'P-';
    for (var i = 0; i < 6; i++) id += A.charAt(Math.floor(Math.random() * A.length));
  } while (used[id]);
  return id;
}

/** 이름·ID로 프로젝트 찾기 (합쳐서 없앤 줄은 제외). ID를 먼저 본다 */
function projectIndex_(rows) {
  var byId = {}, byName = {};
  (rows || []).forEach(function (r) {
    if (r.dropped) return;
    if (r.id && !byId[r.id]) byId[r.id] = r;
    if (!byName[r.name]) byName[r.name] = r;
  });
  return { byId: byId, byName: byName };
}

/**
 * 업무 줄을 프로젝트에 잇는다: 프로젝트ID가 맞으면 그 프로젝트의 이름으로, 없으면 이름으로 찾는다.
 * (t.project = 화면에 보일 이름, t.pid = 프로젝트 ID. 이름이 달라도 ID로 안 끊긴다. 멱등)
 */
function linkProjects_(tasks, rows) {
  var ix = projectIndex_(rows);
  tasks.forEach(function (t) {
    var r = (t.projectId && ix.byId[t.projectId]) || (t.project && ix.byName[t.project]) || null;
    if (r) { t.project = r.name; t.pid = r.id; } else t.pid = '';
  });
  return tasks;
}

/**
 * 프로젝트 줄을 찾거나 만든다(ID 포함). ref는 이름 또는 ID.
 * byId=true(번호로 찾는 길: setProjectInfo)일 때만, P-번호 모양인데 없으면 오류. 이름으로 만드는 길에서는 'P-2026Q4' 같은 이름도 그냥 이름이다.
 * @return {{row:number, id:string, name:string, info:Object}}
 */
function ensureProjectRow_(ss, ref, outcome, byId) {
  ref = String(ref || '').trim();
  if (!ref) throw new Error('프로젝트 이름을 적어 주세요.');
  var info = projectSheetInfo_(ss, true), rows = readProjectRows_(ss), ix = projectIndex_(rows);
  var hit = ix.byId[ref] || ix.byName[ref];
  // P-로 시작하는 번호 모양인데 그 번호의 프로젝트가 없으면 이름으로 오해해 새로 만들지 않는다
  if (!hit && byId && /^P-[0-9A-Z]{6}$/.test(ref)) throw new Error('그 번호의 프로젝트를 찾지 못했어요.');
  // 합쳐서 없앤 이름을 다시 쓰면 새 줄(새 ID)을 만들지 않고 그 줄을 되살린다 (같은 이름의 프로젝트 줄·ID가 둘이 되지 않게)
  if (!hit) {
    var dead = rows.filter(function (r) { return r.dropped && r.name === ref; })[0];
    if (dead) {
      if (!dead.id) { dead.id = newProjectId_(rows); info.sh.getRange(dead.row, info.col['ID']).setValue(dead.id); }
      // 새 목표를 줄 때만 그 글로, 아니면 [버림] 표시 뒤에 남아 있던 원래 목표 글로 되돌린다 (목표를 빈칸으로 덮지 않는다)
      var keptGoal = droppedOriginalGoal_(dead.outcome);
      info.sh.getRange(dead.row, info.col['완료 모습']).setValue(textCell_(outcome ? outcome : keptGoal));
      return { row: dead.row, id: dead.id, name: dead.name, info: info, created: false };
    }
  }
  if (hit) {
    if (!hit.id) { hit.id = newProjectId_(rows); info.sh.getRange(hit.row, info.col['ID']).setValue(hit.id); }
    return { row: hit.row, id: hit.id, name: hit.name, info: info, created: false };
  }
  var id = newProjectId_(rows), row = info.sh.getLastRow() + 1;
  info.sh.getRange(row, info.col['프로젝트']).setValue(textCell_(ref)); // 읽을 때는 앞뒤 공백을 자르므로 이름은 그대로 맞는다
  info.sh.getRange(row, info.col['완료 모습']).setValue(textCell_(outcome || ''));
  info.sh.getRange(row, info.col['만든 날']).setValue(todayYmd_(ss.getSpreadsheetTimeZone()));
  info.sh.getRange(row, info.col['ID']).setValue(id);
  info.sh.getRange(row, info.col['상태']).setValue('진행');
  return { row: row, id: id, name: ref, info: info, created: true };
}

/** 프로젝트 이름 → 프로젝트ID (없으면 줄을 만든다). 이름이 비면 '' */
function projectIdForName_(ss, name) {
  name = String(name || '').trim();
  if (!name) return '';
  return ensureProjectRow_(ss, name).id;
}

/** 프로젝트 현황(projectStats_)에 완료 모습·ID·상태·단계를 붙이고, 할 일이 아직 없는 새 프로젝트도 보이게 한다 */
function withOutcomes_(ss, projects, rowsOpt) {
  var rows = rowsOpt || readProjectRows_(ss), ix = projectIndex_(rows);
  var have = {};
  var enrich = function (p, r) {
    p.outcome = r ? r.outcome : '';
    p.id = r ? r.id : (p.id || '');
    p.state = r ? r.state : '진행';
    p.due = r ? r.due : '';
    p.reviewed = r ? r.reviewed : '';
    p.stages = r ? r.stages : [];
    p.stage = r ? r.stage : 0;
    p.links = r ? r.links : [];
    p.paused = p.state === '보류';
    if (p.state === '끝남') p.finished = true;
    // v1.10: '멈춤' 상태는 없앴다(할 일이 없으면 그냥 비어 있는 프로젝트). 지금 할 일은 projectStats_가 자동으로 정한다
    return p;
  };
  // 합치거나 AI 제안을 되돌려 숨긴([버림]) 프로젝트 이름은 남은 '버림' 할 일 때문에 다시 나타나지 않게 한다.
  // 단, 시트에 직접 적힌 살아 있는 할 일(남은 일·나중에)이 하나라도 있으면 숨기지 않는다(v1.11: 할 일이 목록에서 사라지던 문제)
  var hidden = {};
  rows.forEach(function (r) { if (r.dropped && !ix.byName[r.name]) hidden[r.name] = 1; });
  var out = (projects || []).filter(function (p) { return !hidden[p.name] || (p.open || 0) + (p.someday || 0) > 0; }).map(function (p) { var r = ix.byName[p.name] || null; have[p.name] = 1; return enrich(p, r); });
  // 할 일이 아직 없는 새 프로젝트 폴더도 보이게 (합쳐서 버린 프로젝트는 숨김)
  rows.forEach(function (r) {
    if (r.dropped || have[r.name]) return;
    have[r.name] = 1;
    out.push(enrich({ name: r.name, open: 0, done: 0, next: 0, waiting: 0, important: 0, someday: 0, total: 0, nextDue: '', items: [], stalled: false, finished: false, empty: true, hasNext: false, nextTask: null, delegated: 0 }, r));
  });
  return out;
}

/** 프로젝트 완료 모습 저장 (없으면 시트·줄을 만든다). 합쳐서 없앤 이름이어도 새로 적으면 되살린다 */
function setProjectOutcome(name, outcome) {
  name = String(name || '').trim();
  outcome = String(outcome || '').trim();
  if (!name) throw new Error('프로젝트 이름을 적어 주세요.');
  return withLock_(function () {
    var ctx = taskContext_();
    var rows = readProjectRows_(ctx.ss);
    var any = rows.filter(function (r) { return r.name === name; })[0];
    if (any && any.dropped) {
      var info = projectSheetInfo_(ctx.ss, true);
      info.sh.getRange(any.row, info.col['완료 모습']).setValue(textCell_(outcome));
      if (!any.id) info.sh.getRange(any.row, info.col['ID']).setValue(newProjectId_(rows));
      return { ok: true };
    }
    var hit = ensureProjectRow_(ctx.ss, name, outcome);
    if (!hit.created) hit.info.sh.getRange(hit.row, hit.info.col['완료 모습']).setValue(textCell_(outcome));
    return { ok: true, id: hit.id };
  });
}

/**
 * 프로젝트 정보 고치기. ref = 이름 또는 ID. patch: { outcome, state('진행'|'보류'|'끝남'), due, stages(문자열 배열 또는 '|'로 구분한 글),
 * stage(현재 단계 번호), links(배열 또는 줄바꿈 글), reviewed(true면 오늘) }
 */
function setProjectInfo(ref, patch) {
  patch = patch || {};
  if (patch.state !== undefined && PROJECT_STATES.indexOf(patch.state) < 0) throw new Error('프로젝트 상태는 진행·보류·끝남 중 하나예요.');
  return withLock_(function () {
    var ctx = taskContext_();
    // 앱은 프로젝트를 이름으로 부른다. 'P-2026Q4' 같은 번호 모양 이름이라도 할 일이나 프로젝트 줄에 그 이름이 있으면 이름이다(번호로 오해해 오류 내지 않음)
    var asName = readAllTasks_(ctx).some(function (t) { return t.project === String(ref || '').trim(); });
    var hit = ensureProjectRow_(ctx.ss, ref, undefined, !asName), put = function (h, v) { hit.info.sh.getRange(hit.row, hit.info.col[h]).setValue(textCell_(v)); };
    if (patch.outcome !== undefined) put('완료 모습', String(patch.outcome).trim());
    if (patch.state !== undefined) put('상태', patch.state);
    if (patch.due !== undefined) put('기한', ymd_(patch.due));
    if (patch.stages !== undefined) put('단계', (Array.isArray(patch.stages) ? patch.stages : splitStages_(patch.stages)).map(function (s) { return String(s).trim(); }).filter(String).join(' | '));
    if (patch.stage !== undefined) put('현재 단계', Number(patch.stage) > 0 ? Math.round(Number(patch.stage)) : '');
    if (patch.links !== undefined) put('링크', (Array.isArray(patch.links) ? patch.links : String(patch.links).split(/\r?\n/)).map(function (s) { return String(s).trim(); }).filter(String).join('\n'));
    if (patch.reviewed) put('마지막 검토일', todayYmd_(ctx.tz));
    return { ok: true, id: hit.id };
  });
}

/**
 * 프로젝트의 '다음' 칩(★다음)을 한 할 일에 둔다. 같은 프로젝트의 다른 ★다음은 내린다(프로젝트당 하나).
 * clear=true면 그 할 일의 표시만 뺀다. 프로젝트 밖 할 일에는 둘 수 없다.
 */
function setNextAction(id, clear) {
  return withLock_(function () {
    var ctx = taskContext_();
    if (!ctx.map.nextMark) throw new Error('먼저 업데이트를 적용해 주세요.');
    var all = readAllTasks_(ctx), t = all.filter(function (x) { return x.id === id; })[0];
    if (!t) throw new Error('항목을 찾지 못했습니다.');
    var mark = function (row, on) { ctx.sheet.getRange(row, ctx.map.nextMark).setValue(on ? '★' : ''); };
    if (clear) { mark(t.row, false); return { ok: true }; }
    if (!t.project) throw new Error('프로젝트에 속한 할 일만 \'다음\'으로 정할 수 있어요.');
    var pid = t.pid || ensureProjectRow_(ctx.ss, t.project).id;
    all.forEach(function (x) { if (x.id !== id && x.nextMark && (x.pid === pid || (!x.pid && x.project === t.project))) mark(x.row, false); });
    mark(t.row, true);
    if (ctx.map.projectId && t.projectId !== pid) ctx.sheet.getRange(t.row, ctx.map.projectId).setValue(pid);
    return { ok: true, projectId: pid };
  });
}

/**
 * 수집함을 거치지 않고 바로 '다음 행동'으로 담기 (주간 정리의 프로젝트 단계, 수집함의 프로젝트 만들기).
 * d: { project, context, due, next } — due가 있으면 그날의 '일정'으로 담는다 (캘린더에서 추가), next=true면 프로젝트의 '다음'으로
 */
function addAction(title, d) {
  d = d || {};
  title = String(title || '').trim();
  if (!title) throw new Error('할 일을 적어 주세요.');
  return withLock_(function () {
    var ctx = taskContext_();
    var today = todayYmd_(ctx.tz);
    var due = ymd_(d.due);
    var project = String(d.project || '').trim();
    var task = { title: title, status: due ? STATUS.SCHEDULED : STATUS.NEXT, due: due, created: today, triaged: today, source: '직접',
      project: project, context: String(d.context || '').trim() };
    if (d.detail !== undefined && String(d.detail).trim()) task.detail = normDetail_(d.detail);
    var pid = '';
    if (project) { pid = projectIdForName_(ctx.ss, project); task.projectId = pid; }
    var nid = newId_(); task.id = nid;
    if (d.next && project) {
      readAllTasks_(ctx).forEach(function (x) { if (x.nextMark && (x.pid === pid || (!x.pid && x.project === project)) && ctx.map.nextMark) ctx.sheet.getRange(x.row, ctx.map.nextMark).setValue(''); });
      task.nextMark = '★';
    }
    appendTasks_(ctx, [task]);
    return { ok: true, id: nid };
  });
}

/**
 * 프로젝트 합치기: from 프로젝트의 할 일 전부를 to 프로젝트로 옮긴다.
 * [업무]의 '프로젝트'·'프로젝트ID' 칸만 한 칸씩 고치고(다른 열·행은 그대로), 행은 지우지 않는다.
 * from의 [프로젝트] 줄은 '완료 모습' 앞에 [버림]을 붙여 목록에서만 숨긴다.
 * 확인은 화면에서 이미 받았다고 본다. 같은 이름끼리는 합칠 수 없다.
 */
function mergeProject(from, to) {
  from = String(from || '').trim(); to = String(to || '').trim();
  if (!from || !to) throw new Error('합칠 프로젝트를 골라 주세요.');
  if (from === to) throw new Error('같은 프로젝트로는 합칠 수 없어요.');
  return withLock_(function () {
    var ctx = taskContext_();
    if (!ctx.map.project) throw new Error('먼저 업데이트를 적용해 주세요.');
    var tasks = readAllTasks_(ctx);
    var toExists = tasks.some(function (t) { return t.project === to; }) || readProjectOutcomes_(ctx.ss).hasOwnProperty(to);
    if (!toExists) throw new Error('합칠 대상 프로젝트를 찾지 못했어요.');
    var toId = ensureProjectRow_(ctx.ss, to).id;
    var moved = 0;
    tasks.forEach(function (t) {
      if (t.project !== from) return;
      ctx.sheet.getRange(t.row, ctx.map.project).setValue(textCell_(to));
      if (ctx.map.projectId) ctx.sheet.getRange(t.row, ctx.map.projectId).setValue(toId);
      if (t.nextMark && ctx.map.nextMark) ctx.sheet.getRange(t.row, ctx.map.nextMark).setValue(''); // 프로젝트당 '다음'은 하나
      moved++;
    });
    var sh = ctx.ss.getSheetByName(KIT.PROJECT_SHEET);
    if (sh && sh.getLastRow() >= 2) {
      var info = projectSheetInfo_(ctx.ss, false);
      var cName = info.col['프로젝트'] || 0, cOut = info.col['완료 모습'] || 0;
      if (cName && cOut) {
        var names = sh.getRange(2, cName, sh.getLastRow() - 1, 1).getValues();
        for (var i = 0; i < names.length; i++) {
          if (String(names[i][0]).trim() !== from) continue;
          var cell = sh.getRange(i + 2, cOut), cur = String(cell.getValue() || '').trim();
          if (!isDroppedOutcome_(cur)) cell.setValue(PROJECT_DROPPED_TAG + ' ' + to + PROJECT_MERGED_MARK + (cur ? ' · ' + cur : ''));
        }
      }
    }
    return { ok: true, moved: moved };
  });
}

/**
 * v7 마이그레이션 (시트 구조 6 → 7). 멱등.
 * - [프로젝트] 줄마다 ID를 붙이고, 업무 줄의 '프로젝트' 이름이 같은 프로젝트와 한 번 잇는다(프로젝트ID 채움). 비슷한 이름은 잇지 않는다(합치기 버튼으로).
 * - 이미 있던 업무 줄은 '분류일'을 채워 '분류 대기'로 쏟아지지 않게 한다. 도입일은 [_설정] '분류도입일'에 적는다.
 * 기존 열 이름·값은 건드리지 않고, 비어 있던 새 열 칸만 채운다.
 */
function migrateToV7_(ctx) {
  var ss = ctx.ss, sheet = ctx.sheet, map = ctx.map, tz = ss.getSpreadsheetTimeZone(), today = todayYmd_(tz);
  if (!readSettings_(ss)['분류도입일']) writeSetting_(ss, '분류도입일', today);
  var last = sheet.getLastRow();
  var vals = last >= 2 ? sheet.getRange(2, 1, last - 1, sheet.getLastColumn()).getValues() : [];
  var names = [], seen = {};
  if (map.title && map.project) vals.forEach(function (r) {
    if (!String(r[map.title - 1]).trim()) return;
    var n = String(r[map.project - 1] === null || r[map.project - 1] === undefined ? '' : r[map.project - 1]).trim();
    if (n && !seen[n]) { seen[n] = 1; names.push(n); }
  });
  // 프로젝트 줄에 ID를 붙이고, 업무에만 있던 이름은 줄을 만든다 (프로젝트 탭이 아예 없고 이름도 없으면 만들지 않는다)
  var rows = [];
  if (ss.getSheetByName(KIT.PROJECT_SHEET) || names.length) {
    var info = projectSheetInfo_(ss, true);
    rows = readProjectRows_(ss);
    rows.forEach(function (r) { if (!r.id) { r.id = newProjectId_(rows); info.sh.getRange(r.row, info.col['ID']).setValue(r.id); } });
    var live = projectIndex_(rows).byName, droppedNames = {};
    rows.forEach(function (r) { if (r.dropped) droppedNames[r.name] = 1; });
    names.forEach(function (n) { if (!live[n] && !droppedNames[n]) ensureProjectRow_(ss, n); });
    rows = readProjectRows_(ss);
  }
  var byName = projectIndex_(rows).byName;
  if (!vals.length) return;
  var pidCol = [], trCol = [], needPid = false, needTr = false;
  vals.forEach(function (r) {
    var has = String(r[map.title - 1]).trim() !== '';
    var pid = map.projectId ? String(r[map.projectId - 1] || '').trim() : '';
    if (has && !pid && map.project) {
      var n = String(r[map.project - 1] === null || r[map.project - 1] === undefined ? '' : r[map.project - 1]).trim();
      if (n && byName[n] && byName[n].id) { pid = byName[n].id; needPid = true; }
    }
    pidCol.push([pid]);
    var tr = map.triaged ? r[map.triaged - 1] : '';
    if (has && map.triaged && (tr === '' || tr === null || tr === undefined)) { tr = ymd_(map.created ? r[map.created - 1] : '', tz) || today; needTr = true; }
    trCol.push([tr === null || tr === undefined ? '' : tr]);
  });
  if (needPid) sheet.getRange(2, map.projectId, vals.length, 1).setValues(pidCol);
  if (needTr) sheet.getRange(2, map.triaged, vals.length, 1).setValues(trCol);
}

/* ── 37_Ai.gs ── */
/**
 * GTD 워크 — AI 연결 (v1.9.0, 개편 2단계): [AI기록] · [AI제안] 탭, 알림함 묶음, 되돌리기·적용·거절
 *
 * - [AI기록]: AI(에이전트)가 시트를 바꿀 때마다 한 줄씩 '추가만' 한다. 앱은 읽어서 알림함 'AI가 바꾼 것'과 되돌리기에 쓴다.
 * - [AI제안]: 무인 작업·대화에서 AI가 '제안만' 올린다. 앱은 알림함 'AI 제안'에서 적용/거절을 받아 상태 칸만 고친다.
 * - 두 탭은 앱이 만들어 둔다(에이전트가 탭을 만들지 않는다). 줄은 지우지 않는다(버림 처리). 바뀐 칸만 쓴다.
 * - 되돌리기는 [AI기록]의 '후' 값이 지금 값과 같을 때만 '전' 값으로 돌린다. 그 사이 사람이 바꿨으면 덮지 않는다.
 */

var AI_LOG_HEADERS = ['시각', '주체', '작업', '줄ID', '열', '전', '후', '근거', '되돌림'];
var AI_PROPOSAL_HEADERS = ['시각', '주체', '종류', '대상ID', '제안 내용', '근거·출처', '상태', '처리시각'];
var AI_ACTIONS = ['추가', '수정'];
var AI_KINDS = ['할일', '프로젝트', '자료후보', '독촉초안'];
var AI_STATES = ['대기', '적용', '거절'];
var AI_VIEW_CAP = 100;

/** 지금 시각 'yyyy-MM-dd HH:mm' (시트 시간대) */
function nowStamp_(tz) {
  var now = new Date();
  return todayYmd_(tz) + ' ' + Utilities.formatDate(now, tz, 'HH:mm');
}

/** [AI기록]·[AI제안] 탭 만들기. 없는 탭만 만들고, 있는 탭에 빠진 머리글은 오른쪽 끝에 붙인다(기존 열·값은 그대로). 멱등 */
function ensureAiSheets_(ss) {
  [[KIT.AI_LOG_SHEET, AI_LOG_HEADERS], [KIT.AI_PROPOSAL_SHEET, AI_PROPOSAL_HEADERS]].forEach(function (p) {
    var sh = ss.getSheetByName(p[0]);
    if (!sh) {
      sh = ss.insertSheet(p[0]);
      sh.getRange(1, 1, 1, p[1].length).setValues([p[1]]).setFontWeight('bold').setBackground('#EFE6FF');
      sh.setFrozenRows(1);
      return;
    }
    var width = Math.max(sh.getLastColumn(), 1);
    var head = sh.getRange(1, 1, 1, width).getValues()[0].map(function (h) { return String(h).trim(); });
    var blank = head.every(function (h) { return !h; });
    p[1].forEach(function (h) {
      if (head.indexOf(h) >= 0) return;
      var at = blank ? 1 : head.length + 1;
      sh.getRange(1, at).setValue(h);
      if (blank) { head = [h]; blank = false; } else head.push(h);
    });
  });
}

function aiSheetInfo_(ss, name, headers) {
  var sh = ss.getSheetByName(name);
  if (!sh) return null;
  var width = Math.max(sh.getLastColumn(), 1);
  var head = sh.getRange(1, 1, 1, width).getValues()[0].map(function (h) { return String(h).trim(); });
  var col = {};
  headers.forEach(function (h) { var i = head.indexOf(h); if (i >= 0) col[h] = i + 1; });
  return { sh: sh, col: col, width: width };
}

function aiCell_(v, tz) {
  if (v === null || v === undefined) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') return isNaN(v.getTime()) ? '' : nowStampFrom_(v, tz);
  return String(v);
}
function nowStampFrom_(d, tz) { return ymd_(d, tz) + ' ' + Utilities.formatDate(d, tz, 'HH:mm'); }

function readAiRows_(ss, name, headers) {
  var info = aiSheetInfo_(ss, name, headers);
  if (!info || info.sh.getLastRow() < 2) return { info: info, rows: [] };
  var tz = ss.getSpreadsheetTimeZone();
  var vals = info.sh.getRange(2, 1, info.sh.getLastRow() - 1, info.width).getValues();
  var rows = [];
  vals.forEach(function (r, i) {
    var o = { row: i + 2 }, any = false;
    headers.forEach(function (h) { var c = info.col[h]; var v = c ? aiCell_(r[c - 1], tz) : ''; o[h] = v; if (v.trim()) any = true; });
    if (any) rows.push(o);
  });
  return { info: info, rows: rows };
}

/** [AI기록] 읽기 → { items:[{row,at,who,action,id,col,before,after,why,reverted,revertedAt}], maxRow } (맨 아래가 가장 새것) */
function readAiLog_(ss) {
  var got = readAiRows_(ss, KIT.AI_LOG_SHEET, AI_LOG_HEADERS), maxRow = 0;
  var items = got.rows.map(function (o) {
    maxRow = Math.max(maxRow, o.row);
    return { row: o.row, at: o['시각'].trim(), who: o['주체'].trim(), action: o['작업'].trim(), id: o['줄ID'].trim(), col: o['열'].trim(),
      before: o['전'], after: o['후'], why: o['근거'].trim(), reverted: o['되돌림'].trim() !== '', revertedAt: o['되돌림'].trim() };
  });
  return { items: items, maxRow: maxRow };
}

/** [AI제안] 읽기 → { items:[{row,at,who,kind,target,content,why,state,doneAt}], maxRow } */
function readAiProposals_(ss) {
  var got = readAiRows_(ss, KIT.AI_PROPOSAL_SHEET, AI_PROPOSAL_HEADERS), maxRow = 0;
  var items = got.rows.map(function (o) {
    maxRow = Math.max(maxRow, o.row);
    var st = o['상태'].trim();
    return { row: o.row, at: o['시각'].trim(), who: o['주체'].trim(), kind: o['종류'].trim(), target: o['대상ID'].trim(), content: o['제안 내용'], why: o['근거·출처'].trim(),
      state: AI_STATES.indexOf(st) >= 0 ? st : '대기', doneAt: o['처리시각'].trim() };
  });
  return { items: items, maxRow: maxRow };
}

/** 제목 비교용 키: 대소문자·띄어쓰기·기호 차이는 같은 제목으로 본다 */
function titleKey_(s) { return String(s || '').toLowerCase().replace(/[\s\-_.,·:;!?()\[\]]/g, ''); }

/** 정기 작업(무인)이 올리는 주체 표시. 이 주체는 [AI제안]에만 쓴다 (내 줄을 직접 바꾼 기록이 있으면 규칙 위반) */
var AI_ROUTINE_WHO = 'AI:정기';
/** 앱이 제안을 적용하면서 남기는 [AI기록] 근거의 앞부분 (정기 작업이 직접 바꾼 것과 구분) */
var AI_APPLIED_WHY = ['제안 적용', '프로젝트 제안 적용', '자료 후보 붙임'];
function isRoutineWho_(who) { return String(who || '').indexOf(AI_ROUTINE_WHO) === 0; }
function isAppliedWhy_(why) { return AI_APPLIED_WHY.some(function (m) { return String(why || '').indexOf(m) === 0; }); }

/**
 * 화면용 AI 묶음. 되돌리지 않은 변경(AI가 바꾼 것)과 대기 중인 제안. 긴 글은 화면 데이터가 커지지 않게 잘라 싣는다.
 * titles = { 줄ID: 할 일 제목 } · openTitles = { 제목키: 1 } (끝나지 않은 할 일 제목: 비슷한 제안을 '이미 있어요'로 알리기 위해) · projectNames = { 이름: 1 }
 */
function buildAiView_(ss, titles, openTitles, projectNames) {
  titles = titles || {}; openTitles = openTitles || {}; projectNames = projectNames || {};
  var cut = function (s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n) + '…' : s; };
  var log = readAiLog_(ss), props = readAiProposals_(ss);
  // 내가 직접 [적용]을 누른 제안의 기록은 'AI가 바꾼 것'에 다시 올리지 않는다(되돌리기는 적용 직후 토스트에서).
  // 근거가 '제안 적용 #줄' 꼴이고, 그 줄이 실제로 '적용' 상태일 때만 그렇게 본다. 옛 기록·근거만 흉내 낸 기록은 계속 보인다.
  var appliedRow = {}; props.items.forEach(function (x) { if (x.state === '적용') appliedRow[x.row] = 1; });
  var byMe = function (x) { var m = String(x.why || '').match(/^(?:제안 적용|프로젝트 제안 적용|자료 후보 붙임) #(\d+)/); return !!m && !!appliedRow[Number(m[1])]; };
  var active = log.items.filter(function (x) { return !x.reverted && x.id && !byMe(x); });
  var lines = {}; active.forEach(function (x) { lines[x.id] = 1; });
  var changes = active.slice(-AI_VIEW_CAP).reverse().map(function (x) {
    return { row: x.row, at: x.at, who: x.who, action: x.action, id: x.id, title: titles[x.id] || '', col: x.col, before: cut(x.before, 120), after: cut(x.after, 120), why: cut(x.why, 160) };
  });
  var pending = props.items.filter(function (x) { return x.state === '대기'; });
  var proposals = pending.slice(-AI_VIEW_CAP).reverse().map(function (x) {
    var o = { row: x.row, at: x.at, who: x.who, kind: x.kind, target: x.target, targetTitle: titles[x.target] || '', content: cut(x.content, 3000), why: cut(x.why, 300), apply: aiApplicable_(x.kind) };
    if (x.kind === '프로젝트') {
      var pp = parseProjectProposal_(x.content);
      o.project = { name: pp.name, titles: pp.titles, dups: pp.titles.map(function (t, i) { return openTitles[titleKey_(t)] ? i : -1; }).filter(function (i) { return i >= 0; }), exists: !!projectNames[pp.name] };
    } else if (x.kind === '자료후보') o.links = parseLinkLines_(x.content).slice(0, 20);
    else if (x.kind === '할일') { var tl = String(x.content || '').replace(/\r\n?/g, '\n').split('\n').filter(function (l) { return l.trim(); })[0] || ''; o.dup = !!openTitles[titleKey_(tl.replace(/^#+\s*/, '').replace(/^제목\s*[:：]\s*/, ''))]; }
    return o;
  });
  var mat = { applied: 0, rejected: 0, pending: 0 };
  props.items.forEach(function (x) { if (x.kind === '자료후보') { if (x.state === '적용') mat.applied++; else if (x.state === '거절') mat.rejected++; else mat.pending++; } });
  var counts = { '할일': 0, '프로젝트': 0, '자료후보': 0, '독촉초안': 0, '기타': 0 };
  pending.forEach(function (x) { counts[counts.hasOwnProperty(x.kind) ? x.kind : '기타']++; });
  // 정기 작업 점검: 정기 작업이 올린 제안 수 · 내 줄을 직접 바꾼 기록(규칙 위반) 수
  var rt = { proposals: props.items.filter(function (x) { return isRoutineWho_(x.who); }).length,
    pending: pending.filter(function (x) { return isRoutineWho_(x.who); }).length,
    direct: log.items.filter(function (x) { return isRoutineWho_(x.who) && !isAppliedWhy_(x.why); }).length };
  return {
    rulesVersion: KIT.AI_RULES_VERSION,
    changes: changes, changeLines: Object.keys(lines).length, changeKey: active.length ? 'aichg:' + active[active.length - 1].row : '',
    proposals: proposals, proposalN: pending.length, proposalKey: props.maxRow ? 'aiprop:' + props.maxRow : '',
    proposalMore: Math.max(0, pending.length - proposals.length), proposalKinds: counts, material: mat, routine: rt
  };
}

function aiApplicable_(kind) { return AI_KINDS.indexOf(kind) >= 0; }

/** [AI기록]에 한 줄 추가 (앱이 제안을 적용한 것도 같은 기록으로 남긴다) */
function appendAiLog_(ss, rec) {
  var info = aiSheetInfo_(ss, KIT.AI_LOG_SHEET, AI_LOG_HEADERS);
  if (!info) { ensureAiSheets_(ss); info = aiSheetInfo_(ss, KIT.AI_LOG_SHEET, AI_LOG_HEADERS); }
  var row = info.sh.getLastRow() + 1, tz = ss.getSpreadsheetTimeZone();
  var put = { '시각': nowStamp_(tz), '주체': textCell_(rec.who || 'AI'), '작업': rec.action, '줄ID': rec.id, '열': rec.col || '', '전': rec.before === undefined ? '' : rec.before, '후': rec.after === undefined ? '' : rec.after, '근거': rec.why || '', '되돌림': '' };
  AI_LOG_HEADERS.forEach(function (h) { if (info.col[h]) info.sh.getRange(row, info.col[h]).setValue(put[h]); });
  return { row: row, at: put['시각'] };
}

function aiRowFor_(ss, name, headers, row, stamp) {
  var info = aiSheetInfo_(ss, name, headers);
  if (!info || !info.col['시각']) throw new Error('AI 탭을 찾지 못했어요. 앱을 새로 열어 주세요.');
  row = Math.round(Number(row) || 0);
  if (row < 2 || row > info.sh.getLastRow()) throw new Error('목록이 바뀌었어요. 새로 불러올게요.');
  var cur = aiCell_(info.sh.getRange(row, info.col['시각']).getValue(), ss.getSpreadsheetTimeZone()).trim();
  if (stamp !== undefined && stamp !== null && String(stamp).trim() !== cur) throw new Error('목록이 바뀌었어요. 새로 불러올게요.');
  return info;
}

function colKeyByHeader_(header) {
  var h = String(header || '').trim(), hit = null;
  COLUMNS.forEach(function (c) { if (!hit && (c.header === h || (c.aliases || []).indexOf(h) >= 0)) hit = c; });
  return hit;
}

function sameCellValue_(cur, want, def, tz) {
  var a = cur === null || cur === undefined ? '' : cur, b = want === null || want === undefined ? '' : want;
  if (def && def.type === 'date') return ymd_(a, tz) === ymd_(b, tz);
  if (def && def.type === 'number') { var x = String(a).trim(), y = String(b).trim(); return x === y || (x !== '' && y !== '' && Number(x) === Number(y)); }
  return String(a).trim() === String(b).trim();
}

/**
 * AI가 바꾼 것 되돌리기. row = [AI기록]의 줄 번호, stamp = 그 줄의 시각(화면이 본 것과 같은지 확인).
 * - 수정: 지금 값이 '후'와 같을 때만 '전' 값으로 복구. 다르면 덮지 않고 알린다.
 * - 추가: 새로 들어온 줄은 지우지 않고 상태=버림. 이미 완료한 줄은 건드리지 않는다.
 * 되돌리면 [AI기록] '되돌림' 칸에 시각을 적는다(그 칸만 쓴다).
 */
function revertAiChange(row, stamp) {
  return withLock_(function () { return revertAiChange_(taskContext_(), row, stamp); });
}

function revertAiChange_(ctx, row, stamp) {
  {
    var ss = ctx.ss, tz = ctx.tz;
    var info = aiRowFor_(ss, KIT.AI_LOG_SHEET, AI_LOG_HEADERS, row, stamp);
    var g = function (h) { var v = info.col[h] ? info.sh.getRange(row, info.col[h]).getValue() : ''; return aiCell_(v, tz); };
    if (!info.col['되돌림']) throw new Error('[AI기록]에 "되돌림" 열이 없어요.');
    if (g('되돌림').trim()) return { ok: false, reason: '이미 되돌렸어요.' };
    var id = g('줄ID').trim(), action = g('작업').trim(), r = findRowById_(ctx, id);
    if (!id || !r) return { ok: false, reason: '그 할 일 줄을 찾지 못했어요.' };
    var done = function (note) { info.sh.getRange(row, info.col['되돌림']).setValue(nowStamp_(tz) + (note ? ' ' + note : '')); return { ok: true, note: note || '' }; };
    if (action === '추가') {
      var st = normalizeStatus_(ctx.sheet.getRange(r, ctx.map.status).getValue());
      if (st === STATUS.DROPPED) return done('이미 버려져 있음');
      if (st === STATUS.DONE) return { ok: false, reason: '이미 끝낸 일이라 되돌리지 않았어요.' };
      ctx.sheet.getRange(r, ctx.map.status).setValue(STATUS.DROPPED);
      hideAiOnlyProject_(ctx, id);
      return done('버림 처리');
    }
    if (action === '수정') {
      var def = colKeyByHeader_(g('열'));
      if (!def || def.key === 'id' || !ctx.map[def.key]) return { ok: false, reason: '이 열은 앱에서 되돌릴 수 없어요: ' + g('열') };
      var cell = ctx.sheet.getRange(r, ctx.map[def.key]), curV = cell.getValue();
      if (!sameCellValue_(curV, g('후'), def, tz)) return { ok: false, conflict: true, reason: '그 사이 값이 바뀌었어요. 덮어쓰지 않았어요.' };
      var before = info.col['전'] ? info.sh.getRange(row, info.col['전']).getValue() : '';
      if (def.type === 'number' && String(before).trim() !== '' && !isNaN(Number(before))) before = Number(before);
      cell.setValue(before === null || before === undefined ? '' : before);
      return done('');
    }
    return { ok: false, reason: '알 수 없는 작업이에요: ' + action };
  }
}

/**
 * AI 제안으로 새로 생긴 프로젝트를 되돌려 할 일이 모두 '버림'이 되면, 빈 프로젝트가 남지 않게 [프로젝트] 줄을 목록에서 숨긴다.
 * 줄은 지우지 않고 '완료 모습' 앞에 [버림] 표시만 붙인다(합치기와 같은 방식). 그 프로젝트에 AI가 만들지 않은 할 일이 하나라도 있으면 그대로 둔다.
 */
function hideAiOnlyProject_(ctx, taskId) {
  var all = readAllTasks_(ctx), t = all.filter(function (x) { return x.id === taskId; })[0];
  if (!t || !t.project) return;
  var mine = all.filter(function (x) { return t.pid ? x.pid === t.pid : x.project === t.project; });
  var allAi = mine.every(function (x) { return x.status === STATUS.DROPPED && /^AI/.test(String(x.source || '')); });
  if (!allAi) return;
  // AI 제안이 이 프로젝트를 '새로 만들었다'고 기록에 남은 경우에만 숨긴다 (본부장님이 미리 만든 같은 이름의 빈 프로젝트는 그대로 둔다)
  var mark = '새 프로젝트 ' + t.pid, madeByAi = !!t.pid && readAiLog_(ctx.ss).items.some(function (c) { return c.action === '추가' && c.why.indexOf(mark) >= 0; });
  if (!madeByAi) return;
  var rows = readProjectRows_(ctx.ss), r = rows.filter(function (p) { return !p.dropped && (t.pid ? p.id === t.pid : p.name === t.project); })[0];
  if (!r) return;
  var info = projectSheetInfo_(ctx.ss, false);
  if (!info || !info.col['완료 모습']) return;
  info.sh.getRange(r.row, info.col['완료 모습']).setValue(PROJECT_DROPPED_TAG + ' ' + PROJECT_REVERTED_MARK + (r.outcome ? ' · ' + r.outcome : ''));
}

function newAiTaskId_(ctx) {
  var d = new Date(), base = todayYmd_(ctx.tz).replace(/-/g, '') + Utilities.formatDate(d, ctx.tz, 'HH:mm').replace(':', '') + ('0' + d.getUTCSeconds()).slice(-2);
  for (var n = 1; n < 1000; n++) { var id = 'AI-' + base + '-' + n; if (!findRowById_(ctx, id)) return id; }
  return 'AI-' + base + '-' + Date.now();
}

function aiSourceTag_(who) { who = String(who || '').trim(); return /^AI/.test(who) ? who : 'AI:' + (who || 'AI'); }

/** '제목 | 주소' · '주소' · '[제목](주소)' 줄들 → [{title,url}] (http·https만) */
function parseLinkLines_(text) {
  var out = [];
  String(text || '').split(/\r?\n/).forEach(function (ln) {
    ln = ln.trim().replace(/^[-*+]\s+/, '');
    if (!ln) return;
    var m = ln.match(/^\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/) || ln.match(/^(.*?)\s*\|\s*(https?:\/\/\S+)$/) || ln.match(/^()(https?:\/\/\S+)$/);
    if (m) out.push({ title: (m[1] || '').trim() || m[2], url: m[2] });
  });
  return out;
}

/** 상세 글의 '## 출처' 구역 끝에 링크 줄을 더한다 (없으면 글 끝에 구역을 만든다) */
function addSourceLinks_(detail, links) {
  var lines = links.map(function (l) { return '- [' + String(l.title).replace(/[\[\]]/g, '') + '](' + l.url + ')'; });
  detail = String(detail || '');
  if (!detail.trim()) return '## 출처\n' + lines.join('\n');
  var arr = detail.replace(/\r\n?/g, '\n').split('\n'), at = -1, end = arr.length;
  for (var i = 0; i < arr.length; i++) if (/^##\s+출처\s*$/.test(arr[i])) { at = i; break; }
  if (at < 0) return detail.replace(/\s+$/, '') + '\n\n## 출처\n' + lines.join('\n');
  for (var j = at + 1; j < arr.length; j++) if (/^##\s+/.test(arr[j])) { end = j; break; }
  while (end > at + 1 && !arr[end - 1].trim()) end--;
  return arr.slice(0, end).concat(lines, arr.slice(end)).join('\n');
}

/**
 * 프로젝트 제안 글 해석: 첫 줄=이름, (선택) 둘째 줄=목표, 이어서 "- 할 일" 줄들(최대 30개).
 * 화면은 이름과 할 일 줄만 보여 준다(v1.10 단순화: 완료 모습·단계는 화면에 내지 않는다).
 */
function parseProjectProposal_(content) {
  var pl = String(content || '').replace(/\r\n?/g, '\n').split('\n').map(function (x) { return x.trim(); });
  var name = (pl[0] || '').replace(/^#+\s*/, '').replace(/^(프로젝트|이름)\s*[:：]\s*/, '').trim();
  var goal = '', from = 1;
  if (pl[1] !== undefined && pl[1] && !/^[-*+]\s+/.test(pl[1])) { goal = pl[1].replace(/^(완료 모습|목표)\s*[:：]\s*/, '').trim(); from = 2; }
  var titles = pl.slice(from).filter(function (x) { return /^[-*+]\s+/.test(x); }).map(function (x) { return x.replace(/^[-*+]\s+(\[[ xX]\]\s*)?/, '').trim(); }).filter(String).slice(0, 30);
  return { name: name, goal: goal, titles: titles };
}

/** 체크한 번호들(0부터)만 골라 오름차순으로. picks가 없으면 전부(옛 호출 호환). 범위 밖·중복은 버린다 */
function pickIndexes_(picks, n) {
  var all = []; for (var i = 0; i < n; i++) all.push(i);
  if (picks === undefined || picks === null) return all;
  var seen = {};
  return (Array.isArray(picks) ? picks : []).map(function (x) { return Math.round(Number(x)); })
    .filter(function (x) { return x >= 0 && x < n && !seen[x] && (seen[x] = 1); }).sort(function (a, b) { return a - b; });
}

/**
 * AI 제안 적용. 종류별로 한다:
 *  - 할일: [업무] 맨 아래에 새 줄(ID=AI-…, 출처=AI:…, 분류일 빈칸 → 분류 대기). 제안 내용 첫 줄=제목, 나머지=상세 마크다운. 대상ID=프로젝트ID(선택)
 *  - 자료후보: 대상ID의 상세 '## 출처'에 링크 추가
 *  - 독촉초안(v1.17.1에서 기능 제거, 시트에 남은 옛 제안 호환용): 시트는 바꾸지 않는다. 적용으로만 표시
 *  - 프로젝트: [프로젝트] 줄(이름)과 체크한 '- 할 일' 줄마다 [업무] 새 줄(picks=체크한 번호들, 없으면 전부). ★다음은 붙이지 않는다(지금 할 일은 앱이 목록 맨 위로 자동 정함)
 *  - 자료후보도 picks=체크한 링크 번호들
 * 적용한 시트 변경은 [AI기록]에도 한 줄 남겨 되돌릴 수 있게 한다.
 */
function applyAiProposal(row, stamp, picks) {
  return withLock_(function () { return applyAiProposal_(taskContext_(), row, stamp, picks); });
}

/** 제목 첫 줄에서 @상황, 이미 있는 #프로젝트만 칸으로 옮기고 제목에서 뺀다 (날짜 말은 해석하지 않는다). 다 빼서 비면 원래 줄 그대로 */
function aiTitleParts_(line, projectNames) {
  var src = String(line || '').trim(), t = ' ' + src + ' ', out = { context: '', project: '' };
  var m = t.match(/\s@([^\s@.,]+)(?=\s)/);
  if (m) { out.context = '@' + m[1]; t = t.slice(0, m.index) + ' ' + t.slice(m.index + m[0].length); }
  var known = (projectNames || []).slice().sort(function (a, b) { return b.length - a.length; });
  for (var i = 0; i < known.length; i++) {
    var at = t.indexOf(' #' + known[i] + ' ');
    if (at >= 0) { out.project = known[i]; t = t.slice(0, at) + '  ' + t.slice(at + known[i].length + 3); break; }
  }
  out.title = t.replace(/\s+/g, ' ').trim() || src;
  return out;
}

function applyAiProposal_(ctx, row, stamp, picks) {
  {
    var ss = ctx.ss, tz = ctx.tz;
    var info = aiRowFor_(ss, KIT.AI_PROPOSAL_SHEET, AI_PROPOSAL_HEADERS, row, stamp);
    if (!info.col['상태']) throw new Error('[AI제안]에 "상태" 열이 없어요.');
    var g = function (h) { var v = info.col[h] ? info.sh.getRange(row, info.col[h]).getValue() : ''; return aiCell_(v, tz); };
    var state = g('상태').trim() || '대기';
    if (state !== '대기') return { ok: false, reason: '이미 ' + state + '한 제안이에요.' };
    var kind = g('종류').trim(), who = g('주체').trim() || 'AI', target = g('대상ID').trim(), content = g('제안 내용'), why = g('근거·출처').trim();
    var result = { ok: true, kind: kind }, logs = [], today = todayYmd_(tz), mark = ' #' + row;
    if (kind === '할일') {
      var lines = content.replace(/\r\n?/g, '\n').split('\n'), k = 0;
      while (k < lines.length && !lines[k].trim()) k++;
      var title = (lines[k] || '').replace(/^#+\s*/, '').replace(/^제목\s*[:：]\s*/, '').trim();
      if (!title) return { ok: false, reason: '제안에 제목이 없어요.' };
      var prows = readProjectRows_(ss), live = prows.filter(function (p) { return !p.dropped && p.state !== '끝남' && p.state !== '보류'; });
      var parts = aiTitleParts_(title, live.map(function (p) { return p.name; }));
      title = parts.title;
      var detail = lines.slice(k + 1).join('\n').trim();
      if (detail && !/^##\s/.test(detail)) detail = '## 메모\n' + detail;
      if (detail.length > 40000) return { ok: false, reason: '상세 글이 너무 길어요(4만 자까지).' };
      // 내가 [적용]을 눌렀으니 사람이 정한 것: 오늘 할 일로 바로 들어가고 정리할 것을 거치지 않는다(분류일=오늘)
      var task = { title: title, status: STATUS.NEXT, focus: today, created: today, triaged: today, source: aiSourceTag_(who), detail: detail, id: newAiTaskId_(ctx) };
      if (parts.context) task.context = parts.context;
      var pr = target && /^P-/.test(target) ? prows.filter(function (p) { return !p.dropped && p.id === target; })[0] : null;
      if (pr) { task.project = pr.name; task.projectId = pr.id; }
      else if (parts.project) { var hit = live.filter(function (p) { return p.name === parts.project; })[0]; task.project = parts.project; task.projectId = hit ? hit.id : projectIdForName_(ss, parts.project); }
      appendTasks_(ctx, [task]);
      logs.push(appendAiLog_(ss, { who: who, action: '추가', id: task.id, why: '제안 적용' + mark + (why ? ': ' + why : '') }));
      result.id = task.id;
    } else if (kind === '자료후보') {
      var r = findRowById_(ctx, target);
      if (!r || !ctx.map.detail) return { ok: false, reason: '대상 할 일을 찾지 못했어요.' };
      var links = parseLinkLines_(content), linkPick = pickIndexes_(picks, links.length);
      links = linkPick.map(function (i) { return links[i]; });
      if (!links.length) return { ok: false, reason: '붙일 링크가 없어요(http·https 주소만).' };
      var cell = ctx.sheet.getRange(r, ctx.map.detail), old = cell.getValue();
      old = old === null || old === undefined ? '' : String(old);
      var next = addSourceLinks_(old, links);
      if (next.length > 40000) return { ok: false, reason: '상세 글이 너무 길어요(4만 자까지).' };
      if (/^[=+\-@]/.test(next)) next = ' ' + next;
      cell.setValue(next);
      logs.push(appendAiLog_(ss, { who: who, action: '수정', id: target, col: '상세', before: old, after: next, why: '자료 후보 붙임' + mark + (why ? ': ' + why : '') }));
      result.id = target; result.added = links.length;
    } else if (kind === '독촉초안') {
      result.text = content;
    } else if (kind === '프로젝트') {
      var pp = parseProjectProposal_(content);
      if (!pp.name) return { ok: false, reason: '제안에 프로젝트 이름이 없어요.' };
      if (!pp.titles.length) return { ok: false, reason: '제안에 할 일 줄("- 할 일")이 없어요.' };
      var chosen = pickIndexes_(picks, pp.titles.length);
      if (!chosen.length) return { ok: false, reason: '넣을 할 일을 하나 이상 골라 주세요.' };
      var prj = ensureProjectRow_(ss, pp.name, pp.goal), ids = [];
      chosen.forEach(function (i) {
        var nt = { title: pp.titles[i], status: STATUS.NEXT, created: today, triaged: today, source: aiSourceTag_(who), project: prj.name, projectId: prj.id, id: newAiTaskId_(ctx) };
        appendTasks_(ctx, [nt]); ids.push(nt.id);
        logs.push(appendAiLog_(ss, { who: who, action: '추가', id: nt.id, why: '프로젝트 제안 적용' + mark + (prj.created ? ' · 새 프로젝트 ' + prj.id : '') + ': ' + pp.name }));
      });
      result.id = ids[0]; result.added = ids.length; result.projectId = prj.id; result.skipped = pp.titles.length - ids.length;
    } else {
      return { ok: false, reason: '알 수 없는 제안 종류예요: ' + kind };
    }
    info.sh.getRange(row, info.col['상태']).setValue('적용');
    var doneAt = nowStamp_(tz);
    if (info.col['처리시각']) info.sh.getRange(row, info.col['처리시각']).setValue(doneAt);
    // 되돌리기 정보: 시트를 바꾼 제안만 (옛 독촉초안은 시트를 안 바꿔 되돌릴 것이 없다)
    if (logs.length) result.undo = { ai: [{ row: row, stamp: g('시각').trim(), doneAt: doneAt, logs: logs }] };
    return result;
  }
}

/**
 * 제안 여러 개를 차례로 적용한다 ('모두 적용'). 한 개가 실패해도 나머지는 계속하고, 결과를 모아 돌려준다.
 * list = [{ row, stamp, picks? }] → { ok, applied, failed:[{row, reason}], ids, undo:{ai:[...]} }
 */
function applyAiMany(list) {
  list = (Array.isArray(list) ? list : []).slice(0, 100);
  if (!list.length) throw new Error('적용할 제안을 골라 주세요.');
  return withLock_(function () {
    var ctx = taskContext_(), applied = 0, failed = [], ids = [], undo = [];
    list.forEach(function (x) {
      try {
        var r = applyAiProposal_(ctx, x && x.row, x && x.stamp, x && x.picks);
        if (r.ok) { applied++; if (r.id) ids.push(r.id); if (r.undo && r.undo.ai) undo = undo.concat(r.undo.ai); }
        else failed.push({ row: x.row, reason: r.reason || '적용하지 못했어요.' });
      } catch (err) { failed.push({ row: x && x.row, reason: String((err && err.message) || err) }); }
    });
    return { ok: true, applied: applied, failed: failed, ids: ids, undo: undo.length ? { ai: undo } : undefined };
  });
}

/**
 * 적용 되돌리기. list = [{ row(제안 줄), stamp(제안 시각), doneAt, logs:[{row, at}] }]
 * 새로 들어온 줄은 지우지 않고 '버림'(이미 끝낸 일은 그대로), 상세에 붙인 링크는 값이 그대로일 때만 원래대로.
 * 그 제안이 아직 '적용' 상태이고 시각이 같을 때만 '대기'로 돌리고 처리시각을 비운다.
 */
function undoAiApply_(list) {
  return withLock_(function () {
    var ctx = taskContext_(), ss = ctx.ss, tz = ctx.tz, undone = 0, kept = 0;
    (list || []).forEach(function (x) {
      var info = aiSheetInfo_(ss, KIT.AI_PROPOSAL_SHEET, AI_PROPOSAL_HEADERS);
      var row = Math.round(Number(x && x.row) || 0);
      if (!info || !info.col['상태'] || row < 2 || row > info.sh.getLastRow()) return;
      var cur = aiCell_(info.sh.getRange(row, info.col['시각']).getValue(), tz).trim();
      var state = aiCell_(info.sh.getRange(row, info.col['상태']).getValue(), tz).trim();
      var at = info.col['처리시각'] ? aiCell_(info.sh.getRange(row, info.col['처리시각']).getValue(), tz).trim() : '';
      if (cur !== String(x.stamp || '').trim() || state !== '적용' || (x.doneAt && at !== String(x.doneAt).trim())) return;
      var allOk = true;
      (x.logs || []).forEach(function (l) {
        try { var r = revertAiChange_(ctx, l.row, l.at); if (!r.ok) { allOk = false; kept++; } } catch (err) { allOk = false; kept++; }
      });
      if (!allOk) return; // 일부를 못 돌렸으면(이미 끝낸 일 등) 제안은 '적용'으로 둔다
      info.sh.getRange(row, info.col['상태']).setValue('대기');
      if (info.col['처리시각']) info.sh.getRange(row, info.col['처리시각']).setValue('');
      undone++;
    });
    return { ok: true, count: undone, kept: kept };
  });
}

/** AI 제안 거절: 상태 칸·처리시각 칸만 고친다 */
function rejectAiProposal(row, stamp) {
  return withLock_(function () {
    var ctx = taskContext_(), tz = ctx.tz;
    var info = aiRowFor_(ctx.ss, KIT.AI_PROPOSAL_SHEET, AI_PROPOSAL_HEADERS, row, stamp);
    if (!info.col['상태']) throw new Error('[AI제안]에 "상태" 열이 없어요.');
    var state = aiCell_(info.sh.getRange(row, info.col['상태']).getValue(), tz).trim() || '대기';
    if (state !== '대기') return { ok: false, reason: '이미 ' + state + '한 제안이에요.' };
    info.sh.getRange(row, info.col['상태']).setValue('거절');
    if (info.col['처리시각']) info.sh.getRange(row, info.col['처리시각']).setValue(nowStamp_(tz));
    return { ok: true };
  });
}

/* ── 40_Dashboard.gs ── */
/**
 * GTD 워크 — [오늘] 시트
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
 * 멈춤 = 다음 행동·일정·위임이 하나도 없음 (주간 정리 projectStats_ 와 같은 기준)
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
/** GTD 워크 — 주간 정리 메일 (매주 금요일, 나에게만) */

/** 업무 목록 → 주간 정리 요약 (순수 함수 — 테스트 대상) */
function buildWeeklySummary_(tasks, today, projectRows) {
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
    projects: projectStats_(tasks, projectRows),
    reference: tasks.filter(function (t) { return t.status === STATUS.REFERENCE; })
  };
}

/**
 * 프로젝트별 현황. v1.10부터 '멈춤' 개념은 화면·메일에 쓰지 않는다(stalled는 옛 호환용 값). 지금 할 일(nextTask)은 아래에서 자동으로 정한다.
 */
function projectStats_(tasks, projectRows) {
  var by = {}, order = [];
  if (projectRows && projectRows.length) linkProjects_(tasks, projectRows); // 프로젝트ID로 이름을 맞춘다 (이름이 달라도 한 프로젝트)
  tasks.forEach(function (t) {
    if (!t.project) return;
    if (!by[t.project]) { by[t.project] = { name: t.project, id: t.pid || '', open: 0, done: 0, next: 0, waiting: 0, important: 0, someday: 0, total: 0, nextDue: '', items: [], hasNext: false, nextTask: null, delegated: 0 }; order.push(t.project); }
    var g = by[t.project];
    g.total++; // 합치기 확인창용: 이 프로젝트 줄 전체(버림·참고 포함)
    if (t.status === STATUS.DONE) g.done++;
    // 나중에(언젠가) 할 일도 프로젝트 안에 보이게 (프로젝트가 '끝남'으로 사라지지 않게)
    else if (t.status === STATUS.SOMEDAY) { g.someday++; if (g.items.length < 12) g.items.push({ id: t.id, title: t.title, status: t.status, due: t.due || '', delegatee: '', project: t.project, priority: t.priority || '', context: t.context || '' }); }
    else if (isActionable_(t.status)) {
      g.open++;
      if (t.priority === '높음') g.important++;
      if (t.status === STATUS.DELEGATED) g.delegated++;
      if (t.nextMark && !g.hasNext) { g.hasNext = true; g.nextTask = { id: t.id, title: t.title, status: t.status, delegatee: t.delegatee || '' }; }
      if (g.items.length < 12) g.items.push({ id: t.id, title: t.title, status: t.status, due: t.due || '', delegatee: t.delegatee || '', project: t.project, priority: t.priority || '', context: t.context || '', nextMark: !!t.nextMark, stage: t.stage || '', detail: !!t.detail });
      if (t.due && (!g.nextDue || t.due < g.nextDue)) g.nextDue = t.due;
      if (t.status === STATUS.NEXT) g.next++;
      if (t.status === STATUS.DELEGATED || t.status === STATUS.SCHEDULED) g.waiting++;
    }
  });
  // v1.10: '지금 할 일'은 사용자가 정하지 않는다. '먼저 하기'(★다음)를 누른 일이 있으면 그 일, 없으면 맨 위의 안 끝낸 일
  order.forEach(function (k) {
    var g = by[k];
    if (g.nextTask) return;
    var first = g.items.filter(function (it) { return it.status !== STATUS.SOMEDAY && it.status !== STATUS.DELEGATED; })[0]; // 남에게 맡긴 일은 내가 지금 할 일이 아니다
    if (first) g.nextTask = { id: first.id, title: first.title, status: first.status, delegatee: first.delegatee || '', auto: true };
  });
  return order.map(function (k) { var g = by[k]; g.stalled = g.open > 0 ? g.next === 0 && g.waiting === 0 : false; g.finished = g.open === 0 && !g.someday; return g; });
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
    '<h2 style="margin:0;color:#5b5cf6">이번 주 정리 · ' + s.today + '</h2>' +
    '<p style="margin:6px 0 16px;color:#555">10분만 내서 아래 순서로 보세요: 수집함 비우기 → 확인할 위임 챙기기 → 다음 주 할 일 고르기.</p>' +
    '<table style="border-collapse:separate;border-spacing:6px"><tr>' +
    stat('이번 주 완료', s.done.length) + stat('수집함', s.inbox.length) + stat('마감 지남', s.overdue.length) +
    stat('확인할 위임', s.followUp.length) + '</tr></table>' +
    block('① 수집함 — 아직 정리 안 됨', '#a16207', s.inbox, function (t) { return li(t, t.created); }, '비어 있습니다. 좋습니다!') +
    block('② 확인할 위임', '#b45309', s.followUp, function (t) { return li(t, t.delegatee + ' · ' + t.followUp); }, '확인할 위임이 없습니다.') +
    block('③ 마감 지남', '#b91c1c', s.overdue, function (t) { return li(t, t.due); }, '마감 지난 일이 없습니다.') +
    block('④ 다음 2주 마감', '#1d4ed8', s.upcoming, function (t) { return li(t, t.due); }, '다가오는 마감이 없습니다.') +
    block('⑤ 다음 행동', '#5b5cf6', s.next, function (t) { return li(t, [t.due, t.context].filter(String).join(' · ')); }, '다음 행동이 없습니다.') +
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
    subject: '[내 업무] 주간 정리 · ' + today + ' (수집함 ' + summary.inbox.length + ' · 확인할 위임 ' + summary.followUp.length + ')',
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
/** GTD 워크 — 아침 브리핑 메일 (평일 아침, 나에게만) */

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

// ── 오늘 정리 (v1.11) ───────────────────────────────────────────
// 끝낸 일 요약 → 못 끝낸 일 하나씩 → 분류 대기 3개 → 확인할 것 → 내일 가장 중요한 한 가지 → '오늘은 여기까지'(닫기 기록·연속).
// 앱 화면이 단계별로 기존 함수(clarifyTask·postponeFollowUp·updateTask)를 부르고, 마지막에 closeDay만 [_설정]에 닫은 날을 적는다.

/** [_설정] 하루닫기기록 → 닫은 날짜 배열 (한 날짜만 있어 시트가 날짜로 바꿔 저장해도 읽힌다) */
function readCloseDays_(ss) {
  var raw = readSettings_(ss)['하루닫기기록'], tz = ss.getSpreadsheetTimeZone();
  if (raw === undefined || raw === null || raw === '') return [];
  var parts = Object.prototype.toString.call(raw) === '[object Date]' ? [raw] : String(raw).split(',');
  var out = [];
  parts.forEach(function (x) { var d = ymd_(String(x).trim() ? x : '', tz); if (d && out.indexOf(d) < 0) out.push(d); });
  return out.sort();
}

/** 연속 기록: 평일(월~금)에 닫은 날이 끊기지 않고 이어진 수. 오늘 아직 안 닫았어도 어제(평일)까지 이어졌으면 유지. 주말은 닫지 않아도 끊기지 않는다 */
function closeStreak_(days, today) {
  var set = {}; (days || []).forEach(function (d) { set[d] = 1; });
  var d = set[today] ? today : addDaysYmd_(today, -1), n = 0, guard = 500;
  while (guard-- > 0) {
    var w = dowOf_(d);
    if (set[d]) n++;
    else if (w !== 0 && w !== 6) break;
    d = addDaysYmd_(d, -1);
  }
  return n;
}

/** 화면용 닫기 상태 */
function buildCloseView_(ss, today) {
  var days = readCloseDays_(ss);
  return { closedToday: days.indexOf(today) >= 0, streak: closeStreak_(days, today), last: days.length ? days[days.length - 1] : '' };
}

/** '오늘은 여기까지': 오늘 날짜를 닫기 기록에 적는다 (하루에 한 번만 적힘, 최근 200일). 앱 코드가 직접 쓰는 값 — 에이전트는 읽지도 쓰지도 않는다 */
function closeDay() {
  return withLock_(function () {
    var ctx = taskContext_(), today = todayYmd_(ctx.tz), days = readCloseDays_(ctx.ss);
    if (days.indexOf(today) < 0) {
      days.push(today);
      writeSetting_(ctx.ss, '하루닫기기록', days.sort().slice(-200).join(','));
    }
    return { ok: true, streak: closeStreak_(days, today), doneToday: readAllTasks_(ctx).filter(function (t) { return t.status === STATUS.DONE && t.completed === today; }).length };
  });
}

// ── 지금 뭐 하지? (v1.11, 규칙 기반) ─────────────────────────────
// 에너지(높음/보통/낮음)와 쓸 수 있는 시간(분)을 고르면, 끝나지 않은 일 중 맞는 것을 점수 순으로 보여 준다. AI를 부르지 않는다.
// 거르기: 지금 내 에너지보다 무거운 일 · 쓸 수 있는 시간보다 오래 걸리는 일(예상 시간을 적어 둔 것만). 맡긴 일·나중에·참고·미래 일정은 뺀다.
// 점수: 마감 지남 6 · 오늘 마감 4 · 오늘 꼭(★) 4 · 중요 3 · 급함 3 · 먼저 하기 2 · 지난 ★ 2 · 모레까지 마감 1 · 에너지 딱 맞음 3(덜 무거움 1 · 모름 1) · 시간 딱 맞음 1.
var ENERGY_RANK_ = { '낮음': 1, '보통': 2, '높음': 3 };
function pickNow_(tasks, today, opts, projectRows) {
  opts = opts || {};
  var ue = ENERGY_RANK_[opts.energy] || 0, minutes = Math.max(0, Math.round(Number(opts.minutes) || 0));
  var nextIds = {};
  if (projectRows) {
    var off = {}; projectRows.forEach(function (r) { if (r.dropped || r.state !== '진행') off[r.name] = 1; }); // 잠시 멈추거나 끝낸 프로젝트의 일은 고르지 않는다
    projectStats_(tasks, projectRows).forEach(function (p) { if (p.nextTask && !off[p.name]) nextIds[p.nextTask.id] = 1; });
  }
  var out = [], skipped = { heavy: 0, long: 0 };
  tasks.forEach(function (t) {
    if (!isActionable_(t.status) || t.status === STATUS.DELEGATED) return;
    var late = !!t.due && t.due < today, dueToday = t.due === today, star = !!t.focus && t.focus <= today;
    var inProject = !!t.project;
    if (t.repeat && t.due && t.due > today) return;
    if (t.focus && t.focus > today) return;                            // 내일 이후로 정해 둔 일(오늘 정리에서 내일로 보낸 일 포함)은 아직
    if (t.due && t.due > today && !star) return;                       // 미래 일정은 아직
    if (inProject && !late && !dueToday && !star && !nextIds[t.id]) return; // 프로젝트 일은 그 프로젝트의 '지금 할 일'만
    var te = ENERGY_RANK_[t.energy] || 0;
    if (ue && te > ue) { skipped.heavy++; return; }
    if (minutes && t.est && t.est > minutes) { skipped.long++; return; }
    var score = 0, why = [];
    if (late) { score += 6; why.push('마감이 지났어요'); } else if (dueToday) { score += 4; why.push('오늘 마감이에요'); }
    else if (t.due && t.due <= addDaysYmd_(today, 2)) { score += 1; why.push('마감이 가까워요'); }
    if (star) { score += t.focus === today ? 4 : 2; why.push(t.focus === today ? '오늘 꼭 하려던 일이에요' : '지난 ★ 일이에요'); }
    if (t.priority === '높음') { score += 3; why.push('중요해요'); }
    if (t.urgent) { score += 3; why.push('급해요'); }
    if (t.nextMark) { score += 2; why.push('먼저 하기로 정했어요'); } else if (nextIds[t.id]) why.push('프로젝트의 지금 할 일이에요');
    if (ue) { if (te === ue) { score += 3; why.push('지금 기운에 딱 맞아요'); } else if (te && te < ue) score += 1; else if (!te) score += 1; }
    if (minutes && t.est) { score += 1; why.push(t.est + '분이면 돼요'); }
    out.push({ t: t, score: score, why: why });
  });
  out.sort(function (a, b) { return b.score - a.score || ((a.t.due || '9999') < (b.t.due || '9999') ? -1 : (a.t.due || '9999') > (b.t.due || '9999') ? 1 : 0) || (a.t.row || 0) - (b.t.row || 0); });
  return {
    picks: out.slice(0, 5).map(function (x) { return { id: x.t.id, title: x.t.title, project: x.t.project || '', est: x.t.est || 0, energy: x.t.energy || '', due: x.t.due || '', why: x.why }; }),
    total: out.length, skipped: skipped
  };
}

/** 화면이 부르는 공개 함수: opts = { energy: '높음'|'보통'|'낮음'|'', minutes: 숫자|0 } */
function getNowPicks(opts) {
  var ctx = taskContext_();
  return pickNow_(readAllTasks_(ctx), todayYmd_(ctx.tz), opts, readProjectRows_(ctx.ss));
}

/* ── 60_Menu.gs ── */
/**
 * GTD 워크 — 메뉴·트리거 진입점
 * 여기 있는 공개 함수 이름(onOpen, onEdit, menu*)은 바꾸지 말 것.
 */

function onOpen(e) {
  SpreadsheetApp.getUi().createMenu('✅ 내 업무')
    .addItem('📥 빠른 수집 (사이드바)', 'menuOpenSidebar')
    .addItem('📱 휴대폰·웹 화면 링크', 'menuShowWebLink')
    .addItem('🔑 휴대폰 링크 새로 만들기', 'menuRotateWebLink')
    .addItem('🔄 [오늘] 시트 새로 그리기', 'menuRefreshDashboard')
    .addSeparator()
    .addItem('📧 주간 정리 메일 지금 받기', 'menuWeeklyNow')
    .addItem('⏰ 주간 정리 메일 켜기 (매주 금요일)', 'menuWeeklyOn')
    .addItem('🔕 주간 정리 메일 끄기', 'menuWeeklyOff')
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
  requireCalendarConsent_();
  return lines.join('\n');
}

/**
 * 캘린더 권한을 아직 허용하지 않았으면(권한 화면에서 빼고 넘어갔거나, 캘린더 기능이 나중에 생긴 경우) 권한 화면을 다시 띄운다.
 * 이미 허용했으면 아무 일도 하지 않는다. 권한 범위(appsscript.json)는 바꾸지 않는다.
 */
function requireCalendarConsent_() {
  if (typeof ScriptApp === 'undefined' || !ScriptApp.requireScopes || !ScriptApp.AuthMode) return;
  ScriptApp.requireScopes(ScriptApp.AuthMode.FULL, ['https://www.googleapis.com/auth/calendar']);
}

function menuWeeklyNow() {
  var r = sendWeeklyReview();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.toast(r.sent ? r.to + ' 로 보냈습니다.' : r.reason, KIT.NAME, 6);
}

function menuWeeklyOn() {
  setWeeklyTrigger_(true);
  SpreadsheetApp.getUi().alert('주간 정리 메일을 켰습니다.\n매주 금요일 ' + KIT.WEEKLY_HOUR + '시쯤 나에게만 보냅니다.');
}

function menuWeeklyOff() {
  setWeeklyTrigger_(false);
  SpreadsheetApp.getUi().alert('주간 정리 메일을 껐습니다.');
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
    '4) 금요일엔 주간 정리 메일로 한 주를 정리합니다.\n\n' +
    '새 버전으로 업데이트해도 이 시트의 데이터는 그대로 유지됩니다.',
    ui.ButtonSet.OK);
}

/* ── 70_Sample.gs ── */
/**
 * GTD 워크 — 예시 업무 (처음 써 보는 사람·영상 시연용)
 * 업무 시트가 비어 있을 때만 넣는다. 실제 데이터 위에 덮어쓰지 않는다.
 */

/** 날짜는 오늘 기준 상대값(일). 순수 함수 — 테스트 대상 */
function sampleTasks_(today) {
  var d = function (n) { return addDaysYmd_(today, n); };
  return [
    { title: '거래처 견적서 비교표 만들기', status: STATUS.NEXT, focus: d(0), created: d(0) },
    { title: '다음 달 워크숍 장소 알아보기', status: STATUS.NEXT, focus: d(0), created: d(0) },
    { title: '노트북 배터리 교체 문의', status: STATUS.NEXT, focus: d(0), created: d(-1) },
    { title: '주간회의 안건 3개 정리해서 공유', status: STATUS.NEXT, context: '@컴퓨터', due: d(1), created: d(-2) },
    { title: '세무사님께 부가세 자료 일정 전화로 확인', status: STATUS.NEXT, context: '@전화', focus: d(0), created: d(-1) },
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
      if (ctx.map.triaged) r[ctx.map.triaged - 1] = t.created; // 예시는 이미 분류된 것으로 (분류 대기로 쏟아지지 않게)
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
 * GTD 워크 — 웹앱 (휴대폰·PC 브라우저에서 여는 화면)
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
function webAdd(k, text, opts) { checkKey_(k); appContext_(); var r = addTasks(text, opts); return withView_(r); }
function webClarify(k, id, d) { checkKey_(k); var r = clarifyTask(id, d); return withView_(r); }
function webComplete(k, id) { checkKey_(k); var r = completeTask(id); return withView_(r); }
function webPostpone(k, id, days) { checkKey_(k); var r = postponeFollowUp(id, days); return withView_(r); }
function webUpdate(k, id, patch) { checkKey_(k); var r = updateTask(id, patch); return withView_(r); }
function webPlanDay(k, ids) { checkKey_(k); var r = planDay(ids); return withView_(r); }
function webUndo(k, u) { checkKey_(k); var r = undoTask(u); return withView_(r); }
function webReopen(k, id) { checkKey_(k); var r = reopenTask(id); return withView_(r); }
/** 알림 켜고 끄기: kind = 'daily'(아침 브리핑) | 'weekly'(주간 정리 메일) | 'test'(아침 브리핑 지금 받기) */
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
function webMergeProject(k, from, to) { checkKey_(k); appContext_(); var r = mergeProject(from, to); return withView_(r); }
function webTaskDetail(k, id) { checkKey_(k); appContext_(); return getTaskDetail(id); }
function webSaveDetail(k, id, text, base) { checkKey_(k); appContext_(); var r = saveDetail(id, text, base); return withView_(r); }
function webSetNext(k, id, clear) { checkKey_(k); appContext_(); var r = setNextAction(id, clear === true); return withView_(r); }
function webSetProjectInfo(k, ref, patch) { checkKey_(k); appContext_(); var r = setProjectInfo(ref, patch); return withView_(r); }
// v1.9: AI가 바꾼 것 되돌리기 · AI 제안 적용·거절 (row = [AI기록]/[AI제안] 줄 번호, stamp = 그 줄의 시각)
function webRevertAi(k, row, stamp) { checkKey_(k); appContext_(); var r = revertAiChange(row, stamp); return withView_(r); }
function webApplyAi(k, row, stamp, picks) { checkKey_(k); appContext_(); var r = applyAiProposal(row, stamp, picks); return withView_(r); }
// v1.11: 오늘 정리
function webCloseDay(k) { checkKey_(k); appContext_(); var r = closeDay(); return withView_(r); }
function webNowPicks(k, opts) { checkKey_(k); appContext_(); return getNowPicks(opts); }
function webTriageMany(k, ids, mode) { checkKey_(k); appContext_(); var r = triageMany(ids, mode); return withView_(r); }
function webApplyAiMany(k, list) { checkKey_(k); appContext_(); var r = applyAiMany(list); return withView_(r); }
function webRejectAi(k, row, stamp) { checkKey_(k); appContext_(); var r = rejectAiProposal(row, stamp); return withView_(r); }
/** 알림함 '모두 확인함': 지금 알림 목록(keys)과 시각을 [_설정]에 적는다 (앱 코드가 직접 쓰는 값 — 에이전트는 읽지도 쓰지도 않는다) */
function webInboxSeen(k, keys) {
  checkKey_(k);
  var ctx = appContext_();
  var list = (Array.isArray(keys) ? keys : []).map(String).filter(String).slice(0, 200);
  writeSetting_(ctx.ss, '알림확인시각', new Date().toISOString());
  writeSetting_(ctx.ss, '알림확인목록', list.join('\n')); // 키에 쉼표가 든 프로젝트 이름이 있을 수 있어 줄바꿈으로 나눈다
  return withView_({ ok: true });
}
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
    addAction: webAddAction, setProject: webSetProject, mergeProject: webMergeProject, focusMany: webFocusMany,
    getTaskDetail: webTaskDetail, saveDetail: webSaveDetail, setNext: webSetNext, setProjectInfo: webSetProjectInfo, inboxSeen: webInboxSeen, revertAi: webRevertAi, applyAi: webApplyAi, rejectAi: webRejectAi,
    closeDay: webCloseDay, nowPicks: webNowPicks, triageMany: webTriageMany, applyAiMany: webApplyAiMany,
    getCalendars: webCalendars, setCalendars: webSetCalendars, timebox: webTimebox,
    placeTask: webPlaceTask, unplaceTask: webUnplaceTask, reopenTask: webReopen, setWriteCalendar: webSetWriteCalendar, moveEvent: webMoveEvent
  };
  var out;
  try {
    var req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (req && typeof req.a === 'string') return helpDispatch_(req); // 도움말 AI (38_Help.gs, 서버 전용). 개인 키 대신 구글 토큰으로 확인한다.
    var fn =api.hasOwnProperty(req.fn) ? api[req.fn] : null;
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
// 예전 이름 그대로 둔다: 이미 캘린더에 들어간 일정을 이 표시로 찾아 지우기 때문(이름을 바꿔도 바꾸지 말 것)
var KIT_EVENT_TAG_ = '[내 업무관리 키트] ';

function selectedCalendarIds_() {
  var raw = String(readSettings_(SpreadsheetApp.getActiveSpreadsheet())['캘린더'] || '').trim();
  return raw ? raw.split(',').map(function (s) { return s.trim(); }).filter(String) : [];
}
/** 시간표 일정을 넣을 캘린더 ID ([_설정] '시간표캘린더'). 비어 있으면 기본 캘린더. */
function writeCalendarId_() { return String(readSettings_(SpreadsheetApp.getActiveSpreadsheet())['시간표캘린더'] || '').trim(); }
/** 읽을 캘린더: 보이는 캘린더(없으면 기본) + 시간표 캘린더(넣은 일정이 늘 보이게) */
function readCalendarIds_() {
  var ids = selectedCalendarIds_().slice(), w = writeCalendarId_();
  if (!ids.length) ids = ['primary'];
  if (w && ids.indexOf(w) === -1) ids.push(w);
  return ids;
}
function writeCal_() { var w = writeCalendarId_(); var c = null; if (w) try { c = CalendarApp.getCalendarById(w); } catch (e) {} return c || CalendarApp.getDefaultCalendar(); }
/** 넣은 일정을 찾을 캘린더: 시간표 캘린더 + 기본 캘린더(예전에 넣은 것) */
function placedCals_() { var a = writeCal_(), d = CalendarApp.getDefaultCalendar(); return a.getId() === d.getId() ? [a] : [a, d]; }

/**
 * 고른 캘린더(없으면 기본 캘린더)의 일정을 읽는다. 권한이 없거나 실패하면 빈 목록 + 사유.
 * @return {{ok:boolean, reason?:string, items:Array}}
 */
function readCalendar_(startYmd, days, tz) {
  var c = cache_(), cv = (c && c.get('calv')) || '0';
  var ckey = 'cal:' + cv + ':' + startYmd + ':' + days + ':' + readCalendarIds_().join('|').slice(0, 160);
  var hit = cacheGetJson_(ckey);
  if (hit) return hit;
  var r = readCalendarRaw_(startYmd, days, tz);
  // 캘린더는 10분 캐시. 실패(권한 없음 등)도 1분 캐시: 탭을 열 때마다 다시 실패하느라 느려지지 않게 (제보 #5)
  cachePutJson_(ckey, r, r.ok ? 600 : 60);
  return r;
}

function readCalendarRaw_(startYmd, days, tz) {
  try {
    var start = Utilities.parseDate(startYmd + ' 00:00', tz, 'yyyy-MM-dd HH:mm');
    var end = new Date(start.getTime() + days * 864e5);
    var ids = readCalendarIds_(), cals = [];
    ids.forEach(function (id) { try { var c = id === 'primary' ? CalendarApp.getDefaultCalendar() : CalendarApp.getCalendarById(id); if (c) cals.push(c); } catch (e) {} });
    if (!cals.length) cals = [CalendarApp.getDefaultCalendar()];
    var multi = cals.length > 1, items = [];
    cals.forEach(function (cal) {
      var cname = multi && cal.getName ? cal.getName() : '';
      var color = multi && cal.getColor ? cal.getColor() : '';
      var calId = cal.getId(), own = cal.isOwnedByMe ? cal.isOwnedByMe() : false;
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
          cal: cname, color: color, kit: kit,
          eventId: ev.getId ? ev.getId() : '', calId: calId, own: own && !(ev.isRecurringEvent && ev.isRecurringEvent())
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
  var sel = selectedCalendarIds_(), def = CalendarApp.getDefaultCalendar(), defId = def.getId(), w = writeCalendarId_() || defId;
  return CalendarApp.getAllCalendars().map(function (c) {
    var id = c.getId();
    return { id: id, name: c.getName(), color: c.getColor ? c.getColor() : '', primary: id === defId, on: sel.length ? sel.indexOf(id) !== -1 : id === defId,
      write: id === w, canWrite: c.isOwnedByMe ? c.isOwnedByMe() : id === defId };
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

/** 캘린더 일정 옮기기·길이 바꾸기 (시간표에서 끌었을 때, 내 캘린더의 반복 아닌 일정만) */
function webMoveEvent(k, calId, eventId, date, start, end) {
  checkKey_(k);
  var ctx = appContext_();
  date = ymd_(date) || todayYmd_(ctx.tz);
  if (!/^\d\d:\d\d$/.test(start) || !/^\d\d:\d\d$/.test(end) || end <= start) throw new Error('시간을 확인해 주세요.');
  var cal = CalendarApp.getCalendarById(String(calId || '')), ev = cal && cal.getEventById(String(eventId || ''));
  if (!ev) throw new Error('일정을 찾지 못했어요.');
  var at = function (hm) { return Utilities.parseDate(date + ' ' + hm, ctx.tz, 'yyyy-MM-dd HH:mm'); };
  ev.setTime(at(start), at(end));
  bumpCalendar_(); bumpDataVersion_(ctx.ss.getId());
  return withView_({ ok: true });
}

/** 시간표 일정을 넣을 캘린더 저장 (기본 캘린더면 비워 둔다) */
function webSetWriteCalendar(k, id) {
  checkKey_(k);
  var ctx = appContext_();
  id = String(id || '').trim();
  var defId = CalendarApp.getDefaultCalendar().getId();
  writeSetting_(ctx.ss, '시간표캘린더', !id || id === defId || id === 'primary' ? '' : id);
  bumpCalendar_(); bumpDataVersion_(ctx.ss.getId());
  return withView_({ ok: true });
}

/**
 * 시간표를 시간표 캘린더(기본: 기본 캘린더)에 넣는다. 오늘 키트가 넣었던 일정은 먼저 지우고 다시 넣는다(다시 배치해도 겹치지 않게).
 * blocks: [{id, title, start:'HH:mm', end:'HH:mm'}]
 */
function webTimebox(k, blocks) {
  checkKey_(k);
  var ctx = appContext_();
  var today = todayYmd_(ctx.tz);
  var cal = writeCal_();
  // 시트 시간대 기준으로 시각을 만든다 (스크립트 시간대가 달라도 어긋나지 않게)
  var at = function (hm) { return Utilities.parseDate(today + ' ' + hm, ctx.tz, 'yyyy-MM-dd HH:mm'); };
  var dayStart = at('00:00'), dayEnd = new Date(dayStart.getTime() + 864e5);
  var removed = 0;
  placedCals_().forEach(function (c) { c.getEvents(dayStart, dayEnd).forEach(function (ev) {
    if (String(ev.getDescription() || '').indexOf(KIT_EVENT_TAG_) === 0) { ev.deleteEvent(); removed++; }
  }); });
  var added = 0;
  (blocks || []).slice(0, 30).forEach(function (b) {
    if (!b || !b.title || !/^\d\d:\d\d$/.test(b.start) || !/^\d\d:\d\d$/.test(b.end)) return;
    cal.createEvent(String(b.title).slice(0, 200), at(b.start), at(b.end), { description: KIT_EVENT_TAG_ + String(b.id || '') + '\n시간표에서 넣은 일정입니다. 다시 넣으면 바뀝니다.' });
    added++;
  });
  bumpCalendar_(); bumpDataVersion_(ctx.ss.getId());
  return withView_({ ok: true, added: added, removed: removed });
}

/**
 * 오늘 시간표에서 할 일 하나를 원하는 시각에 놓기 (드래그). 같은 할 일을 이미 놓았으면 옮긴다.
 * 시간표 캘린더에 할 일 제목 그대로 일정으로 넣고, 설명에 KIT_EVENT_TAG_ + 업무 ID를 남긴다.
 */
function webPlaceTask(k, id, title, date, start, end) {
  checkKey_(k);
  var ctx = appContext_();
  date = ymd_(date) || todayYmd_(ctx.tz);
  if (!/^\d\d:\d\d$/.test(start) || !/^\d\d:\d\d$/.test(end) || end <= start) throw new Error('시간을 확인해 주세요.');
  id = String(id || ''); title = String(title || '').trim().slice(0, 200);
  if (!id || !title) throw new Error('할 일을 찾지 못했습니다.');
  var cal = writeCal_();
  placedCals_().forEach(function (c) { removePlaced_(c, id, date, ctx.tz); });
  var at = function (hm) { return Utilities.parseDate(date + ' ' + hm, ctx.tz, 'yyyy-MM-dd HH:mm'); };
  cal.createEvent(title, at(start), at(end), { description: KIT_EVENT_TAG_ + id + '\n시간표에서 넣은 일정입니다.' });
  bumpCalendar_(); bumpDataVersion_(ctx.ss.getId());
  return withView_({ ok: true });
}

/** 시간표에서 뺀다 (키트가 넣은 그 할 일의 일정만 지움) */
function webUnplaceTask(k, id, date) {
  checkKey_(k);
  var ctx = appContext_();
  date = ymd_(date) || todayYmd_(ctx.tz);
  var n = 0; placedCals_().forEach(function (c) { n += removePlaced_(c, String(id || ''), date, ctx.tz); });
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

/** 주간 정리 완료 기록 */
function webReviewDone(k) {
  checkKey_(k);
  var ctx = appContext_();
  var td = todayYmd_(ctx.tz);
  writeSetting_(ctx.ss, '마지막주간검토', td);
  // 인사이트 배지(주간 정리 연속)용: 검토한 날을 최근 60개까지 남긴다
  var hist = String(readSettings_(ctx.ss)['주간검토기록'] || '').split(',').filter(function (x) { return /^\d{4}-\d{2}-\d{2}$/.test(x); });
  if (hist.indexOf(td) < 0) hist.push(td);
  writeSetting_(ctx.ss, '주간검토기록', hist.slice(-60).join(','));
  return withView_({ ok: true });
}

/** PC 화면: 전체 업무 표 */
function webAll(k) {
  checkKey_(k);
  var ctx = appContext_();
  var st = readSettings_(ctx.ss), rv = String(st['주간검토기록'] || '').split(',').filter(function (x) { return /^\d{4}-\d{2}-\d{2}$/.test(x); });
  var lr = ymd_(st['마지막주간검토'], ctx.tz); if (lr && rv.indexOf(lr) < 0) rv.push(lr);
  return {
    today: todayYmd_(ctx.tz), reviews: rv.sort(),
    items: readAllTasks_(ctx).map(function (t) {
      return { id: t.id, title: t.title, status: t.status, due: t.due, context: t.context, delegatee: t.delegatee,
        followUp: t.followUp, memo: t.memo, created: t.created, completed: t.completed, repeat: t.repeat, project: t.project,
        focus: t.focus, est: t.est, priority: t.priority, delegatedOn: t.delegatedOn, urgent: !!t.urgent, spent: t.spent || 0, postponed: t.postponed || 0,
        detail: !!t.detail, source: t.source, triaged: t.triaged, aiProcess: t.aiProcess || '', projectId: t.pid || '', stage: t.stage, nextMark: !!t.nextMark, energy: t.energy, checks: t.checks };
    })
  };
}

/** PC 화면: 주간 정리 */
function webWeekly(k) {
  checkKey_(k);
  var ctx = appContext_();
  var rows = readProjectRows_(ctx.ss);
  var s = buildWeeklySummary_(readAllTasks_(ctx), todayYmd_(ctx.tz), rows);
  var slim = function (list) {
    return list.map(function (t) { return { id: t.id, title: t.title, status: t.status, due: t.due, delegatee: t.delegatee, followUp: t.followUp, created: t.created, completed: t.completed, context: t.context, project: t.project, repeat: t.repeat, delegatedOn: t.delegatedOn, spent: t.spent || 0, focus: t.focus || '', est: t.est || 0, priority: t.priority || '' }; });
  };
  return { today: s.today, weekStart: s.weekStart, done: slim(s.done), next: slim(s.next), overdue: slim(s.overdue),
    followUp: slim(s.followUp), delegated: slim(s.delegated), upcoming: slim(s.upcoming), inbox: slim(s.inbox), someday: slim(s.someday), routineDone: s.routineDone, projects: withOutcomes_(ctx.ss, s.projects, rows), reference: slim(s.reference), pending: buildPending_(readAllTasks_(ctx), ymd_(readSettings_(ctx.ss)['분류도입일'], ctx.tz)).map(function (t) { return { id: t.id, title: t.title, source: t.source, created: t.created }; }),
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
  var all = readAllTasks_(ctx), rows = readProjectRows_(ctx.ss), st0 = readSettings_(ctx.ss);
  var view = buildTodayView_(all, today, { projectRows: rows, adoptedOn: ymd_(st0['분류도입일'], ctx.tz) });
  view.sheetUrl = ctx.ss.getUrl();
  view.kitVersion = KIT.VERSION;
  view.pageUrl = KIT.WEB_PAGE_URL ? KIT.WEB_PAGE_URL.replace(/\/?$/, '/') : '';
  view.projects = withOutcomes_(ctx.ss, view.projects, rows);
  view.adoptedOn = ymd_(st0['분류도입일'], ctx.tz);
  var titles = {}; all.forEach(function (t) { if (t.id) titles[t.id] = t.title; });
  var openTitles = {}, projNames = {};
  all.forEach(function (t) { if (!isClosedStatus_(t.status) && t.title) openTitles[titleKey_(t.title)] = 1; });
  rows.forEach(function (r) { if (!r.dropped) projNames[r.name] = 1; });
  view.ai = buildAiView_(ctx.ss, titles, openTitles, projNames);
  view.nowPicks = pickNow_(all, today, {}, rows).picks; // 오늘 화면 맨 위 '지금 할 일' 카드 (규칙은 '지금 뭐 하지?'와 같다)
  view.dayClose = buildCloseView_(ctx.ss, today);
  view.alertSeen = { at: String(st0['알림확인시각'] || ''), keys: String(st0['알림확인목록'] || '').split('\n').filter(String) };
  view.week = calendarRange_(ctx, weekStartYmd_(today), 7, all);
  view.events = { ok: view.week.events.ok, reason: view.week.events.reason,
    items: view.week.events.items.filter(function (e) { return e.date === today; }) };
  var last = ymd_(readSettings_(ctx.ss)['마지막주간검토'], ctx.tz);
  view.lastReview = last;
  var st = readSettings_(ctx.ss);
  view.notify = { daily: st['아침알림'] === '켜짐', weekly: st['주간메일'] === '켜짐' };
  // 한 번도 안 했으면 첫 사용(분류 도입일 또는 가장 오래된 등록일) 3일 뒤부터. 해 본 적 있으면 7일 뒤
  var base = st0['분류도입일'] ? ymd_(st0['분류도입일'], ctx.tz) : '';
  if (!base) all.forEach(function (t) { if (t.created && (!base || t.created < base)) base = t.created; });
  view.reviewDue = last ? last <= addDaysYmd_(today, -7) : !!base && base <= addDaysYmd_(today, -3);
  return view;
}

/** 업무 목록 → 오늘 화면 (순수 함수 — 테스트 대상) */
/**
 * 분류 대기: 분류일이 비어 있고(앱의 분류 버튼이 채움) 끝나지 않은 줄. 도입일(adoptedOn) 이전에 만든 옛 줄은 이미 분류된 것으로 본다.
 * 도입일을 모르면 아무것도 대기로 보지 않는다(옛 줄이 한꺼번에 쏟아지지 않게).
 */
function buildPending_(tasks, adoptedOn) {
  if (!adoptedOn) return [];
  return tasks.filter(function (t) {
    return !t.triaged && !isClosedStatus_(t.status) && t.status !== STATUS.REFERENCE && (!t.created || t.created >= adoptedOn);
  });
}

function buildTodayView_(tasks, today, ext) {
  ext = ext || {};
  if (ext.projectRows) linkProjects_(tasks, ext.projectRows);
  var s = buildWeeklySummary_(tasks, today, ext.projectRows);
  var pendingList = buildPending_(tasks, ext.adoptedOn), pendingIds = {};
  pendingList.forEach(function (t) { pendingIds[t.id] = 1; });
  var pick = function (t) {
    var o = { id: t.id, title: t.title, due: t.due, context: t.context, delegatee: t.delegatee, followUp: t.followUp, status: t.status, repeat: t.repeat || '', project: t.project || '',
      focus: t.focus || '', est: t.est || 0, priority: t.priority || '', delegatedOn: t.delegatedOn || '', memo: t.memo || '', urgent: !!t.urgent };
    // 새 열은 값이 있을 때만 싣는다 (화면 데이터 크기를 지킨다)
    if (t.detail) o.hasDetail = true;
    if (t.postponed) o.postponed = t.postponed;
    if (t.source) o.source = t.source;
    if (t.pid) o.pid = t.pid;
    if (t.stage) o.stage = t.stage;
    if (t.nextMark) o.nextMark = true;
    if (t.energy) o.energy = t.energy;
    if (t.aiProcess) o.aiProcess = t.aiProcess;
    if (t.checks) o.checks = t.checks;
    if (t.status === STATUS.DELEGATED && !t.delegatedOn && t.created) o.created = t.created; // 맡긴 일 화면의 '맡긴 지 N일' 계산용
    if (pendingIds[t.id]) o.pending = true;
    return o;
  };
  var isRoutineToday = function (t) { return !!t.repeat && isActionable_(t.status) && (!t.due || t.due <= today); };
  var byDue = function (a, b) { return (a.due || '9999') < (b.due || '9999') ? -1 : (a.due || '9999') > (b.due || '9999') ? 1 : 0; };
  var byPrio = function (a, b) {
    var pa = PRIORITY_ORDER[a.priority] === undefined ? 1 : PRIORITY_ORDER[a.priority];
    var pb = PRIORITY_ORDER[b.priority] === undefined ? 1 : PRIORITY_ORDER[b.priority];
    return pa !== pb ? pa - pb : byDue(a, b);
  };
  // ★(오늘 할 일)는 그날만. 지난 날 ★인데 못 끝낸 일은 '어제 못 끝낸 일'(carry)로 모아 오늘 다시 정하게 한다.
  var isFocus = function (t) { return isActionable_(t.status) && t.focus && t.focus === today; };
  // 오늘 마감·예정인 일(★ 없이도 오늘 할 일)
  var isDueToday = function (t) { return (t.status === STATUS.NEXT || t.status === STATUS.SCHEDULED) && !t.focus && t.due && t.due <= today; };
  // 다시 정할 일: 지난 날 ★인데 못 끝낸 일, 예전 수집함, 날짜 없는 '할 일 목록'
  var isCarry = function (t) {
    if (!isActionable_(t.status) || t.repeat || t.status === STATUS.DELEGATED || isDueToday(t)) return false;
    if (t.focus) return t.focus < today;
    // 프로젝트에 넣은 날짜 없는 일은 프로젝트 안에서 기다리는 일이다(어제 못 끝낸 일이 아님)
    if (t.project && t.status === STATUS.NEXT) return false;
    return t.status === STATUS.INBOX || (t.status === STATUS.NEXT && !(t.due && t.due > today));
  };
  var focus = tasks.filter(isFocus).sort(byPrio);
  var carry = tasks.filter(isCarry).sort(byPrio);
  var routines = tasks.filter(function (t) { return isRoutineToday(t) && !isFocus(t); }).sort(byDue);
  var now = tasks.filter(function (t) {
    if (isRoutineToday(t) || isFocus(t) || isCarry(t)) return false;
    return isDueToday(t);
  }).sort(byPrio);
  var mins = function (list) { return list.reduce(function (s, t) { return s + (t.est || 30); }, 0); };
  var dueToday = tasks.filter(function (t) {
    return isActionable_(t.status) && t.due && t.due <= today;
  }).sort(byDue);
  return {
    today: today,
    focus: focus.map(pick),
    estMinutes: { focus: mins(focus), now: mins(now), routines: mins(routines) },
    counts: { doneToday: s.done.filter(function (t) { return t.completed === today; }).length, pending: pendingList.length, inbox: s.inbox.length, focus: focus.length, now: now.length, routines: routines.length, overdue: s.overdue.length, followUp: s.followUp.length, doneWeek: s.done.length },
    routines: routines.map(pick),
    carry: carry.map(pick),
    doneToday: tasks.filter(function (t) { return t.status === STATUS.DONE && t.completed === today; }).map(function (t) { return { id: t.id, title: t.title, project: t.project || '', repeat: t.repeat || '', priority: t.priority || '', urgent: !!t.urgent, spent: t.spent || 0 }; }),
    routineDone: s.routineDone,
    now: now.map(pick),
    followUp: s.followUp.map(pick),
    due: dueToday.map(pick),
    pending: pendingList.slice(0, 100).map(pick),
    upcoming: s.upcoming.map(pick),
    delegated: s.delegated.slice().sort(function (a, b) {
      return (a.followUp || '9999') < (b.followUp || '9999') ? -1 : (a.followUp || '9999') > (b.followUp || '9999') ? 1 : 0;
    }).map(pick),
    inbox: s.inbox.map(pick),
    someday: s.someday.length,
    somedayList: s.someday.slice(0, 30).map(pick),
    reference: s.reference.length,
    projects: s.projects,
    contexts: uniq_(tasks.filter(function (t) { return isActionable_(t.status) && t.context; }).map(function (t) { return t.context; })),
    projectNames: uniq_(tasks.filter(function (t) { return t.project; }).map(function (t) { return t.project; }))
  };
}

function uniq_(list) { var seen = {}; return list.filter(function (x) { if (seen[x]) return false; seen[x] = true; return true; }); }

function completeTask(id) {
  return clarifyTask(id, { status: STATUS.DONE, onlyIfOpen: true });
}

/** 위임 확인일 미루기 */
function postponeFollowUp(id, days) {
  return withLock_(function () {
    var ctx = taskContext_();
    var row = findRowById_(ctx, id);
    if (!row || !ctx.map.followUp) throw new Error('항목을 찾지 못했습니다.');
    ctx.sheet.getRange(row, ctx.map.followUp).setValue(addDaysYmd_(todayYmd_(ctx.tz), Number(days) || 3));
    applyTrack_(ctx, row, { check: true }); // 확인 횟수 +1
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
      todayYmd_: todayYmd_, weekStartYmd_: weekStartYmd_, addDaysYmd_: addDaysYmd_, selectedCalendarIds_: selectedCalendarIds_, readCalendarIds_: readCalendarIds_, writeCalendarId_: writeCalendarId_, getAppData: getAppData,
      KIT_EVENT_TAG_: KIT_EVENT_TAG_, bumpDataVersion_: bumpDataVersion_,
      // 앱스크립트는 요청마다 새로 시작한다. 엔진은 계속 살아 있으므로 요청마다 실행 단위 기억을 비운다
      freshExecution: function () { SETTINGS_CACHE_ = null; DATA_VER_ = {}; LAST_SPAWN_ID_ = ''; }
    };
  })(env);
  env.__cal = function (start, days) {
    var key = calKey(start, days);
    return calData[key] || { ok: true, items: [] };
  };
  function calKey(start, days) { return start + '|' + days + '|' + (book ? K.readCalendarIds_().join(',') : ''); }
  function writeCalId() { return (book && K.writeCalendarId_()) || 'primary'; }
  function placedCalIds() { var w = writeCalId(); return w === 'primary' ? ['primary'] : [w, 'primary']; }

  // ── 캘린더 API ──────────────────────────────────────────────
  var calList = null;
  async function calendars() {
    if (calList) return calList;
    var r = await gapi('GET', API.cal + '/users/me/calendarList?minAccessRole=reader&fields=' + enc('items(id,summary,summaryOverride,backgroundColor,primary,accessRole)'));
    calList = (r.items || []).map(function (c) { return { id: c.id, name: c.summaryOverride || c.summary, color: c.backgroundColor || '', primary: !!c.primary, owner: c.accessRole === 'owner' }; });
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
      var ids = K.readCalendarIds_();
      var multi = ids.length > 1, items = [];
      // 캘린더 목록과 각 캘린더 일정을 한꺼번에 받는다 (차례로 받으면 캘린더 수만큼 느려진다)
      var got = await Promise.all([calendars().catch(function () { return []; })].concat(ids.map(function (cid) { return readEvents(cid, startYmd, days, tz); })));
      var list = got[0];
      for (var i = 0; i < ids.length; i++) {
        var meta = list.filter(function (c) { return c.id === ids[i] || (ids[i] === 'primary' && c.primary); })[0] || {};
        var evs = got[i + 1];
        evs.forEach(function (ev) {
          var allDay = !ev.start.dateTime, s = allDay ? null : new Date(ev.start.dateTime), en = allDay ? null : new Date(ev.end.dateTime);
          var desc = String(ev.description || ''), kit = desc.indexOf(K.KIT_EVENT_TAG_) === 0 ? desc.slice(K.KIT_EVENT_TAG_.length).split(/\s/)[0] : '';
          items.push({ title: ev.summary || '(제목 없음)', allDay: allDay, date: allDay ? ev.start.date : utils.formatDate(s, tz, 'yyyy-MM-dd'), start: allDay ? '' : utils.formatDate(s, tz, 'HH:mm'), end: allDay ? '' : utils.formatDate(en, tz, 'HH:mm'),
            location: ev.location || '', cal: multi ? (meta.name || '') : '', color: multi ? (meta.color || '') : '', kit: kit, eventId: ev.id, calId: ids[i], own: ids[i] === 'primary' || !!meta.owner });
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
  // 넣은 일정 지우기: 시간표 캘린더 + 기본 캘린더(예전에 넣은 것)에서 찾는다
  async function removePlaced(id, date) {
    var tz = book.tz, n = 0, cals = placedCalIds();
    for (var c = 0; c < cals.length; c++) {
      var evs = await readEvents(cals[c], date, 1, tz).catch(function () { return []; });
      for (var i = 0; i < evs.length; i++) {
        var d = String(evs[i].description || '');
        if (d.indexOf(K.KIT_EVENT_TAG_) === 0 && (!id || d.slice(K.KIT_EVENT_TAG_.length).split(/\s/)[0] === id)) { await gapi('DELETE', API.cal + '/calendars/' + enc(cals[c]) + '/events/' + enc(evs[i].id)); n++; }
      }
    }
    return n;
  }
  async function insertPlaced(id, title, date, start, end) {
    var tz = book.tz;
    await gapi('POST', API.cal + '/calendars/' + enc(writeCalId()) + '/events', { summary: title, description: K.KIT_EVENT_TAG_ + id + '\n시간표에서 넣은 일정입니다.',
      start: { dateTime: utils.parseDate(date + ' ' + start, tz).toISOString(), timeZone: tz }, end: { dateTime: utils.parseDate(date + ' ' + end, tz).toISOString(), timeZone: tz } });
  }

  // ── 앱 화면이 부르는 함수 (App.html 의 call(fn) 이름과 같다) ────
  var WEB = { getAppData: 'webData', getInbox: 'webInbox', addTasks: 'webAdd', clarifyTask: 'webClarify', completeTask: 'webComplete', postponeFollowUp: 'webPostpone', skipTask: 'webSkip',
    getCalendar: 'webCalendar', addRoutine: 'webAddRoutine', reviewDone: 'webReviewDone', updateTask: 'webUpdate', planDay: 'webPlanDay', undoTask: 'webUndo', getAll: 'webAll',
    getWeekly: 'webWeekly', addAction: 'webAddAction', setProject: 'webSetProject', mergeProject: 'webMergeProject', focusMany: 'webFocusMany', setCalendars: 'webSetCalendars', reopenTask: 'webReopen', setWriteCalendar: 'webSetWriteCalendar',
    getTaskDetail: 'webTaskDetail', saveDetail: 'webSaveDetail', setNext: 'webSetNext', setProjectInfo: 'webSetProjectInfo', inboxSeen: 'webInboxSeen', revertAi: 'webRevertAi', applyAi: 'webApplyAi', rejectAi: 'webRejectAi',
    closeDay: 'webCloseDay', nowPicks: 'webNowPicks', triageMany: 'webTriageMany', applyAiMany: 'webApplyAiMany' };
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

  // 상세 글을 저장·열기 직전: 그 줄을 시트에서 다시 읽어 화면의 메모리 줄에 반영한다 (못 보낸 변경이 있는 줄은 건드리지 않는다)
  async function syncTaskRow(taskId) {
    if (!book || !taskId) return;
    await saving; // 보내는 중인 변경이 끝난 뒤 읽는다: 내가 방금 보낸 것을 '다른 곳의 변경'으로 오해하지 않게 (체크박스 연타)
    var sh = book.api.getSheetByName(K.KIT.TASK_SHEET), s = sh && sh._s;
    if (!s || !s.data[0]) return;
    var hdr = s.data[0].map(function (h) { return String(h === undefined || h === null ? '' : h).trim(); }), idc = hdr.indexOf('ID');
    if (idc < 0) return;
    var r = 0; for (var i = 1; i < s.data.length; i++) if (String((s.data[i] || [])[idc] === undefined || (s.data[i] || [])[idc] === null ? '' : s.data[i][idc]).trim() === taskId) { r = i + 1; break; }
    if (!r || s.dirty[r] || inflight.some(function (m) { return m.s === s && m.dirty[r]; })) return;
    var L = colName(idc + 1), width = 0; s.data.forEach(function (x) { width = Math.max(width, x.length); });
    try {
      var ids = (await readRanges(book.id, [q(s.name) + '!' + L + '1:' + L]))[0] || [], rr = 0;
      for (var j = 0; j < ids.length; j++) if (String((ids[j] || [])[0] === undefined ? '' : ids[j][0]).trim() === taskId) { rr = j + 1; break; }
      if (!rr) return;
      var row = (await readRanges(book.id, [q(s.name) + '!A' + rr + ':' + colName(Math.max(width, 1)) + rr]))[0];
      row = (row && row[0]) || [];
      if (s.dirty[r] || sending > 0 || saveQueued) return; // 읽는 사이 앱에서 고쳤거나 저장이 시작됐다
      var cur = s.data[r - 1] = s.data[r - 1] || [];
      for (var c = 0; c < Math.max(width, row.length); c++) cur[c] = row[c] === undefined ? '' : row[c];
      cache = {};
    } catch (e) { /* 못 읽으면 화면의 모습 그대로: 저장 직전 확인(flush)이 한 번 더 막는다 */ }
  }

  async function call(fn, args) {
    await ready;
    return serial(async function () {
      K.freshExecution();
      refreshIfStale();
      var t = today();
      // 화면에 필요한 캘린더를 먼저 읽어 둔다 (이번 주 + 요청 범위)
      await preloadCal(K.weekStartYmd_(t), 7);
      if (fn === 'getCalendar') await preloadCal(args[0] || K.weekStartYmd_(t), Math.min(Math.max(Number(args[1]) || 7, 1), 42));
      if (fn === 'getCalendars') { calList = null; var sel = K.selectedCalendarIds_(), wid = K.writeCalendarId_(), list = await calendars(); return list.map(function (c) { return { id: c.id, name: c.name, color: c.color, primary: c.primary, on: sel.length ? sel.indexOf(c.id) !== -1 : c.primary, write: wid ? c.id === wid : c.primary, canWrite: c.owner }; }); }
      // 캘린더 일정 옮기기·길이 바꾸기 (시간표에서 끌었을 때) — 내가 만든 캘린더의 일정만
      if (fn === 'moveEvent') {
        var mc = String(args[0] || ''), me = String(args[1] || ''), md = args[2] || t, ms = args[3], mn = args[4];
        if (!mc || !me || !/^\d\d:\d\d$/.test(ms) || !/^\d\d:\d\d$/.test(mn) || mn <= ms) throw new Error('시간을 확인해 주세요.');
        await gapi('PATCH', API.cal + '/calendars/' + enc(mc) + '/events/' + enc(me), { start: { dateTime: utils.parseDate(md + ' ' + ms, book.tz).toISOString(), timeZone: book.tz }, end: { dateTime: utils.parseDate(md + ' ' + mn, book.tz).toISOString(), timeZone: book.tz } });
        dropCal(); await preloadCal(K.weekStartYmd_(t), 7);
        return { ok: true, view: clone(K.getAppData()) };
      }
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
      if (fn === 'saveDetail' || fn === 'getTaskDetail') await syncTaskRow(String(args[0] || '')); // 상세 글은 읽고 쓰기 직전에 시트의 최신 글로 맞춘다
      var name = WEB[fn]; if (!name) throw new Error('알 수 없는 요청입니다: ' + fn);
      var res = K.fn(name).apply(null, [''].concat(args || []));
      if (fn === 'setCalendars' || fn === 'setWriteCalendar') { dropCal(); await preloadCal(K.weekStartYmd_(t), 7); res = { ok: true, view: clone(K.getAppData()) }; }
      saveLater(); saveSnap();
      return clone(res);
    });
  }

  return {
    /** 시작 뒤에 이메일을 알게 됐을 때 */
    setEmail: function (email) { if (email) userEmail = email; },
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
        startLog = log.join(' · '); try { console.info('[GTD 워크] 시작: ' + startLog); } catch (e) {}
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
    /** 저장 직전 확인에서 '다른 곳에서 먼저 바뀌어' 저장하지 않은 줄 (가져가면 비운다) */
    takeConflicts: function () { var c = conflictLog; conflictLog = []; return c; },
    /** 저장 실패 뒤 다시 시도 */
    retrySave: function () { saveLater(); return idle(); },
    /** 아직 구글 시트에 못 보낸 변경이 있는지 (창을 닫기 전 확인용) */
    unsaved: function () { return saveQueued || sending > 0 || !!saveFailed || hasChanges(); },
    idle: idle,
    _book: function () { return book; }, _K: K, _flush: flush
  };
}
if (typeof module !== 'undefined') module.exports = { createKitEngine: createKitEngine };
