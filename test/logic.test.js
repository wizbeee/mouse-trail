// 설정 저장·발표 모드·화면 선택 로직 시험 (Electron 없이)
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const S = require('../store');

let n = 0;
const t = (name, fn) => { fn(); n++; console.log('  ok ' + name); };

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-'));
const file = path.join(dir, 'sub', 'settings.json');

t('파일 없으면 기본값', () => assert.deepStrictEqual(S.load(file), S.DEFAULTS));
t('저장 후 다시 읽으면 같은 값 (A1 완료 기준)', () => {
  const s = { ...S.load(file), glow: '255,160,80', life: 'long', thickness: 'thick' };
  assert.ok(S.save(file, s));
  const r = S.load(file);
  assert.strictEqual(r.glow, '255,160,80');
  assert.strictEqual(r.life, 'long');
  assert.strictEqual(r.thickness, 'thick');
});
t('깨진 파일 → 기본값으로 동작', () => {
  fs.writeFileSync(file, '{ 깨짐');
  assert.deepStrictEqual(S.load(file), S.DEFAULTS);
});
t('저장 실패해도 예외 없이 false', () => {
  const bad = path.join(dir, 'f'); fs.writeFileSync(bad, 'x');   // 파일을 폴더로 쓰려 함
  assert.strictEqual(S.save(path.join(bad, 'settings.json'), S.DEFAULTS), false);
});
t('잘못된 값은 기본값으로', () => {
  const r = S.sanitize({ glow: '999,0,0', life: 'x', halo: 'neon', thickness: 5, hotkeys: { toggle: 3 } });
  assert.strictEqual(r.glow, S.DEFAULTS.glow);
  assert.strictEqual(r.life, 'normal');
  assert.strictEqual(r.halo, 'off');
  assert.strictEqual(r.thickness, 'thin');
  assert.strictEqual(r.hotkeys.toggle, 'Control+Shift+F9');
});
t('단축키 빈 문자열 = 사용 안 함 유지', () => {
  assert.strictEqual(S.sanitize({ hotkeys: { find: '' } }).hotkeys.find, '');
});
t('기본값: 1.0 모습(얇게·빛나는 커서 끔·맥박 끔·클릭 표시 끔)', () => {
  const d = S.DEFAULTS;
  assert.deepStrictEqual([d.thickness, d.halo, d.haloPulse, d.clickMark], ['thin', 'off', false, 'off']);
});
t('첫 1.1.0 빌드가 저장한 은은하게 → 끔으로 한 번만 되돌림', () => {
  assert.strictEqual(S.sanitize({ halo: 'soft' }).halo, 'off');
  assert.strictEqual(S.sanitize({ schema: 2, halo: 'soft' }).halo, 'soft');   // 그 뒤 직접 고르면 유지
  assert.strictEqual(S.sanitize({ halo: 'strong' }).halo, 'strong');
});

t('발표 모드 켜기 → 굵게·길게·밝은 색·선명하게, 끄면 직전 설정', () => {
  const s0 = { ...S.DEFAULTS, enabled: false, glow: '255,100,180', life: 'short', thickness: 'normal', halo: 'off' };
  const s1 = S.enterPresentation(s0);
  assert.deepStrictEqual([s1.enabled, s1.thickness, s1.life, s1.halo, s1.glow], [true, 'thick', 'long', 'strong', '255,160,80']);
  assert.strictEqual(s1.clickMark, 'off');   // 클릭 표시 승인 전
  const s2 = S.exitPresentation(S.sanitize(JSON.parse(JSON.stringify(s1))));   // 저장·재시작을 거쳐도
  for (const k of ['glow', 'life', 'thickness', 'halo']) assert.strictEqual(s2[k], s0[k], k);
  assert.strictEqual(s2.presentation, false);
  assert.strictEqual(s2.presentationSnapshot, null);
});
t('발표 모드 끄면 은은하게도 그대로 돌아옴(저장·재시작 거쳐도)', () => {
  const s1 = S.enterPresentation({ ...S.DEFAULTS, halo: 'soft' });
  assert.strictEqual(S.exitPresentation(S.sanitize(JSON.parse(JSON.stringify(s1)))).halo, 'soft');
});
t('발표 모드: 이미 시안이면 색 유지, 클릭 표시 가능하면 켬', () => {
  const s1 = S.enterPresentation({ ...S.DEFAULTS, glow: '120,200,255' }, { clickAvailable: true });
  assert.strictEqual(s1.glow, '120,200,255');
  assert.strictEqual(s1.clickMark, 'ripple');
});
t('스냅샷 없는 presentation:true 는 풀림', () => {
  assert.strictEqual(S.sanitize({ presentation: true }).presentation, false);
});

const L = { key: 'L', primary: true }, P = { key: 'P', primary: false };
t('모든 화면', () => assert.deepStrictEqual([...S.resolveDisplays({ mode: 'all', off: [], known: [] }, [L, P]).active], ['L', 'P']));
t('프로젝터만 → 주 화면 제외', () => assert.deepStrictEqual([...S.resolveDisplays({ mode: 'external', off: [], known: [] }, [L, P]).active], ['P']));
t('프로젝터만인데 화면 1대 → 그 화면에 보임', () => assert.deepStrictEqual([...S.resolveDisplays({ mode: 'external', off: [], known: [] }, [L]).active], ['L']));
t('직접 고름: 같은 구성이면 유지', () => {
  const r = S.resolveDisplays({ mode: 'custom', off: ['L'], known: ['L', 'P'] }, [L, P]);
  assert.deepStrictEqual([...r.active], ['P']);
  assert.strictEqual(r.cfg.mode, 'custom');
});
t('직접 고름: 모니터 구성이 바뀌면 모든 화면으로', () => {
  const r = S.resolveDisplays({ mode: 'custom', off: ['L'], known: ['L', 'P'] }, [L]);
  assert.deepStrictEqual([...r.active], ['L']);
  assert.strictEqual(r.cfg.mode, 'all');
});

fs.rmSync(dir, { recursive: true, force: true });
console.log(`\n${n}개 통과`);
