const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');
const fxCanvas = document.getElementById('fx');
const fctx = fxCanvas.getContext('2d');
const toastEl = document.getElementById('toast');

let displayInfo = null;
let origin = { x: 0, y: 0 };
const points = [];

const settings = {
  enabled: true,
  active: true,          // 이 화면에 효과를 보일지 (화면마다 켜기)
  glow: '170,140,255',
  core: '255,255,255',
  maxLife: 60,
  thick: 1.0,            // 굵기 배율: 얇게 1.0 / 보통 1.8 / 굵게 3.0
  halo: 'off',           // off | soft | strong
  haloPulse: false,
  shape: 'trail',        // trail | laser
  laserColor: 'red',
  outline: false,        // 밝은 바탕용 옅은 어두운 테두리
};

const MAX_POINTS  = 90;
const MIN_DIST_SQ = 9;       // 3px
const FRAME_MS    = 1000 / 60;
const BBOX_MARGIN = 24;
const STEPS       = 5;       // 테이퍼링 구간 수

// 브레이드를 이루는 3가닥 — 가운데 가닥이 가장 진하고 양옆은 살짝 흐리게.
const STRANDS = [
  { offset: -1.8, alphaMult: 0.40 },
  { offset:  0.0, alphaMult: 1.00 },
  { offset:  1.8, alphaMult: 0.40 },
];

// 빛나는 커서 — 교실 프로젝터에서 보고 조정할 시작 수치
const HALO = {
  soft:   { diameter: 48, alpha: 0.25 },
  strong: { diameter: 72, alpha: 0.40 },
};
// 움직이는 동안에는 빛을 아예 그리지 않음(꼬리만) — 멈추고 꼬리가 거의 사라진 뒤에야 천천히 나타남
const HALO_IDLE     = 0.35;   // 오래 멈춰 있을 때(화면 가림 방지)
const HALO_IDLE_MS  = 10000;
const MOVE_GRACE_MS = 120;    // 마지막 움직임 후 이 시간 지나면 '멈춤'
const HALO_DELAY_MS = 450;    // 멈춘 뒤 이만큼 기다렸다가(꼬리가 먼저 사라지게)
const HALO_RISE_MS  = 600;    // 이 시간에 걸쳐 부드럽게 나타남
const HALO_FALL_MS  = 120;    // 다시 움직이면 빠르게 사라짐
const HALO_DIM_MS   = 1500;   // 오래 멈춤 → 옅어지는 시간

const LASER = {
  red:   { color: '255,40,40',  core: '255,215,215' },
  green: { color: '40,240,90',  core: '215,255,225' },
};
const LASER_DIAMETER = 14;
const LASER_TAIL_MS  = 200;

const LOCATE_MS = 600;
const LOCATE_R0 = 260;

let cursor = null;          // 이 화면 기준 최신 커서 위치
let lastMoveT = -Infinity;
let haloLevel = 0;
const laserPts = [];
const locates = [];

function sizeCanvas(cv, cx, w, h, sf) {
  cv.width  = Math.floor(w * sf);
  cv.height = Math.floor(h * sf);
  cv.style.width  = w + 'px';
  cv.style.height = h + 'px';
  cx.setTransform(sf, 0, 0, sf, 0, 0);
}

function applyDisplayInfo() {
  const di = displayInfo;
  const w  = di ? di.width  : innerWidth;
  const h  = di ? di.height : innerHeight;
  const sf = di ? di.scaleFactor : (window.devicePixelRatio || 1);
  sizeCanvas(canvas, ctx, w, h, sf);
  sizeCanvas(fxCanvas, fctx, w, h, sf);
}

addEventListener('resize', applyDisplayInfo);
applyDisplayInfo();

function clearCanvas(cv, cx) {
  cx.save();
  cx.setTransform(1, 0, 0, 1, 0, 0);
  cx.clearRect(0, 0, cv.width, cv.height);
  cx.restore();
}

