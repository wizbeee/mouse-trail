// 설정 창 — 바꾸는 즉시 적용·자동 저장(저장 단추 없음)
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
let state = null;

const HK_NAMES = { toggle: '켜기/끄기', laser: '레이저 포인터', pen: '화면에 쓰기', find: '커서 찾기' };

function setAccent(rgb) {
  const [r, g, b] = rgb.split(',').map(Number);
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  document.documentElement.style.setProperty('--accent', `rgb(${rgb})`);
  document.documentElement.style.setProperty('--accent-ink', lum > 0.55 ? '#1d1d24' : '#ffffff');
}

function swatch(rgb, title, pressed) {
  const b = document.createElement('button');
  b.className = 'sw';
  b.style.background = `rgb(${rgb})`;
  b.title = title;
  b.setAttribute('aria-label', title);
  b.setAttribute('aria-pressed', pressed ? 'true' : 'false');
  b.onclick = () => window.mts.set({ glow: rgb });
  return b;
}

function renderSwatches(s) {
  const box = $('#swatches');
  box.textContent = '';
  for (const c of state.colors) box.appendChild(swatch(c.val, c.name, s.glow === c.val));
  for (const c of s.recentColors) box.appendChild(swatch(c, '직접 고른 색', s.glow === c));
  const lab = document.createElement('label');
  lab.className = 'pick';
  lab.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>직접 고르기';
  const input = document.createElement('input');
  input.type = 'color';
  input.value = '#' + s.glow.split(',').map(n => (+n).toString(16).padStart(2, '0')).join('');
  input.onchange = () => {
    const h = input.value.slice(1);
    const rgb = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)).join(',');
    window.mts.set({ glow: rgb });
  };
  lab.appendChild(input);
  box.appendChild(lab);
}

function renderDisplays() {
  const box = $('#displays');
  box.textContent = '';
  for (const d of state.displays) {
    const lab = document.createElement('label');
    lab.className = 'chk';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = d.active;
    cb.onchange = () => window.mts.action('displayToggle', d.key);
    lab.appendChild(cb);
    lab.appendChild(document.createTextNode(' ' + d.label));
    box.appendChild(lab);
  }
}

function renderUpdate() {
  const box = $('#updateBox');
  const u = state.update;
  box.textContent = '';
  const link = (text, act) => {
    const b = document.createElement('button');
    b.className = 'link';
    b.textContent = text;
    b.onclick = () => window.mts.action(act);
    return b;
  };
  const text = (t) => box.appendChild(document.createTextNode(t));
  switch (u.status) {
    case 'dev':         text('업데이트: 개발용 실행'); break;
    case 'checking':    text('업데이트 확인 중…'); break;
    case 'downloading': text(`새 버전 ${u.version || ''} 내려받는 중…`); break;
    case 'ready': {
      text(`새 버전 ${u.version || ''} 준비됨 `);
      const b = document.createElement('button');
      b.className = 'small-btn primary';
      b.textContent = '지금 재시작';
      b.onclick = () => window.mts.action('installUpdate');
      box.appendChild(b);
      break;
    }
    case 'none':  text('최신 버전 · '); box.appendChild(link('다시 확인', 'checkUpdate')); break;
    case 'error': text('확인 실패 · '); box.appendChild(link('다시 확인', 'checkUpdate')); break;
    default:      box.appendChild(link('업데이트 확인', 'checkUpdate'));
  }
}

function render() {
  const s = state.settings;
  setAccent(s.glow);

  $('#enabled').setAttribute('aria-pressed', s.enabled);

  renderSwatches(s);
  for (const seg of $$('.seg')) {
    const key = seg.dataset.key;
    for (const b of seg.querySelectorAll('button')) {
      b.setAttribute('aria-pressed', s[key] === b.dataset.v ? 'true' : 'false');
    }
  }
  for (const b of $$('.seg[data-key=clickMark] button')) {
    b.disabled = !state.clickAvailable && b.dataset.v !== 'off';
  }
  $('#clickHint').hidden = state.clickAvailable;
  $('#clickOnHint').hidden = !(state.clickAvailable && s.clickMark === 'ripple');
  $('#haloOpts').hidden = s.halo === 'off';

  $('#haloPulse').checked = s.haloPulse;
  $('#outline').checked = s.outline;
  $('#penButton').checked = s.penButton;
  $('#autoMultiMonitor').checked = s.autoMultiMonitor;
  $('#autoSlideshow').checked = s.autoSlideshow;
  $('#autoSlideshow').disabled = !state.slideshowAvailable;
  $('#slideshowLabel').classList.toggle('disabled', !state.slideshowAvailable);
  $('#slideshowHint').hidden = state.slideshowAvailable;
  $('#slideshowOnHint').hidden = !(state.slideshowAvailable && s.autoSlideshow);
  $('#openAtLogin').checked = state.openAtLogin;

  renderDisplays();

  for (const b of $$('.hk')) {
    if (b.classList.contains('capturing')) continue;
    const acc = s.hotkeys[b.dataset.hk];
    b.textContent = acc ? acc.replace(/Control/g, 'Ctrl').replace(/\+/g, ' + ') : '(사용 안 함)';
  }
  for (const w of $$('[data-hkw]')) {
    w.textContent = state.hotkeyStatus[w.dataset.hkw] === 'fail' ? '다른 프로그램이 쓰는 중이라 등록 못 했어요' : '';
  }

  $('#version').textContent = `버전 ${state.version}`;
  renderUpdate();
}

