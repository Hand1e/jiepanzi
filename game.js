/* 顶住！别摔盘子 —— 接盘子叠高小游戏
 * 纯 Canvas 2D，无外部素材。按小红书小工具（离线 H5）规范实现：
 * 不用传感器、不联网、不用浏览器存储；持久化走 xhs.miniTool Storage。
 */
(function () {
  'use strict';

  // ================= 画布 =================
  var canvas, ctx, W, H, DPR, SAFE_T = 0, SAFE_B = 0;

  // 读安全区：模拟器注入 --safe-area-inset-*，真机用 env()
  function readSafeArea() {
    var probe = document.getElementById('safe-probe');
    if (!probe || !window.getComputedStyle) return;
    var cs = window.getComputedStyle(probe);
    SAFE_T = parseFloat(cs.paddingTop) || 0;
    SAFE_B = parseFloat(cs.paddingBottom) || 0;
  }

  function setupCanvas() {
    canvas = document.getElementById('game');
    var resize = function () {
      W = window.innerWidth; H = window.innerHeight;
      DPR = Math.min(window.devicePixelRatio || 1, 2.5);
      canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
      canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
      readSafeArea();
      layout();
    };
    window.addEventListener('resize', resize);
    resize();
    ctx = canvas.getContext('2d');
  }

  // ================= 存储：xhs.miniTool Storage（9.46+），不可用时只存在内存里 =================
  var STORE_KEYS = ['plate_best', 'plate_total'];
  var mem = {};
  function miniTool() { return window.xhs && window.xhs.miniTool; }
  function store(k, v) {
    if (v === undefined) return mem.hasOwnProperty(k) ? mem[k] : null;
    mem[k] = v;
    var mt = miniTool();
    if (mt && typeof mt.setStorage === 'function') {
      try {
        var p = mt.setStorage({ key: k, data: JSON.stringify(v) });
        if (p && p.catch) p.catch(function () {});
      } catch (e) {}
    }
  }
  // 启动后异步读回上次的记录，读到后刷新相关变量
  function loadStore(done) {
    var mt = miniTool();
    if (!mt || typeof mt.getStorage !== 'function') return;
    STORE_KEYS.forEach(function (k) {
      try {
        var p = mt.getStorage({ key: k });
        if (!p || !p.then) return;
        p.then(function (res) {
          if (!res || typeof res.data !== 'string' || mem.hasOwnProperty(k)) return;
          try { mem[k] = JSON.parse(res.data); } catch (e) { return; }
          done(k);
        }).catch(function () {});
      } catch (e) {}
    });
  }
  function vibrate(long) {
    try { if (navigator.vibrate) navigator.vibrate(long ? 300 : 25); } catch (e) {}
  }

  // ================= 声音（合成，无素材） =================
  var actx = null;
  function initAudio() {
    if (actx) return;
    try {
      if (typeof AudioContext !== 'undefined') actx = new AudioContext();
      else if (typeof webkitAudioContext !== 'undefined') actx = new webkitAudioContext();
      if (actx && actx.resume) actx.resume();
    } catch (e) { actx = null; }
  }
  function tone(freq, dur, type, vol, slide) {
    if (!actx) return;
    try {
      var t = actx.currentTime, o = actx.createOscillator(), g = actx.createGain();
      o.type = type || 'sine';
      o.frequency.setValueAtTime(freq, t);
      if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
      g.gain.setValueAtTime(vol || 0.2, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g); g.connect(actx.destination);
      o.start(t); o.stop(t + dur);
    } catch (e) {}
  }
  function noise(dur, vol, hp) {
    if (!actx) return;
    try {
      var t = actx.currentTime, n = Math.floor(actx.sampleRate * dur);
      var buf = actx.createBuffer(1, n, actx.sampleRate), d = buf.getChannelData(0);
      for (var i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 2);
      var s = actx.createBufferSource(); s.buffer = buf;
      var f = actx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = hp || 1500;
      var g = actx.createGain(); g.gain.value = vol || 0.4;
      s.connect(f); f.connect(g); g.connect(actx.destination); s.start(t);
    } catch (e) {}
  }
  var sfx = {
    catch: function (perfect) { tone(perfect ? 1760 : 1320, 0.25, 'sine', 0.18); tone(perfect ? 2640 : 1980, 0.18, 'sine', 0.08); },
    whoosh: function () { noise(0.25, 0.08, 600); },
    shatter: function () { noise(0.5, 0.5, 1800); tone(3000, 0.15, 'triangle', 0.08, 1200); tone(2200, 0.2, 'triangle', 0.06, 900); },
    boss: function () { tone(140, 0.5, 'sawtooth', 0.12, 90); tone(110, 0.6, 'square', 0.06, 70); },
    warn: function () { tone(520, 0.08, 'square', 0.05); }
  };

  // ================= 输入 =================
  // 按住屏幕任意位置左右拖：手跟着手指的位移走（相对拖动，手指不会挡住盘子）
  var input = { touching: false, touchX: 0, anchor: null, keys: 0 };
  var DRAG_GAIN = 1.35;

  function setupInput() {
    canvas.addEventListener('pointerdown', function (e) {
      input.touching = true; input.touchX = e.clientX; input.anchor = null;
      onTap(e.clientX, e.clientY);
    });
    window.addEventListener('pointermove', function (e) { if (input.touching) input.touchX = e.clientX; });
    var up = function () { input.touching = false; input.anchor = null; };
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    window.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowLeft' || e.key === 'a') input.keys = -1;
      if (e.key === 'ArrowRight' || e.key === 'd') input.keys = 1;
      if (e.key === ' ' || e.key === 'Enter') { if (G.state === 'title') startGame(); else onTap(W / 2, H / 2); }
    });
    window.addEventListener('keyup', function (e) {
      if ((e.key === 'ArrowLeft' || e.key === 'a') && input.keys < 0) input.keys = 0;
      if ((e.key === 'ArrowRight' || e.key === 'd') && input.keys > 0) input.keys = 0;
    });
  }

  // ================= 常量 & 布局 =================
  var PW, PH, HAND_SY, FLOOR;
  function layout() {
    PW = Math.min(W * 0.30, 130);
    PH = PW * 0.11;
    HAND_SY = H * 0.74;
    FLOOR = H * 0.22;
  }

  var PLATE_STYLES = [
    { rim: '#2f6fb3', inner: '#cfe0f3', name: '青花盘' },
    { rim: '#c0392b', inner: '#f6d6cf', name: '红边盘' },
    { rim: '#d4a017', inner: '#f8ecc4', name: '金边盘' },
    { rim: '#2e8b57', inner: '#d3eedd', name: '青瓷盘' },
    { rim: '#8e44ad', inner: '#ead8f2', name: '紫边盘' }
  ];

  // ================= 游戏状态 =================
  var G = {};
  var best = parseInt(store('plate_best') || '0', 10) || 0;

  function resetGame() {
    G = {
      state: 'title',
      t: 0,
      hx: 0, hv: 0, ha: 0, prevHx: 0, prevHv: 0,
      theta: 0, omega: 0, lean: 0, beta: 0, betaV: 0,
      topX: 0, topY: 0, topA: 0, wrist: 0, wristV: 0, pending: [],
      stack: [],
      flying: [], debris: [], shards: [], popups: [],
      lives: 3, broken: 0, caught: 0, perfect: 0,
      spawnT: 1.2,
      s: 1, camShift: 0,
      shake: 0, warnT: 0,
      collapseT: 0, bossT: 0, bossLine: '', reason: ''
    };
  }

  function startGame() {
    initAudio();
    resetGame();
    G.state = 'play';
  }

  // ================= 物理参数 =================
  var GFALL = 1150;             // 统一重力：飞盘、碎片、盘叠都用它
  var MU_S = 0.5, MU_K = 0.38;  // 盘与盘之间的静/动摩擦（盘沿嵌套，比较涩）
  var HAND_COUPLE = 0.35;       // 手部加速度传到盘叠的比例（游戏性折中）
  var N_CROSS = 13;             // 叠到大约这么多以后，光靠脑袋顶不住，要移动去扶
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  // ================= 坐标 / 盘叠形状 =================
  function rangeWorld() { return (W * 0.5 - PW * 0.6 * G.s) / G.s; }

  // 每个盘子的世界角度 = 底部整体倾角 theta + 弯曲 beta（越往上越大）
  function computeShape() {
    var n = G.stack.length, x = G.hx, y = 0, under = palmAngle();
    for (var i = 0; i < n; i++) {
      var p = G.stack[i];
      var a = G.theta + G.beta * ((i + 1) / n);
      var cu = Math.cos(under), su = Math.sin(under);
      x += p.rel * cu; y += p.rel * su;           // 沿下面那层表面的偏移
      var c = Math.cos(a), sn = Math.sin(a);
      p.a = a; p.under = under;
      p.cx = x + PH * 0.5 * sn; p.cy = y - PH * 0.5 * c;
      x += PH * sn; y -= PH * c;
      under = a;
    }
    G.topX = x; G.topY = y; G.topA = under;
  }
  function palmAngle() { return G.theta * 0.3 + G.wrist; }
  function toTopLocal(wx, wy) {
    var dx = wx - G.topX, dy = wy - G.topY, c = Math.cos(G.topA), sn = Math.sin(G.topA);
    return { x: dx * c + dy * sn, y: -dx * sn + dy * c };
  }
  function viewBounds() {
    var s = G.s;
    return {
      l: -(W / 2) / s, r: (W / 2) / s,
      t: -(HAND_SY + G.camShift) / s, b: (H - HAND_SY - G.camShift) / s
    };
  }

  // ================= 发射盘子 =================
  var SIDE_NAMES = ['左边', '右边', '上面', '左下角', '右下角'];
  // 先在边缘预告约半秒，再真正扔出来
  function planSpawn() {
    var vb = viewBounds(), m = 40 / G.s, span = vb.b - vb.t, ty = G.topY;
    var side = Math.floor(Math.random() * 5), x0, y0;
    if (side === 0) { x0 = vb.l - m; y0 = ty - Math.random() * span * 0.3; }
    else if (side === 1) { x0 = vb.r + m; y0 = ty - Math.random() * span * 0.3; }
    else if (side === 2) { x0 = vb.l + PW * 0.6 + Math.random() * (vb.r - vb.l - PW * 1.2); y0 = vb.t - PW * 0.3; }
    else if (side === 3) { x0 = vb.l - m; y0 = Math.min(FLOOR, vb.b) - 10; }
    else { x0 = vb.r + m; y0 = Math.min(FLOOR, vb.b) - 10; }
    G.pending.push({ side: side, x0: x0, y0: y0, t: 0.55 });
  }

  function launch(pd) {
    var n = G.stack.length, r = rangeWorld();
    var tx = clamp(G.hx + (Math.random() * 2 - 1) * PW * (0.6 + Math.min(n, 20) * 0.04), -r, r);
    var ty = G.topY, x0 = pd.x0, y0 = pd.y0, T, vy;
    if (pd.side === 2) {
      // 从顶上落：几乎是松手掉下来，不再先往上抛出屏幕
      var vy0 = 40, d = Math.max(10, ty - y0);
      T = (-vy0 + Math.sqrt(vy0 * vy0 + 2 * GFALL * d)) / GFALL;
      vy = vy0;
    } else {
      T = Math.max(0.85, 1.4 - n * 0.015) + Math.random() * 0.3;
      T = Math.max(T, Math.sqrt(2.6 * Math.max(0, y0 - ty) / GFALL));
      vy = (ty - y0 - 0.5 * GFALL * T * T) / T;
    }
    G.flying.push({
      x: x0, y: y0, vx: (tx - x0) / T, vy: vy,
      rot: Math.random() * 6, vr: (Math.random() < 0.5 ? -1 : 1) * (pd.side === 2 ? 2 + Math.random() * 3 : 6 + Math.random() * 8),
      style: PLATE_STYLES[Math.floor(Math.random() * PLATE_STYLES.length)],
      side: SIDE_NAMES[pd.side],
      prevLy: toTopLocal(x0, y0).y, alive: true
    });
    sfx.whoosh();
  }

  function updatePending(dt) {
    for (var i = 0; i < G.pending.length; i++) {
      var pd = G.pending[i];
      pd.t -= dt;
      if (pd.t <= 0) { launch(pd); pd.done = true; }
    }
    G.pending = G.pending.filter(function (p) { return !p.done; });
  }

  // ================= 更新 =================
  function updateHand(dt) {
    var r = rangeWorld();
    var target = G.hx;
    var dragging = input.touching && G.state === 'play';
    if (dragging) {
      if (!input.anchor) input.anchor = { x: input.touchX, hx: G.hx };
      target = input.anchor.hx + (input.touchX - input.anchor.x) * DRAG_GAIN / G.s;
    } else if (input.keys) {
      target = G.hx + input.keys * 900 * dt / G.s;
    }
    var tc = clamp(target, -r, r);
    // 拖到边以后往回拖要立刻响应：把锚点挪到边上
    if (dragging && tc !== target) input.anchor.hx = tc - (input.touchX - input.anchor.x) * DRAG_GAIN / G.s;
    target = tc;
    G.prevHx = G.hx;
    G.hx += (target - G.hx) * Math.min(1, dt * 18);
    var v = (G.hx - G.prevHx) / dt;
    var a = (v - G.hv) / dt;
    G.hv = v;
    G.ha += (clamp(a, -2500, 2500) - G.ha) * Math.min(1, dt * 15);
    // 手腕：手往右加速时手掌会稍微往左压（惯性滞后），带一点回弹
    var wT = clamp(-G.ha * 0.00005, -0.12, 0.12);
    G.wristV += ((wT - G.wrist) * 160 - G.wristV * 14) * dt;
    G.wrist += G.wristV * dt;
  }

  function updateStack(dt) {
    var n = G.stack.length;
    if (!n) { G.theta = G.omega = G.beta = G.betaV = G.lean = 0; computeShape(); return; }
    var steps = 4, h = dt / steps;
    var Kg = GFALL * PH * N_CROSS * N_CROSS / 2;   // 手掌能提供的扶正力矩（每弧度）
    for (var k = 0; k < steps; k++) {
      computeShape();
      // 绕手掌的刚体：重力力矩 + 手加速度的惯性力矩 + 手的扶正
      var sx = 0, sh = 0, I = 0;
      for (var i = 0; i < n; i++) {
        var p = G.stack[i], rx = p.cx - G.hx, ry = -p.cy;
        sx += rx; sh += ry; I += rx * rx + ry * ry;
      }
      I += n * PW * PW / 16;
      var stiff = Math.max(Kg - GFALL * sh, Kg * 0.08);
      var damp = 2 * 0.3 * Math.sqrt(stiff * I);
      var torque = GFALL * sx - HAND_COUPLE * G.ha * sh * Math.cos(G.theta) - Kg * G.theta - damp * G.omega;
      G.omega += torque / I * h;
      G.theta += G.omega * h;
      // 弯曲：高叠像软塔，手一动顶部滞后甩动
      var wb = 18 / (1 + n * 0.07);
      G.betaV += (-wb * wb * G.beta - 2 * 0.16 * wb * G.betaV - G.ha * HAND_COUPLE * 0.006 * Math.min(1, n / 6)) * h;
      G.beta = clamp(G.beta + G.betaV * h, -0.4, 0.4);
      if (slidePlates(h)) return;
    }
    computeShape();
    G.lean = G.theta + G.beta * 0.5;
    if (Math.abs(G.theta) > 0.6) {
      collapse('lean');
    } else if (Math.abs(G.lean) > 0.28) {
      G.warnT += dt;
      if (G.warnT > 0.35) { G.warnT = 0; sfx.warn(); }
    }
  }

  // 摩擦滑动：盘面太斜或手猛地一动，上面的盘子会滑；滑出边就掉
  function slidePlates(h) {
    var n = G.stack.length;
    for (var i = 0; i < n; i++) {
      var p = G.stack[i], a = p.under;
      var lat = GFALL * Math.sin(a) - HAND_COUPLE * G.ha * Math.cos(a);
      var nor = GFALL * Math.cos(a);
      if (p.sv === 0) {
        if (Math.abs(lat) > MU_S * nor) p.sv = 1e-6 * Math.sign(lat);
      }
      if (p.sv !== 0) {
        var dir = Math.sign(p.sv);
        var nv = p.sv + (lat - dir * MU_K * nor) * h;
        if (Math.sign(nv) !== dir && Math.abs(lat) <= MU_S * nor) nv = 0;
        p.sv = nv;
        p.rel += p.sv * h;
      }
      var edge = i === 0 ? PW * 0.6 : PW * 0.5;
      if (Math.abs(p.rel) > edge) { slideOff(i); return true; }
    }
    return false;
  }

  function plateToDebris(p, extraVx) {
    var rx = p.cx - G.hx, ry = p.cy;
    return {
      x: p.cx, y: p.cy,
      vx: G.hv - G.omega * ry + (p.sv || 0) + (extraVx || 0),
      vy: G.omega * rx,
      rot: p.a, vr: G.omega * 0.8 + (Math.random() - 0.5) * 3 + Math.sign(p.sv || G.omega) * 2,
      style: p.style
    };
  }

  function slideOff(i) {
    computeShape();
    if (i === 0) { collapse('lean'); return; }
    var cnt = G.stack.length - i;
    for (var k = i; k < G.stack.length; k++) G.debris.push(plateToDebris(G.stack[k], (Math.random() - 0.5) * 40));
    G.stack.length = i;
    G.lives--;
    G.shake = 8;
    vibrate(true);
    popup(cnt > 1 ? '上面' + cnt + '个滑下去了！' : '最上面那个滑掉了！', W / 2, H * 0.32, '#ff7b6b', 22);
    if (G.lives <= 0) collapse('miss');
  }

  function updateFlying(dt) {
    for (var i = 0; i < G.flying.length; i++) {
      var p = G.flying[i];
      if (!p.alive) continue;
      p.vy += GFALL * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.rot += p.vr * dt;
      if (G.state === 'play') {
        var loc = toTopLocal(p.x, p.y);
        if (p.prevLy < 0 && loc.y >= 0 && p.vy > 0) {
          var tol = G.stack.length ? PW * 0.4 : PW * 0.45;
          if (Math.abs(loc.x) < tol) { land(p, loc.x); continue; }
        }
        p.prevLy = loc.y;
      }
      if (p.y >= FLOOR - 4) {
        p.alive = false;
        shatter(p.x, FLOOR, p.style);
        if (G.state === 'play') { G.lastMiss = p; miss(); }
      }
    }
    G.flying = G.flying.filter(function (p) { return p.alive; });
  }

  function land(p, lx) {
    p.alive = false;
    var n = G.stack.length;
    var c = Math.cos(G.topA), sn = Math.sin(G.topA);
    var vAlong = p.vx * c + p.vy * sn;                  // 沿盘面的速度 → 落上去会滑一小段
    var hTop = -G.topY, rxTop = G.topX - G.hx;
    G.stack.push({ rel: lx, style: p.style, sv: clamp(vAlong * 0.22, -140, 140) || 0, bounce: -PH * 0.9, bv: 0 });
    G.caught++;
    var perfect = Math.abs(lx) < PW * 0.08;
    // 角动量冲击：砸在越高的地方，叠子晃得越厉害（一部分被手掌吸收）
    var I = 0; computeShape();
    for (var i = 0; i < G.stack.length; i++) { var q = G.stack[i], rx = q.cx - G.hx; I += rx * rx + q.cy * q.cy; }
    I += G.stack.length * PW * PW / 16;
    G.omega += 0.45 * (p.vx * hTop + p.vy * rxTop) / I;
    G.betaV += p.vx * 0.0012 / (1 + n * 0.05);
    if (perfect) { G.perfect++; G.stack[n].sv = 0; }
    sfx.catch(perfect);
    vibrate(false);
    var tp = toScreen({ x: G.topX, y: G.topY });
    popup(perfect ? '完美！' : '+1', tp.x, tp.y - 10, perfect ? '#ffd54a' : '#ffffff', perfect ? 26 : 20);
    if (G.stack.length > best) { best = G.stack.length; store('plate_best', String(best)); }
  }

  function miss() {
    G.lives--;
    G.shake = 10;
    vibrate(true);
    var msgs = ['老板瞪了你一眼…', '“啪！”又碎一个', '老板在记账了…'];
    popup(msgs[Math.min(2, 3 - G.lives - 1)] || msgs[0], W / 2, H * 0.32, '#ff7b6b', 22);
    if (G.lives <= 0) collapse('miss');
  }

  function collapse(reason) {
    if (G.state !== 'play') return;
    G.state = 'collapse';
    G.reason = reason;
    computeShape();
    G.topStyle = G.stack.length ? G.stack[G.stack.length - 1].style : null;
    G.tipDir = (G.lean || G.theta) > 0 ? '右' : '左';
    G.collapseT = 0;
    // 倒下时保持当前的转动，越往上甩得越远；再给一点继续倒的趋势
    var dir = Math.sign(G.theta || G.lean || (Math.random() - 0.5));
    G.omega += dir * 1.2;
    for (var i = 0; i < G.stack.length; i++) G.debris.push(plateToDebris(G.stack[i], dir * Math.random() * 30));
    G.stack = [];
    G.theta = G.omega = G.beta = G.betaV = 0;
    vibrate(true);
  }

  function shatter(x, y, style) {
    G.broken++;
    G.shake = Math.min(18, G.shake + 7);
    sfx.shatter();
    var cnt = 10 + Math.floor(Math.random() * 6);
    for (var i = 0; i < cnt; i++) {
      var a = -Math.PI * Math.random();
      var sp = 120 + Math.random() * 340;
      G.shards.push({
        x: x + (Math.random() - 0.5) * PW * 0.5, y: y - 3,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.9,
        rot: Math.random() * 6, vr: (Math.random() - 0.5) * 20,
        sz: 4 + Math.random() * 9,
        color: Math.random() < 0.35 ? style.rim : (Math.random() < 0.5 ? '#ffffff' : style.inner),
        life: 3 + Math.random()
      });
    }
    if (G.shards.length > 500) G.shards.splice(0, G.shards.length - 500);
  }

  function updateDebris(dt) {
    for (var i = 0; i < G.debris.length; i++) {
      var d = G.debris[i];
      d.vy += GFALL * dt;
      d.x += d.vx * dt; d.y += d.vy * dt; d.rot += d.vr * dt;
      if (d.y >= FLOOR - 4) { d.dead = true; shatter(d.x, FLOOR, d.style); }
    }
    G.debris = G.debris.filter(function (d) { return !d.dead; });
    for (var j = 0; j < G.shards.length; j++) {
      var s = G.shards[j];
      s.vy += GFALL * dt;
      s.x += s.vx * dt; s.y += s.vy * dt; s.rot += s.vr * dt;
      if (s.y > FLOOR) { s.y = FLOOR; s.vy *= -0.28; s.vx *= 0.55; s.vr *= 0.5; }
      if (G.state === 'play') s.life -= dt;
    }
    G.shards = G.shards.filter(function (s) { return s.life > 0; });
    // 落盘回弹
    for (var k = 0; k < G.stack.length; k++) {
      var p = G.stack[k];
      if (p.bounce) {
        p.bv += (-900 * p.bounce - 30 * p.bv) * dt;
        p.bounce += p.bv * dt;
        if (Math.abs(p.bounce) < 0.05 && Math.abs(p.bv) < 1) p.bounce = 0;
      }
    }
  }

  function updateCamera(dt) {
    var topH = -G.topY + PW * 0.9;
    var avail = HAND_SY - 120;
    var sT = Math.max(0.38, Math.min(1, avail / (topH + 40)));
    G.s += (sT - G.s) * Math.min(1, dt * 3);
    var shiftT = Math.max(0, (topH + 40) * G.s - avail);
    G.camShift += (shiftT - G.camShift) * Math.min(1, dt * 3);
  }

  function update(dt) {
    G.t += dt;
    G.shake *= Math.pow(0.02, dt);
    for (var i = 0; i < G.popups.length; i++) G.popups[i].t += dt;
    G.popups = G.popups.filter(function (p) { return p.t < 1.1; });

    if (G.state === 'title') { G.hx = Math.sin(G.t * 1.3) * W * 0.12; return; }

    if (G.state === 'play') {
      updateHand(dt);
      updateStack(dt);
      updatePending(dt);
      G.spawnT -= dt;
      if (G.spawnT <= 0) {
        var n = G.stack.length;
        planSpawn();
        if (n >= 12 && Math.random() < Math.min(0.35, (n - 10) * 0.02)) planSpawn();
        G.spawnT = Math.max(0.75, 2.0 - n * 0.045) + Math.random() * 0.4;
      }
    }
    updateFlying(dt);
    updateDebris(dt);
    updateCamera(dt);

    if (G.state === 'collapse') {
      G.collapseT += dt;
      if (!G.debris.length && G.collapseT > 1.1) {
        G.state = 'boss'; G.bossT = 0; career.fails++; career.total += G.broken; store('plate_total', String(career.total));
        G.isRecord = G.caught >= best && G.caught > career.prevBest; G.bossLine = pickBossLine(); career.prevBest = best; sfx.boss(); vibrate(true);
      }
    }
    if (G.state === 'boss') G.bossT += dt;
  }

  // ================= 老板台词 =================
  var career = { fails: 0, total: parseInt(store('plate_total') || '0', 10) || 0, prevBest: best, recent: [] };

  function pick(arr) {
    // 避开最近说过的话
    var fresh = arr.filter(function (x) { return career.recent.indexOf(x) < 0; });
    var c = (fresh.length ? fresh : arr)[Math.floor(Math.random() * (fresh.length || arr.length))];
    career.recent.push(c); if (career.recent.length > 30) career.recent.shift();
    return c;
  }

  function pickBossLine() {
    var n = G.caught, b = G.broken, money = b * 28, f = career.fails;
    var plate = G.topStyle ? G.topStyle.name : '盘子';
    var hour = new Date().getHours();
    var open = [], body = [], close = [];

    // —— 开场：针对刚才发生的事 ——
    if (G.reason === 'miss') {
      var side = G.lastMiss && G.lastMiss.side;
      open.push(
        side ? '刚才那个是从' + side + '飞过来的，你脑袋往哪儿伸呢？' : '眼睁睁看着它掉地上？',
        '一个都接不住，三个全掉地上了！',
        '你看着盘子飞过来，脖子就跟焊死了一样。',
        '盘子是往你头上扔的，不是往地上扔的！'
      );
    } else if (n <= 2) {
      open.push(
        '我茶刚泡上，你这边就碎了？',
        '才' + n + '个！' + n + '个你都扶不住？',
        '我转个身的工夫，又是一地碎片。',
        '新来的洗碗阿姨都比你稳。'
      );
    } else if (n < 10) {
      open.push(
        '往' + G.tipDir + '歪的时候你就该往' + G.tipDir + '挪，我在后面喊半天了！',
        '叠了' + n + '个，稀里哗啦全没了。',
        '刚叠稳一点你就开始晃，晃什么晃？',
        '你听听这声音，' + b + '个，一个不剩。'
      );
    } else {
      open.push(
        '叠到' + n + '个了还逞能，就不知道先放下来？',
        '那么高一摞你还在那儿晃，我心都提到嗓子眼了！',
        '你是叠盘子还是盖楼呢？' + n + '个一起砸下来！',
        '最上面那个是' + plate + '！最贵的那批！'
      );
    }
    open.push(
      '谁教你拿脑袋顶盘子的？！杂技团招人你去啊！',
      '用头顶？你当这是马戏团呢？',
      '你脖子歪成那样，盘子能不倒吗？'
    );
    if (G.isRecord && n >= 5) open.push('叠了' + n + '个，比上回多，那又怎样？最后还不是全碎了。');
    if (f >= 3) open.push('这已经是今天第' + f + '回了。', '第' + f + '次了！我都不想数了。');

    // —— 中段：现实后果 ——
    body.push(
      '一个盘子进价二十八，你自己算算，' + b + '个就是' + money + '块。',
      plate === '盘子' ? '这批盘子从景德镇订的，补货要等一个礼拜。' : '这' + plate + '是景德镇订的，补货要等一个礼拜。',
      '碎片掉你头上扎破了算谁的？工伤我可不认！',
      '扣钱是小事，碎片崩到客人脚边怎么办？出了事谁负责？',
      '监控我全看着呢，别跟我说是盘子自己倒的。',
      '上个月刚给你涨了两百，你就这么报答我？',
      '隔壁老李家的小伙子，脑袋上能顶二十个。',
      '你干活能不能用点心？脖子稳一点，眼睛看着点！'
    );
    if (hour >= 10 && hour < 14) body.push('马上中午饭点了，外面坐满了，你让我拿什么装菜？');
    else if (hour >= 16 && hour < 21) body.push('晚上包间订了三桌，盘子都不够了你知道吗？');
    else body.push('明天早上还要接一个寿宴，你让我上哪儿借盘子去？');
    if (career.total > 40) body.push('你来了以后，店里已经碎了' + career.total + '个盘子了。');

    // —— 收尾：吩咐 / 威胁 ——
    close.push(
      '碎片自己扫干净，戴手套，别扎着手。',
      '下班前写个情况说明发我微信。',
      '这个月全勤奖没了。',
      '再摔一回，你自己去网上下单补上。',
      '别愣着！又来活了，接着叠！',
      '今天员工餐你别吃了……算了，吃吧，吃饱了脖子才稳。',
      '去后面跟王师傅学学怎么顶盘子。',
      '我不想再听到那个声音了，听见没有？'
    );

    var parts = [pick(open)];
    var r = Math.random();
    if (r < 0.45) parts.push(pick(body), pick(close));
    else if (r < 0.75) parts.push(pick(body));
    else parts.push(pick(close));
    return parts.join('');
  }

  // ================= 交互 =================
  var buttons = [];
  function onTap(x, y) {
    initAudio();
    if (G.state === 'title' || (G.state === 'boss' && G.bossT > 1.0)) {
      for (var i = 0; i < buttons.length; i++) {
        var b = buttons[i];
        if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) { b.fn(); return; }
      }
    }
  }

  function popup(text, x, y, color, size) {
    G.popups.push({ text: text, x: x, y: y, color: color, size: size || 20, t: 0 });
  }

  // ================= 绘制工具 =================
  function toScreen(w) {
    return { x: W / 2 + w.x * G.s, y: HAND_SY + G.camShift + w.y * G.s };
  }
  function rr(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function ellipse(x, y, rx, ry) {
    ctx.beginPath();
    if (ctx.ellipse) ctx.ellipse(x, y, Math.max(0.0001, rx), Math.max(0.0001, ry), 0, 0, Math.PI * 2);
    else { ctx.save(); ctx.translate(x, y); ctx.scale(rx, ry); ctx.arc(0, 0, 1, 0, Math.PI * 2); ctx.restore(); }
  }
  function text(str, x, y, size, color, align, weight, stroke) {
    ctx.font = (weight || 'bold') + ' ' + size + 'px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.textAlign = align || 'center';
    ctx.textBaseline = 'middle';
    if (stroke) { ctx.lineWidth = Math.max(3, size / 6); ctx.strokeStyle = stroke; ctx.lineJoin = 'round'; ctx.strokeText(str, x, y); }
    ctx.fillStyle = color;
    ctx.fillText(str, x, y);
  }
  function wrap(str, maxW, size) {
    ctx.font = 'bold ' + size + 'px "PingFang SC","Microsoft YaHei",sans-serif';
    var lines = [], line = '';
    for (var i = 0; i < str.length; i++) {
      var test = line + str[i];
      if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = str[i]; }
      else line = test;
    }
    if (line) lines.push(line);
    return lines;
  }

  // 侧视盘子（中心 0,0，宽 w）
  function drawPlate(w, style, flat) {
    var rx = w / 2, ry = w * (flat ? 0.13 : 0.16);
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ellipse(0, ry * 0.55, rx * 0.98, ry * 0.9); ctx.fill();
    ctx.fillStyle = '#d9dde3';
    ellipse(0, ry * 0.35, rx, ry); ctx.fill();
    ctx.fillStyle = '#ffffff';
    ellipse(0, 0, rx, ry); ctx.fill();
    ctx.strokeStyle = style.rim; ctx.lineWidth = Math.max(1.5, w * 0.035);
    ellipse(0, 0, rx * 0.9, ry * 0.85); ctx.stroke();
    ctx.fillStyle = style.inner;
    ellipse(0, ry * 0.05, rx * 0.55, ry * 0.5); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ellipse(-rx * 0.35, -ry * 0.35, rx * 0.18, ry * 0.18); ctx.fill();
  }

  function drawBackground() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#f3e3c3'); g.addColorStop(1, '#e2c99c');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    // 墙砖
    var tile = 46;
    ctx.strokeStyle = 'rgba(160,120,70,0.18)'; ctx.lineWidth = 1;
    for (var y = 0; y < H; y += tile) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
    for (var x = 0; x < W; x += tile) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    // 挂灯
    for (var i = 0; i < 2; i++) {
      var lx = W * (0.25 + i * 0.5);
      ctx.strokeStyle = '#6b4a2b'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(lx, 0); ctx.lineTo(lx, 40); ctx.stroke();
      ctx.fillStyle = '#c0392b';
      ctx.beginPath(); ctx.moveTo(lx - 18, 58); ctx.lineTo(lx + 18, 58); ctx.lineTo(lx + 10, 40); ctx.lineTo(lx - 10, 40); ctx.closePath(); ctx.fill();
      var lg = ctx.createRadialGradient(lx, 60, 2, lx, 60, 90);
      lg.addColorStop(0, 'rgba(255,240,180,0.55)'); lg.addColorStop(1, 'rgba(255,240,180,0)');
      ctx.fillStyle = lg; ctx.fillRect(lx - 90, 40, 180, 120);
    }
    // 招牌
    rr(W / 2 - 70, 70, 140, 34, 6); ctx.fillStyle = '#7a1f1f'; ctx.fill();
    text('老 王 饭 庄', W / 2, 87, 18, '#ffd54a');
  }

  function worldTransform() {
    var sx = (Math.random() - 0.5) * G.shake, sy = (Math.random() - 0.5) * G.shake;
    ctx.setTransform(DPR * G.s, 0, 0, DPR * G.s, DPR * (W / 2 + sx), DPR * (HAND_SY + G.camShift + sy));
  }

  function drawFloor() {
    var vb = viewBounds();
    ctx.fillStyle = '#8b5a2b';
    ctx.fillRect(vb.l - 50, FLOOR, vb.r - vb.l + 100, Math.max(400, vb.b - FLOOR + 50));
    ctx.fillStyle = '#a0693a';
    for (var x = Math.floor(vb.l / 60) * 60; x < vb.r; x += 60) ctx.fillRect(x, FLOOR, 2, 900);
    ctx.fillStyle = 'rgba(0,0,0,0.15)'; ctx.fillRect(vb.l - 50, FLOOR, vb.r - vb.l + 100, 6);
  }

  // —— 头顶盘子：服务员张着胳膊保持平衡，眼睛盯着飞来的盘子 ——
  function drawHead() {
    var u = PW, hx = G.hx, pa = palmAngle(), vb = viewBounds();
    var lean = G.state === 'play' ? G.lean : 0;
    var NECK = 0.8;
    var nx = hx - Math.sin(pa) * NECK * u, ny = Math.cos(pa) * NECK * u;
    // 身体（不跟着头转）
    ctx.save(); ctx.translate(nx, ny); ctx.scale(u, u);
    var bot = (Math.max(vb.b, FLOOR) - ny) / u + 0.5;
    // 胳膊：往两边张开，盘子往哪边歪，另一边的手就往下压
    var k = clamp(lean, -0.5, 0.5) * 1.2, wob = Math.sin(G.t * 5) * 0.03;
    for (var side = -1; side <= 1; side += 2) {
      var sh = [side * 0.42, 0.18], el = [side * 0.78, 0.34 + side * k * 0.3], hd = [side * 1.0, 0.0 + side * k + wob * side];
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.strokeStyle = '#f4f4ee'; ctx.lineWidth = 0.2;
      ctx.beginPath(); ctx.moveTo(sh[0], sh[1]); ctx.lineTo(el[0], el[1]); ctx.stroke();
      ctx.strokeStyle = '#e8b78d'; ctx.lineWidth = 0.13;
      ctx.beginPath(); ctx.moveTo(el[0], el[1]); ctx.lineTo(hd[0], hd[1]); ctx.stroke();
      ctx.strokeStyle = '#e6e6de'; ctx.lineWidth = 0.17;      // 卷起的袖口
      ctx.beginPath(); ctx.moveTo(el[0] - side * 0.02, el[1] + 0.01); ctx.lineTo(el[0] + (hd[0] - el[0]) * 0.12, el[1] + (hd[1] - el[1]) * 0.12); ctx.stroke();
      ctx.fillStyle = '#efc19a';
      ellipse(hd[0] + side * 0.03, hd[1] - 0.03, 0.08, 0.1); ctx.fill();   // 张开的手
      ctx.strokeStyle = '#efc19a'; ctx.lineWidth = 0.035;
      for (var f = 0; f < 4; f++) {
        var fa = -1.2 + f * 0.38, ang = side > 0 ? fa : Math.PI - fa;
        ctx.beginPath(); ctx.moveTo(hd[0] + side * 0.03, hd[1] - 0.03);
        ctx.lineTo(hd[0] + side * 0.03 + Math.cos(ang) * 0.13, hd[1] - 0.03 + Math.sin(ang) * 0.13); ctx.stroke();
      }
    }
    // 衬衫 + 黑马甲
    ctx.fillStyle = '#f7f7f2';
    ctx.beginPath(); ctx.moveTo(-0.12, -0.02); ctx.lineTo(0.12, -0.02);
    ctx.quadraticCurveTo(0.45, 0.06, 0.5, 0.25); ctx.lineTo(0.55, bot); ctx.lineTo(-0.55, bot); ctx.lineTo(-0.5, 0.25);
    ctx.quadraticCurveTo(-0.45, 0.06, -0.12, -0.02); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#26262b';
    ctx.beginPath(); ctx.moveTo(-0.3, 0.1); ctx.lineTo(-0.07, 0.45); ctx.lineTo(0, 0.62); ctx.lineTo(0.07, 0.45); ctx.lineTo(0.3, 0.1);
    ctx.lineTo(0.42, 0.24); ctx.lineTo(0.47, bot); ctx.lineTo(-0.47, bot); ctx.lineTo(-0.42, 0.24); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#d4af37';
    for (var bt = 0; bt < 3; bt++) { ellipse(0.045, 0.72 + bt * 0.17, 0.018, 0.018); ctx.fill(); }
    // 脖子 + 领结
    ctx.fillStyle = '#e3ad82';
    rr(-0.09, -0.12, 0.18, 0.16, 0.05); ctx.fill();
    ctx.fillStyle = '#c0392b';
    ctx.beginPath(); ctx.moveTo(0, 0.05); ctx.lineTo(-0.11, -0.01); ctx.lineTo(-0.11, 0.11); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(0, 0.05); ctx.lineTo(0.11, -0.01); ctx.lineTo(0.11, 0.11); ctx.closePath(); ctx.fill();
    ellipse(0, 0.05, 0.03, 0.03); ctx.fill();
    ctx.restore();

    // 头（跟着盘底一起歪）
    ctx.save(); ctx.translate(hx, 0); ctx.rotate(pa); ctx.scale(u, u);
    var hc = 0.43;
    ctx.fillStyle = '#efc19a';
    ellipse(-0.3, hc + 0.02, 0.05, 0.07); ctx.fill();
    ellipse(0.3, hc + 0.02, 0.05, 0.07); ctx.fill();
    var fg = ctx.createRadialGradient(-0.06, hc - 0.05, 0.05, 0, hc, 0.36);
    fg.addColorStop(0, '#f8d5b0'); fg.addColorStop(1, '#e3a97c');
    ctx.fillStyle = fg;
    ellipse(0, hc, 0.29, 0.33); ctx.fill();
    // 头发
    ctx.fillStyle = '#2a1d17';
    ctx.beginPath(); ctx.ellipse(0, hc - 0.01, 0.305, 0.345, 0, Math.PI, Math.PI * 2);
    ctx.quadraticCurveTo(0.2, hc - 0.18, 0.02, hc - 0.13);
    ctx.quadraticCurveTo(-0.16, hc - 0.1, -0.305, hc - 0.01);
    ctx.closePath(); ctx.fill();
    // 垫在头顶的红白毛巾圈
    ctx.lineWidth = 0.075; ctx.strokeStyle = '#c0392b';
    ellipse(0, 0.1, 0.24, 0.055); ctx.stroke();
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 0.075; ctx.setLineDash([0.05, 0.07]);
    ellipse(0, 0.1, 0.24, 0.055); ctx.stroke();
    ctx.setLineDash([]);
    // 眼睛：盯着最近的飞盘
    var tx = 0, ty = -1, bd = 1e9;
    for (var i = 0; i < G.flying.length; i++) {
      var p = G.flying[i], ddx = p.x - hx, ddy = p.y - hc * u, d2 = ddx * ddx + ddy * ddy;
      if (d2 < bd) { bd = d2; tx = ddx; ty = ddy; }
    }
    var cl = Math.cos(-pa), sl = Math.sin(-pa), lx2 = tx * cl - ty * sl, ly2 = tx * sl + ty * cl;
    var ll = Math.sqrt(lx2 * lx2 + ly2 * ly2) || 1;
    var px = lx2 / ll * 0.022, py = ly2 / ll * 0.018;
    var worry = Math.min(1, Math.abs(lean) * 4);
    for (var e = -1; e <= 1; e += 2) {
      var ex2 = e * 0.11, ey2 = hc + 0.01;
      ctx.fillStyle = '#ffffff'; ellipse(ex2, ey2, 0.055, 0.045 + worry * 0.012); ctx.fill();
      ctx.fillStyle = '#2a1d17'; ellipse(ex2 + px, ey2 + py, 0.026, 0.026); ctx.fill();
      ctx.fillStyle = '#ffffff'; ellipse(ex2 + px - 0.008, ey2 + py - 0.009, 0.007, 0.007); ctx.fill();
      // 皱着的眉毛（内侧往上挑）
      ctx.strokeStyle = '#2a1d17'; ctx.lineWidth = 0.022; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(e * 0.17, ey2 - 0.075); ctx.lineTo(e * 0.06, ey2 - 0.085 - 0.02 - worry * 0.03); ctx.stroke();
    }
    // 腮红、鼻子
    ctx.fillStyle = 'rgba(230,110,90,0.25)';
    ellipse(-0.18, hc + 0.12, 0.05, 0.03); ctx.fill(); ellipse(0.18, hc + 0.12, 0.05, 0.03); ctx.fill();
    ctx.strokeStyle = 'rgba(150,85,50,0.6)'; ctx.lineWidth = 0.014;
    ctx.beginPath(); ctx.moveTo(0, hc + 0.05); ctx.quadraticCurveTo(0.03, hc + 0.1, -0.005, hc + 0.11); ctx.stroke();
    // 嘴：越歪越紧张
    ctx.strokeStyle = '#7a2e22'; ctx.lineWidth = 0.018;
    if (Math.abs(lean) > 0.2) {
      ctx.fillStyle = '#7a2e22'; ellipse(0, hc + 0.19, 0.035, 0.045); ctx.fill();
    } else if (Math.abs(lean) > 0.08) {
      ctx.beginPath(); ctx.moveTo(-0.07, hc + 0.19);
      ctx.quadraticCurveTo(-0.035, hc + 0.17, 0, hc + 0.19); ctx.quadraticCurveTo(0.035, hc + 0.21, 0.07, hc + 0.19); ctx.stroke();
    } else {
      ctx.beginPath(); ctx.moveTo(-0.06, hc + 0.18); ctx.quadraticCurveTo(0, hc + 0.22, 0.06, hc + 0.18); ctx.stroke();
    }
    // 冒汗
    if (Math.abs(lean) > 0.2) {
      for (var sw = 0; sw < 2; sw++) {
        var ph = (G.t * 1.4 + sw * 0.5) % 1, sx = (sw ? -1 : 1) * (0.27 + sw * 0.02), sy = hc - 0.12 + ph * 0.25;
        ctx.globalAlpha = 1 - ph;
        ctx.fillStyle = '#7fc8f8';
        ctx.beginPath(); ctx.moveTo(sx, sy - 0.05); ctx.quadraticCurveTo(sx + 0.03, sy, sx, sy + 0.02); ctx.quadraticCurveTo(sx - 0.03, sy, sx, sy - 0.05); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  function drawStack() {
    for (var i = 0; i < G.stack.length; i++) {
      var pl = G.stack[i];
      ctx.save(); ctx.translate(pl.cx, pl.cy); ctx.rotate(pl.a);
      if (pl.bounce) ctx.translate(0, pl.bounce);
      drawPlate(PW, pl.style, true);
      ctx.restore();
    }
  }

  function drawFlying() {
    for (var i = 0; i < G.flying.length; i++) {
      var p = G.flying[i];
      // 落点阴影提示
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(Math.sin(p.rot) * 0.6);
      ctx.scale(1, 0.55 + 0.45 * Math.abs(Math.cos(p.rot * 0.5)));
      drawPlate(PW, p.style, false);
      ctx.restore();
    }
    for (var j = 0; j < G.debris.length; j++) {
      var d = G.debris[j];
      ctx.save(); ctx.translate(d.x, d.y); ctx.rotate(d.rot);
      drawPlate(PW, d.style, true);
      ctx.restore();
    }
  }

  function drawShards() {
    for (var i = 0; i < G.shards.length; i++) {
      var s = G.shards[i];
      ctx.save(); ctx.translate(s.x, s.y); ctx.rotate(s.rot);
      ctx.globalAlpha = Math.min(1, s.life);
      ctx.fillStyle = s.color;
      ctx.beginPath(); ctx.moveTo(-s.sz, 0); ctx.lineTo(s.sz * 0.6, -s.sz * 0.5); ctx.lineTo(s.sz * 0.3, s.sz * 0.6); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.15)'; ctx.lineWidth = 0.8; ctx.stroke();
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  function drawEdgeWarnings() {
    // 屏幕外盘子的方向提示
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    if (G.state === 'play') for (var q = 0; q < G.pending.length; q++) {
      var pd = G.pending[q], ps = toScreen({ x: pd.x0, y: pd.y0 });
      var px = clamp(ps.x, 22, W - 22), py = clamp(ps.y, 120 + SAFE_T, H - 22 - SAFE_B);
      var ang = pd.side === 0 ? 0 : pd.side === 1 ? Math.PI : pd.side === 2 ? Math.PI / 2 : pd.side === 3 ? -Math.PI / 4 : -Math.PI * 3 / 4;
      var al = 0.55 + 0.45 * Math.sin(G.t * 22);
      ctx.save(); ctx.translate(px, py); ctx.rotate(ang);
      ctx.fillStyle = 'rgba(230,60,40,' + al + ')';
      ctx.beginPath(); ctx.moveTo(16, 0); ctx.lineTo(-6, -12); ctx.lineTo(-1, 0); ctx.lineTo(-6, 12); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
    for (var i = 0; i < G.flying.length; i++) {
      var sp = toScreen(G.flying[i]);
      if (sp.x > 0 && sp.x < W && sp.y > 0 && sp.y < H) continue;
      var x = Math.max(16, Math.min(W - 16, sp.x)), y = Math.max(110 + SAFE_T, Math.min(H - 16 - SAFE_B, sp.y));
      ctx.fillStyle = 'rgba(220,40,40,' + (0.6 + 0.4 * Math.sin(G.t * 20)) + ')';
      ctx.beginPath(); ctx.arc(x, y, 10, 0, Math.PI * 2); ctx.fill();
      text('!', x, y + 1, 14, '#fff');
    }
  }

  function drawHUD() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    var top = 18 + SAFE_T;
    rr(14, top, 120, 50, 12); ctx.fillStyle = 'rgba(60,30,10,0.75)'; ctx.fill();
    text('已叠', 36, top + 25, 14, '#f3d9a4');
    text(String(G.stack.length), 90, top + 25, 28, '#ffffff');
    rr(W - 134, top, 120, 50, 12); ctx.fillStyle = 'rgba(60,30,10,0.75)'; ctx.fill();
    text('最高 ' + best, W - 74, top + 16, 14, '#ffd54a');
    // 生命（小盘子）
    for (var i = 0; i < 3; i++) {
      ctx.save(); ctx.translate(W - 110 + i * 34, top + 36);
      ctx.globalAlpha = i < G.lives ? 1 : 0.25;
      drawPlate(26, PLATE_STYLES[0], true);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    if (G.state === 'play' && G.t < 4) {
      text('按住屏幕任意位置，左右拖动', W / 2, H - 28 - SAFE_B, 15, '#5a3a1a', 'center', 'bold');
    }
    // 摇晃警告
    if (G.state === 'play' && Math.abs(G.lean) > 0.32) {
      var a = 0.25 + 0.2 * Math.sin(G.t * 18);
      var vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.7);
      vg.addColorStop(0, 'rgba(255,0,0,0)'); vg.addColorStop(1, 'rgba(255,0,0,' + a + ')');
      ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
      text(G.lean > 0 ? '往右倒了！快往右挪！' : '往左倒了！快往左挪！', W / 2, 100, 20, '#fff', 'center', 'bold', '#b3261e');
    }
    // 弹字
    for (var j = 0; j < G.popups.length; j++) {
      var p = G.popups[j];
      ctx.globalAlpha = Math.max(0, 1 - p.t / 1.1);
      text(p.text, p.x, p.y - p.t * 40, p.size, p.color, 'center', 'bold', 'rgba(60,30,10,0.85)');
    }
    ctx.globalAlpha = 1;
  }

  function drawTitle() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.fillStyle = 'rgba(40,20,5,0.55)'; ctx.fillRect(0, 0, W, H);
    var cy = H * 0.24;
    text('顶住！', W / 2, cy, 46, '#ffd54a', 'center', 'bold', '#7a1f1f');
    text('别摔盘子', W / 2, cy + 56, 46, '#ffffff', 'center', 'bold', '#7a1f1f');
    var lines = [
      '👆 按住屏幕左右拖动，用头去接',
      '🍽️ 盘子从四面八方飞过来，接住叠高',
      '⚖️ 叠得越高越晃，往歪的那边挪一挪',
      '💥 倒了全碎……老板就在你身后'
    ];
    for (var i = 0; i < lines.length; i++) text(lines[i], W / 2, cy + 130 + i * 32, 16, '#fff3dc', 'center', 'normal');
    var bw = 200, bh = 56, bx = W / 2 - bw / 2, by = H * 0.5 + 120;
    var pulse = 1 + Math.sin(G.t * 4) * 0.04;
    ctx.save(); ctx.translate(W / 2, by + bh / 2); ctx.scale(pulse, pulse);
    rr(-bw / 2, -bh / 2, bw, bh, 28); ctx.fillStyle = '#e74c3c'; ctx.fill();
    text('开始上班', 0, 1, 24, '#fff');
    ctx.restore();
    buttons.push({ x: bx, y: by, w: bw, h: bh, fn: startGame });
    if (best) text('最高纪录：' + best + ' 个', W / 2, by + bh + 28, 15, '#ffd54a');
  }

  function drawBoss() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    var t = G.bossT;
    ctx.fillStyle = 'rgba(20,0,0,' + Math.min(0.6, t * 1.2) + ')'; ctx.fillRect(0, 0, W, H);

    var rise = Math.min(1, t / 0.45);
    rise = 1 - Math.pow(1 - rise, 3);
    var S = Math.min(W * 0.75, 300);
    var bx = W / 2 + Math.sin(t * 40) * (t < 1.5 ? 3 : 1);
    var byFinal = Math.min(H - 190 - 0.62 * S, H * 0.55);
    var by = H + 20 - rise * (H + 20 - byFinal); // 头顶位置

    // 身体
    ctx.fillStyle = '#2c2f3a';
    ctx.beginPath();
    ctx.moveTo(bx - S * 0.55, H + 20); ctx.lineTo(bx - S * 0.42, by + S * 0.62);
    ctx.quadraticCurveTo(bx, by + S * 0.52, bx + S * 0.42, by + S * 0.62);
    ctx.lineTo(bx + S * 0.55, H + 20); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.moveTo(bx - S * 0.13, by + S * 0.57); ctx.lineTo(bx + S * 0.13, by + S * 0.57); ctx.lineTo(bx, by + S * 0.95); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#c0392b';
    ctx.beginPath(); ctx.moveTo(bx - S * 0.04, by + S * 0.6); ctx.lineTo(bx + S * 0.04, by + S * 0.6); ctx.lineTo(bx + S * 0.06, by + S * 0.9); ctx.lineTo(bx, by + S * 0.98); ctx.lineTo(bx - S * 0.06, by + S * 0.9); ctx.closePath(); ctx.fill();
    // 指着你的手
    var shake = Math.sin(t * 30) * 4;
    ctx.strokeStyle = '#2c2f3a'; ctx.lineWidth = S * 0.12; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(bx + S * 0.4, by + S * 0.75); ctx.lineTo(bx + S * 0.52, by + S * 0.38 + shake); ctx.stroke();
    ctx.fillStyle = '#f0b98a';  // 挥舞的拳头
    ellipse(bx + S * 0.53, by + S * 0.32 + shake, S * 0.075, S * 0.07); ctx.fill();
    ctx.strokeStyle = '#d99a6c'; ctx.lineWidth = 2;
    for (var f = 0; f < 3; f++) { ctx.beginPath(); ctx.moveTo(bx + S * (0.47 + f * 0.04), by + S * 0.28 + shake); ctx.lineTo(bx + S * (0.47 + f * 0.04), by + S * 0.33 + shake); ctx.stroke(); }
    // 头
    var hr = S * 0.3, hy = by + S * 0.3;
    ctx.fillStyle = '#f0b98a';
    ellipse(bx, hy, hr, hr * 1.05); ctx.fill();
    ellipse(bx - hr, hy + hr * 0.1, hr * 0.15, hr * 0.22); ctx.fill();
    ellipse(bx + hr, hy + hr * 0.1, hr * 0.15, hr * 0.22); ctx.fill();
    // 怒红
    var red = Math.min(0.55, t * 0.5);
    ctx.fillStyle = 'rgba(230,40,30,' + red + ')';
    ellipse(bx, hy - hr * 0.2, hr * 0.95, hr * 0.75); ctx.fill();
    // 头发（两侧，地中海）
    ctx.fillStyle = '#3b2a20';
    ellipse(bx - hr * 0.85, hy - hr * 0.15, hr * 0.22, hr * 0.38); ctx.fill();
    ellipse(bx + hr * 0.85, hy - hr * 0.15, hr * 0.22, hr * 0.38); ctx.fill();
    // 头顶反光
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ellipse(bx - hr * 0.3, hy - hr * 0.78, hr * 0.22, hr * 0.08); ctx.fill();
    // 眉毛（怒）
    ctx.strokeStyle = '#2a1a10'; ctx.lineWidth = hr * 0.11; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(bx - hr * 0.62, hy - hr * 0.42); ctx.lineTo(bx - hr * 0.12, hy - hr * 0.22); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(bx + hr * 0.62, hy - hr * 0.42); ctx.lineTo(bx + hr * 0.12, hy - hr * 0.22); ctx.stroke();
    // 眼镜
    ctx.strokeStyle = '#111'; ctx.lineWidth = hr * 0.05;
    rr(bx - hr * 0.62, hy - hr * 0.18, hr * 0.46, hr * 0.32, hr * 0.08); ctx.stroke();
    rr(bx + hr * 0.16, hy - hr * 0.18, hr * 0.46, hr * 0.32, hr * 0.08); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(bx - hr * 0.16, hy - hr * 0.05); ctx.lineTo(bx + hr * 0.16, hy - hr * 0.05); ctx.stroke();
    ctx.fillStyle = '#111';
    ellipse(bx - hr * 0.36, hy - hr * 0.0, hr * 0.06, hr * 0.06); ctx.fill();
    ellipse(bx + hr * 0.36, hy - hr * 0.0, hr * 0.06, hr * 0.06); ctx.fill();
    // 胡子
    ctx.fillStyle = '#3b2a20';
    ellipse(bx - hr * 0.18, hy + hr * 0.32, hr * 0.2, hr * 0.07); ctx.fill();
    ellipse(bx + hr * 0.18, hy + hr * 0.32, hr * 0.2, hr * 0.07); ctx.fill();
    // 张嘴吼
    var mo = 0.16 + 0.08 * Math.abs(Math.sin(t * 14));
    ctx.fillStyle = '#7a1010';
    ellipse(bx, hy + hr * 0.58, hr * 0.3, hr * mo); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillRect(bx - hr * 0.2, hy + hr * (0.58 - mo) + 1, hr * 0.4, hr * 0.06);
    // 怒气符号
    drawAnger(bx + hr * 0.75, hy - hr * 0.85, hr * 0.28 * (1 + 0.15 * Math.sin(t * 12)));
    // 头顶冒烟
    for (var k = 0; k < 3; k++) {
      var st = (t * 0.8 + k / 3) % 1;
      ctx.fillStyle = 'rgba(255,255,255,' + (0.5 * (1 - st)) + ')';
      ellipse(bx - hr * 0.5 + k * hr * 0.5, hy - hr * 1.1 - st * 60, 10 + st * 16, 10 + st * 16); ctx.fill();
    }

    // 对话框
    if (t > 0.4) {
      var bubW = Math.min(W - 32, 360), pad = 16, fs = 19;
      var lines = wrap(G.bossLine, bubW - pad * 2, fs);
      var shown = Math.min(G.bossLine.length, Math.floor((t - 0.4) * 28));
      var bubH = lines.length * (fs + 8) + pad * 2;
      var bubX = W / 2 - bubW / 2, bubY = Math.max(16, by - bubH - 28);
      rr(bubX, bubY, bubW, bubH, 14); ctx.fillStyle = '#fff'; ctx.fill();
      ctx.lineWidth = 3; ctx.strokeStyle = '#b3261e'; ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.moveTo(W / 2 - 12, bubY + bubH - 1); ctx.lineTo(W / 2 + 12, bubY + bubH - 1); ctx.lineTo(W / 2 - 4, bubY + bubH + 20); ctx.closePath(); ctx.fill();
      var c = 0;
      for (var i = 0; i < lines.length; i++) {
        var seg = lines[i].substr(0, Math.max(0, shown - c)); c += lines[i].length;
        text(seg, bubX + pad, bubY + pad + fs / 2 + i * (fs + 8), fs, '#b3261e', 'left');
      }
    }

    // 结算 & 按钮
    buttons = [];
    if (t > 1.0) {
      var a = Math.min(1, (t - 1.0) * 3);
      ctx.globalAlpha = a;
      var py = H - 170;
      rr(20, py, W - 40, 150, 16); ctx.fillStyle = 'rgba(255,248,235,0.96)'; ctx.fill();
      var maxStack = G.caught;
      text('最高叠了 ' + maxStack + ' 个   摔碎 ' + G.broken + ' 个', W / 2, py + 26, 17, '#5a3a1a');
      text('赔偿 ¥' + (G.broken * 28) + '（从工资扣）', W / 2, py + 52, 15, '#b3261e', 'center', 'normal');
      var bw = (W - 80) / 2, bh = 48, by2 = py + 82;
      rr(30, by2, bw, bh, 24); ctx.fillStyle = '#e74c3c'; ctx.fill();
      text('再来一次', 30 + bw / 2, by2 + bh / 2 + 1, 18, '#fff');
      rr(50 + bw, by2, bw, bh, 24); ctx.fillStyle = '#8d6e63'; ctx.fill();
      text('回到首页', 50 + bw + bw / 2, by2 + bh / 2 + 1, 18, '#fff');
      ctx.globalAlpha = 1;
      buttons.push({ x: 30, y: by2, w: bw, h: bh, fn: startGame });
      buttons.push({ x: 50 + bw, y: by2, w: bw, h: bh, fn: function () { resetGame(); } });
    }
  }

  function drawAnger(x, y, r) {
    ctx.save(); ctx.translate(x, y);
    ctx.strokeStyle = '#e53935'; ctx.lineWidth = r * 0.35; ctx.lineCap = 'round';
    for (var i = 0; i < 4; i++) {
      ctx.save(); ctx.rotate(i * Math.PI / 2);
      ctx.beginPath(); ctx.moveTo(r * 0.25, -r); ctx.quadraticCurveTo(r * 0.25, -r * 0.25, r, -r * 0.25); ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  }

  function render() {
    buttons = [];
    drawBackground();
    worldTransform();
    drawFloor();
    drawShards();
    drawHead();
    if (G.state !== 'collapse' && G.state !== 'boss') { drawStack(); }
    drawFlying();
    drawEdgeWarnings();
    if (G.state === 'title') drawTitle();
    else drawHUD();
    if (G.state === 'boss') drawBoss();
  }

  // ================= 主循环 =================
  var last = 0, running = true, rafId = 0;
  function frame(ts) {
    if (!running) return;
    var now = ts || Date.now();
    var dt = last ? (now - last) / 1000 : 0.016;
    last = now;
    dt = Math.min(dt, 1 / 30);
    update(dt);
    render();
    rafId = requestAnimationFrame(frame);
  }
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      running = false; cancelAnimationFrame(rafId);
      input.touching = false; input.anchor = null;
      if (actx && actx.suspend) { try { actx.suspend(); } catch (e) {} }
    } else if (!running) {
      running = true; last = 0;
      if (actx && actx.resume) { try { actx.resume(); } catch (e) {} }
      rafId = requestAnimationFrame(frame);
    }
  });

  setupCanvas();
  layout();
  resetGame();
  setupInput();
  loadStore(function (k) {
    if (k === 'plate_best') { best = Math.max(best, parseInt(mem[k], 10) || 0); career.prevBest = best; }
    else if (k === 'plate_total') { career.total = Math.max(career.total, parseInt(mem[k], 10) || 0); }
  });
  rafId = requestAnimationFrame(frame);
  var boot = document.getElementById('boot');
  if (boot) boot.parentNode.removeChild(boot);
})();