const trailOn = () => settings.enabled && settings.active && settings.shape === 'trail';
const laserOn = () => settings.enabled && settings.active && settings.shape === 'laser';

window.mt.onDisplayInfo(d => {
  displayInfo = d;
  origin = { x: d.originX, y: d.originY };
  applyDisplayInfo();
});

window.mt.onSettings(s => {
  Object.assign(settings, s);
  if (!trailOn()) { points.length = 0; clearCanvas(canvas, ctx); }
  if (!laserOn()) laserPts.length = 0;
});

window.mt.onCursor(pt => {
  const x = pt.x - origin.x;
  const y = pt.y - origin.y;
  const now = performance.now();
  if (cursor) lastMoveT = now;   // 첫 위치(시작 시 한 번)는 '움직임'으로 치지 않음
  cursor = { x, y };

  if (laserOn()) {
    laserPts.push({ x, y, t: now });
    if (laserPts.length > MAX_POINTS) laserPts.shift();
  }
  if (!trailOn()) return;
  const last = points[points.length - 1];
  if (last) {
    const dx = x - last.x, dy = y - last.y;
    if (dx * dx + dy * dy < MIN_DIST_SQ) return;
  }
  points.push({ x, y, t: now });
  if (points.length > MAX_POINTS) points.shift();
});

let toastTimer = null;
window.mt.onToast(text => {
  toastEl.textContent = text;
  toastEl.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 800);
});

window.mt.onLocate(({ pt, color }) => {
  locates.push({ x: pt.x - origin.x, y: pt.y - origin.y, t0: performance.now(), color });
});

function getCanvasDIP() {
  if (displayInfo) return { w: displayInfo.width, h: displayInfo.height };
  return { w: innerWidth, h: innerHeight };
}

function nearCanvas(x, y, margin) {
  const { w, h } = getCanvasDIP();
  return x > -margin && x < w + margin && y > -margin && y < h + margin;
}

function pointsOverlapCanvas() {
  for (let i = 0; i < points.length; i++) {
    if (nearCanvas(points[i].x, points[i].y, BBOX_MARGIN * settings.thick)) return true;
  }
  return false;
}

// 각 점에서 곡선의 접선에 수직인 단위 벡터(법선) 계산.
// 인접 점 사이 방향을 사용해 자연스러운 평행 가닥을 만든다.
function computeNormals() {
  const N = points.length;
  const out = new Array(N);
  for (let i = 0; i < N; i++) {
    const a = points[Math.max(0, i - 1)];
    const b = points[Math.min(N - 1, i + 1)];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    out[i] = { x: -dy / len, y: dx / len };
  }
  return out;
}

// 시간 기반 속도 (px/sec). 부드러운 그라디언트 효과를 위해 5점 윈도우로 평활화.
function computeSpeeds() {
  const N = points.length;
  const raw = new Array(N).fill(0);
  for (let i = 1; i < N; i++) {
    const dx = points[i].x - points[i - 1].x;
    const dy = points[i].y - points[i - 1].y;
    const dt = Math.max(1, points[i].t - points[i - 1].t);
    raw[i] = Math.hypot(dx, dy) / dt * 1000;
  }
  raw[0] = raw[1] || 0;
  const sm = new Array(N);
  for (let i = 0; i < N; i++) {
    let sum = 0, cnt = 0;
    for (let k = -2; k <= 2; k++) {
      const j = i + k;
      if (j >= 0 && j < N) { sum += raw[j]; cnt++; }
    }
    sm[i] = sum / cnt;
  }
  return sm;
}

// 속도 → 폭 배수 변환. 느릴수록 진하게(잉크 머무름), 빠를수록 얇게(휘둘림).
function speedToFactor(spd) {
  const SLOW = 150, FAST = 2200;
  const t = Math.min(1, Math.max(0, (spd - SLOW) / (FAST - SLOW)));
  return 1.15 - t * 0.85; // 1.15 → 0.30
}

