# Mouse Trail

수업 화면에서 **커서가 어디 있는지 잘 보이게** 하는 Windows 오버레이 앱.

- 화면 전체를 덮는 **클릭 관통 투명 오버레이** — 평소 작업 방해 없음
- 빛나는 꼬리(굵기 3단계 — 굵게는 가는 선 둘레에 옅은 빛 띠) + **빛나는 커서**(선택, 기본 끔)
- **빛나는 커서** 나타나는 방식 3가지(스며들기·커지며·퍼지는 원)
- **클릭 표시**(왼쪽 = 원 하나, 오른쪽 = 이중 원이 퍼짐)
- **레이저 포인터**, **레이저 펜**(화면 어디에나 쓰고 2초 뒤 사라짐 · 마우스·손가락·펜), **커서 찾기**(동심원이 커서로 모여듦)
- **펜 단추**: 화면 구석에 늘 떠 있는 작은 단추 — 누르면 레이저 펜 켜기/끄기, 끌어서 옮기기
- **화면마다 켜기**(프로젝터에만 효과), 자동 켜짐(모니터 2대 이상 · **PowerPoint 슬라이드 쇼 중**)
- 설정은 `%APPDATA%\mouse-trail\settings.json` 에 자동 저장
- 자동 업데이트(GitHub Releases [wizbeee/mouse-trail](https://github.com/wizbeee/mouse-trail/releases))

**내려받기**: [최신 설치파일](https://github.com/wizbeee/mouse-trail/releases/latest) → `MouseTrail-Setup-<버전>.exe`

---

## 사용법

실행하면 작업 표시줄 오른쪽(시계 옆) 트레이에 보라색 점 아이콘이 생깁니다.

- **왼쪽 클릭** → 설정 창 (바꾸는 즉시 적용, 저장 단추 없음)
- **오른쪽 클릭** → 빠른 메뉴 (켜짐·색·길이·설정 창·자동 실행·종료)

### 단축키 (설정 창에서 바꿀 수 있음)

| 단축키 | 하는 일 |
|---|---|
| Ctrl+Alt+1 | 효과 켜기/끄기 |
| Ctrl+Alt+2 | 레이저 포인터 켜기/끄기 |
| Ctrl+Alt+3 | 화면에 쓰기(레이저 펜) 켜기/끄기 |
| Ctrl+Alt+4 | 커서 찾기 (효과를 꺼 둬도 동작) |
| Esc | 화면에 쓰기 끝내기 (쓰는 동안만) |

> 노트북은 F키가 볼륨·밝기 키라 Fn 을 같이 눌러야 해서, 1.1.5부터 숫자 키를 씁니다(예전 F키 기본값은 자동으로 바뀜).
> Word 에서는 Ctrl+Alt+1~3 이 「제목 1~3」 스타일 단축키와 같아서, Mouse Trail 이 켜져 있는 동안에는 Word 쪽이 동작하지 않습니다. 필요하면 설정 창에서 바꾸세요.

---

## 설치파일 만들기

Node.js(LTS) 설치 후 **`build.bat` 더블클릭** → `dist\MouseTrail-Setup-<버전>.exe`.

## 개발자용

```bash
npm install
npm start          # 개발 모드로 실행
npm test           # 설정 저장·화면 선택 로직 시험
npm run dist       # 설치파일 빌드
npm run publish    # GitHub Releases 에 올리기 (GH_TOKEN 필요)
```

실제 Electron 에서 오버레이가 그리는 것을 확인하는 연기 시험(설정은 임시 파일 사용):

```bash
MT_SMOKE=1 MT_SETTINGS_FILE=<임시>/settings.json MT_SMOKE_OUT=<임시> npx electron .
```

### 파일 구조
- `main.js` — 오버레이 창·커서 위치(~120Hz, 효과 끄면 멈춤)·트레이·단축키·설정 창·자동 업데이트
- `store.js` — 설정 기본값·검증·저장(옛 판 값 정리 포함), 화면 선택(순수 함수, `test/logic.test.js`)
- `index.html` / `renderer.js` — 꼬리(잔상 캔버스) + 빛나는 커서·레이저·커서 찾기·안내 문구(효과 캔버스)
- `settings.html` / `settings.js` / `settings-preload.js` — 설정 창
- `pen-button.html` / `pen-button-preload.js` — 화면 구석 펜 단추
- `slideshow.js` — 슬라이드 쇼 감지(숨은 PowerShell 1개가 1초마다 확인, 앱이 끝나면 함께 끝남)
- `tools/ppt-slideshow-test.ps1` — 슬라이드 쇼 감지 단독 시험

### 조정할 수치
교실 프로젝터에서 보고 바꿀 값은 한곳에 모여 있습니다.
- 굵기 배율: `store.js` `THICKNESS` (얇게 1.0 / 보통 1.8 / 굵게 3.0)
- 빛나는 커서 크기·세기: `renderer.js` `HALO` (은은하게 72px·25%, 선명하게 104px·40%), `HALO_*`, `RING_PERIOD_MS`
- 클릭 파문: `RIPPLE_MS`·`RIPPLE_R` / 레이저 펜: `PEN_HOLD_MS`(2초)·`PEN_FADE_MS`(0.5초)
- 레이저 점: `renderer.js` `LASER_DIAMETER`, `LASER_TAIL_MS`
