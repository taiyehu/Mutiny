@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22.13 or newer is required.
  exit /b 1
)

if /I "%~1"=="--check" (
  echo Flash player launcher is ready.
  exit /b 0
)

call npm run flash:start
set "exitCode=%errorlevel%"
if not "%exitCode%"=="0" pause
exit /b %exitCode%