function lerpRGB(c1, c2, t) {
  const a = c1.split(',');
  const b = c2.split(',');
  const r = +a[0] + (+b[0] - +a[0]) * t;
  const g = +a[1] + (+b[1] - +a[1]) * t;
  const bl = +a[2] + (+b[2] - +a[2]) * t;
  return Math.round(r) + ',' + Math.round(g) + ',' + Math.round(bl);
}

// 한 가닥의 점들을 perpendicular offset만큼 옆으로 밀어낸 위치로,
// STEPS개의 부분 경로로 분할해서 반환.
function buildStrand(normals, offset) {
  const N = points.length;
  if (N < 2) return null;

  const ox = new Array(N), oy = new Array(N);
  for (let i = 0; i < N; i++) {
    ox[i] = points[i].x + normals[i].x * offset;
    oy[i] = points[i].y + normals[i].y * offset;
  }

  const segs = new Array(STEPS).fill(null);
  const meta = new Array(STEPS).fill(null);

  for (let s = 0; s < STEPS; s++) {
    const a = Math.floor(((N - 1) * s) / STEPS);
    const b = Math.floor(((N - 1) * (s + 1)) / STEPS);
    if (b - a < 1) continue;
    const path = new Path2D();
    path.moveTo(ox[a], oy[a]);
    for (let i = a + 1; i < b; i++) {
      const mx = (ox[i] + ox[i + 1]) / 2;
      const my = (oy[i] + oy[i + 1]) / 2;
      path.quadraticCurveTo(ox[i], oy[i], mx, my);
    }
    path.lineTo(ox[b], oy[b]);
    segs[s] = path;
    meta[s] = { a, b };
  }
  return { segs, meta };
}

function avgSpeed(speeds, a, b) {
  let sum = 0, cnt = 0;
  for (let i = a; i <= b; i++) { sum += speeds[i]; cnt++; }
  return cnt ? sum / cnt : 0;
}

function drawTrail() {
  const N = points.length;
  if (N < 2) return;

  const m       = settings.thick;
  const normals = computeNormals();
  const speeds  = computeSpeeds();
  const strands = STRANDS.map(st => buildStrand(normals, st.offset * m));

  ctx.lineCap  = 'round';
  ctx.lineJoin = 'round';

  // 0) 밝은 바탕용 옅은 어두운 테두리 — 가운데 가닥 아래에 한 겹
  if (settings.outline && strands[1]) {
    const { segs, meta } = strands[1];
    ctx.shadowBlur = 0;
    for (let s = 0; s < STEPS; s++) {
      if (!segs[s]) continue;
      const t  = (s + 1) / STEPS;
      const vf = speedToFactor(avgSpeed(speeds, meta[s].a, meta[s].b));
      ctx.strokeStyle = 'rgba(0,0,0,' + (0.10 + t * 0.16) * vf + ')';
      ctx.lineWidth   = (0.40 + t * 1.10) * vf * m + 2.2 * m;
      ctx.stroke(segs[s]);
    }
  }

  // 1) 3가닥 브레이드 — 각 가닥마다 STEPS 단계 테이퍼링
  for (let st = 0; st < STRANDS.length; st++) {
    const strand = STRANDS[st];
    const built  = strands[st];
    if (!built) continue;
    const { segs, meta } = built;

    for (let s = 0; s < STEPS; s++) {
      if (!segs[s]) continue;
      const t    = (s + 1) / STEPS;                         // 0.2 → 1.0
      const vf   = speedToFactor(avgSpeed(speeds, meta[s].a, meta[s].b));
      const w    = (0.40 + t * 1.10) * vf * m;              // 얇게 0.4 → 1.5 px (중앙)
      const a    = (0.18 + t * 0.75) * strand.alphaMult * vf;
      // 꼬리 끝은 설정된 컬러, 헤드는 흰색에 가깝게 (혜성 그라디언트)
      const color = lerpRGB(settings.glow, settings.core, t * t);

      ctx.shadowBlur  = 3.5 * m;
      ctx.shadowColor = 'rgba(' + color + ',0.7)';
      ctx.strokeStyle = 'rgba(' + color + ',' + a + ')';
      ctx.lineWidth   = w;
      ctx.stroke(segs[s]);
    }
  }

  // 2) 헤드 스파크 — 커서 끝의 작은 빛점. 느릴 때만 살짝 크게(잉크가 고이는 느낌).
  const head      = points[N - 1];
  const headSpd   = speeds[N - 1];
  const sparkSize = (0.9 + Math.max(0, 1 - headSpd / 1200) * 1.6) * m;
  ctx.shadowBlur  = 6 * m;
  ctx.shadowColor = 'rgba(' + settings.core + ',1)';
  ctx.fillStyle   = 'rgba(' + settings.core + ',0.92)';
  ctx.beginPath();
  ctx.arc(head.x, head.y, sparkSize, 0, Math.PI * 2);
  ctx.fill();

  ctx.shadowBlur = 0;
}

