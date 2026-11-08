/* GTD 워크 홈페이지 v3
 * - 캔버스 이미지 시퀀스 스크럽(장면 ①~④는 tools/render-scenes에서 Three.js로 직접 렌더링)
 * - Lenis 관성 스크롤 + GSAP ScrollTrigger
 * - 신청 폼: apps-script/signup 웹 앱으로 보낸다(요청 형식은 v1과 같음)
 */
(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var clamp = function (x, a, b) { return Math.min(b === undefined ? 1 : b, Math.max(a || 0, x)); };
  var seg = function (t, a, b) { return clamp((t - a) / (b - a)); };
  var lerp = function (a, b, k) { return a + (b - a) * k; };
  var ease = function (k) { return k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2; };
  var backOut = function (k) { var c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2); };

  var SIGNUP_URL = 'https://script.google.com/macros/s/AKfycbwWL9zc73fGZVbQ2Iv8RpCzL17y4kDozMzpOInNu9GoH4g1HRujOfBLUw2CrCVz89aMoA/exec';
  var FRAMES = { hero: { d: 140, m: 140 }, card: { d: 120, m: 60 }, explode: { d: 150, m: 75 }, zoom: { d: 110, m: 110 } }; // seq/manifest.json과 같다

  if (!window.gsap || !window.ScrollTrigger) { document.documentElement.classList.remove('js'); return; }
  gsap.registerPlugin(ScrollTrigger);

  // ── 글자 단위 쪼개기 ──
  $$('[data-split]').forEach(function (el) {
    // '|'는 줄바꿈 자리(넓은 화면에서만 확실히 꺾고, 좁으면 자연스럽게 흐름)
    var raw = el.textContent.trim(), txt = raw.replace(/\s*\|\s*/g, ' '); el.setAttribute('aria-label', txt); el.textContent = '';
    // 단어 단위로 묶어 줄바꿈이 글자 사이(마침표 앞 등)에서 일어나지 않게
    var i = 0;
    raw.replace(/\s*\|\s*/g, ' | ').split(' ').filter(Boolean).forEach(function (word, wi) {
      if (word === '|') { el.appendChild(document.createElement('br')); return; }
      if (wi && el.lastChild && el.lastChild.nodeName !== 'BR') el.appendChild(document.createTextNode(' '));
      var w = document.createElement('span'); w.className = 'w'; w.setAttribute('aria-hidden', 'true');
      Array.from(word).forEach(function (ch) { var s = document.createElement('span'); s.className = 'c'; s.textContent = ch; s.style.setProperty('--i', i++); w.appendChild(s); });
      el.appendChild(w);
    });
  });

  // ── 관성 스크롤 ──
  var lenis = null;
  if (window.Lenis) {
    lenis = new Lenis({ lerp: 0.1, wheelMultiplier: 1, touchMultiplier: 1.4 });
    lenis.on('scroll', ScrollTrigger.update);
    gsap.ticker.add(function (t) { lenis.raf(t * 1000); });
    gsap.ticker.lagSmoothing(0);
  }
  $$('[data-go]').forEach(function (a) {
    a.addEventListener('click', function (e) {
      var id = a.getAttribute('href'); var el = id === '#top' ? document.body : $(id);
      if (!el) return; e.preventDefault();
      if (lenis) lenis.scrollTo(id === '#top' ? 0 : el, { duration: 1.6 }); else el.scrollIntoView({ behavior: 'smooth' });
      try { history.replaceState(null, '', id === '#top' ? location.pathname + location.search : id); } catch (err) {}
    });
  });

  // ── 배경색 보간 · 내비 ──
  var nav = $('#lnav');
  $$('.ch[data-bg]').forEach(function (sec) {
    ScrollTrigger.create({
      trigger: sec, start: 'top 55%', end: 'bottom 55%',
      onToggle: function (self) {
        if (!self.isActive) return;
        gsap.to('#bg', { backgroundColor: sec.dataset.bg, duration: 0.6, ease: 'power2.out', overwrite: true });
        nav.classList.toggle('light', sec.dataset.theme === 'light');
      }
    });
  });
  ScrollTrigger.create({ start: function () { return innerHeight * 0.6; }, end: 'max', onToggle: function (self) { nav.classList.toggle('solid', self.isActive); } });

  // ── 진행률로 켜고 끄는 글(data-at / data-until) ──
  function cues(sec, p) {
    $$('[data-at]', sec).forEach(function (el) {
      var at = parseFloat(el.dataset.at), until = el.dataset.until ? parseFloat(el.dataset.until) : 2;
      el.classList.toggle('on', p >= at && p < until);
    });
  }
  $$('[data-reveal]').forEach(function (el) {
    ScrollTrigger.create({ trigger: el, start: 'top 72%', onEnter: function () { el.classList.add('on'); }, onLeaveBack: function () { el.classList.remove('on'); } });
  });

  // ══════════ 이미지 시퀀스 스크럽 엔진 ══════════
  function pickSet() { return innerWidth / innerHeight < 1 ? 'm' : 'd'; }
  var pageLoaded = document.readyState === 'complete';
  // 첫 장면의 나머지 프레임: 첫 스크롤 때 또는 페이지가 뜨고 3.5초 뒤에 이어 받는다(첫 화면 용량 2MB 이하)
  function release() { if (pageLoaded) return; pageLoaded = true; seqs.forEach(function (q) { q.pump(); }); }
  addEventListener('load', function () { setTimeout(release, 3500); });
  ['wheel', 'touchstart', 'keydown'].forEach(function (ev) { addEventListener(ev, release, { once: true, passive: true }); });
  // 시퀀스 장면들은 화면에 고정된 캔버스 하나(#seqfx)에 그린다. 구역마다 캔버스를 두면 경계에서 폰이 잘리고
  // 다음 구역에서 새 폰이 올라오므로, 붙어 있는 장면 사이(①→②→③)는 같은 화면에서 이어 그리고 겹쳐 바꾼다.
  var fx = document.createElement('canvas'); fx.id = 'seqfx'; fx.setAttribute('aria-hidden', 'true');
  $('#bg').after(fx);
  var fctx = fx.getContext('2d'), fxDpr = 1;
  function fxSize() {
    fxDpr = Math.min(devicePixelRatio || 1, 2);
    var w = innerWidth, h = innerHeight;
    if (fx.width !== Math.round(w * fxDpr) || fx.height !== Math.round(h * fxDpr)) { fx.width = Math.round(w * fxDpr); fx.height = Math.round(h * fxDpr); paintKey = ''; }
    return { w: w, h: h };
  }
  function Seq(name) { this.name = name; this.started = false; this.reset(pickSet()); }
  Seq.prototype.reset = function (set) {
    if (this.imgs && this.ok && this.ok.some(Boolean)) this.prev = { imgs: this.imgs, ok: this.ok, n: this.n, set: this.set };
    this.set = set; this.n = FRAMES[this.name][set]; this.imgs = new Array(this.n); this.ok = new Array(this.n); this.queue = []; this.busy = 0;
    if (this.started) { this.started = false; this.start(); }
  };
  Seq.prototype.url = function (i) { return 'seq/' + this.name + '/' + this.set + '/' + String(i + 1).padStart(4, '0') + '.webp'; };
  // 포스터 → 4장 간격 → 2장 간격 → 전부
  Seq.prototype.start = function () {
    if (this.started) return; this.started = true;
    var order = [0], seen = { 0: 1 }, n = this.n;
    if (!seen[n - 1]) { seen[n - 1] = 1; order.push(n - 1); }
    [8, 4, 2, 1].forEach(function (step) { for (var i = 0; i < n; i += step) if (!seen[i]) { seen[i] = 1; order.push(i); } });
    // 첫 장면은 8장 간격까지만 먼저 받고(첫 화면 용량), 나머지는 페이지가 다 뜬 뒤 이어 받는다
    this.hold = this.first ? Math.ceil(n / 8) + 2 : 0;
    this.queue = order; this.pump();
  };
  Seq.prototype.pump = function () {
    var self = this, set = this.set;
    while (this.busy < 6 && this.queue.length && !(this.hold && !pageLoaded && (this.loaded || 0) + this.busy >= this.hold)) {
      (function (i) {
        self.busy++;
        var img = new Image(); img.decoding = 'async'; img.src = self.url(i);
        var done = function (good) {
          if (set !== self.set) return;
          self.busy--; self.loaded = (self.loaded || 0) + 1; if (good) { self.imgs[i] = img; self.ok[i] = true; paint(true); }
          self.pump();
        };
        (img.decode ? img.decode() : new Promise(function (r) { img.onload = r; })).then(function () { done(true); }, function () { done(false); });
      })(this.queue.shift());
    }
  };
  // 장면 안에서 스크롤과 프레임의 대응을 고르게: 급한 구간에 스크롤을 더 배분한다
  // zoom: 카드 클로즈업(흰 화면 뒤 어둡게 비치면 잔상처럼 보임)은 건너뛰고 카드가 폰에 내려앉은 뒤부터
  var WARP = { card: [[0, 0], [0.26, 0.3], [0.66, 0.56], [1, 1]], zoom: [[0, 0.4], [1, 1]] };
  function warp(name, p) {
    var w = WARP[name]; if (!w) return p;
    for (var i = 1; i < w.length; i++) if (p <= w[i][0]) return lerp(w[i - 1][1], w[i][1], seg(p, w[i - 1][0], w[i][0]));
    return p;
  }
  Seq.prototype.nearest = function (p) {
    p = warp(this.name, p);
    var i = Math.round(clamp(p) * (this.n - 1));
    for (var d = 0; d < this.n; d++) { if (this.ok[i - d]) return i - d; if (this.ok[i + d]) return i + d; }
    return -1;
  };
  // 프레임 좌표(0~1) → 화면 좌표(px). 그리기와 같은 cover 계산
  // p를 주면 장면별 가로 이동(offx)까지 넣어 계산한다: 옮긴 만큼 살짝 키워 화면 끝에 빈 띠가 생기지 않게
  Seq.prototype.cover = function (p) {
    var s = fxSize(), iw = this.set === 'd' ? 1920 : 1080, ih = this.set === 'd' ? 1080 : 1920, off = p === undefined ? 0 : this.offx(p);
    var k = Math.max(s.w / iw, s.h / ih, (s.w + 2 * Math.abs(off)) / iw);
    return { k: k, x: (s.w - iw * k) / 2 + off, y: (s.h - ih * k) / 2, iw: iw, ih: ih };
  };
  // PC에서 장면 ②는 그림을 오른쪽으로 옮겨 왼쪽 제목과 좌우 균형을 맞추고, ③이 시작되며 제자리로 돌아온다
  Seq.prototype.offx = function (p) {
    if (innerWidth / innerHeight < 1 || innerWidth <= 760) return 0;
    if (this.name === 'card') return 0.1 * ease(seg(p, 0.3, 0.62)) * innerWidth;
    if (this.name === 'explode') return 0.1 * (1 - ease(seg(p, 0, 0.22))) * innerWidth;
    return 0;
  };
  Seq.prototype.toView = function (nx, ny, p) { var c = this.cover(p || 0); return { x: c.x + nx * c.iw * c.k, y: c.y + ny * c.ih * c.k }; };
  Seq.prototype.blit = function (p, alpha) {
    var i = this.nearest(p);
    if (i < 0 && this.prev) {
      // 새 묶음 첫 프레임이 오기 전: 이전 묶음의 가장 가까운 프레임을 같은 cover 계산으로 그린다
      var pv = this.prev, j = Math.round(clamp(warp(this.name, p)) * (pv.n - 1)), d2;
      for (d2 = 0; d2 < pv.n; d2++) { if (pv.ok[j - d2]) { j = j - d2; break; } if (pv.ok[j + d2]) { j = j + d2; break; } }
      if (pv.ok[j]) { var s2 = fxSize(), im = pv.imgs[j], k2 = Math.max(s2.w / im.naturalWidth, s2.h / im.naturalHeight); fctx.globalAlpha = alpha; fctx.drawImage(im, (s2.w - im.naturalWidth * k2) / 2, (s2.h - im.naturalHeight * k2) / 2, im.naturalWidth * k2, im.naturalHeight * k2); fctx.globalAlpha = 1; }
      return false;
    }
    if (i < 0) return false;
    var c = this.cover(p);
    fctx.globalAlpha = alpha; fctx.drawImage(this.imgs[i], c.x, c.y, c.iw * c.k, c.ih * c.k); fctx.globalAlpha = 1;
    return this.name + i + '@' + alpha.toFixed(2);
  };

  var seqs = [], seqSecs = [];
  $$('.ch[data-seq]').forEach(function (sec, n) {
    var seq = new Seq(sec.dataset.seq); sec._seq = seq; seqs.push(seq); seqSecs.push(sec);
    if (n === 0) { seq.first = true; seq.start(); }
    // 다음 챕터가 화면 1개 거리에 오면 미리 불러온다
    else ScrollTrigger.create({ trigger: sec, start: 'top bottom+=100%', once: true, onEnter: function () { seq.start(); } });
  });
  // 지금 스크롤 위치에서 그릴 장면과 섞는 비율을 정한다.
  var paintKey = '';
  function paint(force) {
    var y = scrollY, vh = innerHeight, jobs = [];
    seqSecs.forEach(function (sec, i) {
      var top = sec.getBoundingClientRect().top + y, a = top, b = top + sec.offsetHeight - vh;
      var prev = seqSecs[i - 1], next = seqSecs[i + 1];
      var prevAdj = prev && Math.abs(prev.getBoundingClientRect().top + y + prev.offsetHeight - top) < 2;
      var nextAdj = next && Math.abs(next.getBoundingClientRect().top + y - (top + sec.offsetHeight)) < 2;
      if (y >= a && y <= b) jobs.push([sec._seq, (y - a) / (b - a), 1]);
      else if (y > b && y < b + vh) {
        if (nextAdj) jobs.push([sec._seq, 1, 1], [next._seq, 0, ease(seg(y, b + vh * 0.15, b + vh * 0.85))]);
        else jobs.push([sec._seq, 1, 1]);
      } else if (y < a && y > a - vh && !prevAdj) jobs.push([sec._seq, 0, 1]);
    });
    if (!jobs.length) return;
    fxSize();
    var key = jobs.map(function (j) { return j[0].name + j[0].nearest(j[1]) + j[2].toFixed(2) + Math.round(j[0].offx(j[1])); }).join('|') + fx.width;
    if (key === paintKey && !force) return;
    paintKey = key;
    fctx.setTransform(fxDpr, 0, 0, fxDpr, 0, 0);
    jobs.forEach(function (j) { if (j[2] > 0.005) j[0].blit(j[1], j[2]); });
  }
  if (lenis) lenis.on('scroll', function () { paint(); }); else addEventListener('scroll', function () { paint(); }, { passive: true });
  var lastSet = pickSet();
  addEventListener('resize', function () {
    var s = pickSet();
    if (s !== lastSet) { seqs.forEach(function (q) { q.reset(s); }); lastSet = s; loadAnchors(); }
    paint(true);
  });

  // ── 장면 ③ 층 이름표: 렌더링 때 기록한 3D 좌표를 그대로 따라간다 ──
  var anchors = null, lblSec = $('#c3');
  function loadAnchors() {
    anchors = null;
    fetch('seq/explode/anchors-' + pickSet() + '.json').then(function (r) { return r.json(); }).then(function (a) { anchors = a; if (lblSec._p !== undefined) labels(lblSec._p); }).catch(function () {});
  }
  loadAnchors();
  var NS = 'http://www.w3.org/2000/svg', svgL = $('.lbl-lines', lblSec), lineEls = {};
  $$('.lbls li', lblSec).forEach(function (li) {
    var g = document.createElementNS(NS, 'g'), l = document.createElementNS(NS, 'line'), c = document.createElementNS(NS, 'circle');
    c.setAttribute('r', 3.5); g.appendChild(l); g.appendChild(c); svgL.appendChild(g); lineEls[li.dataset.id] = { li: li, g: g, l: l, c: c };
  });
  function labels(p) {
    if (!anchors) return;
    var seq = lblSec._seq, f = anchors[Math.round(p * (anchors.length - 1))] || [], off = innerWidth < 700 ? 30 : 64;
    f.forEach(function (a) {
      var e = lineEls[a.id]; if (!e) return;
      var v = seq.toView(a.x, a.y, p), k = seg(a.o, 0.6, 1);
      e.li.style.transform = 'translate(' + (v.x + off) + 'px,' + v.y + 'px)';
      e.li.style.opacity = k;
      e.l.setAttribute('x1', v.x); e.l.setAttribute('y1', v.y); e.l.setAttribute('x2', v.x + (off - 10) * k); e.l.setAttribute('y2', v.y);
      e.c.setAttribute('cx', v.x); e.c.setAttribute('cy', v.y); e.g.style.opacity = k;
    });
  }

  // ══════════ 장면별 진행률 ══════════
  var scenes = {
    c1: function () { paint(); },
    c2: function () { paint(); },
    c3: function (p) { paint(); labels(p); },
    c4: sortFlow(),
    c5: day(),
    c6: focus(),
    c7: highlights(),
    c10: function () { paint(); },
    c11: signupSteps()
  };
  Object.keys(scenes).forEach(function (id) {
    var sec = document.getElementById(id);
    var run = function (p) { sec._p = p; scenes[id](p, sec); cues(sec, p); };
    ScrollTrigger.create({ trigger: sec, start: 'top top', end: 'bottom bottom', onUpdate: function (self) { run(self.progress); }, onRefresh: function (self) { run(self.progress); } });
    run(0);
  });

  // ── C4 떠오른 일이 정리되는 과정: 실제 앱 화면을 넘기며, 처리한 카드는 오른쪽 칸으로 날아간다 ──
  function sortFlow() {
    var sec = $('#c4'), scr = $('.scr', sec), imgs = {}, dot = $('.tapdot', sec), fly = $('.flyc', sec);
    var stepEls = $$('.steps li', sec), copyEls = $$('.sc', sec), copyBox = $('.sort-copy', sec), phone = $('.sort-phone', sec), binsBox = $('.bins', sec), bins = {};
    $$('img', scr).forEach(function (im) { imgs[im.dataset.k] = im; });
    $$('.bin', sec).forEach(function (b) { bins[b.dataset.bin] = b; });
    // tap: 실제 앱 화면(390×844)에서 누르는 버튼 위치(비율). fly: 처리된 카드와 갈 칸, self면 이 화면에서 바로 날아간다
    var B = [
      { img: 'type', step: 0, tap: [0.86, 0.19] },
      { img: 'drop-ask', step: 1, tap: [0.70, 0.296] },
      { img: 'drop-no', step: 1, tap: [0.295, 0.296], fly: { t: '광고 메일 확인', bin: 'drop' } },
      { img: 'drop-drop', step: 1, tap: [0.70, 0.296] },
      { img: 'someday-no', step: 1, tap: [0.70, 0.296], fly: { t: '독서 모임 알아보기', bin: 'someday' } },
      { img: 'someday-someday', step: 1, tap: [0.70, 0.296] },
      { img: 'ref-no', step: 1, tap: [0.295, 0.423], fly: { t: '회의실 와이파이 비번', bin: 'ref' } },
      { img: 'ref-ref', step: 1, tap: [0.33, 0.393], fly: { t: '택배 반품 신청', bin: 'now' } },
      { img: 'now-now', step: 2, tap: [0.295, 0.296] },
      { img: 'hero-yes', step: 2, tap: [0.70, 0.296] },
      { img: 'hero-sched', step: 2, tap: [0.125, 0.743] },
      { img: 'hero-done', step: 3, fly: { t: '팀장님께 보고서 초안 보내기', bin: 'today', self: true } },
      { img: 'today-star', step: 3 }
    ];
    var N = B.length, lastKey = '', cur = null;
    function layout() {
      if (innerWidth / innerHeight < 1 || innerWidth <= 760) { copyBox.style.left = ''; copyBox.style.width = ''; return; }
      var pr = phone.getBoundingClientRect(), br = binsBox.getBoundingClientRect(), l = pr.right + 48;
      copyBox.style.left = l + 'px'; copyBox.style.width = Math.max(220, br.left - 48 - l) + 'px';
    }
    addEventListener('resize', layout);
    return function (p) {
      layout();
      var b = clamp(p, 0, 0.9999) * N, i = Math.floor(b), f = b - i, beat = B[i];
      // 다음 화면을 스크롤에 맞춰 서서히 겹친다(멈춰 있는 구간이 없게)
      var nxt = B[i + 1] ? B[i + 1].img : null, mix = nxt ? seg(f, 0.78, 1) : 0;
      Object.keys(imgs).forEach(function (k2) { imgs[k2].style.opacity = k2 === beat.img ? 1 : k2 === nxt ? mix : 0; });
      stepEls.forEach(function (el, k) { el.classList.toggle('on', k === beat.step); el.classList.toggle('done', k < beat.step); });
      copyEls.forEach(function (el, k) { el.classList.toggle('on', k === beat.step); });
      // 누르는 곳 표시
      if (beat.tap) {
        var a = Math.sin(Math.PI * seg(f, 0.3, 0.8));
        dot.style.left = beat.tap[0] * 100 + '%'; dot.style.top = beat.tap[1] * 100 + '%';
        dot.style.opacity = a; dot.style.transform = 'scale(' + (0.6 + 0.6 * seg(f, 0.3, 0.7)) + ')';
      } else dot.style.opacity = 0;
      // 날아가는 카드: 앞 화면의 카드(다음 화면이 시작될 때) 또는 self(이 화면에서)
      var fb = null, k = 0;
      if (beat.fly && beat.fly.self) { fb = beat.fly; k = seg(f, 0.2, 0.8); }
      else if (i > 0 && B[i - 1].fly && !B[i - 1].fly.self) { fb = B[i - 1].fly; k = seg(f, 0, 0.75); }
      Object.keys(bins).forEach(function (n) { bins[n].classList.toggle('hit', !!fb && fb.bin === n && k > 0.75 && k < 1); });
      if (fb && k > 0 && k < 1) {
        var sr = scr.getBoundingClientRect(), stg = sec.querySelector('.stage').getBoundingClientRect(), ul = $('ul', bins[fb.bin]).getBoundingClientRect();
        if (fly.textContent !== fb.t) fly.textContent = fb.t;
        var x0 = sr.left + sr.width * 0.5 - stg.left, y0 = sr.top + sr.height * 0.17 - stg.top;
        var x1 = ul.left + Math.min(ul.width, 220) / 2 - stg.left, y1 = ul.top + 26 - stg.top;
        var e = ease(k), x = lerp(x0, x1, e), y = lerp(y0, y1, e) - Math.sin(Math.PI * k) * 90;
        fly.style.opacity = Math.min(1, k * 8, (1 - k) * 5);
        fly.style.transform = 'translate(' + (x - fly.offsetWidth / 2) + 'px,' + (y - fly.offsetHeight / 2) + 'px) rotate(' + (Math.sin(Math.PI * k) * -6) + 'deg) scale(' + lerp(1, 0.62, e) + ')';
      } else fly.style.opacity = 0;
      // 다 날아간 카드는 칸에 쌓인다
      var landed = {}, key = '';
      B.forEach(function (bt, n) {
        if (!bt.fly) return;
        var doneAt = bt.fly.self ? n + 0.8 : n + 1 + 0.75;
        if (b >= doneAt) { (landed[bt.fly.bin] = landed[bt.fly.bin] || []).push(bt.fly.t); key += n; }
      });
      if (key !== lastKey) {
        lastKey = key;
        Object.keys(bins).forEach(function (n) {
          var ul = $('ul', bins[n]), want = landed[n] || [];
          if (ul.children.length !== want.length) ul.innerHTML = want.map(function (t) { return '<li>' + t + '</li>'; }).join('');
        });
      }
    };
  }

  // ── C11 신청: 화면에 고정된 채 스크롤에 따라 한 단계씩 펼쳐진다 ──
  var suMax = 0;
  function revealTo(n) {
    if (n <= suMax) return; suMax = n;
    $$('#signup .st').forEach(function (el) { el.classList.toggle('on', +el.dataset.step <= suMax); });
    $$('#signup .su-steps li').forEach(function (el, i) { el.classList.toggle('on', i <= suMax); });
  }
  function signupSteps() {
    var stage = $('#c11 .su-stage'), AT = [0, 0.08, 0.18, 0.28, 0.38, 0.48];
    function stick() { stage.style.setProperty('--st', Math.min(88, innerHeight - stage.offsetHeight - 8) + 'px'); }
    addEventListener('resize', stick);
    $('#c11 .su-steps li').classList.add('on');
    return function (p) {
      var n = 0; AT.forEach(function (a, i) { if (p >= a) n = i; });
      revealTo(n); stick();
    };
  }

  // ── C5 하루 타임랩스 (가로 핀) ──
  function day() {
    var sec = $('#c5'), stage = $('.stage', sec), trackEl = $('.dtrack', sec), hours = $('.hours', sec), sun = $('.sun', sec), clock = $('.clock', sec);
    var tks = $$('.slot.tk', sec), tocal = $('.tocal', sec), badge = $('.badge', sec);
    for (var h = 9; h <= 17; h++) { var i = document.createElement('i'); i.style.setProperty('--k', h - 9); i.textContent = h + ':00'; hours.appendChild(i); }
    var SKY = [[9, '#CFE3FF', '#FFF4E6'], [13, '#BFE0FF', '#F6FBFF'], [15, '#C9C2FF', '#FFE4EC'], [17, '#A99BFF', '#FFD1DC']];
    function mix(a, b, k) {
      var pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16), r = [16, 8, 0].map(function (s) { return Math.round(lerp((pa >> s) & 255, (pb >> s) & 255, k)); });
      return 'rgb(' + r.join(',') + ')';
    }
    function sky(hr) {
      for (var i = 1; i < SKY.length; i++) if (hr <= SKY[i][0]) { var a = SKY[i - 1], b = SKY[i], k = seg(hr, a[0], b[0]); return [mix(a[1], b[1], k), mix(a[2], b[2], k)]; }
      return [SKY[3][1], SKY[3][2]];
    }
    return function (p) {
      var vw = innerWidth, vh = innerHeight, tw = trackEl.offsetWidth, hw = parseFloat(getComputedStyle(trackEl).getPropertyValue('--hw')) / 100 * vw;
      var x = (0.45 * vw - 8 * hw) * ease(seg(p, 0.03, 0.86)); // 끝에서 17:00 눈금이 화면 85% 자리에 오도록(잘리지 않게)
      trackEl.style.transform = 'translate3d(' + x + 'px,0,0)';
      var hr = clamp(9 + (vw * 0.5 - (vw * 0.4 + x)) / hw, 9, 17);
      var hh = Math.floor(hr), mm = Math.floor((hr - hh) * 60 / 10) * 10;
      clock.textContent = String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
      var c = sky(hr); stage.style.setProperty('--sky1', c[0]); stage.style.setProperty('--sky2', c[1]);
      var k = (hr - 9) / 8; sun.style.transform = 'translate(' + (vw * lerp(0.08, 0.92, k)) + 'px,' + (vh * (0.62 - Math.sin(Math.PI * k) * 0.5)) + 'px)';
      // 할 일 블록: 화면 가운데를 지나기 직전에 빈칸으로 떨어져 맞물린다
      tks.forEach(function (t) {
        var sx = t.offsetLeft + x + t.offsetWidth / 2, kk = seg(vw * 0.92 - sx, 0, vw * 0.3), b = kk < 1 ? backOut(kk) : 1;
        t.style.transform = 'translateY(' + ((1 - b) * -vh * 0.42) + 'px) rotate(' + ((1 - kk) * -8) + 'deg)';
        t.style.opacity = clamp(kk * 2.5);
      });
      tocal.classList.toggle('on', p > 0.86);
      var press = p > 0.92; tocal.classList.toggle('press', press);
      tks.forEach(function (t) { t.classList.toggle('placed', press); });
      badge.textContent = press ? tks.length : 0;
    };
  }

  // ── C6 집중 ──
  function focus() {
    var sec = $('#c6'), timer = $('.timer', sec), arc = $('.ring .arc', sec), chk = $('.check path', sec), chkSvg = $('.check', sec), label = $('.flabel', sec);
    var C = 2 * Math.PI * 92, L = chk.getTotalLength ? chk.getTotalLength() : 120, fired = false;
    arc.style.strokeDasharray = C; chk.style.strokeDasharray = L;
    return function (p) {
      var left = Math.round(1500 * (1 - ease(seg(p, 0.06, 0.8))));
      timer.textContent = String(Math.floor(left / 60)).padStart(2, '0') + ':' + String(left % 60).padStart(2, '0');
      arc.style.strokeDashoffset = C * (1 - left / 1500);
      var out = seg(p, 0.8, 0.86); timer.style.opacity = 1 - out; label.style.opacity = 1 - out;
      var ck = seg(p, 0.83, 0.93); chkSvg.style.opacity = ck > 0 ? 1 : 0; chk.style.strokeDashoffset = L * (1 - ease(ck));
      if (p > 0.88 && !fired) { fired = true; confetti(160); }
      if (p < 0.78) fired = false;
    };
  }

  // ── C7 직접 보세요: 휴대폰 하나씩, 스크롤하면 옆으로 ──
  function highlights() {
    var sec = $('#c7'), track = $('.hl-track', sec), panels = $$('.hp-panel', sec), dots = $$('.hl-dots i', sec), vids = $$('video', sec), act = -1;
    var n = panels.length, KEYS = [[0, 0]];
    // 한 장마다 멈춰 보여 주고(dwell) 다음 장으로 넘어간다
    // 첫 장 잠깐 보여 준 뒤, 넘어가는 시간(0.75)을 머무는 시간(0.25)보다 길게: 한 걸음에 화면이 확 바뀌지 않게
    var span = 0.9 / (n - 1);
    for (var k = 1; k < n; k++) { var t = 0.05 + (k - 1) * span + span * 0.18; KEYS.push([t, k - 1], [t + span * 0.78, k]); }
    KEYS.push([1, n - 1]);
    function pos(p) {
      for (var i = 1; i < KEYS.length; i++) if (p <= KEYS[i][0]) { var a = KEYS[i - 1], b = KEYS[i]; return b[0] === a[0] ? b[1] : lerp(a[1], b[1], ease(seg(p, a[0], b[0]))); }
      return n - 1;
    }
    ScrollTrigger.create({ trigger: sec, start: 'top bottom+=100%', once: true, onEnter: function () { vids.forEach(function (v) { v.preload = 'auto'; }); } });
    ScrollTrigger.create({ trigger: sec, start: 'top bottom', end: 'bottom top', onToggle: function (self) { if (!self.isActive) { vids.forEach(function (v) { v.pause(); }); act = -1; } } });
    return function (p) {
      var x = pos(p), a = Math.round(x), r = sec.getBoundingClientRect();
      var desk = innerWidth / innerHeight >= 1 && innerWidth > 760;
      if (desk) return; // PC는 deskPin()이 맡는다
      if (false) {
        // PC: 고정된 자리에서 앞 장은 흐려지며 위로, 다음 장은 아래에서 올라오며 겹쳐 바뀐다
        var base = Math.floor(x), k = x - base;
        panels.forEach(function (pn, i) {
          var o = i === base ? 1 - k : i === base + 1 ? k : 0, d = i - x;
          pn.style.opacity = o; pn.style.visibility = o > 0.01 ? 'visible' : 'hidden';
          $('.ph', pn).style.transform = 'translateY(' + (d * 60) + 'px) scale(' + (1 - Math.min(1, Math.abs(d)) * 0.06) + ')';
          $('.hp-txt', pn).style.transform = 'translateY(' + (d * 90) + 'px)';
        });
      } else {
        track.style.transform = 'translate3d(' + (-x * innerWidth) + 'px,0,0)';
        panels.forEach(function (pn) { pn.style.opacity = ''; pn.style.visibility = ''; $('.ph', pn).style.transform = ''; $('.hp-txt', pn).style.transform = ''; });
      }
      dots.forEach(function (d, i) { d.classList.toggle('on', i === a); });
      if (a !== act && r.top < innerHeight && r.bottom > 0) {
        act = a;
        vids.forEach(function (v, i) { if (i === a) { v.currentTime = 0; var pr = v.play(); if (pr) pr.catch(function () {}); } else v.pause(); });
      }
    };
  }

  // ── C7 PC: 핀 스크롤리텔링(휴대폰 고정, 설명이 스크롤되며 가운데 온 설명으로 화면 전환) ──
  (function deskPin() {
    var sec = $('#c7'), pin = $('.hl-pin', sec), steps = $$('.hl-step', sec), vids = $$('.dv', sec), act = -1, playing = false;
    function upd() {
      if (!(innerWidth / innerHeight >= 1 && innerWidth > 760)) return;
      var r = sec.getBoundingClientRect(), inView = r.top < innerHeight && r.bottom > 0, pr = pin.getBoundingClientRect();
      // 고정 구간 안에서 스크롤한 만큼 0~5번 설명을 고른다
      var p = clamp((innerHeight / 2 - pr.top) / pr.height, 0, 0.9999), best = Math.floor(p * steps.length);
      if (best !== act) {
        act = best;
        steps.forEach(function (st, i) { st.classList.toggle('on', i === best); st.classList.toggle('past', i < best); });
        vids.forEach(function (v, i) { v.classList.toggle('on', i === best); if (i !== best) v.pause(); });
        playing = false;
      }
      var v = vids[act];
      if (inView && !playing) { v.preload = 'auto'; v.currentTime = 0; var pr = v.play(); if (pr) pr.catch(function () {}); playing = true; }
      if (!inView && playing) { v.pause(); playing = false; }
    }
    if (lenis) lenis.on('scroll', upd); addEventListener('scroll', upd, { passive: true }); addEventListener('resize', upd); upd();
  })();

  // ── 마키: 끝없이 흐르는 글자 띠. 스크롤이 빠를수록 빨라진다 ──
  (function () {
    $$('.mq-row').forEach(function (row, n) {
      var inner = $('.mq-in', row), unit = inner.textContent, x = 0, dir = row.classList.contains('rev') ? 1 : -1;
      inner.textContent = unit.repeat(6);
      var w = 0, last = performance.now();
      function measure() { var tmp = document.createElement('span'); tmp.textContent = unit; tmp.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap'; inner.appendChild(tmp); w = tmp.offsetWidth; tmp.remove(); }
      measure(); addEventListener('resize', measure);
      (function loop(now) {
        var dt = Math.min(0.05, (now - last) / 1000); last = now;
        var r = row.getBoundingClientRect();
        if (r.bottom > 0 && r.top < innerHeight && w) {
          var vel = lenis ? Math.abs(lenis.velocity || 0) : 0;
          x += dir * (38 + Math.min(vel, 30) * 8) * dt;
          if (x <= -w) x += w; if (x > 0) x -= w;
          inner.style.transform = 'translate3d(' + x + 'px,0,0)';
        }
        requestAnimationFrame(loop);
      })(last);
    });
  })();

  // ── 스크롤에 따라 단어가 하나씩 칠해지는 문장 ──
  $$('[data-hilite]').forEach(function (el) {
    var words = el.textContent.trim().split(/\s+/); el.setAttribute('aria-label', el.textContent.trim()); el.textContent = '';
    words.forEach(function (w, i) { var sp = document.createElement('span'); sp.className = 'wd'; sp.textContent = w; sp.setAttribute('aria-hidden', 'true'); el.appendChild(sp); if (i < words.length - 1) el.appendChild(document.createTextNode(' ')); });
    var spans = $$('.wd', el);
    ScrollTrigger.create({ trigger: el, start: 'top 85%', end: 'top 40%', onUpdate: function (self) { var n = Math.round(self.progress * spans.length); spans.forEach(function (sp, i) { sp.classList.toggle('on', i < n); }); } });
  });

  // ── 마그네틱 버튼: 커서가 가까이 오면 살짝 끌려온다(마우스가 있는 화면만) ──
  if (matchMedia('(hover: hover) and (pointer: fine)').matches) $$('[data-magnet]').forEach(function (el) {
    el.addEventListener('pointermove', function (e) { var r = el.getBoundingClientRect(); gsap.to(el, { x: (e.clientX - r.left - r.width / 2) * 0.28, y: (e.clientY - r.top - r.height / 2) * 0.35, duration: 0.4, ease: 'power3.out' }); });
    el.addEventListener('pointerleave', function () { gsap.to(el, { x: 0, y: 0, duration: 0.7, ease: 'elastic.out(1, 0.4)' }); });
  });

  // ── 스크롤 진행 막대 ──
  (function () { var bar = $('.scroll-prog'); function u() { var m = document.documentElement.scrollHeight - innerHeight; bar.style.setProperty('--sp', m > 0 ? scrollY / m : 0); } if (lenis) lenis.on('scroll', u); addEventListener('scroll', u, { passive: true }); u(); })();

  // ── 기능 카드: 잘린 틀이 펼쳐지며 차례로 등장(클립패스 + 스태거) + 서로 다른 속도로 움직임(패럴랙스) ──
  (function () {
    var tiles = $$('[data-tile]'); if (!tiles.length) return;
    gsap.to(tiles, { clipPath: 'inset(0% 0% 0% 0% round 28px)', opacity: 1, duration: 1.1, ease: 'expo.out', stagger: 0.12, scrollTrigger: { trigger: tiles[0], start: 'top 82%' } });
    tiles.forEach(function (t, i) { gsap.fromTo(t, { y: 30 + (i % 2) * 40 }, { y: -(10 + (i % 2) * 40), ease: 'none', scrollTrigger: { trigger: t.parentNode, start: 'top bottom', end: 'bottom top', scrub: true } }); });
  })();

  // ── 먼저 써 본 분들의 말: 차례로 떠올라 떠다닌다 ──
  $$('[data-vb]').forEach(function (el) {
    ScrollTrigger.create({ trigger: el.parentNode, start: 'top 78%', onEnter: function () { el.classList.add('on'); }, onLeaveBack: function () { el.classList.remove('on'); } });
  });

  // ── 이런 고민: 말풍선이 차례로 떠오르고 키트의 답이 이어진다 ──
  $$('[data-qa]').forEach(function (el, i) {
    ScrollTrigger.create({ trigger: el, start: 'top 78%', onEnter: function () { setTimeout(function () { el.classList.add('on'); }, i * 220); }, onLeaveBack: function () { el.classList.remove('on'); } });
  });

  // ── C8 맡긴 일 며칠째 ──
  (function () { var els = [$('.dcount'), $('.dcount2')], n = 1; setInterval(function () { n = n % 3 + 1; els.forEach(function (el) { el.textContent = n; el.style.color = n === 3 ? '#C27C00' : ''; }); }, 1600); })();

  // ── C9 숫자 올라가기 ──
  $$('.cu').forEach(function (el) {
    var to = +el.dataset.to;
    ScrollTrigger.create({ trigger: el, start: 'top 85%', once: true, onEnter: function () {
      var o = { v: to === 0 ? 9 : 0 };
      gsap.to(o, { v: to, duration: 1.4, ease: 'power3.out', onUpdate: function () { el.textContent = Math.round(o.v); } });
    } });
  });

  // ── 앱과 같은 confetti ──
  function confetti(power) {
    var cv = $('#confetti'), ctx = cv.getContext('2d'), dpr = devicePixelRatio || 1, W = cv.width = innerWidth * dpr, H = cv.height = innerHeight * dpr;
    var colors = ['#5B5CF6', '#8B7CFF', '#FF7AC6', '#5FD3F3', '#F2A20C', '#3182F6', '#FFD43B', '#F0508C'], ps = [], n = Math.min(power || 150, innerWidth < 700 ? 60 : 150);
    for (var i = 0; i < n; i++) {
      var side = i % 2 ? 1 : -1;
      ps.push({ x: W / 2 + side * W * .18, y: H * .72, vx: (side * -(Math.random() * 9 + 4) + (Math.random() - .5) * 6) * dpr, vy: -(Math.random() * 16 + 12) * dpr,
        s: (Math.random() * 6 + 5) * dpr, r: Math.random() * 6.28, vr: (Math.random() - .5) * .4, c: colors[i % colors.length], shape: i % 3 });
    }
    var t0 = performance.now();
    (function frame(now) {
      var el = now - t0; ctx.clearRect(0, 0, W, H);
      ps.forEach(function (p) {
        p.vy += .45 * dpr; p.vx *= .985; p.x += p.vx; p.y += p.vy; p.r += p.vr;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.globalAlpha = Math.max(0, 1 - el / 2200); ctx.fillStyle = p.c;
        if (p.shape === 0) ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); else if (p.shape === 1) { ctx.beginPath(); ctx.arc(0, 0, p.s / 2.6, 0, 6.28); ctx.fill(); } else { ctx.beginPath(); ctx.moveTo(0, -p.s / 2); ctx.lineTo(p.s / 2, p.s / 2); ctx.lineTo(-p.s / 2, p.s / 2); ctx.fill(); }
        ctx.restore();
      });
      if (el < 2300) requestAnimationFrame(frame); else ctx.clearRect(0, 0, W, H);
    })(t0);
  }

  // ══════════ C11 신청 폼 (백엔드: apps-script/signup/Code.gs) ══════════
  (function () {
    var card = $('#formcard'), form = $('#signup'), email = $('#fEmail'), msg = $('#fMsg'), btn = $('.submit', form), more = $('.more', form);
    // 유입 출처(utm) 기록
    var src = '';
    try {
      var q = new URLSearchParams(location.search), utm = ['utm_source', 'utm_medium', 'utm_campaign'].map(function (k) { return q.get(k); }).filter(Boolean).join('/');
      if (utm) sessionStorage.setItem('kitSrc', utm);
      src = sessionStorage.getItem('kitSrc') || '';
    } catch (e) {}
    if (!src && document.referrer) { try { var h = new URL(document.referrer).hostname; if (h !== location.hostname) src = h; } catch (e) {} }

    // 단계 펼치기는 signupSteps()가 스크롤에 맞춰 한다. 입력하거나 초점이 들어오면 그 단계까지 바로 펼친다.
    form.addEventListener('focusin', function (e) { var st = e.target.closest('.st'); revealTo(st ? +st.dataset.step : 0); });
    email.addEventListener('input', function () { revealTo(1); });
    $$('.chips', form).forEach(function (g) {
      g.addEventListener('click', function (e) {
        var b = e.target.closest('button'); if (!b) return;
        var was = b.classList.contains('on'); $$('button', g).forEach(function (x) { x.classList.remove('on'); x.setAttribute('aria-pressed', 'false'); });
        if (!was) { b.classList.add('on'); b.setAttribute('aria-pressed', 'true'); }
        if (g.dataset.name === 'role') { var etcIn = $('#fRoleEtc'); etcIn.hidden = !(b.hasAttribute('data-etc') && !was); if (!etcIn.hidden) etcIn.focus(); }
      });
    });
    var rIn = $('#fReason'), rCnt = $('#fReasonCnt');
    rIn.addEventListener('input', function () { var n = rIn.value.replace(/\s/g, '').length; rCnt.textContent = n + ' / 20자'; rCnt.classList.toggle('ok', n >= 20); });
    var chip = function (name) { var b = $('.chips[data-name="' + name + '"] .on', form); return b ? b.textContent : ''; };

    form.addEventListener('submit', function (e) {
      e.preventDefault(); revealTo(5); msg.textContent = '';
      var em = email.value.trim();
      if (!/^[^\s@<>()]+@[^\s@<>()]+\.[a-z]{2,}$/i.test(em)) { msg.textContent = '이메일 주소를 확인해 주세요.'; email.focus(); return; }
      var nm = form.elements.namedItem('name').value.trim(), etc = $('#fRoleEtc'), role = chip('role'), use = chip('use'), reason = $('#fReason').value.trim();
      if (role === '기타') role = etc.value.trim() ? '기타: ' + etc.value.trim() : '';
      if (!nm) { msg.textContent = '이름을 적어 주세요.'; form.elements.namedItem('name').focus(); return; }
      if (!role) { msg.textContent = chip('role') === '기타' ? '하는 일을 적어 주세요.' : '하는 일을 골라 주세요.'; if (chip('role') === '기타') etc.focus(); return; }
      if (!use) { msg.textContent = '어디에 쓰고 싶은지 골라 주세요.'; return; }
      if (reason.replace(/\s/g, '').length < 20) { msg.textContent = '신청한 이유를 20자 이상 적어 주세요.'; $('#fReason').focus(); return; }
      if (!form.agree.checked) { msg.textContent = '개인정보 수집·이용에 동의해 주세요.'; return; }
      var body = { email: em, name: nm, role: role, use: use, reason: reason, agree: true, marketing: form.marketing.checked, website: form.website.value, source: src || 'direct' };
      btn.disabled = true; btn.textContent = '보내는 중…';
      var ctrl = window.AbortController ? new AbortController() : null, timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, 20000);
      fetch(SIGNUP_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body), signal: ctrl && ctrl.signal })
        .then(function (r) { return r.json(); })
        .then(function (r) {
          if (!r || !r.ok) throw new Error((r && r.error) || '잠시 문제가 생겼어요. 조금 뒤 다시 시도해 주세요.');
          done(r);
        })
        .catch(function (err) {
          msg.textContent = err && err.name !== 'AbortError' && err.message && !/fetch|network|JSON|Unexpected/i.test(err.message) ? err.message : '잠시 문제가 생겼어요. 조금 뒤 다시 시도해 주세요.';
        })
        .then(function () { clearTimeout(timer); btn.disabled = false; btn.textContent = '평생 무료로 신청하기'; });
    });
    function done(r) {
      $('#sentH').textContent = r.again ? '이미 신청하셨어요.' : '메일함을 확인해 주세요.';
      $('#sentP').textContent = !r.ready ? '첫 사용자분들께 차례로 열어 드리고 있어요. 준비되면 이 주소로 시작 링크를 바로 보내 드릴게요.'
        : r.again ? '메일함에서 ‘시작 링크와 사용법’ 메일을 찾아 주세요. 스팸함도 확인해 주세요.'
        : '방금 보낸 메일에 시작 링크, 사용법, 사용자 커뮤니티 카톡방 링크가 있어요.';
      card.classList.add('fly');
      setTimeout(function () {
        form.hidden = true; var s = $('#sent'); s.hidden = false;
        // 긴 폼이 작은 완료 카드로 바뀌며 페이지가 짧아지므로, 완료 카드가 화면 가운데 오도록 옮긴다
        ScrollTrigger.refresh();
        var y = s.getBoundingClientRect().top + scrollY - Math.max(80, (innerHeight - s.offsetHeight) / 2);
        if (lenis) lenis.scrollTo(y, { duration: 0.8 }); else scrollTo({ top: y, behavior: 'smooth' });
        s.focus({ preventScroll: true });
        gsap.from(s, { scale: 0.85, opacity: 0, duration: 0.9, ease: 'expo.out' }); confetti(150);
      }, 750);
    }
  })();

  // 점검 도구(tools/site-check)가 쓰는 손잡이
  window.__v3 = { lenis: lenis, seqs: seqs };

  // 글꼴이 늦게 와서 높이가 바뀌면 다시 계산
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { ScrollTrigger.refresh(); });
  addEventListener('load', function () { ScrollTrigger.refresh(); });
})();
