@echo off
chcp 65001 >nul
echo [WinVibe] 正在清洗环境并极速启动灵动岛...
set NODE_OPTIONS=
set HTTP_PROXY=
set HTTPS_PROXY=
set ALL_PROXY=

:: 优先以原生解包模式启动（0.2秒秒开，无需 7z 临时解压延迟）
if exist "%~dp0release\win-unpacked\WinVibe.exe" (
  start "" /D "%~dp0release\win-unpacked" "%~dp0release\win-unpacked\WinVibe.exe"
  exit /b 0
)

:: 备选：启动独立便携单文件版
if exist "%~dp0WinVibe.exe" (
  start "" "%~dp0WinVibe.exe"
  exit /b 0
)

:: 源码开发启动兜底
npm start
