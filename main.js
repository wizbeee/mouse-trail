const { app, BrowserWindow, screen, Tray, Menu, nativeImage, ipcMain, globalShortcut } = require('electron');
const path = require('path');
const zlib = require('zlib');
const store = require('./store');

if (!app.requestSingleInstanceLock()) {
  app.quit();
  return;
}

const SETTINGS_FILE = process.env.MT_SETTINGS_FILE ||   // 시험용 덮어쓰기
  path.join(app.getPath('appData'), 'mouse-trail', 'settings.json');

const overlays = new Map();   // displayId -> BrowserWindow
let tray = null;
let settingsWin = null;
let pollInterval = null;
let lastPt = { x: -1, y: -1 };
let activeKeys = new Set();   // 효과를 보일 화면(displayKey)
let hotkeyStatus = {};        // name -> 'ok' | 'fail' | 'off'
let hotkeysSuspended = false;
let updateState = { status: app.isPackaged ? 'idle' : 'dev', version: null };

// 슬라이드 쇼 자동 켜짐(A9)은 승인 후 켬
const SLIDESHOW_AVAILABLE = false;

// ── 클릭 표시 (A5) — 전역 마우스 감지는 네이티브 모듈 필요 ─────
// 모듈을 못 불러오는 PC(백신 차단 등)에서는 클릭 표시만 꺼지고 나머지는 그대로 동작.
let uio = null;
let clickAvailable = false;
let hookRunning = false;
let hookEvents = 0;           // 시험용: 감지한 클릭 수
try {
  uio = require('uiohook-napi').uIOhook;
  clickAvailable = true;
} catch (_) { uio = null; }

// 레이저 펜 (B6) — 쓰는 동안만 오버레이가 마우스를 받음. 저장하지 않음(다시 켜면 늘 꺼진 상태)
let penMode = false;

let settings = store.load(SETTINGS_FILE);   // 옛 판 값(발표 모드 등)은 여기서 정리됨 → 시작 때 한 번 다시 저장

// ── 저장 ─────────────────────────────────────────────────────
let saveTimer = null;
function saveSoon() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { saveTimer = null; store.save(SETTINGS_FILE, settings); }, 300);
}
function saveNow() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  store.save(SETTINGS_FILE, settings);
}

