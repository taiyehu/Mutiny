@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Mutiny Relay - Flash 播放器
where node >nul 2>nul
if errorlevel 1 (
  echo 未找到 Node.js，请先安装 Node.js 22.13 或更高版本。
  pause
  exit /b 1
)
call npm run flash:start
if errorlevel 1 pause
