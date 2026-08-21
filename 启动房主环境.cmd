@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Mutiny Relay - 房主环境
where node >nul 2>nul
if errorlevel 1 (
  echo 未找到 Node.js，请先安装 Node.js 22.13 或更高版本。
  pause
  exit /b 1
)
call npm run host:start
if errorlevel 1 pause
