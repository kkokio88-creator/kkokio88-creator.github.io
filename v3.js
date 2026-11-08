/* 내 업무관리 키트 홈페이지 v3
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
    var txt = el.textContent.trim(); el.setAttribute('aria-label', txt); el.textContent = '';
    // 단어 단위로 묶어 줄바꿈이 글자 사이(마침표 앞 등)에서 일어나지 않게
    var i = 0;
    txt.split(' ').forEach(function (word, wi) {
      if (wi) el.appendChild(document.createTextNode(' '));
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
    ScrollTrigger.create({ trigger: el, start: 'top 88%', onEnter: function () { el.classList.add('on'); }, onLeaveBack: function () { el.classList.remove('on'); } });
  });

  // ══════════ 이미지 시퀀스 스크럽 엔진 ══════════
  function pickSet() { return innerWidth / innerHeight < 1 ? 'm' : 'd'; }
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
    this.set = set; this.n = FRAMES[this.name][set]; this.imgs = new Array(this.n); this.ok = new Array(this.n); this.queue = []; this.busy = 0;
    if (this.started) { this.started = false; this.start(); }
  };
  Seq.prototype.url = function (i) { return 'seq/' + this.name + '/' + this.set + '/' + String(i + 1).padStart(4, '0') + '.webp'; };
  // 포스터 → 4장 간격 → 2장 간격 → 전부
  Seq.prototype.start = function () {
    if (this.started) return; this.started = true;
    var order = [0], seen = { 0: 1 }, n = this.n;
    if (!seen[n - 1]) { seen[n - 1] = 1; order.push(n - 1); }
    [4, 2, 1].forEach(function (step) { for (var i = 0; i < n; i += step) if (!seen[i]) { seen[i] = 1; order.push(i); } });
    this.queue = order; this.pump();
  };
  Seq.prototype.pump = function () {
    var self = this, set = this.set;
    while (this.busy < 6 && this.queue.length) {
      (function (i) {
        self.busy++;
        var img = new Image(); img.decoding = 'async'; img.src = self.url(i);
        var done = function (good) {
          if (set !== self.set) return;
          self.busy--; if (good) { self.imgs[i] = img; self.ok[i] = true; paint(true); }
          self.pump();
        };
        (img.decode ? img.decode() : new Promise(function (r) { img.onload = r; })).then(function () { done(true); }, function () { done(false); });
      })(this.queue.shift());
    }
  };
  Seq.prototype.nearest = function (p) {
    var i = Math.round(clamp(p) * (this.n - 1));
    for (var d = 0; d < this.n; d++) { if (this.ok[i - d]) return i - d; if (this.ok[i + d]) return i + d; }
    return -1;
  };
  // 프레임 좌표(0~1) → 화면 좌표(px). 그리기와 같은 cover 계산
  Seq.prototype.cover = function () {
    var s = fxSize(), iw = this.set === 'd' ? 1600 : 900, ih = this.set === 'd' ? 900 : 1600, k = Math.max(s.w / iw, s.h / ih);
    return { k: k, x: (s.w - iw * k) / 2, y: (s.h - ih * k) / 2, iw: iw, ih: ih };
  };
  Seq.prototype.toView = function (nx, ny) { var c = this.cover(); return { x: c.x + nx * c.iw * c.k, y: c.y + ny * c.ih * c.k }; };
  Seq.prototype.blit = function (p, alpha) {
    var i = this.nearest(p); if (i < 0) return false;
    var c = this.cover();
    fctx.globalAlpha = alpha; fctx.drawImage(this.imgs[i], c.x, c.y, c.iw * c.k, c.ih * c.k); fctx.globalAlpha = 1;
    return this.name + i + '@' + alpha.toFixed(2);
  };

  var seqs = [], seqSecs = [];
  $$('.ch[data-seq]').forEach(function (sec, n) {
    var seq = new Seq(sec.dataset.seq); sec._seq = seq; seqs.push(seq); seqSecs.push(sec);
    if (n === 0) seq.start();
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
    var key = jobs.map(function (j) { return j[0].name + j[0].nearest(j[1]) + j[2].toFixed(2); }).join('|') + fx.width;
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
      var v = seq.toView(a.x, a.y), k = seg(a.o, 0.6, 1);
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
    c4: journey(),
    c5: day(),
    c6: focus(),
    c10: function () { paint(); }
  };
  Object.keys(scenes).forEach(function (id) {
    var sec = document.getElementById(id);
    var run = function (p) { sec._p = p; scenes[id](p, sec); cues(sec, p); };
    ScrollTrigger.create({ trigger: sec, start: 'top top', end: 'bottom bottom', onUpdate: function (self) { run(self.progress); }, onRefresh: function (self) { run(self.progress); } });
    run(0);
  });

  // ── C4 카드의 여행 (가로 핀) ──
  function journey() {
    var sec = $('#c4'), track = $('.track', sec), card = $('.tcard', sec), inner = $('.tcard-in', sec), star = $('.star', card);
    var fill = $('.rail-fill', sec), dots = $$('.rail span', sec), minis = $$('.mini', sec), paths = $$('.fork-lines path', sec), opts = $$('.fork-opts li', sec);
    var lens = paths.map(function (p) { var L = p.getTotalLength ? p.getTotalLength() : 500; p.style.strokeDasharray = L; p.style.strokeDashoffset = L; return L; });
    // 정류장 위치: 멈춤(dwell)과 이동을 번갈아
    var KEYS = [[0, 0], [0.1, 0], [0.28, 1], [0.44, 1], [0.6, 2], [0.72, 2], [0.88, 3], [1, 3]];
    function pos(p) {
      for (var i = 1; i < KEYS.length; i++) if (p <= KEYS[i][0]) { var a = KEYS[i - 1], b = KEYS[i]; return lerp(a[1], b[1], ease(seg(p, a[0], b[0]))); }
      return 3;
    }
    return function (p) {
      var x = pos(p), moving = x - Math.floor(x), vw = innerWidth, vh = innerHeight, portrait = vw / vh < 1;
      track.style.transform = 'translate3d(' + (-x * vw) + 'px,0,0)';
      fill.style.transform = 'scaleX(' + (x / 3) + ')';
      dots.forEach(function (d, i) { d.classList.toggle('on', x >= i - 0.02); });
      // 카드: 입력칸에서 떠올라, 이동할 때 기울고 튀어 오른다
      var rise = ease(seg(p, 0, 0.09)), bob = Math.sin(Math.PI * moving);
      var ty = (1 - rise) * vh * (portrait ? 0.27 : 0.25) - bob * 34;
      var flip = 180 * ease(seg(p, 0.3, 0.36)) * (1 - ease(seg(p, 0.4, 0.45)));
      var pick = ease(seg(p, 0.62, 0.68)) * (1 - ease(seg(p, 0.72, 0.8)));
      var land = ease(seg(p, 0.89, 0.95));
      var vis = $('.vis-today', sec), listTop = vis ? vis.getBoundingClientRect().top : vh * 0.7;
      var cardMid = vh * (portrait ? 0.44 : 0.47);
      ty += land * (listTop - cardMid + 30) - pick * 26;
      var tx = 0;
      var sc = lerp(1, 0.86, rise < 1 ? 1 - rise : 0) * (1 - land * 0.12) * (1 - pick * 0.1);
      card.style.transform = 'translate3d(' + tx + 'px,' + ty + 'px,0) rotate(' + (-6 * bob * (x < 3 ? 1 : 0)) + 'deg) scale(' + sc + ')';
      inner.style.transform = 'rotateY(' + flip + 'deg)';
      var st = seg(p, 0.95, 0.99); star.style.opacity = st; star.style.transform = 'scale(' + backOut(st) + ') rotate(' + (1 - st) * -40 + 'deg)';
      // 정류장 2: 아닌 일은 세 갈래 쟁반으로
      minis.forEach(function (m, i) {
        var k = seg(p, 0.33 + i * 0.025, 0.41 + i * 0.025), b = k < 1 ? backOut(k) : 1;
        m.style.transform = 'translateY(' + ((1 - b) * -vh * 0.5) + 'px) rotate(' + ((1 - k) * (i - 1) * 14) + 'deg)';
        m.style.opacity = clamp(k * 3);
      });
      // 정류장 3: 네 갈래 선을 그린다
      paths.forEach(function (pa, i) { pa.style.strokeDashoffset = lens[i] * (1 - ease(seg(p, 0.52 + i * 0.02, 0.62 + i * 0.02))); });
      opts.forEach(function (o, i) { o.style.opacity = seg(p, 0.58 + i * 0.02, 0.62 + i * 0.02); });
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

  // ── C7 하이라이트 캐러셀 ──
  (function () {
    var car = $('.car'), tiles = $$('.tile', car), dotsEl = $('#c7 .dots'), active = 0, idle = 0, inView = false, paused = false, pauseBtn = $('#c7 .pause');
    pauseBtn.addEventListener('click', function () {
      paused = !paused; pauseBtn.setAttribute('aria-pressed', paused); pauseBtn.textContent = paused ? '자동 재생 켜기' : '자동 재생 멈춤';
      $$('video', car).forEach(function (v) { if (paused) v.pause(); });
      if (!paused) mark(), tiles.forEach(function (t) { io.unobserve(t); if (inView) io.observe(t); });
    });
    tiles.forEach(function (t, i) {
      var b = document.createElement('button'); b.type = 'button'; b.setAttribute('role', 'tab'); b.setAttribute('aria-label', (i + 1) + '번 영상: ' + $('b', t).textContent);
      b.addEventListener('click', function () { go(i); idle = Date.now(); }); dotsEl.appendChild(b);
    });
    var dots = $$('button', dotsEl);
    function go(i) { var t = tiles[i]; car.scrollTo({ left: t.offsetLeft - (car.clientWidth - t.offsetWidth) / 2, behavior: 'smooth' }); }
    function mark() {
      var mid = car.scrollLeft + car.clientWidth / 2, best = 0, bd = 1e9;
      tiles.forEach(function (t, i) { var d = Math.abs(t.offsetLeft + t.offsetWidth / 2 - mid); if (d < bd) { bd = d; best = i; } });
      active = best; dots.forEach(function (d, i) { d.classList.toggle('on', i === best); d.setAttribute('aria-selected', i === best); });
    }
    car.addEventListener('scroll', function () { mark(); }, { passive: true });
    ['pointerdown', 'wheel', 'touchstart'].forEach(function (ev) { car.addEventListener(ev, function () { idle = Date.now(); }, { passive: true }); });
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        var v = $('video', e.target);
        if (e.isIntersecting && e.intersectionRatio > 0.55 && inView && !paused) { v.preload = 'auto'; var pr = v.play(); if (pr) pr.catch(function () {}); } else v.pause();
      });
    }, { root: car, threshold: [0, 0.55, 1] });
    ScrollTrigger.create({ trigger: '#c7', start: 'top 80%', end: 'bottom 20%', onToggle: function (self) {
      inView = self.isActive; tiles.forEach(function (t) { io.unobserve(t); if (inView) io.observe(t); else $('video', t).pause(); });
    } });
    setInterval(function () { if (inView && !paused && Date.now() - idle > 8000 && !document.hidden) go((active + 1) % tiles.length); }, 7000);
    mark();
  })();

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

    // 빈 카드 → 신청 폼으로 펼쳐진다
    function open() {
      if (card.classList.contains('open')) return;
      card.classList.add('open');
      gsap.fromTo(more, { height: 0, opacity: 0 }, { height: 'auto', opacity: 1, duration: 0.9, ease: 'expo.out', clearProps: 'height' });
      // 시작·끝 값을 둘 다 적고 끝나면 인라인 스타일을 지운다(버튼이 opacity 0에 멈춰 남던 문제)
      gsap.fromTo($$('.more > *', form), { y: 14, opacity: 0 }, { y: 0, opacity: 1, duration: 0.8, ease: 'expo.out', stagger: 0.04, delay: 0.1, clearProps: 'transform,opacity,translate,rotate,scale' });
    }
    gsap.from(form, { scale: 0.9, y: 40, opacity: 0, duration: 1.1, ease: 'expo.out', scrollTrigger: { trigger: card, start: 'top 85%' } });
    ScrollTrigger.create({ trigger: card, start: 'top 62%', once: true, onEnter: function () { setTimeout(open, 250); } });
    email.addEventListener('focus', open);

    $$('.chips', form).forEach(function (g) {
      g.addEventListener('click', function (e) {
        var b = e.target.closest('button'); if (!b) return;
        var was = b.classList.contains('on'); $$('button', g).forEach(function (x) { x.classList.remove('on'); x.setAttribute('aria-pressed', 'false'); });
        if (!was) { b.classList.add('on'); b.setAttribute('aria-pressed', 'true'); }
      });
    });
    var chip = function (name) { var b = $('.chips[data-name="' + name + '"] .on', form); return b ? b.textContent : ''; };

    form.addEventListener('submit', function (e) {
      e.preventDefault(); open(); msg.textContent = '';
      var em = email.value.trim();
      if (!/^[^\s@<>()]+@[^\s@<>()]+\.[a-z]{2,}$/i.test(em)) { msg.textContent = '이메일 주소를 확인해 주세요.'; email.focus(); return; }
      if (!form.agree.checked) { msg.textContent = '개인정보 수집·이용에 동의해 주세요.'; return; }
      var body = { email: em, name: form.elements.namedItem('name').value.trim(), role: chip('role'), use: chip('use'), agree: true, marketing: form.marketing.checked, website: form.website.value, source: src || 'direct' };
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
        .then(function () { clearTimeout(timer); btn.disabled = false; btn.textContent = '무료로 시작하기'; });
    });
    function done(r) {
      $('#sentH').textContent = r.again ? '이미 신청하셨어요.' : '메일함을 확인해 주세요.';
      $('#sentP').textContent = !r.ready ? '첫 사용자분들께 차례로 열어 드리고 있어요. 준비되면 이 주소로 내 시트 만들기 링크를 바로 보내 드릴게요.'
        : r.again ? '메일함에서 ‘내 시트 만들기 링크’ 메일을 찾아 버튼을 누르세요. 스팸함도 확인해 주세요.'
        : '방금 보낸 메일의 ‘내 시트 만들기’ 버튼을 누르면 5분 안에 시작할 수 있어요.';
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
