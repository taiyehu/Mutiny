@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22.13 or newer is required.
  echo Download it from https://nodejs.org/ and run this file again.
  pause
  exit /b 1
)

if /I "%~1"=="--check" (
  echo Host launcher is ready.
  exit /b 0
)

echo Starting the Mutiny Relay host environment...
echo Keep this window open. Press Ctrl+C here to stop everything started by it.
call npm run control:start
set "exitCode=%errorlevel%"
if not "%exitCode%"=="0" pause
exit /b %exitCode%