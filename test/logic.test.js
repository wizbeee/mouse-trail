// 설정 저장·화면 선택 로직 시험 (Electron 없이)
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

t('없앤 발표 모드가 켜진 채 저장돼 있으면 켜기 전 값으로 되돌림', () => {
  const r = S.sanitize({
    schema: 2, glow: '255,160,80', life: 'long', thickness: 'thick', halo: 'strong',
    presentation: true,
    presentationSnapshot: { thickness: 'normal', life: 'short', glow: '170,140,255', halo: 'off', clickMark: 'off' },
  });
  assert.deepStrictEqual([r.thickness, r.life, r.glow, r.halo], ['normal', 'short', '170,140,255', 'off']);
  assert.ok(!('presentation' in r) && !('presentationSnapshot' in r));
});
t('발표 모드 꺼진 채 저장된 값은 그대로', () => {
  const r = S.sanitize({ schema: 2, thickness: 'thick', presentation: false, presentationSnapshot: null });
  assert.strictEqual(r.thickness, 'thick');
});
t('옛 발표 모드 단축키는 사라짐', () => {
  const r = S.sanitize({ hotkeys: { toggle: 'Control+Shift+F9', presentation: 'Control+Shift+F10' } });
  assert.deepStrictEqual(Object.keys(r.hotkeys), ['toggle', 'find', 'laser']);
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
