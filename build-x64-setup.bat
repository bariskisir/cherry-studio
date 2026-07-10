@echo off
title Cherry Studio x64 Setup Build
cd /d "%~dp0"
echo [1/3] Installing dependencies...
echo.
call pnpm install --ignore-scripts
if %errorlevel% neq 0 (
  echo [ERROR] pnpm install failed!
  pause
  exit /b %errorlevel%
)
echo.
echo [2/3] Running pnpm build:win:x64...
echo.
cmd /c "pnpm build:win:x64"
if %errorlevel% neq 0 (
  echo [ERROR] Build failed!
  pause
  exit /b %errorlevel%
)
echo.
echo [3/3] Build completed!
echo.
dir /b "dist\*-setup.exe" 2>nul
echo.
pause
