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
  assert.strictEqual(r.hotkeys.toggle, 'Control+Alt+1');
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
t('옛 발표 모드 단축키는 사라지고 쓰기 단축키가 생김', () => {
  const r = S.sanitize({ hotkeys: { toggle: 'Control+Shift+F9', presentation: 'Control+Shift+F10' } });
  assert.deepStrictEqual(Object.keys(r.hotkeys), ['toggle', 'laser', 'pen', 'find']);
});
t('예전 F키 기본값은 숫자 키로 옮기고, 직접 바꾼 것은 그대로', () => {
  const r = S.sanitize({ schema: 2, hotkeys: { toggle: 'Control+Shift+F9', find: 'Control+Shift+F11', laser: 'Alt+L' } });
  assert.deepStrictEqual(r.hotkeys, { toggle: 'Control+Alt+1', laser: 'Alt+L', pen: 'Control+Alt+3', find: 'Control+Alt+4' });
  // 옮긴 뒤(schema 3)에 일부러 F키로 다시 고르면 그대로
  assert.strictEqual(S.sanitize({ schema: 3, hotkeys: { toggle: 'Control+Shift+F9' } }).hotkeys.toggle, 'Control+Shift+F9');
});
t('schema 2 에서 고른 은은하게는 schema 3 이 되어도 그대로', () => {
  assert.strictEqual(S.sanitize({ schema: 2, halo: 'soft' }).halo, 'soft');
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

const WA = [{ workArea: { x: 0, y: 0, width: 1920, height: 1040 }, primary: true }, { workArea: { x: 1920, y: 0, width: 1280, height: 760 }, primary: false }];
t('펜 단추: 처음엔 주 화면 오른쪽 아래', () => assert.deepStrictEqual(S.penButtonPlace(null, WA, 44), { x: 1920 - 60, y: 1040 - 60 }));
t('펜 단추: 옮긴 자리가 화면 안이면 그대로(두 번째 화면 포함)', () => assert.deepStrictEqual(S.penButtonPlace({ x: 2000, y: 100 }, WA, 44), { x: 2000, y: 100 }));
t('펜 단추: 그 화면이 빠지면 주 화면 오른쪽 아래로', () => assert.deepStrictEqual(S.penButtonPlace({ x: 2000, y: 100 }, [WA[0]], 44), { x: 1860, y: 980 }));
t('펜 단추 설정 기본 켜짐·잘못된 자리는 버림', () => {
  assert.strictEqual(S.DEFAULTS.penButton, true);
  assert.strictEqual(S.sanitize({ penButtonPos: { x: 'a', y: 1 } }).penButtonPos, null);
});

fs.rmSync(dir, { recursive: true, force: true });
console.log(`\n${n}개 통과`);