// ── 빛나는 커서 (A7) ─────────────────────────────────────────
// 움직일 때는 옅게, 멈추면 0.3초에 걸쳐 살아나고, 10초 넘게 그대로면 다시 옅어짐.
function drawHalo(now, dt) {
  const cfg = HALO[settings.halo];
  const since = now - lastMoveT;
  let target = 0;
  if (cfg && trailOn() && cursor) {
    target = since < HALO_DELAY_MS ? 0 : since > HALO_IDLE_MS ? HALO_IDLE : 1;
  }
  const ms = target > haloLevel ? HALO_RISE_MS : target === HALO_IDLE ? HALO_DIM_MS : HALO_FALL_MS;
  const step = dt / ms;
  haloLevel = target > haloLevel ? Math.min(target, haloLevel + step) : Math.max(target, haloLevel - step);
  if (haloLevel < 0.01 || !cfg || !cursor) return false;

  const r = cfg.diameter / 2;
  if (!nearCanvas(cursor.x, cursor.y, r)) return false;

  const eased = haloLevel * haloLevel * (3 - 2 * haloLevel);   // 처음과 끝이 부드럽게
  let a = cfg.alpha * eased;
  if (settings.haloPulse && since >= MOVE_GRACE_MS) {
    a *= 0.85 + 0.15 * Math.sin((now / 2400) * Math.PI * 2);   // 은은한 맥박(선택 시에만)
  }
  const g = fctx.createRadialGradient(cursor.x, cursor.y, 0, cursor.x, cursor.y, r);
  g.addColorStop(0,    'rgba(' + settings.glow + ',' + a + ')');
  g.addColorStop(0.45, 'rgba(' + settings.glow + ',' + a * 0.55 + ')');
  g.addColorStop(1,    'rgba(' + settings.glow + ',0)');
  fctx.fillStyle = g;
  fctx.beginPath();
  fctx.arc(cursor.x, cursor.y, r, 0, Math.PI * 2);
  fctx.fill();

  if (settings.outline) {
    fctx.strokeStyle = 'rgba(0,0,0,' + 0.10 * eased + ')';
    fctx.lineWidth = 1.5;
    fctx.beginPath();
    fctx.arc(cursor.x, cursor.y, r * 0.8, 0, Math.PI * 2);
    fctx.stroke();
  }
  return true;
}

