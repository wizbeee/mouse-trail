// 설정 기본값 · 검증 · 파일 저장 (A1) + 화면 선택(A8).
// 발표 모드는 10/7 발주자 결정으로 없앰(설정이 저장되니 한 번 맞추면 됨).
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

// 10/8: F키는 노트북(갤럭시 북 등)에서 Fn 을 같이 눌러야 해서 숫자 키로. 교사 도구함은 Ctrl+Alt+글자를 씀
const DEFAULT_HOTKEYS = {
  toggle: 'Control+Alt+1',   // 효과 켜기/끄기
  laser:  'Control+Alt+2',   // 레이저 포인터 켜기/끄기
  pen:    'Control+Alt+3',   // 화면에 쓰기(레이저 펜) 켜기/끄기
  find:   'Control+Alt+4',   // 커서 찾기
};
// 예전 기본값 — 사용자가 바꾸지 않았으면 새 기본값으로 옮김
const OLD_DEFAULT_HOTKEYS = {
  toggle: 'Control+Shift+F9',
  laser:  'Control+Shift+F12',
  find:   'Control+Shift+F11',
};

const SCHEMA = 3;   // 2: 빛나는 커서 기본값을 끔으로(1.0 모습 유지) · 3: 단축키를 숫자 키로

const DEFAULTS = {
  schema: SCHEMA,
  enabled: true,
  glow: '170,140,255',
  life: 'normal',
  thickness: 'thin',
  halo: 'off',             // off | soft | strong — 기본 끔(1.0 모습)
  haloStyle: 'fade',       // fade(스며들기) | grow(커지며) | ring(퍼지는 원)
  haloPulse: false,        // 은은한 맥박 — 기본 꺼짐
  clickMark: 'off',        // off | ripple
  shape: 'trail',          // trail | laser
  laserColor: 'red',       // red | green
  outline: false,          // 밝은 바탕용 테두리 항상 켜기 (B4 대체안)
  recentColors: [],
  displays: { mode: 'all', off: [], known: [] },   // all | external | custom
  autoMultiMonitor: false,
  autoSlideshow: false,
  hotkeys: { ...DEFAULT_HOTKEYS },
  penButton: true,         // 화면 구석 펜 단추 (10/7 발주자: 켜고 끄기 + 늘 보이는 단추)
  penButtonPos: null,      // { x, y } — 끌어서 옮긴 자리
  firstRunShown: false,
};

const clone = (o) => JSON.parse(JSON.stringify(o));
const isRGB = (v) => typeof v === 'string' && /^\d{1,3},\d{1,3},\d{1,3}$/.test(v) &&
  v.split(',').every(n => +n <= 255);
const oneOf = (v, list, d) => (list.includes(v) ? v : d);
const bool = (v, d) => (typeof v === 'boolean' ? v : d);
const strList = (v) => (Array.isArray(v) ? v.filter(x => typeof x === 'string') : []);

// 없앤 발표 모드가 켜진 채 저장돼 있으면, 켜기 전 값으로 되돌림
const PRES_KEYS = ['thickness', 'life', 'glow', 'halo', 'clickMark'];

function sanitize(raw) {
  const d = clone(DEFAULTS);
  if (!raw || typeof raw !== 'object') return d;
  if (raw.presentation === true && raw.presentationSnapshot && typeof raw.presentationSnapshot === 'object') {
    const snap = {};
    for (const k of PRES_KEYS) if (k in raw.presentationSnapshot) snap[k] = raw.presentationSnapshot[k];
    raw = { ...raw, ...snap };
  }
  const s = d;
  s.enabled    = bool(raw.enabled, d.enabled);
  s.glow       = isRGB(raw.glow) ? raw.glow : d.glow;
  s.life       = oneOf(raw.life, Object.keys(LIFES), d.life);
  s.thickness  = oneOf(raw.thickness, Object.keys(THICKNESS), d.thickness);
  s.halo       = oneOf(raw.halo, ['off', 'soft', 'strong'], d.halo);
  // 첫 1.1.0 빌드는 '은은하게'를 기본으로 저장했음 → 한 번만 끔으로 되돌림
  if (!(raw.schema >= 2) && s.halo === 'soft') s.halo = 'off';
  s.haloStyle  = oneOf(raw.haloStyle, ['fade', 'grow', 'ring'], d.haloStyle);
  s.haloPulse  = bool(raw.haloPulse, d.haloPulse);
  s.clickMark  = oneOf(raw.clickMark, ['off', 'ripple'], d.clickMark);
  s.shape      = oneOf(raw.shape, ['trail', 'laser'], d.shape);
  s.laserColor = oneOf(raw.laserColor, ['red', 'green'], d.laserColor);
  s.outline    = bool(raw.outline, d.outline);
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
    if (!(raw.schema >= 3) && hk[k] === OLD_DEFAULT_HOTKEYS[k]) s.hotkeys[k] = DEFAULT_HOTKEYS[k];
  }
  s.firstRunShown = bool(raw.firstRunShown, false);
  s.penButton = bool(raw.penButton, d.penButton);
  const pp = raw.penButtonPos;
  s.penButtonPos = pp && Number.isFinite(pp.x) && Number.isFinite(pp.y) ? { x: Math.round(pp.x), y: Math.round(pp.y) } : null;
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

// 펜 단추 자리: 저장된 자리가 어느 화면 작업 영역 안에 통째로 들어가면 그대로, 아니면 주 화면 오른쪽 아래
// displays: [{ workArea: {x,y,width,height}, primary }]
function penButtonPlace(pos, displays, size, margin = 16) {
  if (pos) {
    const inside = displays.some(({ workArea: w }) =>
      pos.x >= w.x && pos.y >= w.y && pos.x + size <= w.x + w.width && pos.y + size <= w.y + w.height);
    if (inside) return { x: pos.x, y: pos.y };
  }
  const w = (displays.find(d => d.primary) || displays[0]).workArea;
  return { x: w.x + w.width - size - margin, y: w.y + w.height - size - margin };
}

function colorName(rgb) {
  const c = COLORS.find(x => x.val === rgb);
  return c ? c.name : '직접 고른 색';
}

module.exports = {
  COLORS, LIFES, LIFE_NAMES, THICKNESS, DEFAULTS, DEFAULT_HOTKEYS,
  sanitize, load, save, resolveDisplays, penButtonPlace, colorName, isRGB,
};
