const { app, BrowserWindow, screen, Tray, Menu, nativeImage, ipcMain } = require('electron');
const path = require('path');
const zlib = require('zlib');

if (!app.requestSingleInstanceLock()) {
  app.quit();
  return;
}

const overlays = new Map();   // displayId -> BrowserWindow
let tray = null;
let pollInterval = null;
let lastPt = { x: -1, y: -1 };
let lastDisplayId = null;

const settings = {
  enabled: true,
  glow: '170,140,255',
  glowName: '보라',
  maxLife: 60,
  maxLifeName: '보통',
};

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
    win.webContents.send('settings', settings);
  });

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
  }, 250);
}

function broadcastSettings() {
  for (const win of overlays.values()) {
    if (!win.isDestroyed()) win.webContents.send('settings', settings);
  }
}

function startCursorPolling() {
  if (pollInterval) clearInterval(pollInterval);
  pollInterval = setInterval(() => {
    if (!settings.enabled) return;
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

function rebuildTrayMenu() {
  const colors = [
    { name: '보라', val: '170,140,255' },
    { name: '시안', val: '120,200,255' },
    { name: '주황', val: '255,160,80'  },
    { name: '그린', val: '120,255,180' },
    { name: '핑크', val: '255,100,180' },
    { name: '화이트', val: '255,255,255' },
  ];
  const lifes = [
    { name: '짧게', val: 30 },
    { name: '보통', val: 60 },
    { name: '길게', val: 120 },
  ];

  const menu = Menu.buildFromTemplate([
    {
      label: settings.enabled ? '✔ 활성화됨' : '비활성화됨',
      type: 'checkbox',
      checked: settings.enabled,
      click: (mi) => { settings.enabled = mi.checked; broadcastSettings(); rebuildTrayMenu(); },
    },
    { type: 'separator' },
    {
      label: `색상 — ${settings.glowName}`,
      submenu: colors.map(c => ({
        label: c.name,
        type: 'radio',
        checked: settings.glow === c.val,
        click: () => { settings.glow = c.val; settings.glowName = c.name; broadcastSettings(); rebuildTrayMenu(); },
      })),
    },
    {
      label: `꼬리 길이 — ${settings.maxLifeName}`,
      submenu: lifes.map(l => ({
        label: l.name,
        type: 'radio',
        checked: settings.maxLife === l.val,
        click: () => { settings.maxLife = l.val; settings.maxLifeName = l.name; broadcastSettings(); rebuildTrayMenu(); },
      })),
    },
    { type: 'separator' },
    {
      label: 'Windows 시작 시 자동 실행',
      type: 'checkbox',
      checked: app.getLoginItemSettings().openAtLogin,
      click: (mi) => app.setLoginItemSettings({ openAtLogin: mi.checked, args: ['--hidden'] }),
    },
    { type: 'separator' },
    { label: '종료', click: () => { app.exit(0); } },
  ]);
  tray.setContextMenu(menu);
}

function setupTray() {
  const iconBuf = makeIconPNG(16, [170, 140, 255]);
  const icon = nativeImage.createFromBuffer(iconBuf);
  tray = new Tray(icon);
  tray.setToolTip('Mouse Trail — 클릭해서 설정');
  tray.on('click', () => tray.popUpContextMenu());
  rebuildTrayMenu();
}

app.on('second-instance', () => {
  if (tray) tray.popUpContextMenu();
});

app.whenReady().then(() => {
  setupOverlays();
  setupTray();
  startCursorPolling();

  // 모니터 추가/제거/해상도·DPI 변경 시 모든 오버레이 재구성 (디바운스)
  screen.on('display-added',           refitDebounced);
  screen.on('display-removed',         refitDebounced);
  screen.on('display-metrics-changed', refitDebounced);
});

app.on('window-all-closed', (e) => { e.preventDefault && e.preventDefault(); });