// ── 입력 ────────────────────────────────────────────────────
$('#enabled').onclick = () => window.mts.set({ enabled: !state.settings.enabled });
for (const seg of $$('.seg')) {
  seg.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    window.mts.set({ [seg.dataset.key]: b.dataset.v });
  });
}
for (const id of ['haloPulse', 'outline', 'autoMultiMonitor', 'autoSlideshow', 'penButton']) {
  $('#' + id).onchange = (e) => window.mts.set({ [id]: e.target.checked });
}
$('#openAtLogin').onchange = (e) => window.mts.action('setLogin', e.target.checked);
$('#dspAll').onclick = () => window.mts.action('displaysAll');
$('#dspExt').onclick = () => window.mts.action('displaysExternal');
$('#lightPreview').onchange = (e) => $('#preview').classList.toggle('light', e.target.checked);
$('#penStart').onclick = () => window.mts.action('pen', true);
$('#hkReset').onclick = () => { $('#hkMsg').textContent = ''; window.mts.action('resetHotkeys'); };

// ── 단축키 입력받기 ──────────────────────────────────────────
let capturing = null;

function codeToKey(code, key) {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^F\d{1,2}$/.test(code)) return code;
  if (/^Numpad\d$/.test(code)) return 'num' + code.slice(6);
  const map = {
    ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
    Space: 'Space', Insert: 'Insert', Delete: 'Delete', Home: 'Home', End: 'End',
    PageUp: 'PageUp', PageDown: 'PageDown', Enter: 'Enter', Tab: 'Tab',
  };
  return map[code] || null;
}

function stopCapture() {
  if (!capturing) return;
  capturing.classList.remove('capturing');
  capturing = null;
  window.mts.action('suspendHotkeys', false);
  render();
}

for (const b of $$('.hk')) {
  b.onclick = () => {
    if (capturing === b) return stopCapture();
    if (capturing) stopCapture();
    capturing = b;
    b.classList.add('capturing');
    b.textContent = '새 조합을 누르세요…';
    $('#hkMsg').textContent = '';
    window.mts.action('suspendHotkeys', true);
  };
}

document.addEventListener('keydown', (e) => {
  if (!capturing) return;
  e.preventDefault();
  const name = capturing.dataset.hk;
  if (e.code === 'Escape') return stopCapture();
  if (e.code === 'Backspace') {
    window.mts.set({ hotkeys: { ...state.settings.hotkeys, [name]: '' } });
    return stopCapture();
  }
  const key = codeToKey(e.code, e.key);
  if (!key) return;   // Ctrl·Shift 만 누른 상태 — 더 기다림
  const mods = [];
  if (e.ctrlKey) mods.push('Control');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  if (e.metaKey) mods.push('Super');
  if (!mods.length && !/^F\d{1,2}$/.test(key)) {
    $('#hkMsg').textContent = 'Ctrl·Alt·Shift 중 하나와 함께 눌러 주세요.';
    return;
  }
  const acc = [...mods, key].join('+');
  const dup = Object.entries(state.settings.hotkeys).find(([k, v]) => k !== name && v === acc);
  if (dup) {
    $('#hkMsg').textContent = `이미 「${HK_NAMES[dup[0]]}」에 쓰는 조합입니다.`;
    return;
  }
  window.mts.set({ hotkeys: { ...state.settings.hotkeys, [name]: acc } });
  stopCapture();
});

// ── 시작 ────────────────────────────────────────────────────
if (new URLSearchParams(location.search).get('firstRun') === '1') $('#firstRun').hidden = false;
window.mts.onState((s) => { state = s; render(); });
window.mts.getState().then((s) => { state = s; render(); });
