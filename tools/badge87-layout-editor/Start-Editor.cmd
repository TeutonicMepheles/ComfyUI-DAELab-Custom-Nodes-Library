@echo off
cd /d "%~dp0"
if not exist node_modules\grapesjs\dist\grapes.min.js (
  call npm.cmd ci --no-audit --no-fund
  if errorlevel 1 exit /b 1
)
echo Open http://127.0.0.1:8177 in your browser.
call npm.cmd start
