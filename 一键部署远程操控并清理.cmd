@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Mutiny Relay - 通用远程操控

where node >nul 2>nul
if errorlevel 1 (
  where winget >nul 2>nul
  if errorlevel 1 (
    echo 未找到 Node.js 和 winget。请先安装 Node.js 22.13 或更高版本。
    pause
    exit /b 1
  )
  echo 未找到 Node.js，正在通过 winget 安装长期支持版……
  winget install --id OpenJS.NodeJS.LTS --exact --accept-package-agreements --accept-source-agreements
  set "PATH=%ProgramFiles%\nodejs;%PATH%"
)

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 已安装，但当前终端尚未刷新 PATH。请关闭窗口后重新双击本脚本。
  pause
  exit /b 1
)

call npm run control:start
if errorlevel 1 pause
