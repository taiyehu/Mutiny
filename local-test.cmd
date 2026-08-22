@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22.13 or newer is required.
  exit /b 1
)

if not exist "node_modules\vinext" (
  echo Installing project dependencies...
  call npm ci
  if errorlevel 1 exit /b 1
)

if /I "%~1"=="--check" (
  echo Local test launcher is ready.
  exit /b 0
)

echo Starting the local web and signaling services...
start "Mutiny Dev" /D "%~dp0" cmd /k "npm run dev"
timeout /t 2 /nobreak >nul
echo Starting the local input companion...
start "Mutiny Companion" /D "%~dp0" cmd /k "npm run companion:arm"
echo Local test services were opened in two terminal windows.
echo Stop both windows with Ctrl+C when testing is complete.