// ── 레이저 포인터 (B5) ───────────────────────────────────────
function drawLaser(now) {
  while (laserPts.length && now - laserPts[0].t > LASER_TAIL_MS) laserPts.shift();
  if (!cursor || !nearCanvas(cursor.x, cursor.y, LASER_DIAMETER * 4)) return false;
  const L = LASER[settings.laserColor] || LASER.red;
  const R = LASER_DIAMETER / 2;

  fctx.lineCap = 'round';
  for (let i = 1; i < laserPts.length; i++) {
    const p0 = laserPts[i - 1], p1 = laserPts[i];
    const k = 1 - (now - p1.t) / LASER_TAIL_MS;   // 1 → 0
    if (k <= 0) continue;
    fctx.strokeStyle = 'rgba(' + L.color + ',' + 0.55 * k + ')';
    fctx.lineWidth = LASER_DIAMETER * 0.75 * k;
    fctx.beginPath();
    fctx.moveTo(p0.x, p0.y);
    fctx.lineTo(p1.x, p1.y);
    fctx.stroke();
  }

  if (settings.outline) {
    fctx.fillStyle = 'rgba(0,0,0,0.22)';
    fctx.beginPath();
    fctx.arc(cursor.x, cursor.y, R + 1.5, 0, Math.PI * 2);
    fctx.fill();
  }
  fctx.shadowBlur  = 12;
  fctx.shadowColor = 'rgba(' + L.color + ',0.9)';
  fctx.fillStyle   = 'rgba(' + L.color + ',0.95)';
  fctx.beginPath();
  fctx.arc(cursor.x, cursor.y, R, 0, Math.PI * 2);
  fctx.fill();
  fctx.shadowBlur = 0;
  fctx.fillStyle  = 'rgba(' + L.core + ',0.9)';
  fctx.beginPath();
  fctx.arc(cursor.x, cursor.y, R * 0.35, 0, Math.PI * 2);
  fctx.fill();
  return true;
}

// ── 커서 찾기 (B3) — 바깥에서 커서로 모여드는 동심원 3개 ─────────
function drawLocates(now) {
  for (let i = locates.length - 1; i >= 0; i--) {
    if (now - locates[i].t0 > LOCATE_MS) locates.splice(i, 1);
  }
  for (const l of locates) {
    if (!nearCanvas(l.x, l.y, LOCATE_R0)) continue;
    const p = (now - l.t0) / LOCATE_MS;
    for (let k = 0; k < 3; k++) {
      const q = Math.min(1, Math.max(0, (p - k * 0.15) / 0.7));
      if (q <= 0 || q >= 1) continue;
      const ease = 1 - Math.pow(1 - q, 2);
      const r = 8 + (LOCATE_R0 - 8) * (1 - ease);
      const a = Math.sin(q * Math.PI);
      fctx.lineWidth = 6;
      fctx.strokeStyle = 'rgba(0,0,0,' + 0.22 * a + ')';
      fctx.beginPath(); fctx.arc(l.x, l.y, r, 0, Math.PI * 2); fctx.stroke();
      fctx.lineWidth = 3;
      fctx.strokeStyle = 'rgba(' + l.color + ',' + 0.95 * a + ')';
      fctx.beginPath(); fctx.arc(l.x, l.y, r, 0, Math.PI * 2); fctx.stroke();
    }
  }
}

let lastFrame = performance.now();
let trailIdleFrames = 0;
let fxDirty = false;

function loop() {
  const now = performance.now();
  const dt = Math.min(100, now - lastFrame);
  lastFrame = now;

  // 오래된 점 정리
  const cutoff = now - settings.maxLife * FRAME_MS;
  while (points.length && points[0].t < cutoff) points.shift();

  const drawNow = trailOn() && points.length >= 2 && pointsOverlapCanvas();

  // 잔상 페이드 — 그릴 것이 없고 화면이 다 지워진 뒤에는 건너뜀(배터리)
  if (drawNow || trailIdleFrames < 45) {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = 'rgba(0,0,0,0.26)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
    trailIdleFrames = drawNow ? 0 : trailIdleFrames + 1;
  }
  if (drawNow) drawTrail();

  // 효과 레이어 — 매 프레임 새로 그림
  if (fxDirty) { clearCanvas(fxCanvas, fctx); fxDirty = false; }
  if (drawHalo(now, dt)) fxDirty = true;
  if (laserOn() && drawLaser(now)) fxDirty = true;
  if (locates.length) { drawLocates(now); fxDirty = true; }

  requestAnimationFrame(loop);
}
loop();