// ── 트레이 아이콘 ────────────────────────────────────────────
function makeIconPNG(size, [r, g, b]) {
  const crcTable = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[i] = c >>> 0;
  }
  const crc32 = (buf) => {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const t = Buffer.from(type, 'ascii');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
    return Buffer.concat([len, t, data, crc]);
  };

  const cx = (size - 1) / 2, cy = (size - 1) / 2;
  const radius = size / 2 - 0.5;
  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 4);
    row[0] = 0;
    for (let x = 0; x < size; x++) {
      const dx = x - cx, dy = y - cy;
      const dist = Math.sqrt(dx*dx + dy*dy);
      const i = 1 + x * 4;
      let alpha = 0;
      if (dist <= radius) alpha = 255;
      else if (dist <= radius + 1) alpha = Math.round(255 * (radius + 1 - dist));
      row[i] = r; row[i+1] = g; row[i+2] = b; row[i+3] = alpha;
    }
    rows.push(row);
  }
  const idat = zlib.deflateSync(Buffer.concat(rows));
  const sig = Buffer.from([0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type RGBA
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// ── 화면 (A8) ────────────────────────────────────────────────
function displayKey(d) {
  return `${d.bounds.width}x${d.bounds.height}@${d.bounds.x},${d.bounds.y}`;
}

function resolveActiveDisplays() {
  const primaryId = screen.getPrimaryDisplay().id;
  const list = screen.getAllDisplays().map(d => ({ key: displayKey(d), primary: d.id === primaryId }));
  const r = store.resolveDisplays(settings.displays, list);
  if (r.cfg !== settings.displays) { settings.displays = r.cfg; saveSoon(); }
  activeKeys = r.active;
}

function describeDisplays() {
  const primaryId = screen.getPrimaryDisplay().id;
  return screen.getAllDisplays().map((d, i) => {
    const sf = d.scaleFactor || 1;
    const w = Math.round(d.bounds.width * sf), h = Math.round(d.bounds.height * sf);
    const kind = d.internal ? '노트북 화면' : `${w}×${h}`;
    return {
      key: displayKey(d),
      label: `${i + 1}번 · ${kind}${d.primary || d.id === primaryId ? ' (주 화면)' : ''}`,
      active: activeKeys.has(displayKey(d)),
    };
  });
}

// ── 오버레이 ─────────────────────────────────────────────────
function overlaySettings(display) {
  return {
    enabled:   settings.enabled,
    active:    activeKeys.has(displayKey(display)),
    glow:      settings.glow,
    maxLife:   store.LIFES[settings.life],
    thick:     store.THICKNESS[settings.thickness],
    halo:      settings.halo,
    haloPulse: settings.haloPulse,
    haloStyle: settings.haloStyle,
    clickMark: settings.clickMark,
    shape:     settings.shape,
    laserColor: settings.laserColor,
    outline:   settings.outline,
  };
}

function createOverlayForDisplay(display) {
  const b = display.bounds;
  const sf = display.scaleFactor || 1;

  // 생성자에 width/height을 직접 주는 대신 setBounds로 설정 — Windows 혼합 DPI에서
  // 비기본 모니터에 정확히 맞는 창 크기를 얻기 위함.
  const win = new BrowserWindow({
    show: false,
    transparent: true,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    closable: false,
    focusable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    fullscreenable: false,
    acceptFirstMouse: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      backgroundThrottling: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.setBounds({ x: b.x, y: b.y, width: b.width, height: b.height });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setIgnoreMouseEvents(true);
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.loadFile(path.join(__dirname, 'index.html'));

  const sendDisplayInfo = () => {
    if (!win || win.isDestroyed()) return;
    win.webContents.send('display-info', {
      originX: b.x,
      originY: b.y,
      width: b.width,            // DIP 폭
      height: b.height,          // DIP 높이
      scaleFactor: sf,           // 모니터의 실제 DPI 배율 (window.devicePixelRatio 대신 이걸 사용)
    });
  };

  win.once('ready-to-show', () => {
    win.showInactive();
    // 창이 완전히 표시된 후 한 번 더 setBounds로 크기 보정
    win.setBounds({ x: b.x, y: b.y, width: b.width, height: b.height });
    sendDisplayInfo();
    win.webContents.send('settings', overlaySettings(display));
    // 커서가 멈춰 있어도 빛나는 커서가 보이도록 현재 위치를 한 번 보냄
    win.webContents.send('cursor', screen.getCursorScreenPoint());
    if (penMode) applyPenToOverlay(win);   // 펜 쓰는 중에 모니터가 바뀐 경우
  });

  win.mtDisplay = display;
  overlays.set(display.id, win);
}

function destroyAllOverlays() {
  for (const win of overlays.values()) {
    try { if (!win.isDestroyed()) win.destroy(); } catch (_) {}
  }
  overlays.clear();
}

function setupOverlays() {
  destroyAllOverlays();
  resolveActiveDisplays();
  for (const d of screen.getAllDisplays()) {
    createOverlayForDisplay(d);
  }
}

let refitTimer = null;
function refitDebounced() {
  if (refitTimer) clearTimeout(refitTimer);
  refitTimer = setTimeout(() => {
    refitTimer = null;
    setupOverlays();
    applyAutoMultiMonitor(true);
    pushState();
  }, 250);
}

function broadcastSettings() {
  for (const win of overlays.values()) {
    if (!win.isDestroyed()) win.webContents.send('settings', overlaySettings(win.mtDisplay));
  }
}

function overlayUnderCursor() {
  const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const win = overlays.get(d.id);
  return win && !win.isDestroyed() ? win : null;
}

// 화면 가운데 0.8초 안내
function toast(text) {
  const win = overlayUnderCursor();
  if (!win) return;
  // 모니터 연결 직후에는 오버레이가 아직 로딩 중일 수 있음
  if (win.webContents.isLoading()) win.webContents.once('did-finish-load', () => win.webContents.send('toast', text));
  else win.webContents.send('toast', text);
}

// ── 커서 위치 (B1: 효과를 끄면 타이머도 멈춤) ─────────────────
function startCursorPolling() {
  if (pollInterval) return;
  lastPt = { x: -1, y: -1 };
  pollInterval = setInterval(() => {
    const pt = screen.getCursorScreenPoint();
    if (pt.x === lastPt.x && pt.y === lastPt.y) return;
    lastPt = pt;

    // 모든 창에 동일한 좌표 브로드캐스트 — 모니터 경계를 넘는 곡선이
    // 양쪽 창에서 자기 영역에 해당하는 부분만 그려서 시각적으로 연속됨
    for (const win of overlays.values()) {
      if (win && !win.isDestroyed()) {
        win.webContents.send('cursor', pt);
      }
    }
  }, 8); // ~120Hz
}

function stopCursorPolling() {
  if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
}

function syncPolling() {
  if (settings.enabled) startCursorPolling(); else stopCursorPolling();
}

// ── 커서 찾기 (B3) — 효과를 꺼 둔 상태에서도 동작 ──────────────
function locateCursor() {
  const pt = screen.getCursorScreenPoint();
  for (const win of overlays.values()) {
    if (win && !win.isDestroyed()) win.webContents.send('locate', { pt, color: settings.glow });
  }
}

// ── 설정 변경의 단일 통로 ────────────────────────────────────
function update(patch) {
  const before = settings;
  settings = store.sanitize({ ...settings, ...patch });
  const hotkeysChanged = JSON.stringify(before.hotkeys) !== JSON.stringify(settings.hotkeys);
  const displaysChanged = JSON.stringify(before.displays) !== JSON.stringify(settings.displays);
  if (displaysChanged) resolveActiveDisplays();
  if (hotkeysChanged) registerHotkeys();
  // 선택지를 막 켰을 때는 켜기만 함(모니터 1대에서 체크하자마자 꺼지면 고장으로 보임)
  if (!before.autoMultiMonitor && settings.autoMultiMonitor && screen.getAllDisplays().length >= 2 && !settings.enabled) {
    return update({ enabled: true });
  }
  saveSoon();
  syncPolling();
  syncClickHook();
  broadcastSettings();
  rebuildTrayMenu();
  pushState();
}

function setEnabled(on, withToast) {
  if (settings.enabled === on) return;
  if (!on) setPenMode(false);
  update({ enabled: on });
  if (withToast) toast(on ? '꼬리 효과 켜짐' : '꼬리 효과 꺼짐');
}

// 단축키를 누를 때마다 꼬리 → 레이저 포인터 → 레이저 펜 → 꼬리
function toggleLaser() {
  if (penMode) {
    setPenMode(false, false);
    update({ shape: 'trail' });
    toast('꼬리 모드');
  } else if (settings.shape !== 'laser') {
    update({ shape: 'laser', enabled: true });
    toast('레이저 포인터');
  } else {
    if (!settings.enabled) update({ enabled: true });
    setPenMode(true);
  }
}

// ── 레이저 펜 (B6) ──────────────────────────────────────────
function applyPenToOverlay(win) {
  if (!win || win.isDestroyed()) return;
  win.setIgnoreMouseEvents(!penMode);
  win.webContents.send('pen', penMode);
}

function setPenMode(on, withToast = true) {
  if (penMode === on) return;
  penMode = on;
  for (const win of overlays.values()) applyPenToOverlay(win);
  registerHotkeys();   // 펜 동안만 Esc 를 잡음
  if (withToast) toast(on ? '레이저 펜 · Esc로 끝내기' : '레이저 펜 끝');
  pushState();
}

// ── 클릭 표시 (A5) ──────────────────────────────────────────
function syncClickHook() {
  const want = clickAvailable && settings.enabled && settings.clickMark === 'ripple';
  if (want && !hookRunning) {
    try { uio.start(); hookRunning = true; }
    catch (_) { clickAvailable = false; pushState(); }
  } else if (!want && hookRunning) {
    try { uio.stop(); } catch (_) {}
    hookRunning = false;
  }
}

if (uio) {
  uio.on('mousedown', (e) => {
    hookEvents++;
    if (penMode) return;   // 펜으로 쓰는 중에는 파문 없음
    // 훅 좌표는 실제 픽셀 → 화면 배율을 반영한 좌표로
    const pt = process.platform === 'win32' ? screen.screenToDipPoint({ x: e.x, y: e.y }) : { x: e.x, y: e.y };
    for (const win of overlays.values()) {
      if (win && !win.isDestroyed()) win.webContents.send('click', { x: pt.x, y: pt.y, button: e.button });
    }
  });
}

// ── 자동 켜짐 (A9: 모니터 2대 이상) ──────────────────────────
function applyAutoMultiMonitor(withToast) {
  if (!settings.autoMultiMonitor) return;
  const many = screen.getAllDisplays().length >= 2;
  setEnabled(many, withToast);
}

// ── 단축키 (A3) ─────────────────────────────────────────────
const HOTKEY_ACTIONS = {
  toggle:       () => setEnabled(!settings.enabled, true),
  find:         () => locateCursor(),
  laser:        () => toggleLaser(),
};

function registerHotkeys() {
  globalShortcut.unregisterAll();
  hotkeyStatus = {};
  if (hotkeysSuspended) return;
  for (const [name, fn] of Object.entries(HOTKEY_ACTIONS)) {
    const acc = settings.hotkeys[name];
    if (!acc) { hotkeyStatus[name] = 'off'; continue; }
    let ok = false;
    try { ok = globalShortcut.register(acc, fn); } catch (_) { ok = false; }
    hotkeyStatus[name] = ok ? 'ok' : 'fail';
  }
  if (penMode) {
    try { globalShortcut.register('Escape', () => setPenMode(false)); } catch (_) {}
  }
}

// ── 자동 업데이트 (A6) ──────────────────────────────────────
let autoUpdater = null;
function setUpdateState(s) {
  updateState = { ...updateState, ...s };
  if (tray) {
    tray.setToolTip(updateState.status === 'ready'
      ? `Mouse Trail — 새 버전 ${updateState.version || ''} 준비됨`
      : 'Mouse Trail — 클릭해서 설정');
  }
  pushState();
}

function setupUpdater() {
  if (!app.isPackaged) return;
  try {
    autoUpdater = require('electron-updater').autoUpdater;
  } catch (_) { return; }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('checking-for-update', () => setUpdateState({ status: 'checking' }));
  autoUpdater.on('update-available', (i) => setUpdateState({ status: 'downloading', version: i && i.version }));
  autoUpdater.on('update-not-available', () => setUpdateState({ status: 'none' }));
  autoUpdater.on('update-downloaded', (i) => setUpdateState({ status: 'ready', version: i && i.version }));
  autoUpdater.on('error', () => setUpdateState({ status: 'error' }));
  setTimeout(checkForUpdates, 10 * 1000);
  setInterval(checkForUpdates, 6 * 60 * 60 * 1000);
}

function checkForUpdates() {
  if (!autoUpdater || updateState.status === 'ready' || updateState.status === 'downloading') return;
  autoUpdater.checkForUpdates().catch(() => setUpdateState({ status: 'error' }));
}

// ── 설정 창 (A4) ─────────────────────────────────────────────
function stateForWindow() {
  return {
    settings,
    colors: store.COLORS,
    displays: describeDisplays(),
    hotkeyStatus,
    version: app.getVersion(),
    update: updateState,
    openAtLogin: app.getLoginItemSettings().openAtLogin,
    clickAvailable,
    penMode,
    slideshowAvailable: SLIDESHOW_AVAILABLE,
  };
}

function pushState() {
  if (settingsWin && !settingsWin.isDestroyed()) settingsWin.webContents.send('mts:state', stateForWindow());
}

function openSettings({ firstRun = false } = {}) {
  if (settingsWin && !settingsWin.isDestroyed()) {
    if (settingsWin.isMinimized()) settingsWin.restore();
    settingsWin.show();
    settingsWin.focus();
    return;
  }
  settingsWin = new BrowserWindow({
    width: 480,
    height: 680,
    minWidth: 420,
    minHeight: 480,
    title: 'Mouse Trail 설정',
    icon: nativeImage.createFromBuffer(makeIconPNG(32, [170, 140, 255])),
    autoHideMenuBar: true,
    show: false,
    backgroundColor: '#f6f6f8',
    webPreferences: {
      preload: path.join(__dirname, 'settings-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  settingsWin.setMenu(null);
  settingsWin.loadFile(path.join(__dirname, 'settings.html'), { query: { firstRun: firstRun ? '1' : '0' } });
  settingsWin.once('ready-to-show', () => settingsWin.show());
  settingsWin.on('closed', () => {
    settingsWin = null;
    if (hotkeysSuspended) { hotkeysSuspended = false; registerHotkeys(); }
  });
}

ipcMain.handle('mts:get-state', () => stateForWindow());
ipcMain.on('pen-end', () => setPenMode(false));   // 오버레이 위쪽 띠의 [끝내기]
ipcMain.on('mts:set', (_, patch) => {
  if (!patch || typeof patch !== 'object') return;
  if ('enabled' in patch) return setEnabled(!!patch.enabled, false);
  if ('glow' in patch && store.isRGB(patch.glow) && !store.COLORS.some(c => c.val === patch.glow)) {
    // 직접 고른 색은 최근 3개 기억 (B2)
    patch.recentColors = [patch.glow, ...settings.recentColors.filter(c => c !== patch.glow)].slice(0, 3);
  }
  update(patch);
});
ipcMain.handle('mts:action', (_, name, arg) => {
  switch (name) {
    case 'displaysAll':      return update({ displays: { mode: 'all', off: [], known: [] } });
    case 'displaysExternal': return update({ displays: { mode: 'external', off: [], known: [] } });
    case 'displayToggle': {
      const all = describeDisplays();
      const off = all.filter(d => (d.key === arg ? d.active : !d.active)).map(d => d.key);
      const cfg = off.length ? { mode: 'custom', off, known: all.map(d => d.key) }
                             : { mode: 'all', off: [], known: [] };
      return update({ displays: cfg });
    }
    case 'setLogin':
      app.setLoginItemSettings({ openAtLogin: !!arg, args: ['--hidden'] });
      rebuildTrayMenu();
      return pushState();
    case 'suspendHotkeys':   // 단축키를 새로 입력받는 동안 기존 단축키가 반응하지 않게
      hotkeysSuspended = !!arg;
      registerHotkeys();
      return pushState();
    case 'resetHotkeys':
      return update({ hotkeys: { ...store.DEFAULT_HOTKEYS } });
    case 'locate':        return locateCursor();
    case 'pen':           if (!settings.enabled) update({ enabled: true }); return setPenMode(!!arg);
    case 'checkUpdate':   return checkForUpdates();
    case 'installUpdate': if (autoUpdater && updateState.status === 'ready') autoUpdater.quitAndInstall(); return;
  }
});

// ── 트레이 (오른쪽 클릭 = 빠른 메뉴, 왼쪽 클릭 = 설정 창) ────────
function rebuildTrayMenu() {
  if (!tray) return;
  const lifeKeys = Object.keys(store.LIFES);
  const menu = Menu.buildFromTemplate([
    {
      label: '효과 켜짐',
      type: 'checkbox',
      checked: settings.enabled,
      click: (mi) => setEnabled(mi.checked, false),
    },
    { type: 'separator' },
    {
      label: `색상 — ${store.colorName(settings.glow)}`,
      submenu: store.COLORS.map(c => ({
        label: c.name,
        type: 'radio',
        checked: settings.glow === c.val,
        click: () => update({ glow: c.val }),
      })),
    },
    {
      label: `꼬리 길이 — ${store.LIFE_NAMES[settings.life]}`,
      submenu: lifeKeys.map(k => ({
        label: store.LIFE_NAMES[k],
        type: 'radio',
        checked: settings.life === k,
        click: () => update({ life: k }),
      })),
    },
    { type: 'separator' },
    { label: '설정 창 열기…', click: () => openSettings() },
    {
      label: 'Windows 시작 시 자동 실행',
      type: 'checkbox',
      checked: app.getLoginItemSettings().openAtLogin,
      click: (mi) => { app.setLoginItemSettings({ openAtLogin: mi.checked, args: ['--hidden'] }); pushState(); },
    },
    { type: 'separator' },
    { label: '종료', click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);
}

function setupTray() {
  const iconBuf = makeIconPNG(16, [170, 140, 255]);
  const icon = nativeImage.createFromBuffer(iconBuf);
  tray = new Tray(icon);
  tray.setToolTip('Mouse Trail — 클릭해서 설정');
  tray.on('click', () => openSettings());
  rebuildTrayMenu();
}

app.on('second-instance', () => openSettings());

app.whenReady().then(() => {
  saveSoon();
  setupOverlays();
  setupTray();
  registerHotkeys();
  applyAutoMultiMonitor(false);
  syncPolling();
  syncClickHook();
  setupUpdater();

  // 처음 실행 시 설정 창을 한 번 띄워 트레이 위치를 알려 줌
  if (!settings.firstRunShown) {
    openSettings({ firstRun: true });
    update({ firstRunShown: true });
  }

  // 모니터 추가/제거/해상도·DPI 변경 시 모든 오버레이 재구성 (디바운스)
  screen.on('display-added',           refitDebounced);
  screen.on('display-removed',         refitDebounced);
  screen.on('display-metrics-changed', refitDebounced);

  if (process.env.MT_SMOKE) {
    require('./test/smoke')({
      get settings() { return settings; }, overlays, update, setEnabled, toggleLaser, setPenMode, get penMode() { return penMode; },
      hookEvents: () => hookEvents, get clickAvailable() { return clickAvailable; },
      locateCursor, openSettings, get settingsWin() { return settingsWin; }, hotkeyStatus: () => hotkeyStatus,
      SETTINGS_FILE,
    });
  }
});

// 오버레이는 closable:false 라서 종료(업데이트 설치 포함) 전에 직접 없앰
app.on('before-quit', () => {
  saveNow();
  destroyAllOverlays();
});
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (hookRunning) { try { uio.stop(); } catch (_) {} }
});

app.on('window-all-closed', (e) => { e.preventDefault && e.preventDefault(); });
