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

  // ══════════ 장면별 연출 ══════════
  var S = {};

  // C0: 휴대폰에서 네 가지가 튀어나와 둘레에 자리를 잡는다
  S.c0 = {
    build: function (sec) {
      this.items = [
        { c: new Comp(sec, 'home', '.capwrap'), tag: '담기', d: '떠오르면 한 줄' },
        { c: new Comp(sec, 'home', function (d) { return rowOf(d, NEXT); }, { ctx: ['<div class="card">'] }), tag: '보내기', d: '누르면 어디로' },
        { c: new Comp(sec, 'send', '#sheetBody [data-a="star"]', { ctx: ['<div class="sheet on">', '<div id="sheetBody">', '<div class="actgrid">'] }), tag: '★ 중요', d: '맨 위로' },
        { c: new Comp(sec, 'focus', '#fmClock', { ctx: ['<div class="fm on">'], keep: true, css: '.fm{padding:10px 26px!important;border-radius:28px!important;background:#11121a!important}' }), tag: '집중', d: '25분 하나만' }
      ];
      this.items.forEach(function (it) {
        var t = document.createElement('div'); t.className = 'tag'; t.innerHTML = '<i>' + it.tag + '</i>' + it.d; sec.lift.appendChild(t); it.t = t;
      });
    },
    run: function (p, sec) {
      sec.show('home');
      var B = sec.box(), W = B.width, H = B.height, nw = narrow();
      var spots = nw
        ? [[.3, .5, .5], [.7, .56, .5], [.3, .78, .3], [.7, .86, .34]]
        : [[.17, .3, .27], [.83, .3, .27], [.2, .74, .12], [.8, .74, .2]];
      var anyOut = 0;
      this.items.forEach(function (it, i) {
        var out1 = seg(p, .18 + i * .05, .42 + i * .05), back1 = seg(p, .86, .98), t = out1 * (1 - back1);
        anyOut = Math.max(anyOut, t);
        var sp = spots[i], A = it.c.home(it.c.n === 'home' ? null : null);
        // 꺼내는 원래 자리는 지금 보이는 홈 화면 기준(별·시계는 휴대폰 가운데에서 튀어나옴)
        if (it.c.n !== 'home') { var ph = sec.phone.getBoundingClientRect(), bx = sec.box(); A = { x: ph.left - bx.left + ph.width / 2 - it.c.nat.w * .2, y: ph.top - bx.top + ph.height * .55, s: .4 }; }
        var Bt = it.c.at(sp[0] * W, sp[1] * H, sp[2] * W);
        var P = it.c.fly(A, Bt, t, 60, it.c.n === 'home');
        if (it.c.n !== 'home') it.c.host.style.opacity = t <= 0.001 ? 0 : Math.min(1, t * 3);
        var pw = it.c.nat.w * P.s, ph2 = it.c.nat.h * P.s, right = sp[0] > .5;
        it.t.style.opacity = seg(t, .7, 1);
        it.t.style.transform = 'translate(' + (right ? P.x : P.x) + 'px,' + (P.y + ph2 + 14) + 'px)';
      });
      sec.dim(anyOut);
    }
  };

  // C1 담기: 입력칸이 휴대폰 밖으로 → 크게 타이핑 → 한 줄이 목록으로 날아 들어감
  S.c1 = {
    build: function (sec) {
      this.cap = new Comp(sec, 'home', '.capwrap');
      this.row = new Comp(sec, 'capture-added', function (d) { return rowOf(d, '은행 서류 떼기'); }, { ctx: ['<div class="card">'], keep: true });
      this.input = $('input', this.cap.root);
      this.text = '은행 서류 떼기';
    },
    run: function (p, sec) {
      var B = sec.box(), W = B.width, H = B.height, nw = narrow();
      var target = nw ? this.cap.at(W * .5, H * .3, W * .9) : this.cap.at(W * .27, H * .44, W * .4);
      var up = seg(p, .06, .2), down = seg(p, .62, .78);
      var added = p >= .55;
      sec.show(added ? 'capture-added' : 'home');
      // 입력칸: 올라왔다가(scale) 내려감
      var A = this.cap.home(added ? 'capture-added' : 'home');
      if (added) { this.cap.src.style.visibility = ''; this.cap.src = sec.q('capture-added', '.capwrap'); }
      else { this.cap.src = sec.q('home', '.capwrap'); sec.q('capture-added', '.capwrap').style.visibility = ''; }
      this.cap.fly(A, target, up * (1 - down), 0);
      if (up * (1 - down) > .001) this.cap.host.style.opacity = 1 - seg(p, .5, .56); // 엔터: 입력칸은 사라지고 한 줄로 바뀜
      // 타이핑(스크롤만큼 글자가 찍힘)
      var n = Math.round(seg(p, .22, .44) * this.text.length);
      this.input.value = p < .55 ? this.text.slice(0, n) : '';
      this.input.parentElement.style.boxShadow = (p > .2 && p < .55) ? '0 0 0 4px rgba(91,92,246,.25)' : '';
      // 엔터: 글자가 한 줄(실제 할 일 줄)로 바뀌어 목록 제자리로 날아감
      var fly = seg(p, .5, .72);
      var srcRow = rowOf(sec.doc('capture-added'), this.text);
      if (srcRow) {
        this.row.src = srcRow;
        var H0 = this.row.at(target.x + this.cap.nat.w * target.s / 2, target.y + this.cap.nat.h * target.s / 2 + 10, this.cap.nat.w * target.s * .96);
        var home = this.row.home('capture-added');
        if (p < .5) { this.row.hide(); srcRow.style.visibility = 'hidden'; }
        else this.row.fly(H0, home, fly, nw ? 40 : 120);
        if (fly >= 1) { this.row.host.style.opacity = 0; srcRow.style.visibility = ''; srcRow.querySelector('.row').style.boxShadow = 'inset 0 0 0 2px rgba(91,92,246,' + (1 - seg(p, .74, .9)) + ')'; }
      }
      // 숫자가 올라감(오늘 할 일 7 → 8)
      var hn = sec.q('capture-added', '#heroN'); if (hn) hn.textContent = p < .72 ? 7 : Math.round(lerp(7, 8, seg(p, .72, .8)));
      var self = this;
      sec.once('c1burst', p > .72, function () { var r = self.row.src.getBoundingClientRect(), f = sec.frames['capture-added'].getBoundingClientRect(), k = f.width / 390; burst(f.left + (r.left + r.width / 2) * k, f.top + (r.top + r.height / 2) * k, 50); });
      sec.dim(Math.max(up * (1 - down), fly > 0 && fly < 1 ? .5 : 0));
    }
  };

  // C2 보내기: 할 일이 튀어나오고, 보낼 곳 다섯 개가 그 둘레로 펼쳐짐 → 날짜 → 맡기기
  S.c2 = {
    build: function (sec) {
      this.row = new Comp(sec, 'home', function (d) { return rowOf(d, NEXT); }, { ctx: ['<div class="card">'], keep: true });
      var A = ['s-plan', 's-day', 's-who', 's-pj', 's-later'];
      this.tiles = A.map(function (a) { return new Comp(sec, 'send', '#sheetBody [data-a="' + a + '"]', { ctx: ['<div class="sheet on">', '<div id="sheetBody">', '<div class="actgrid">'] }); });
      this.days = new Comp(sec, 'send-day', '#sheetBody .chips', { ctx: ['<div class="sheet on">', '<div id="sheetBody">'], keep: true, css: '.sheet{border-radius:24px!important;padding:16px 16px 8px!important}' });
      this.who = new Comp(sec, 'send-who', '#sheetBody', { ctx: ['<div class="sheet on">'], keep: true, css: '.sheet{border-radius:28px!important;padding:20px!important}' });
      this.whoIn = $('#sWhoIn', this.who.root);
    },
    run: function (p, sec) {
      var B = sec.box(), W = B.width, H = B.height, nw = narrow();
      sec.show(p < .2 ? 'home' : p < .44 ? 'send' : p < .66 ? 'send-day' : 'send-who');
      // 1) 할 일 한 줄이 튀어나옴
      var rowUp = seg(p, .04, .16), rowDown = seg(p, .88, .98);
      var rc = nw ? [W * .5, H * .2, W * .86] : [W * .3, H * .5, W * .36];
      var rowT = this.row.at(rc[0], rc[1], rc[2]);
      var rowP = this.row.fly(this.row.home('home'), rowT, rowUp * (1 - rowDown), 40);
      // 2) 보낼 곳 다섯 개: 할 일 가운데서 곡선을 그리며 둘레로
      var R = nw ? W * .36 : Math.min(W * .19, H * .4), cxr = rc[0], cyr = rc[1];
      var focus = p < .44 ? -1 : p < .66 ? 1 : 2; // 날짜 / 맡기기
      var self = this;
      this.tiles.forEach(function (tc, i) {
        var ang = -Math.PI / 2 + (i - 2) * (nw ? .5 : .42) + (nw ? Math.PI : 0); // 할 일 위쪽 반원
        var out1 = seg(p, .18 + i * .025, .34 + i * .025), back1 = seg(p, .84, .94), t = out1 * (1 - back1);
        var big = focus === i ? 1.35 : 1;
        var tw = (nw ? W * .17 : Math.min(W * .075, 120)) * big;
        var T = nw ? tc.at(W * (.14 + i * .18), H * .33, tw) : tc.at(cxr + Math.cos(ang) * R, cyr + Math.sin(ang) * R * .62 - 46, tw);
        var A = tc.at(cxr, cyr, tw * .2);
        tc.fly(A, T, t, 0, false);
        tc.host.style.opacity = t <= .001 ? 0 : Math.min(1, t * 3) * (focus >= 0 && focus !== i ? .35 : 1);
        if (tc.src) tc.src.style.visibility = '';
      });
      // 3) 날짜 버튼 줄
      var dIn = seg(p, .45, .54), dOut = seg(p, .62, .67);
      var dc = nw ? [W * .5, H * .4, W * .9] : [rc[0], rc[1] + H * .2, W * .36];
      var DT = this.days.at(dc[0], dc[1], dc[2]), DA = this.days.at(dc[0], dc[1] + 60, dc[2] * .7);
      this.days.fly(DA, DT, dIn * (1 - dOut), 0, false); if (dIn * (1 - dOut) <= 0.001) this.days.host.style.opacity = 0;
      var tmr = $$('[data-sday]', this.days.root)[1];
      if (tmr) { var on = p > .57; tmr.style.background = on ? '#5B5CF6' : ''; tmr.style.color = on ? '#fff' : ''; tmr.style.transform = on ? 'scale(' + (1 + .12 * (1 - seg(p, .57, .6))) + ')' : ''; }
      // 4) 맡기기: 이름을 적는 시트
      var wIn = seg(p, .67, .75), wOut = seg(p, .86, .92);
      var wc = nw ? [W * .5, H * .33, W * .9] : [rc[0], rc[1] + H * .02, W * .36];
      this.who.fly(this.who.at(wc[0], wc[1] + 80, wc[2] * .7), this.who.at(wc[0], wc[1], wc[2]), wIn * (1 - wOut), 0, false);
      if (wIn * (1 - wOut) <= 0.001) this.who.host.style.opacity = 0;
      if (this.whoIn) this.whoIn.value = '박주임'.slice(0, Math.round(seg(p, .76, .83) * 3));
      if (wIn > 0) { this.row.host.style.opacity = 1 - wIn * (1 - wOut) * .9; }
      sec.dim(Math.max(rowUp * (1 - rowDown)));
    }
  };

  // C3 하루: ★가 날아와 박히고 맨 위로 → 밀어서 완료(체크 그리기 · 진행 고리 · 숫자)
  S.c3 = {
    build: function (sec) {
      this.row = new Comp(sec, 'home', function (d) { return rowOf(d, NEXT2); }, { ctx: ['<div class="card">'], keep: true });
      this.rowStar = new Comp(sec, 'star-done', function (d) { return rowOf(d, NEXT2); }, { ctx: ['<div class="card">'], keep: true });
      this.star = new Comp(sec, 'star-sheet', '#sheetBody [data-a="star"]', { ctx: ['<div class="sheet on">', '<div id="sheetBody">', '<div class="actgrid">'] });
      this.sw = new Comp(sec, 'home', function (d) { return rowOf(d, NEXT); }, { ctx: ['<div class="card">'], keep: true });
      this.ring = new Comp(sec, 'swipe-done', '#ring', { ctx: ['<div class="hero">'] });
      this.swRow = $('.row', this.sw.root); this.swWrap = $('.swr', this.sw.root);
      this.ringFg = $('#ringFg', this.ring.root);
      this.ringEnd = parseFloat((sec.q('swipe-done', '#ringFg') || {}).style ? sec.q('swipe-done', '#ringFg').style.strokeDashoffset : 172) || 172;
      this.ringTxt = $('#ring span, #ring b, #ring .pct', this.ring.root);
      this.tick = pathEl(sec, 'tick', 'M0 0', 6);
    },
    run: function (p, sec) {
      var B = sec.box(), W = B.width, H = B.height, nw = narrow();
      // ── ★ ──
      var up = seg(p, .04, .14), stamp = seg(p, .16, .28), goTop = seg(p, .3, .44);
      sec.show(p < .3 ? 'home' : p < .5 ? 'star-done' : p < .74 ? 'home' : 'swipe-done');
      var rc = nw ? [W * .5, H * .3, W * .86] : [W * .3, H * .48, W * .38];
      var T = this.row.at(rc[0], rc[1], rc[2]);
      if (p < .3) { this.rowStar.hide(); this.row.fly(this.row.home('home'), T, up, 30); }
      else { this.row.hide(); var homeTop = this.rowStar.home('star-done'); this.rowStar.fly(homeTop, this.rowStar.at(rc[0], rc[1], rc[2]), 1 - goTop, 90); if (p >= .5) this.rowStar.hide(); }
      // 별 타일이 오른쪽 위에서 곡선을 그리며 날아와 할 일에 박힘(크게 → 작게)
      var sT = this.star.at(rc[0] + rc[2] * .42, rc[1], (nw ? W * .12 : 70));
      var sA = this.star.at(nw ? W * .85 : W * .44, nw ? H * .1 : H * .14, nw ? W * .22 : 150);
      var st = p < .3 ? stamp : 0;
      this.star.fly(sA, sT, st, 120, false); this.star.host.style.opacity = st <= .001 || st >= 1 ? 0 : 1;
      var self = this;
      sec.once('c3star', p > .28 && p < .3, function () { var c = self.row.center(); burst(c.x + c.w * .4, c.y, 30, 8, ['#FFB020', '#FFD66B', '#5B5CF6']); });
      // ── 밀면 끝 ──
      var sUp = seg(p, .5, .58), slide = seg(p, .6, .72), sDown = seg(p, .9, .98);
      var sc = nw ? [W * .5, H * .26, W * .86] : [W * .3, H * .4, W * .38];
      var swT = this.sw.at(sc[0], sc[1], sc[2]);
      if (p >= .5 && p < .74) this.sw.fly(this.sw.home('home'), swT, sUp, 30);
      else if (p >= .74) { this.sw.set(swT, 1 - seg(p, .74, .8)); this.sw.src && (this.sw.src.style.visibility = ''); }
      else this.sw.hide();
      if (this.swRow) { this.swRow.style.transform = 'translateX(' + (io(slide) * 260) + 'px)'; this.swWrap.classList.toggle('goR', slide > 0); }
      // 체크: 동그라미 자리에서 그려짐(line drawing)
      var tk = seg(p, .72, .8);
      if (tk > 0 && p < .86) {
        var c = this.sw.center(), s = c.w / 350, bx = sec.box();
        var x0 = c.x - bx.left - c.w / 2 + 44 * s, y0 = c.y - bx.top;
        this.tick.setAttribute('d', 'M' + (x0 - 14 * s) + ' ' + y0 + ' L' + (x0 - 4 * s) + ' ' + (y0 + 10 * s) + ' L' + (x0 + 16 * s) + ' ' + (y0 - 12 * s));
        this.tick.setAttribute('stroke-width', 7 * s); strokeTo(this.tick, tk); this.tick.style.opacity = 1 - seg(p, .8, .86);
      } else this.tick.style.opacity = 0;
      sec.once('c3done', p > .74, function () { var c = self.sw.center(); burst(c.x, c.y, 70, 12); });
      // 진행 고리가 그려지고 숫자가 오름
      var rIn = seg(p, .76, .84), rOut = seg(p, .92, .99);
      var rc2 = nw ? [W * .5, H * .5, W * .36] : [W * .3, H * .66, Math.min(W * .14, 200)];
      this.ring.fly(this.ring.home('swipe-done'), this.ring.at(rc2[0], rc2[1], rc2[2]), rIn * (1 - rOut), 50);
      var draw = seg(p, .8, .9);
      if (this.ringFg) this.ringFg.style.strokeDashoffset = lerp(201, this.ringEnd, out(draw));
      var pct = $('#ring', this.ring.root); var span = pct && pct.querySelector('span'); if (span) span.textContent = Math.round(14 * out(draw)) + '%';
      var hn = sec.q('swipe-done', '#heroN'); if (hn) hn.textContent = Math.round(lerp(7, 6, seg(p, .78, .86)));
      sec.dim(Math.max(up * (1 - goTop), sUp * (1 - seg(p, .86, .95))));
    }
  };

  // C4 시간표: 할 일 칩이 휴대폰에서 빠져나와 하루 시간표 빈 칸으로 날아가 박힘. 시계가 흐름
  S.c4 = {
    build: function (sec) {
      var self = this;
      this.track = $('.track', sec.el);
      this.chips = $$('.dchip', sec.doc('timeline')).slice(0, 6).map(function (el) { return new Comp(sec, 'timeline', function () { return el; }, { ctx: ['<div class="tray">', '<div class="dchips">'] }); });
      this.slots = [9, 9.5, 11, 11.5, 13, 15];
      this.track.innerHTML = '';
      for (var h = 9; h <= 18; h++) { var d = document.createElement('div'); d.className = 'hr'; d.dataset.h = h; d.innerHTML = '<span>' + h + ':00</span>'; this.track.appendChild(d); }
      [[10, 1, '팀 회의', '구글 캘린더'], [14, 1, '고객사 미팅', '구글 캘린더']].forEach(function (e) { var d = document.createElement('div'); d.className = 'ev'; d.dataset.h = e[0]; d.dataset.d = e[1]; d.innerHTML = e[2] + '<small>' + e[0] + ':00 · ' + e[3] + '</small>'; self.track.appendChild(d); });
    },
    run: function (p, sec) {
      var B = sec.box(), W = B.width, H = B.height, nw = narrow();
      sec.show('timeline');
      var top = nw ? H * .1 : H * .12, hgt = nw ? H * .42 : H * .76, ph = hgt / 9;
      this.track.style.top = top + 'px';
      $$('.hr', this.track).forEach(function (d) { d.style.top = (d.dataset.h - 9) * ph + 'px'; });
      $$('.ev', this.track).forEach(function (d) { d.style.top = (d.dataset.h - 9) * ph + 'px'; d.style.height = d.dataset.d * ph - 4 + 'px'; });
      var tr = this.track.getBoundingClientRect(), bx = sec.box(), tl = tr.left - bx.left, tw = tr.width;
      var self = this, placed = 0;
      this.chips.forEach(function (c, i) {
        var t = seg(p, .14 + i * .1, .3 + i * .1);
        var y = top + (self.slots[i] - 9) * ph + ph * .25;
        var T = c.atH(tl + tw * .5, y, ph * .46);
        if (c.nat.w * T.s > tw * .96) T = c.at(tl + tw * .5, y, tw * .96);
        c.fly(c.home(), T, t, nw ? 30 : 160);
        if (t >= 1) placed++;
      });
      var mins = Math.round(lerp(9 * 60, 18 * 60, seg(p, .05, .95)) / 10) * 10;
      $('#clock').textContent = ('0' + Math.floor(mins / 60)).slice(-2) + ':' + ('0' + mins % 60).slice(-2);
      $('#calN').textContent = Math.round(lerp(0, 6, seg(p, .86, .94)));
      // 하늘색: 아침 → 저녁
      var k = seg(p, .3, 1); sec.stage.style.setProperty('--sky1', 'hsl(' + lerp(214, 28, k) + ',' + lerp(100, 90, k) + '%,' + lerp(93, 88, k) + '%)');
      sec.stage.style.setProperty('--sky2', 'hsl(' + lerp(210, 40, k) + ',100%,' + lerp(98, 96, k) + '%)');
      sec.once('c4done', placed === 6, function () { var r = self.track.getBoundingClientRect(); burst(r.left + r.width / 2, r.top + r.height * .4, 60, 11); });
      sec.dim(seg(p, .1, .2) * .6);
      if (nw) sec.phone.style.opacity = 1 - .9 * seg(p, .1, .2); else sec.phone.style.opacity = '';
    }
  };

  // C5 집중: 시계가 크게 나오고 둘레에 고리가 그려지며 25분이 흐른 뒤 체크
  S.c5 = {
    build: function (sec) {
      this.clock = new Comp(sec, 'focus', '#fmClock', { ctx: ['<div class="fm on">'], css: '.fm{background:transparent!important}' });
      this.arc = $('.bigring .arc', sec.el); this.check = $('.bigcheck path', sec.el);
      this.txt = this.clock.clone;
    },
    run: function (p, sec) {
      var B = sec.box(), W = B.width, H = B.height, nw = narrow();
      sec.show('focus');
      var up = seg(p, .04, .2);
      var T = this.clock.at(W * .5, H * .62, nw ? W * .66 : Math.min(W * .36, 560));
      this.clock.fly(this.clock.home(), T, up, 0);
      var run = seg(p, .2, .8), left = Math.round(25 * 60 * (1 - run));
      if (this.txt) this.txt.textContent = Math.floor(left / 60) + ':' + ('0' + left % 60).slice(-2);
      this.arc.style.strokeDashoffset = 578 * (1 - run);
      var ck = seg(p, .82, .9);
      this.check.style.strokeDashoffset = 100 * (1 - out(ck));
      this.clock.host.style.opacity = up <= .001 ? 0 : 1 - seg(p, .8, .84);
      sec.phone.style.opacity = 1 - up * .85;
      sec.phone.style.transform = 'translate(-50%,-50%) scale(' + (1 - up * .25) + ')';
      sec.once('c5done', p > .86, function () { var r = sec.box(); burst(r.left + r.width / 2, r.top + r.height * .55, 100, 14); });
    }
  };

  // C6 돌아보기: 마무리 시트 → 맡긴 일 → 주간 검토 카드가 차례로 크게
  S.c6 = {
    build: function (sec) {
      this.a = new Comp(sec, 'shutdown', '#sheetBody', { ctx: ['<div class="sheet on">'], keep: true, css: '.sheet{border-radius:30px!important;padding:22px!important}' });
      this.b = new Comp(sec, 'waiting', function (d) { return $('[data-wid]', d).closest('.card'); }, { ctx: ['<div id="moreBody">'] });
      this.c = new Comp(sec, 'weekly', '#moreBody .card', { ctx: ['<div id="moreBody">'] });
      this.wq = $('.card', this.c.root);
    },
    run: function (p, sec) {
      var B = sec.box(), W = B.width, H = B.height, nw = narrow();
      var ph = p < .35 ? 'shutdown' : p < .67 ? 'waiting' : 'weekly';
      sec.show(ph);
      var self = this, any = 0;
      [[this.a, 'shutdown', .06, .3, .34], [this.b, 'waiting', .38, .6, .66], [this.c, 'weekly', .7, .92, 1.1]].forEach(function (x) {
        var c = x[0], t = seg(p, x[2], x[2] + .08) * (1 - seg(p, x[3], x[4]));
        var T = nw ? c.at(W * .5, H * .32, W * .9) : (c === self.a ? c.atH(W * .3, H * .5, H * .8) : c.at(W * .3, H * .5, W * .4));
        if (nw && c === self.a) T = c.atH(W * .5, H * .36, H * .5);
        if (sec.cur === x[1] || t > 0) c.fly(c.home(x[1]), T, t, 40); else c.hide();
        any = Math.max(any, t);
      });
      // 며칠째: 맡긴 일 줄을 하나씩 강조
      $$('[data-wid]', this.b.root).forEach(function (r, i) { r.style.boxShadow = seg(p, .46 + i * .05, .5 + i * .05) > 0 && p < .62 ? 'inset 0 0 0 2px rgba(91,92,246,.6)' : ''; });
      sec.dim(any);
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
    ScrollTrigger.create({ trigger: el, start: 'top top', end: 'bottom bottom', onUpdate: function (self) { render(self.progress); }, onRefresh: function (self) { render(self.progress); } });
    addEventListener('resize', function () { sec.fit(); if (built && sc) { [].forEach.call(sec.lift.querySelectorAll('.comp'), function () {}); } render(lastP); });
  });
  $$('.ch:not([data-scenes])').forEach(function (el) { ScrollTrigger.create({ trigger: el, start: 'top top', end: 'bottom bottom', onUpdate: function (self) { cues(el, self.progress); } }); });
  ScrollTrigger.create({ trigger: '#c7', start: 'top 40%', once: false, onEnter: function () { var r = innerWidth; burst(r * .3, innerHeight * .4, 90, 13); setTimeout(function () { burst(r * .7, innerHeight * .4, 90, 13); }, 220); } });
  cues($('#c0'), 0);
})();
