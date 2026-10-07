# Mouse Trail

수업 화면에서 **커서가 어디 있는지 잘 보이게** 하는 Windows 오버레이 앱.

- 화면 전체를 덮는 **클릭 관통 투명 오버레이** — 평소 작업 방해 없음
- 빛나는 꼬리 + **빛나는 커서**(멈춰 있을 때 커서 둘레에 은은한 빛)
- **발표 모드** 한 번에 프로젝터용(굵게·길게·밝은 색·선명한 빛)
- **레이저 포인터** 모드, **커서 찾기**(동심원이 커서로 모여듦)
- **화면마다 켜기**(프로젝터에만 효과), 모니터 2대 이상이면 자동 켜짐
- 설정은 `%APPDATA%\mouse-trail\settings.json` 에 자동 저장
- 자동 업데이트(GitHub Releases `wizbeee/mouse-trail`)

---

## 사용법

실행하면 작업 표시줄 오른쪽(시계 옆) 트레이에 보라색 점 아이콘이 생깁니다.

- **왼쪽 클릭** → 설정 창 (바꾸는 즉시 적용, 저장 단추 없음)
- **오른쪽 클릭** → 빠른 메뉴 (켜짐·발표 모드·색·길이·자동 실행·종료)

### 단축키 (설정 창에서 바꿀 수 있음)

| 단축키 | 하는 일 |
|---|---|
| Ctrl+Shift+F9  | 효과 켜기/끄기 |
| Ctrl+Shift+F10 | 발표 모드 켜기/끄기 |
| Ctrl+Shift+F11 | 커서 찾기 (효과를 꺼 둬도 동작) |
| Ctrl+Shift+F12 | 레이저 포인터 ↔ 꼬리 |

> Word 에서는 Ctrl+Shift+F9(필드 연결 끊기)·F11(필드 잠금 해제)·F12(인쇄)가 같은 조합이라,
> Mouse Trail 이 켜져 있는 동안에는 Word 쪽 기능이 동작하지 않습니다. 필요하면 설정 창에서 바꾸세요.

---

## 설치파일 만들기

Node.js(LTS) 설치 후 **`build.bat` 더블클릭** → `dist\MouseTrail-Setup-<버전>.exe`.

## 개발자용

```bash
npm install
npm start          # 개발 모드로 실행
npm test           # 설정 저장·발표 모드·화면 선택 로직 시험
npm run dist       # 설치파일 빌드
npm run publish    # GitHub Releases 에 올리기 (GH_TOKEN 필요)
```

실제 Electron 에서 오버레이가 그리는 것을 확인하는 연기 시험(설정은 임시 파일 사용):

```bash
MT_SMOKE=1 MT_SETTINGS_FILE=<임시>/settings.json MT_SMOKE_OUT=<임시> npx electron .
```

### 파일 구조
- `main.js` — 오버레이 창·커서 위치(~120Hz, 효과 끄면 멈춤)·트레이·단축키·설정 창·자동 업데이트
- `store.js` — 설정 기본값·검증·저장, 발표 모드 전환, 화면 선택(순수 함수, `test/logic.test.js`)
- `index.html` / `renderer.js` — 꼬리(잔상 캔버스) + 빛나는 커서·레이저·커서 찾기·안내 문구(효과 캔버스)
- `settings.html` / `settings.js` / `settings-preload.js` — 설정 창
- `tools/ppt-slideshow-test.ps1` — 슬라이드 쇼 감지 시험(A9)

### 조정할 수치
교실 프로젝터에서 보고 바꿀 값은 한곳에 모여 있습니다.
- 굵기 배율: `store.js` `THICKNESS` (얇게 1.0 / 보통 1.8 / 굵게 3.0)
- 빛나는 커서 크기·세기: `renderer.js` `HALO` (은은하게 48px·25%, 선명하게 72px·40%), `HALO_*`
- 레이저 점: `renderer.js` `LASER_DIAMETER`, `LASER_TAIL_MS`
