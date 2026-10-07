// 설정 기본값 · 검증 · 파일 저장 (A1) + 발표 모드 전환(A2) + 화면 선택(A8).
// Electron 없이 node 로 시험할 수 있게 순수 함수만 둔다.
const fs = require('fs');
const path = require('path');

const COLORS = [
  { name: '보라',   val: '170,140,255' },
  { name: '시안',   val: '120,200,255' },
  { name: '주황',   val: '255,160,80'  },
  { name: '그린',   val: '120,255,180' },
  { name: '핑크',   val: '255,100,180' },
  { name: '화이트', val: '255,255,255' },
];
const LIFES      = { short: 30, normal: 60, long: 120 };
const LIFE_NAMES = { short: '짧게', normal: '보통', long: '길게' };
const THICKNESS  = { thin: 1.0, normal: 1.8, thick: 3.0 };   // 교실에서 보고 조정
const BRIGHT     = ['255,160,80', '120,200,255'];             // 발표 모드용 밝은 색(주황·시안)

const DEFAULT_HOTKEYS = {
  toggle:       'Control+Shift+F9',
  presentation: 'Control+Shift+F10',
  find:         'Control+Shift+F11',
  laser:        'Control+Shift+F12',
};

const DEFAULTS = {
  enabled: true,
  glow: '170,140,255',
  life: 'normal',
  thickness: 'thin',
  halo: 'soft',            // off | soft | strong
  haloPulse: false,        // 은은한 맥박 — 기본 꺼짐
  clickMark: 'off',        // off | ripple (A5 승인 전에는 쓰지 않음)
  shape: 'trail',          // trail | laser
  laserColor: 'red',       // red | green
  outline: false,          // 밝은 바탕용 테두리 항상 켜기 (B4 대체안)
  presentation: false,
  presentationSnapshot: null,
  recentColors: [],
  displays: { mode: 'all', off: [], known: [] },   // all | external | custom
  autoMultiMonitor: false,
  autoSlideshow: false,
  hotkeys: { ...DEFAULT_HOTKEYS },
  firstRunShown: false,
};

const clone = (o) => JSON.parse(JSON.stringify(o));
const isRGB = (v) => typeof v === 'string' && /^\d{1,3},\d{1,3},\d{1,3}$/.test(v) &&
  v.split(',').every(n => +n <= 255);
const oneOf = (v, list, d) => (list.includes(v) ? v : d);
const bool = (v, d) => (typeof v === 'boolean' ? v : d);
const strList = (v) => (Array.isArray(v) ? v.filter(x => typeof x === 'string') : []);

const PRES_KEYS = ['thickness', 'life', 'glow', 'halo', 'clickMark'];

function sanitize(raw) {
  const d = clone(DEFAULTS);
  if (!raw || typeof raw !== 'object') return d;
  const s = d;
  s.enabled    = bool(raw.enabled, d.enabled);
  s.glow       = isRGB(raw.glow) ? raw.glow : d.glow;
  s.life       = oneOf(raw.life, Object.keys(LIFES), d.life);
  s.thickness  = oneOf(raw.thickness, Object.keys(THICKNESS), d.thickness);
  s.halo       = oneOf(raw.halo, ['off', 'soft', 'strong'], d.halo);
  s.haloPulse  = bool(raw.haloPulse, d.haloPulse);
  s.clickMark  = oneOf(raw.clickMark, ['off', 'ripple'], d.clickMark);
  s.shape      = oneOf(raw.shape, ['trail', 'laser'], d.shape);
  s.laserColor = oneOf(raw.laserColor, ['red', 'green'], d.laserColor);
  s.outline    = bool(raw.outline, d.outline);
  s.presentation = bool(raw.presentation, false);
  if (s.presentation && raw.presentationSnapshot && typeof raw.presentationSnapshot === 'object') {
    const snap = {};
    const ok = sanitize({ ...raw.presentationSnapshot });   // 같은 규칙으로 검증
    for (const k of PRES_KEYS) snap[k] = ok[k];
    s.presentationSnapshot = snap;
  } else {
    s.presentation = false;
    s.presentationSnapshot = null;
  }
  s.recentColors = strList(raw.recentColors).filter(isRGB).slice(0, 3);
  const dsp = raw.displays && typeof raw.displays === 'object' ? raw.displays : {};
  s.displays = {
    mode:  oneOf(dsp.mode, ['all', 'external', 'custom'], 'all'),
    off:   strList(dsp.off),
    known: strList(dsp.known),
  };
  s.autoMultiMonitor = bool(raw.autoMultiMonitor, false);
  s.autoSlideshow    = bool(raw.autoSlideshow, false);
  const hk = raw.hotkeys && typeof raw.hotkeys === 'object' ? raw.hotkeys : {};
  for (const k of Object.keys(DEFAULT_HOTKEYS)) {
    // 빈 문자열 = 사용 안 함
    s.hotkeys[k] = typeof hk[k] === 'string' ? hk[k] : DEFAULT_HOTKEYS[k];
  }
  s.firstRunShown = bool(raw.firstRunShown, false);
  return s;
}

function load(file) {
  try {
    return sanitize(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch (_) {
    return clone(DEFAULTS);   // 파일 없음·깨짐 → 기본값으로 동작
  }
}

function save(file, s) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(s, null, 2), 'utf8');
    fs.renameSync(tmp, file);
    return true;
  } catch (_) {
    return false;
  }
}

// ── 발표 모드 (A2) ──────────────────────────────────────────
function enterPresentation(s, { clickAvailable = false } = {}) {
  if (s.presentation) return s;
  const snap = {};
  for (const k of PRES_KEYS) snap[k] = s[k];
  return {
    ...s,
    enabled: true,
    presentation: true,
    presentationSnapshot: snap,
    thickness: 'thick',
    life: 'long',
    halo: 'strong',
    glow: BRIGHT.includes(s.glow) ? s.glow : BRIGHT[0],
    clickMark: clickAvailable ? 'ripple' : s.clickMark,
  };
}

function exitPresentation(s) {
  if (!s.presentation) return s;
  return { ...s, ...(s.presentationSnapshot || {}), presentation: false, presentationSnapshot: null };
}

// ── 화면 선택 (A8) ──────────────────────────────────────────
// displays: [{ key, primary }]  →  { cfg, active: Set<key> }
function resolveDisplays(cfg, displays) {
  const keys = displays.map(d => d.key);
  let c = cfg;
  if (c.mode === 'custom') {
    const same = c.known.length === keys.length && keys.every(k => c.known.includes(k));
    if (!same) c = { mode: 'all', off: [], known: [] };   // 모니터 구성이 바뀌면 모든 화면으로
  }
  let active;
  if (c.mode === 'external' && displays.length >= 2) {
    active = displays.filter(d => !d.primary).map(d => d.key);
  } else if (c.mode === 'custom') {
    active = keys.filter(k => !c.off.includes(k));
  } else {
    active = keys;   // all, 또는 화면이 1대뿐인 external
  }
  return { cfg: c, active: new Set(active) };
}

function colorName(rgb) {
  const c = COLORS.find(x => x.val === rgb);
  return c ? c.name : '직접 고른 색';
}

module.exports = {
  COLORS, LIFES, LIFE_NAMES, THICKNESS, DEFAULTS, DEFAULT_HOTKEYS,
  sanitize, load, save, enterPresentation, exitPresentation, resolveDisplays, colorName, isRGB,
};
