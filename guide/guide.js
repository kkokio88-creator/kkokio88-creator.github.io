/* GTD 워크 사용법 — 스크롤 장면 엔진
 * 휴대폰 안은 실제 앱 화면(guide/s/*.html, GTD 레포 tools/guide-scenes.js로 생성).
 * 장면마다 그 화면의 실제 컴포넌트를 Shadow DOM으로 복제해(앱 CSS = s/comp.css) 휴대폰 밖으로 꺼내고,
 * 스크롤 진행률(p)에 맞춰 키우고·옮기고·되돌린다. 모든 움직임은 p의 함수라 위로 올리면 거꾸로 돈다.
 */
(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var clamp = function (x, a, b) { return Math.min(b === undefined ? 1 : b, Math.max(a || 0, x)); };
  var seg = function (t, a, b) { return clamp((t - a) / (b - a)); };
  var lerp = function (a, b, k) { return a + (b - a) * k; };
  var io = function (k) { return k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2; };
  var out = function (k) { return 1 - Math.pow(1 - k, 3); };
  var back = function (k) { var c1 = 1.5, c3 = c1 + 1; return 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2); };
  var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var narrow = function () { return innerWidth / innerHeight < 1 || innerWidth < 860; };
  var NEXT = '세무사님께 부가세 자료 일정 전화로 확인', NEXT2 = '분기 보고서 초안 목차 쓰기';

  // ── 글자 쪼개기 (| = 줄바꿈) ──
  $$('[data-split]').forEach(function (el) {
    var i = 0, html = el.innerHTML;
    el.innerHTML = '';
    var tmp = document.createElement('div'); tmp.innerHTML = html;
    (function walk(node, parent, em) {
      [].slice.call(node.childNodes).forEach(function (n) {
        if (n.nodeType === 3) {
          n.textContent.split(/(\s*\|\s*|\s+)/).forEach(function (part) {
            if (!part) return;
            if (/\|/.test(part)) { parent.appendChild(document.createElement('br')); return; }
            if (/^\s+$/.test(part)) { parent.appendChild(document.createTextNode(' ')); return; }
            var w = document.createElement('span'); w.className = 'w';
            Array.from(part).forEach(function (ch) { var s = document.createElement('span'); s.className = 'c'; s.textContent = ch; s.style.setProperty('--i', i++); w.appendChild(s); });
            parent.appendChild(w);
          });
        } else {
          var c = n.cloneNode(false); parent.appendChild(c); walk(n, c, true);
        }
      });
    })(tmp, el, false);
  });

  // ── 관성 스크롤 ──
  var lenis = null;
  if (window.Lenis && !reduce) {
    lenis = new Lenis({ lerp: 0.1, wheelMultiplier: 1, touchMultiplier: 1.4 });
    lenis.on('scroll', ScrollTrigger.update);
    gsap.ticker.add(function (t) { lenis.raf(t * 1000); });
    gsap.ticker.lagSmoothing(0);
  }
  gsap.registerPlugin(ScrollTrigger);
  $$('[data-go]').forEach(function (a) {
    a.addEventListener('click', function (e) {
      var id = a.getAttribute('href'), el = id === '#top' ? document.body : $(id);
      if (!el) return; e.preventDefault();
      if (lenis) lenis.scrollTo(id === '#top' ? 0 : el, { duration: 1.6 }); else el.scrollIntoView({ behavior: 'smooth' });
    });
  });

  // ── 배경색 · 내비 · 진행 막대 ──
  var nav = $('#gnav');
  $$('.ch[data-bg]').forEach(function (sec) {
    ScrollTrigger.create({ trigger: sec, start: 'top 55%', end: 'bottom 55%', onToggle: function (self) {
      if (!self.isActive) return;
      gsap.to('#bg', { backgroundColor: sec.dataset.bg, duration: 0.7, ease: 'power2.out', overwrite: true });
      nav.classList.toggle('light', sec.classList.contains('light') || sec.classList.contains('day'));
      $$('.chips a').forEach(function (a) { a.classList.toggle('on', a.getAttribute('href') === '#' + sec.id); });
    } });
  });
  ScrollTrigger.create({ start: 0, end: 'max', onUpdate: function (self) { $('#bar').style.transform = 'scaleX(' + self.progress + ')'; } });
  $$('[data-reveal]').forEach(function (el) {
    ScrollTrigger.create({ trigger: el, start: 'top 80%', onEnter: function () { el.classList.add('on'); }, onLeaveBack: function () { el.classList.remove('on'); } });
  });
  function cues(sec, p) {
    $$('[data-at]', sec).forEach(function (el) {
      var at = parseFloat(el.dataset.at), until = el.dataset.until ? parseFloat(el.dataset.until) : 2;
      el.classList.toggle('on', p >= at && p < until);
    });
  }

  // ── 색종이 ──
  var cv = $('#confetti'), cx = cv.getContext('2d'), parts = [], running = false;
  function sizeCv() { var d = devicePixelRatio || 1; cv.width = innerWidth * d; cv.height = innerHeight * d; cx.setTransform(d, 0, 0, d, 0, 0); }
  sizeCv(); addEventListener('resize', sizeCv);
  var COLORS = ['#5B5CF6', '#A35BF6', '#E06BD8', '#5FD3F3', '#FFB020', '#3CC6A0'];
  function burst(x, y, n, power, colors) {
    if (reduce) return;
    for (var i = 0; i < n; i++) {
      var a = -Math.PI / 2 + (Math.random() - .5) * Math.PI * 1.4, v = (power || 10) * (.45 + Math.random());
      parts.push({ x: x, y: y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, r: 4 + Math.random() * 6, rot: Math.random() * 6, vr: (Math.random() - .5) * .4, c: (colors || COLORS)[i % (colors || COLORS).length], life: 0, s: i % 3 });
    }
    if (!running) { running = true; requestAnimationFrame(draw); }
  }
  function draw() {
    cx.clearRect(0, 0, innerWidth, innerHeight);
    parts = parts.filter(function (p) { return p.life < 150 && p.y < innerHeight + 40; });
    parts.forEach(function (p) {
      p.life++; p.vy += .3; p.vx *= .985; p.x += p.vx; p.y += p.vy; p.rot += p.vr;
      cx.save(); cx.translate(p.x, p.y); cx.rotate(p.rot); cx.globalAlpha = Math.max(0, 1 - p.life / 150); cx.fillStyle = p.c;
      if (p.s === 0) cx.fillRect(-p.r, -p.r / 2, p.r * 2, p.r); else if (p.s === 1) { cx.beginPath(); cx.arc(0, 0, p.r / 1.6, 0, 7); cx.fill(); } else { cx.beginPath(); cx.moveTo(0, -p.r); cx.lineTo(p.r, p.r); cx.lineTo(-p.r, p.r); cx.fill(); }
      cx.restore();
    });
    if (parts.length) requestAnimationFrame(draw); else { running = false; cx.clearRect(0, 0, innerWidth, innerHeight); }
  }

  // ══════════ 장면: 휴대폰 + 실제 앱 화면 ══════════
  var CSS = fetch('s/comp.css?v=3').then(function (r) { return r.text(); }).catch(function () { return ''; });
  var NEUTRAL = '.nx{display:block!important;position:static!important;transform:none!important;inset:auto!important;max-height:none!important;max-width:none!important;overflow:visible!important;margin:0!important;animation:none!important;opacity:1!important;visibility:visible!important;left:auto!important;right:auto!important;top:auto!important;bottom:auto!important;width:auto!important;height:auto!important;min-height:0!important}' +
    '.nx.bare{padding:0!important;background:transparent!important;box-shadow:none!important;border-radius:0!important}' +
    ':host{background:transparent!important;display:block}.wrapc{display:inline-block}.g-hl{box-shadow:0 0 0 4px rgba(91,92,246,.55)!important}*{transition:none!important;animation:none!important}';

  function Sec(el) {
    this.el = el; this.stage = $('.stage', el); this.scr = $('.scr', el); this.lift = $('.lift', el); this.phone = $('.phone', el);
    this.names = (el.dataset.scenes || '').split(',').filter(Boolean); this.frames = {}; this.cur = null; this.flags = {};
    this.ink = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); this.ink.setAttribute('class', 'ink'); this.lift.appendChild(this.ink);
    var self = this;
    this.ready = Promise.all(this.names.map(function (n) {
      return new Promise(function (res) {
        var f = document.createElement('iframe'); f.title = '앱 화면'; f.tabIndex = -1; f.setAttribute('aria-hidden', 'true');
        f.onload = function () {
          try { $$('[data-scroll]', f.contentDocument).forEach(function (e) { e.scrollTop = +e.getAttribute('data-scroll'); }); } catch (e) {}
          res();
        };
        f.src = 's/' + n + '.html?v=3'; self.scr.appendChild(f); self.frames[n] = f;
      });
    })).then(function () { return CSS; }).then(function (css) { self.css = css; self.fit(); self.show(self.names[0]); });
  }
  Sec.prototype.fit = function () { var k = this.scr.clientWidth / 390; for (var n in this.frames) this.frames[n].style.transform = 'scale(' + k + ')'; };
  Sec.prototype.show = function (n) { if (this.cur === n) return; this.cur = n; for (var m in this.frames) this.frames[m].classList.toggle('on', m === n); };
  Sec.prototype.doc = function (n) { return this.frames[n].contentDocument; };
  Sec.prototype.q = function (n, sel) { var d = this.doc(n); return typeof sel === 'function' ? sel(d) : d.querySelector(sel); };
  Sec.prototype.box = function () { return this.stage.getBoundingClientRect(); };
  // iframe 안 요소 → 장면(stage) 좌표
  Sec.prototype.rectIn = function (n, el) {
    var f = this.frames[n].getBoundingClientRect(), s = this.box(), k = f.width / 390, r = el.getBoundingClientRect();
    return { x: f.left - s.left + r.left * k, y: f.top - s.top + r.top * k, w: r.width * k, h: r.height * k, k: k };
  };
  Sec.prototype.once = function (key, cond, fn) { if (cond && !this.flags[key]) { this.flags[key] = 1; fn(); } if (!cond) this.flags[key] = 0; };
  Sec.prototype.toPage = function (x, y) { var s = this.box(); return { x: s.left + x, y: s.top + y }; };
  Sec.prototype.dim = function (t) { // 컴포넌트를 꺼내면 휴대폰은 살짝 물러난다
    this.phone.style.transform = 'translate(-50%,-50%) scale(' + (1 - .06 * t) + ')';
    this.phone.style.filter = t > 0.01 ? 'brightness(' + (1 - .35 * t) + ') saturate(' + (1 - .3 * t) + ')' : '';
  };

  function rowOf(d, text) {
    var hit = null;
    $$('.swr', d).forEach(function (w) { var t = $('.t', w); if (!hit && t && t.textContent.replace(/★/g, '').trim() === text) hit = w; });
    return hit;
  }

  // ── 휴대폰에서 꺼낸 컴포넌트 ──
  // ctx: 앱 CSS 선택자가 맞도록 감싸는 부모(여는 태그들). keep: 맨 바깥 부모의 상자(배경·여백)는 남김
  function Comp(sec, n, find, opt) {
    opt = opt || {};
    this.sec = sec; this.n = n; this.src = sec.q(n, find); this.opt = opt;
    var host = this.host = document.createElement('div'); host.className = 'comp'; host.style.opacity = 0;
    var root = host.attachShadow({ mode: 'open' });
    var ctx = opt.ctx || [], open = '', close = '';
    ctx.forEach(function (tag, i) {
      var t = tag.replace(/^<(\w+)/, function (m, nm) { return '<' + nm + ' data-nx'; });
      open += t; close = '</' + tag.match(/^<(\w+)/)[1] + '>' + close;
    });
    var html = this.src ? this.src.outerHTML : '<div></div>';
    root.innerHTML = '<style>' + sec.css + NEUTRAL + (opt.css || '') + '</style><div class="wrapc">' + open + html + close + '</div>';
    $$('[data-nx]', root).forEach(function (e, i) { e.classList.add('nx'); if (!(opt.keep && i === 0)) e.classList.add('bare'); });
    this.root = root; this.el = root.querySelector('.wrapc').lastElementChild;
    var inner = root.querySelector('.wrapc');
    var deepest = inner; while (deepest.firstElementChild && deepest.firstElementChild.hasAttribute && deepest.firstElementChild.hasAttribute('data-nx')) deepest = deepest.firstElementChild;
    this.clone = deepest === inner ? inner.firstElementChild : deepest.firstElementChild;
    if (this.src) { var sr = this.src.getBoundingClientRect(); this.clone.style.width = sr.width + 'px'; this.clone.style.boxSizing = 'border-box'; }
    sec.lift.appendChild(host);
    this.wrap = inner;
    this.measure();
  }
  Comp.prototype.measure = function () {
    this.host.style.transform = 'none';
    var w = this.wrap.getBoundingClientRect(), c = this.clone.getBoundingClientRect();
    this.nat = { w: w.width, h: w.height }; this.off = { x: c.left - w.left, y: c.top - w.top };
  };
  // 휴대폰 속 원래 자리(같은 크기)
  Comp.prototype.home = function (n) {
    var src = n ? this.sec.q(n, this.opt.homeFind || this.opt.find) : this.src;
    if (!src) src = this.src;
    var r = this.sec.rectIn(n || this.n, src);
    return { x: r.x - this.off.x * r.k, y: r.y - this.off.y * r.k, s: r.k };
  };
  // 장면 좌표 (cx, cy) 가운데, 보이는 너비 w
  Comp.prototype.at = function (cx, cy, w) { var s = w / this.nat.w; return { x: cx - this.nat.w * s / 2, y: cy - this.nat.h * s / 2, s: s }; };
  Comp.prototype.atH = function (cx, cy, h) { var s = h / this.nat.h; return { x: cx - this.nat.w * s / 2, y: cy - this.nat.h * s / 2, s: s }; };
  Comp.prototype.set = function (P, o) {
    this.host.style.transform = 'translate(' + P.x + 'px,' + P.y + 'px) scale(' + P.s + ')';
    this.host.style.opacity = o === undefined ? 1 : o;
  };
  // A→B를 t(0~1)만큼: 위로 살짝 뜨는 곡선(motion path) + 크기
  Comp.prototype.fly = function (A, B, t, lift, hideSrc) {
    var k = io(t), P = { x: lerp(A.x, B.x, k), y: lerp(A.y, B.y, k) - Math.sin(Math.PI * k) * (lift || 0), s: lerp(A.s, B.s, k) };
    this.set(P, t <= 0.001 ? 0 : 1);
    if (this.src && hideSrc !== false) this.src.style.visibility = t <= 0.001 ? '' : 'hidden';
    return P;
  };
  Comp.prototype.hide = function () { this.host.style.opacity = 0; if (this.src) this.src.style.visibility = ''; };
  Comp.prototype.center = function () { // 지금 화면 위 가운데(페이지 좌표)
    var r = this.host.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
  };

  // 손으로 그리는 선: 0~1만큼만 보인다
  function strokeTo(path, t) { var L = path.getTotalLength(); path.style.strokeDasharray = L; path.style.strokeDashoffset = L * (1 - t); }
  function pathEl(sec, cls, d, w, color) {
    var p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('class', cls); p.setAttribute('d', d);
    if (w) p.setAttribute('stroke-width', w); if (color) p.setAttribute('stroke', color); sec.ink.appendChild(p); return p;
  }

  var S = {};
  // ══════════ 이야기: 비우기 → 나누기 → 집중 (휴대폰은 고정) ══════════
  var ITEMS = [
    { t: '팀장님께 보고서 초안 보내기', to: 'today' },
    { t: '세무사님께 부가세 자료 요청', to: 'who' },
    { t: '운동 등록하기', to: 'later' },
    { t: '치과 예약', to: 'day' },
    { t: '거래처 견적서 비교', to: 'today', warn: 1 },
    { t: '이사 견적 받아보기', to: 'who' },
    { t: '빌린 책 반납', to: 'later', warn: 1 },
    { t: '엄마 생신 선물 고르기', to: 'day' },
    { t: '회의록 정리해서 공유', to: 'today' }
  ];
  var BINS = {
    today: { name: '오늘', ds: '오늘 끝낼 일', bg: '#EEEEFF', fg: '#5B5CF6', svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>' },
    who: { name: '맡기기', ds: '며칠째인지 알려 줘요', a: 's-who' },
    later: { name: '나중에', ds: '지금은 아닌 일', a: 's-later' },
    day: { name: '날짜', ds: '그날 아침에 올라와요', a: 's-day' }
  };
  var ORDER = ['today', 'who', 'later', 'day'];
  var EVENTS = [[10, 1, '팀 회의'], [12.5, 1, '점심'], [14.5, 1, '고객사 미팅']]; // 구글 캘린더 일정
  var SLOTS = [[9, 1], [11, 1.5], [16, 1]]; // 오늘 할 일을 놓는 빈 시간
  var BG = [[0, [7, 7, 13]], [.14, [7, 7, 13]], [.22, [244, 245, 247]], [.76, [244, 245, 247]], [.84, [255, 255, 255]], [1, [255, 255, 255]]];
  function bgAt(p) {
    for (var i = 1; i < BG.length; i++) if (p <= BG[i][0]) { var a = BG[i - 1], b = BG[i], k = seg(p, a[0], b[0]); return 'rgb(' + [0, 1, 2].map(function (j) { return Math.round(lerp(a[1][j], b[1][j], k)); }).join(',') + ')'; }
    return 'rgb(255,255,255)';
  }

  S.story = {
    build: function (sec) {
      var self = this, d = sec.doc('home');
      // 휴대폰: 빈 목록에서 시작(예시 할 일은 치우고, 머릿속 일을 담을 줄을 미리 만들어 숨겨 둠)
      var list = $('#listCard', d), tpl = $('.swr', list).cloneNode(true);
      $$('.swr', list).forEach(function (w) { w.remove(); });
      $$('.sub2 .m, .meta', tpl).forEach(function (m) { m.remove(); });
      this.list = list;
      this.rows = ITEMS.map(function (it) {
        var w = tpl.cloneNode(true), t = $('.t', w); t.textContent = it.t;
        $$('.m, .sub, .due, .dl, .st', w).forEach(function (x) { if (x !== t && x.closest('.row') && !x.contains(t)) x.remove(); });
        w.style.display = ''; list.appendChild(w); return w;
      });
      this.heroN = $('#heroN', d); this.heroSub = $('#heroSub', d);
      // 휴대폰에서 꺼낼 컴포넌트
      this.cap = new Comp(sec, 'home', '.capwrap');
      this.capIn = $('input', this.cap.root);
      this.rc = this.rows.map(function (w) { return new Comp(sec, 'home', function () { return w; }, { ctx: ['<div class="card">'], keep: true }); });
      this.tiles = {};
      ['who', 'later', 'day'].forEach(function (k) { self.tiles[k] = new Comp(sec, 'send', '#sheetBody [data-a="' + BINS[k].a + '"]', { ctx: ['<div class="sheet on">', '<div id="sheetBody">', '<div class="actgrid">'] }); });
      this.hero = new Comp(sec, 'home', '.hero > div:first-child', { ctx: ['<div class="hero">'] });
      this.clock = new Comp(sec, 'focus', '#fmClock', { ctx: ['<div class="fm on">'], keep: true, css: '.fm{background:#fff!important;border-radius:32px!important;padding:6px 30px!important;box-shadow:0 30px 80px rgba(60,60,140,.25)}.clock{color:#191F28!important}' });
      this.clock.measure();
      this.rows.forEach(function (w) { w.style.display = 'none'; });
      list.style.minHeight = '0';
      // 머릿속 생각(떠다니는 말풍선)
      var box = $('#thoughts');
      this.th = ITEMS.map(function (it, i) {
        var e = document.createElement('div'); e.className = 'th' + (it.warn ? ' warn' : ''); e.innerHTML = (it.warn ? '<i>아 맞다,</i>' : '') + it.t; box.appendChild(e);
        return { el: e, seed: i * 1.7 + .3 };
      });
      // 나누는 칸 4개(아이콘은 앱의 보내기 버튼과 같은 그림)
      var bins = $('#bins');
      this.bins = {};
      ORDER.forEach(function (k) {
        var b = BINS[k], icon = b.svg, bg = b.bg, fg = b.fg;
        if (b.a) { var q = sec.q('send', '#sheetBody [data-a="' + b.a + '"] .tile'); icon = q ? q.innerHTML : ''; var cs = q && sec.frames.send.contentWindow.getComputedStyle(q); bg = cs ? cs.backgroundColor : '#F2F4F6'; fg = cs ? cs.color : '#4E5968'; }
        var e = document.createElement('div'); e.className = 'bin' + (k === 'today' ? ' today' : '');
        e.innerHTML = '<div class="hd"><span class="ic" style="background:' + bg + ';color:' + fg + '">' + icon + '</span>' + b.name + '<span class="n">0</span></div><p class="ds">' + b.ds + '</p><ul></ul>';
        bins.appendChild(e); self.bins[k] = { el: e, n: $('.n', e), ul: $('ul', e), got: [] };
      });
      this.tick = pathEl(sec, 'tick', 'M0 0', 6, '#5B5CF6');
      this.ringArc = $('#ring .arc'); this.ringEl = $('#ring');
      // 3. 배치: 구글 캘린더 하루 시간표(실제 일정 사이 빈 칸에 오늘 할 일이 들어감)
      var tr = this.trk = $('#track');
      tr.innerHTML = '<div class="thd"><span class="gc"></span>구글 캘린더 · 오늘</div><div class="grid"></div>';
      var g = this.grid = $('.grid', tr), pct = function (h) { return ((h - 9) / 9 * 100) + '%'; }, hm = function (h) { return Math.floor(h) + ':' + (h % 1 ? '30' : '00'); };
      for (var h = 9; h <= 18; h++) g.insertAdjacentHTML('beforeend', '<div class="hr" style="top:' + pct(h) + '"><span>' + h + ':00</span></div>');
      EVENTS.forEach(function (e) { g.insertAdjacentHTML('beforeend', '<div class="ev" style="top:' + pct(e[0]) + ';height:' + (e[1] / 9 * 100) + '%">' + e[2] + '<small>' + hm(e[0]) + ' – ' + hm(e[0] + e[1]) + '</small></div>'); });
      this.todayIdx = []; ITEMS.forEach(function (it, i) { if (it.to === 'today') self.todayIdx.push(i); });
      this.blk = this.todayIdx.map(function (i, n) {
        var s = SLOTS[n], e = document.createElement('div'); e.className = 'blk'; e.style.top = pct(s[0]); e.style.height = (s[1] / 9 * 100) + '%';
        e.innerHTML = '<i class="ck"></i>' + ITEMS[i].t + '<small>' + hm(s[0]) + ' – ' + hm(s[0] + s[1]) + '</small>'; g.appendChild(e); return e;
      });
      this.nowl = document.createElement('div'); this.nowl.className = 'nowl'; this.nowl.innerHTML = '<b></b>'; g.appendChild(this.nowl); this.nowb = $('b', this.nowl);
      // 4. 타임어택: 앱의 집중 시계
      this.tclock = new Comp(sec, 'focus', '#fmClock', { ctx: ['<div class="fm on">'], keep: true, css: '.fm{background:#15161E!important;border-radius:32px!important;padding:6px 30px!important;box-shadow:0 30px 80px rgba(20,20,60,.35)}.clock{color:#fff!important}' });
      this.tclock.measure();
      // 5. 인사이트: 앱의 인사이트 카드 3장
      var ins = function (sel) { return new Comp(sec, 'insight', function (d) { var e = d.querySelector(sel); return e && e.closest('.card'); }, { ctx: ['<div id="insBody">'], css: '.qleg{grid-template-columns:1fr!important;gap:6px!important}.qleg b{white-space:nowrap}' }); };
      this.ins = [ins('.ihero'), ins('.qbar'), ins('.wbars')];
      this.ihn = $('.ihn', this.ins[0].root); this.qbar = $('.qbar', this.ins[1].root); this.stk = $$('.stk', this.ins[2].root);
      this.t0 = performance.now();
    },
    // 전체 이야기: 앞부분(비우기·나누기)은 0~0.56, 그 뒤 배치·타임어택·인사이트
    run: function (p, sec) {
      var q = p < .4 ? p / .4 * .748 : p < .47 ? .748 + (p - .4) / .07 * .007 : Math.min(.755 + (p - .47) / .086 * .095, .85);
      this.runA(q, sec);
      var bins = this.bins;
      sec.once('allFiled', p > .402 && p < .47, function () { // 모든 생각이 제 칸에 들어감
        ORDER.forEach(function (k, i) { var e = bins[k].el, r = e.getBoundingClientRect(); e.classList.remove('pop'); void e.offsetWidth; e.classList.add('pop'); setTimeout(function () { burst(r.left + r.width / 2, r.top + 30, 36, 8); }, i * 90); });
      });
      $$('#steps li').forEach(function (li, i, all) { var f = +li.dataset.from, nx = all[i + 1] ? +all[i + 1].dataset.from : 2; li.classList.toggle('on', p >= f && p < nx); });
      this.runB(p, sec);
    },
    runB: function (p, sec) {
      var self = this, B = sec.box(), W = B.width, H = B.height, nw = narrow();
      var ph = sec.phone.getBoundingClientRect(), pc = { x: ph.left - B.left + ph.width / 2, y: ph.top - B.top + ph.height / 2, w: ph.width, h: ph.height };
      var act = p >= .55;
      // 시간표가 오른쪽에서 떠오른다
      var L = nw ? { x: W * .34, y: H * .075, w: W * .62, h: H * .5 } : { x: W * .655, y: H * .1, w: W * .31, h: H * .82 };
      var tin = seg(p, .555, .58), tout = seg(p, .85, .88), tk = io(tin) * (1 - tout), tr = this.trk;
      tr.style.left = L.x + 'px'; tr.style.top = L.y + 'px'; tr.style.width = L.w + 'px'; tr.style.height = L.h + 'px'; tr.style.right = 'auto';
      tr.style.opacity = tk; tr.style.visibility = tk < .001 ? 'hidden' : 'visible';
      tr.style.transform = 'translateY(' + ((1 - io(tin)) * 50 - out(tout) * 30) + 'px) scale(' + lerp(.94, 1, io(tin)) + ')';
      var gr = this.grid.getBoundingClientRect(), G = { x: gr.left - B.left, y: gr.top - B.top, w: gr.width, h: gr.height };
      // 시계: 9시 → 18시
      var mins = 540 + seg(p, .68, .83) * 540;
      this.nowl.style.top = ((mins - 540) / 540 * 100) + '%'; this.nowl.style.opacity = seg(p, .66, .68);
      this.nowb.textContent = Math.floor(mins / 60) + ':' + ('0' + Math.floor(mins % 60)).slice(-2);
      // 배경: 아침 하늘 → 저녁 노을 → 다시 하양
      if (act && p < .88) {
        var k = seg(mins, 540, 1080), a = [222, 236, 255], b = [255, 228, 206], mix = seg(p, .555, .6) * (1 - seg(p, .85, .88));
        $('#bg').style.backgroundColor = 'rgb(' + [0, 1, 2].map(function (j) { return Math.round(lerp(255, lerp(a[j], b[j], k), mix)); }).join(',') + ')';
      }
      // 오늘 할 일이 휴대폰에서 날아가 빈 시간에 들어감 → 시간이 지나면 하나씩 끝
      var cur = -1, curT = 0, curLeft = 0;
      this.todayIdx.forEach(function (i, n) {
        var c = self.rc[i], s = SLOTS[n], blk = self.blk[n], row = self.rows[i];
        var t = seg(p, .585 + n * .025, .62 + n * .025);
        var top = G.y + (s[0] - 9) / 9 * G.h, hh = s[1] / 9 * G.h, cx = G.x + G.w / 2, cy = top + hh / 2;
        if (act) {
          if (t > 0 && t < 1) { c.fly(c.home(), c.at(cx, cy, G.w), t, nw ? 40 : 120); c.host.style.opacity = 1 - seg(t, .8, 1); } else c.hide();
        }
        var st = s[0] * 60, en = st + s[1] * 60, going = p >= .68 && p < .85;
        var done = p >= .68 && mins >= en, on = going && !done && mins >= st;
        blk.style.opacity = seg(t, .75, 1) * (done ? .6 : 1);
        blk.classList.toggle('on', on); blk.classList.toggle('done', done);
        if (on) { cur = n; curT = (mins - st) / (en - st); curLeft = en - mins; }
        var r = $('.row', row), ck = $('.chk', row), tt = $('.t', row);
        if (act) { if (r) r.style.opacity = done ? '.5' : ''; if (tt) tt.style.textDecoration = done ? 'line-through' : ''; if (ck) { ck.style.background = done ? '#5B5CF6' : ''; ck.style.borderColor = done ? '#5B5CF6' : ''; } }
        sec.once('slot' + n, done && p < .84, function () { var q = sec.toPage(cx, cy); burst(q.x, q.y, 40, 9); });
      });
      // 타이머: 지금 하는 일의 남은 시간이 줄어든다
      var tc = seg(p, .675, .695) * (1 - seg(p, .818, .832));
      var TP = nw ? this.tclock.at(W * .17, H * .32, W * .3) : this.tclock.at(pc.x, pc.y, Math.min(W * .2, 320));
      this.tclock.fly(this.tclock.home(), TP, tc, 0, false); this.tclock.host.style.opacity = tc <= .001 ? 0 : tc * (cur >= 0 ? 1 : .3);
      var secs = Math.max(0, Math.round(curLeft * 60));
      if (this.tclock.clone) this.tclock.clone.textContent = cur >= 0 ? Math.floor(secs / 60) + ':' + ('0' + secs % 60).slice(-2) : '0:00';
      if (act) { this.ringEl.style.opacity = nw ? 0 : tc * (cur >= 0 ? 1 : .25); this.ringArc.style.strokeDashoffset = 578 * curT; }
      sec.once('dayEnd', p > .826 && p < .86, function () { var q = sec.toPage(G.x + G.w / 2, G.y + G.h * .5); burst(q.x, q.y, 140, 15); });
      // 인사이트: 휴대폰이 인사이트 화면으로 바뀌고 카드가 하나씩 튀어나온다
      if (p >= .855) sec.show('insight');
      var IC = nw ? [[.5, .6, .8], [.5, .74, .8], [.5, .89, .8]] : [[.82, .2, .3], [.82, .48, .3], [.82, .78, .3]];
      var cardOut = 0, mh = 0; this.ins.forEach(function (c) { mh += c.nat.h; });
      this.ins.forEach(function (c, i) {
        var t = seg(p, .87 + i * .03, .91 + i * .03);
        if (t <= 0 || !c.src) { c.hide(); return; }
        var wd = Math.min(W * IC[i][2], 460), T = c.at(W * IC[i][0], H * IC[i][1], wd);
        if (nw) { var sk = Math.min(W * .62 / c.nat.w, (H * .5 - 16) / mh), y0 = H * .075; for (var j = 0; j < i; j++) y0 += self.ins[j].nat.h * sk + 8; T = { x: W * .34, y: y0, s: sk }; }
        c.fly(c.home(), T, t, 60); cardOut = Math.max(cardOut, t);
      });
      var kc = io(seg(p, .89, .94)), n = Math.round(690 * kc / 10) * 10;
      if (this.ihn && this.ihn.firstChild) this.ihn.firstChild.textContent = Math.floor(n / 60) + '시간 ' + (n % 60 ? n % 60 + '분' : '');
      if (this.qbar) this.qbar.style.clipPath = 'inset(0 ' + (100 - seg(p, .91, .95) * 100) + '% 0 0 round 8px)';
      this.stk.forEach(function (e, j) { e.style.transformOrigin = '50% 100%'; e.style.transform = 'scaleY(' + out(seg(p, .935 + j * .006, .96 + j * .006)) + ')'; });
      if (act) {
        sec.dim(Math.max(tc * .7, cardOut * .55));
        if (nw) { var sh = io(seg(p, .55, .58)); sec.phone.style.transform = 'translate(-50%,-50%) translateX(' + (-W * .33 * sh) + 'px) scale(' + lerp(1, .6, sh) + ')'; if (!(tc > 0 || cardOut > 0)) sec.phone.style.filter = ''; }
      }
    },
    runA: function (p, sec) {
      var self = this, B = sec.box(), W = B.width, H = B.height, nw = narrow(), now = (performance.now() - this.t0) / 1000;
      // 배경: 어두운 머릿속 → 밝은 정리 → 하얀 집중
      $('#bg').style.backgroundColor = bgAt(p);
      var dark = p < .19; sec.stage.classList.toggle('dk', dark); $('#gnav').classList.toggle('light', !dark);
      $$('#steps li').forEach(function (li, i, all) { var f = +li.dataset.from, nx = all[i + 1] ? +all[i + 1].dataset.from : 2; li.classList.toggle('on', p >= f && p < nx); });
      sec.show('home');
      var ph = sec.phone.getBoundingClientRect(), pc = { x: ph.left - B.left + ph.width / 2, y: ph.top - B.top + ph.height / 2, w: ph.width, h: ph.height };

      // ── 0. 머릿속 생각들이 휴대폰 둘레를 무겁게 떠다닌다 ──
      var capT = nw ? this.cap.at(W * .5, pc.y - pc.h * .42, W * .92) : this.cap.at(pc.x, pc.y - pc.h * .36, Math.min(W * .34, 520));
      var capC = { x: capT.x + this.cap.nat.w * capT.s / 2, y: capT.y + this.cap.nat.h * capT.s / 2 };
      var arrived = 0, typing = '';
      this.th.forEach(function (o, i) {
        var a = o.seed, bx, by;
        // 휴대폰(오늘 할 일·이번 주) 위를 계속 가로질러 가린다
        var lane = ((i * .61) % 1) - .5, sp = .22 + .05 * (i % 3);
        if (nw) { bx = W * .5 + Math.sin(now * sp + a * 2) * W * .34; by = pc.y + lane * pc.h * 1.05; }
        else { bx = pc.x + pc.w * .3 + Math.sin(now * sp + a * 2) * pc.w * .78; by = pc.y + lane * pc.h * .95; }
        var wob = { x: Math.sin(now * .6 + a) * 14, y: Math.cos(now * .5 + a * 1.3) * 10 };
        var appear = seg(p, .04 + i * .006, .08 + i * .006);
        var w0 = .19 + i * .017, t = seg(p, w0, w0 + .032); // 입력칸으로 빨려 들어감
        var e = io(t), x = lerp(bx + wob.x, capC.x, e), y = lerp(by + wob.y, capC.y, e) - Math.sin(Math.PI * e) * 60;
        var r = o.el.getBoundingClientRect();
        o.el.style.transform = 'translate(' + (x - r.width / 2 * (1 - e * .6)) + 'px,' + (y - r.height / 2) + 'px) scale(' + lerp(1, .35, e) * lerp(.8, 1, appear) + ') rotate(' + (Math.sin(a) * 4 * (1 - e)) + 'deg)';
        o.el.style.opacity = appear * (1 - seg(t, .75, 1)) * (dark || p > .14 ? 1 : 1);
        o.el.style.filter = 'blur(' + (p < .14 ? (i % 3 === 0 ? 1.5 : 0) : 0) + 'px)';
        if (t > .35 && t < 1) typing = ITEMS[i].t.slice(0, Math.ceil(seg(t, .35, .85) * ITEMS[i].t.length));
        if (t >= 1) arrived = i + 1;
      });
      sec.dim(p < .14 ? .5 * seg(p, .05, .1) : 0);

      // ── 1. 비우기: 입력칸이 휴대폰 위로 튀어나와 생각을 빨아들이고, 한 줄씩 목록에 쌓인다 ──
      var capOut = seg(p, .15, .19) * (1 - seg(p, .36, .4));
      this.cap.fly(this.cap.home(), capT, capOut, 0);
      if (this.capIn) this.capIn.value = capOut > 0 ? typing : '';
      if (this.capIn) this.capIn.parentElement.style.boxShadow = typing ? '0 0 0 5px rgba(91,92,246,.28), 0 20px 60px rgba(91,92,246,.35)' : '';
      // 나누기 단계에서 날아간 것은 목록에서 빠진다
      var gone = {}, landed = {};
      ITEMS.forEach(function (it, i) { var s0 = .5 + i * .026; gone[i] = p >= s0 + .004; landed[i] = p >= s0 + .04; });
      var todayBack = p >= .84;
      var visible = 0;
      this.rows.forEach(function (w, i) {
        var show = i < arrived && !gone[i];
        if (todayBack && ITEMS[i].to === 'today') show = true;
        w.style.display = show ? '' : 'none'; if (show) visible++;
        var r = $('.row', w); if (r) { r.style.transition = 'background .4s'; r.style.background = (i === arrived - 1 && p < .36) ? '#EEEEFF' : ''; }
      });
      this.list.style.display = visible ? '' : 'none';
      var count = p < .42 ? arrived : visible;
      if (p >= .76 && p < .84) count = 0;
      if (this.heroN) this.heroN.textContent = p > .955 ? 2 : count;
      sec.once('emptyHead', p > .355 && p < .4, function () { var c = sec.toPage(capC.x, capC.y); burst(c.x, c.y, 50, 10); });

      // ── 2. 나누기: 첫 할 일이 튀어나오고 → 보낼 곳 버튼이 터져 나와 → 네 칸이 된다. 나머지는 차례로 칸에 쏙 ──
      var binIn = seg(p, .47, .52), binOut = seg(p, .76, .82);
      var slots = nw
        ? { today: [W * .27, H * .43], who: [W * .73, H * .43], later: [W * .27, H * .53], day: [W * .73, H * .53] }
        : { today: [W * .82, H * .2], who: [W * .82, H * .42], later: [W * .82, H * .62], day: [W * .82, H * .82] };
      var bw = nw ? 168 : 250;
      ORDER.forEach(function (k, i) {
        var b = self.bins[k], s = slots[k];
        var away = k === 'today' ? 0 : binOut, tx = s[0] + away * W * .3, ty = s[1];
        var inT = seg(p, .48 + i * .01, .52 + i * .01);
        var sc = lerp(.6, 1, back(inT));
        if (k === 'today') { var m = seg(p, .78, .84); tx = lerp(tx, pc.x, io(m)); ty = lerp(ty, pc.y - pc.h * .38, io(m)); sc *= lerp(1, .5, m); }
        var tr = 'translate(' + (tx - bw / 2) + 'px,' + (ty - b.el.offsetHeight / 2) + 'px)';
        b.el.style.setProperty('--t', tr);
        b.el.style.transform = tr + ' scale(' + sc + ')';
        b.el.style.opacity = inT * (k === 'today' ? 1 - seg(p, .82, .85) : 1 - away);
      });
      // 첫 할 일이 크게 튀어나옴(누르면 → 보낼 곳)
      var r0 = this.rc[0], liftT = nw ? r0.at(W * .5, H * .3, W * .86) : r0.at(pc.x + pc.w * .2, pc.y, Math.min(W * .3, 440));
      var up0 = seg(p, .43, .46);
      ['who', 'later', 'day'].forEach(function (k, i) {
        var tc = self.tiles[k], c0 = { x: liftT.x + r0.nat.w * liftT.s / 2, y: liftT.y + r0.nat.h * liftT.s / 2 };
        var ang = (nw ? Math.PI / 2 : -Math.PI / 2) + (i - 1) * .7, R = nw ? W * .3 : Math.min(W * .14, 220);
        var tw = nw ? W * .16 : 92;
        var A = tc.at(c0.x, c0.y, tw * .2), M = tc.at(c0.x + Math.cos(ang) * R, c0.y + Math.sin(ang) * R * .8, tw);
        var s = slots[k], E = tc.at(s[0] - bw / 2 + (nw ? 22 : 37), s[1] - (nw ? 0 : 24), nw ? 28 : 38);
        var t1 = seg(p, .45, .48), t2 = seg(p, .48, .52);
        if (t2 > 0) tc.fly(M, E, t2, 40, false); else tc.fly(A, M, t1, 0, false);
        tc.host.style.opacity = t1 <= .001 ? 0 : (1 - seg(t2, .7, 1));
        if (tc.src) tc.src.style.visibility = '';
      });
      // '오늘 할 일 N개' 머리글이 휴대폰에서 빠져나와 오늘 칸이 됨
      var hT = seg(p, .47, .52), hs = slots.today;
      this.hero.fly(this.hero.home(), this.hero.at(hs[0], hs[1] - (nw ? 0 : 20), nw ? 120 : 200), hT, 30);
      this.hero.host.style.opacity = hT <= .001 ? 0 : 1 - seg(hT, .7, 1);
      if (this.hero.src) this.hero.src.style.visibility = hT > 0 && hT < 1 ? 'hidden' : '';
      // 할 일이 하나씩 칸으로 날아가 합쳐짐
      this.rc.forEach(function (c, i) {
        var it = ITEMS[i], s0 = .5 + i * .026, t = seg(p, s0, s0 + .04), s = slots[it.to];
        var A = i === 0 ? liftT : c.home();
        if (i === 0 && p < s0) { c.fly(c.home(), liftT, up0, 30); return; }
        if (p < s0 || t >= 1) { c.hide(); if (p >= s0) c.src.style.visibility = ''; return; }
        var Bt = c.at(s[0], s[1], (nw ? 140 : 220) * .7);
        var P = c.fly(A, Bt, t, nw ? 30 : 90, false);
        c.src.style.visibility = 'hidden';
        c.host.style.opacity = 1 - seg(t, .8, 1);
      });
      ORDER.forEach(function (k) {
        var b = self.bins[k], want = ITEMS.filter(function (it, i) { return it.to === k && landed[i]; });
        if (want.length !== b.got.length) {
          var grew = want.length > b.got.length;
          b.got = want; b.ul.innerHTML = want.slice(-3).map(function (it) { return '<li>' + it.t + '</li>'; }).join('');
          b.n.textContent = want.length;
          if (grew) { b.el.classList.remove('pop'); void b.el.offsetWidth; b.el.classList.add('pop'); }
        }
      });

      // ── 3. 집중: 나머지 칸은 물러나고 오늘 칸만 휴대폰으로 합쳐짐 → 시계와 고리 → 하나 끝 ──
      var clk = seg(p, .86, .89) * (1 - seg(p, .955, .975));
      var cT = this.clock.at(pc.x, pc.y, nw ? W * .6 : Math.min(W * .26, 420));
      this.clock.fly(this.clock.home(), cT, clk, 0, false); this.clock.host.style.opacity = clk <= .001 ? 0 : clk;
      var run = seg(p, .88, .95), left = Math.round(25 * 60 * (1 - run));
      if (this.clock.clone) this.clock.clone.textContent = Math.floor(left / 60) + ':' + ('0' + left % 60).slice(-2);
      this.ringEl.style.opacity = seg(p, .85, .88) * (1 - seg(p, .985, 1));
      this.ringArc.style.strokeDashoffset = 578 * (1 - run);
      sec.dim(Math.max(capOut * .5, up0 * (1 - seg(p, .5, .53)) * .6, clk * .7));
      // 체크: 첫 오늘 할 일 위에 그려짐
      var first = this.rows[0], ck = seg(p, .95, .965);
      if (ck > 0 && p < .99 && first.style.display !== 'none') {
        var rr = sec.rectIn('home', $('.chk', first) || first), cx = rr.x + rr.w / 2, cy = rr.y + rr.h / 2, s2 = rr.k * 1.4;
        this.tick.setAttribute('d', 'M' + (cx - 8 * s2) + ' ' + cy + ' L' + (cx - 2 * s2) + ' ' + (cy + 6 * s2) + ' L' + (cx + 9 * s2) + ' ' + (cy - 7 * s2));
        this.tick.setAttribute('stroke-width', Math.max(3, 3.5 * s2)); strokeTo(this.tick, ck); this.tick.style.opacity = 1;
        $('.row', first).style.opacity = 1 - .5 * ck;
      } else { this.tick.style.opacity = 0; if (first) { var fr = $('.row', first); if (fr) fr.style.opacity = ''; } }
      sec.once('done', p > .96, function () { var c = sec.toPage(pc.x, pc.y - pc.h * .1); burst(c.x, c.y, 110, 14); });
    }
  };

  // ── 묶기 ──
  $$('.ch[data-scenes]').forEach(function (el) {
    var sec = new Sec(el), sc = S[el.id], built = false, lastP = 0;
    var render = function (p) {
      lastP = p; cues(el, p);
      if (!built || !sc) return;
      try { sc.run(p, sec); } catch (e) { if (window.console) console.warn(el.id, e); }
    };
    sec.ready.then(function () {
      if (sc) try { sc.build(sec); built = true; } catch (e) { console.warn(el.id, e); }
      render(lastP);
    });
    var vis = false;
    ScrollTrigger.create({ trigger: el, start: 'top top', end: 'bottom bottom', onUpdate: function (self) { render(self.progress); }, onRefresh: function (self) { render(self.progress); }, onToggle: function (self) { vis = self.isActive; } });
    if (el.id === 'story' && !reduce) gsap.ticker.add(function () { if (vis && lastP < .25) render(lastP); }); // 생각 말풍선이 계속 떠다니게
    addEventListener('resize', function () { sec.fit(); if (built && sc) { [].forEach.call(sec.lift.querySelectorAll('.comp'), function () {}); } render(lastP); });
  });
  $$('.ch:not([data-scenes])').forEach(function (el) { ScrollTrigger.create({ trigger: el, start: 'top top', end: 'bottom bottom', onUpdate: function (self) { cues(el, self.progress); } }); });
  ScrollTrigger.create({ trigger: '#end', start: 'top 40%', once: false, onEnter: function () { var r = innerWidth; burst(r * .3, innerHeight * .4, 90, 13); setTimeout(function () { burst(r * .7, innerHeight * .4, 90, 13); }, 220); } });
  cues($('#story'), 0);
})();
