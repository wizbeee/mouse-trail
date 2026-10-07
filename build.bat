@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo === Mouse Trail 빌드 스크립트 ===
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [!] Node.js가 설치되어 있지 않습니다.
  echo     https://nodejs.org/ko/  에서 LTS 버전을 설치한 뒤 다시 실행해주세요.
  echo.
  pause
  exit /b 1
)

echo [1/2] 의존성 설치 중...
call npm install
if errorlevel 1 (
  echo.
  echo [!] npm install 실패
  pause
  exit /b 1
)

echo.
echo [2/2] 설치파일 빌드 중... (수 분 소요)
call npm run dist
if errorlevel 1 (
  echo.
  echo [!] 빌드 실패
  pause
  exit /b 1
)

echo.
echo ============================================================
echo  빌드 완료!
echo  dist 폴더에서 'MouseTrail-Setup-x.x.x.exe' 를 실행해 설치하세요.
echo ============================================================
explorer dist
pause
