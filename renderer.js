const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');

let displayInfo = null;
let origin = { x: 0, y: 0 };
const points = [];

const settings = {
  enabled: true,
  glow: '170,140,255',
  core: '255,255,255',
  maxLife: 60,
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

function applyDisplayInfo() {
  const di = displayInfo;
  if (!di) {
    const dpr = window.devicePixelRatio || 1;
    canvas.width  = Math.floor(innerWidth  * dpr);
    canvas.height = Math.floor(innerHeight * dpr);
    canvas.style.width  = innerWidth  + 'px';
    canvas.style.height = innerHeight + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return;
  }
  canvas.width  = Math.floor(di.width  * di.scaleFactor);
  canvas.height = Math.floor(di.height * di.scaleFactor);
  canvas.style.width  = di.width  + 'px';
  canvas.style.height = di.height + 'px';
  ctx.setTransform(di.scaleFactor, 0, 0, di.scaleFactor, 0, 0);
}

addEventListener('resize', applyDisplayInfo);
applyDisplayInfo();

window.mt.onDisplayInfo(d => {
  displayInfo = d;
  origin = { x: d.originX, y: d.originY };
  applyDisplayInfo();
});

window.mt.onSettings(s => {
  Object.assign(settings, s);
  if (!settings.enabled) points.length = 0;
});

window.mt.onCursor(pt => {
  if (!settings.enabled) return;
  const x = pt.x - origin.x;
  const y = pt.y - origin.y;
  const last = points[points.length - 1];
  if (last) {
    const dx = x - last.x, dy = y - last.y;
    if (dx * dx + dy * dy < MIN_DIST_SQ) return;
  }
  points.push({ x, y, t: performance.now() });
  if (points.length > MAX_POINTS) points.shift();
});

function getCanvasDIP() {
  if (displayInfo) return { w: displayInfo.width, h: displayInfo.height };
  return { w: innerWidth, h: innerHeight };
}

function pointsOverlapCanvas() {
  const { w, h } = getCanvasDIP();
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (p.x > -BBOX_MARGIN && p.x < w + BBOX_MARGIN &&
        p.y > -BBOX_MARGIN && p.y < h + BBOX_MARGIN) {
      return true;
    }
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

  const normals = computeNormals();
  const speeds  = computeSpeeds();

  ctx.lineCap  = 'round';
  ctx.lineJoin = 'round';

  // 1) 3가닥 브레이드 — 각 가닥마다 STEPS 단계 테이퍼링
  for (let st = 0; st < STRANDS.length; st++) {
    const strand = STRANDS[st];
    const built  = buildStrand(normals, strand.offset);
    if (!built) continue;
    const { segs, meta } = built;

    for (let s = 0; s < STEPS; s++) {
      if (!segs[s]) continue;
      const t    = (s + 1) / STEPS;                         // 0.2 → 1.0
      const vf   = speedToFactor(avgSpeed(speeds, meta[s].a, meta[s].b));
      const w    = (0.40 + t * 1.10) * vf;                  // 0.4 → 1.5 px (중앙)
      const a    = (0.18 + t * 0.75) * strand.alphaMult * vf;
      // 꼬리 끝은 설정된 컬러, 헤드는 흰색에 가깝게 (혜성 그라디언트)
      const color = lerpRGB(settings.glow, settings.core, t * t);

      ctx.shadowBlur  = 3.5;
      ctx.shadowColor = 'rgba(' + color + ',0.7)';
      ctx.strokeStyle = 'rgba(' + color + ',' + a + ')';
      ctx.lineWidth   = w;
      ctx.stroke(segs[s]);
    }
  }

  // 2) 헤드 스파크 — 커서 끝의 작은 빛점. 느릴 때만 살짝 크게(잉크가 고이는 느낌).
  const head      = points[N - 1];
  const headSpd   = speeds[N - 1];
  const sparkSize = 0.9 + Math.max(0, 1 - headSpd / 1200) * 1.6;
  ctx.shadowBlur  = 6;
  ctx.shadowColor = 'rgba(' + settings.core + ',1)';
  ctx.fillStyle   = 'rgba(' + settings.core + ',0.92)';
  ctx.beginPath();
  ctx.arc(head.x, head.y, sparkSize, 0, Math.PI * 2);
  ctx.fill();

  ctx.shadowBlur = 0;
}

function loop() {
  const now = performance.now();

  // 잔상 페이드
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = 'rgba(0,0,0,0.26)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.restore();

  // 오래된 점 정리
  const cutoff = now - settings.maxLife * FRAME_MS;
  while (points.length && points[0].t < cutoff) points.shift();

  if (points.length >= 2 && pointsOverlapCanvas()) {
    drawTrail();
  }

  requestAnimationFrame(loop);
}
loop();
