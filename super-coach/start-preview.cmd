@echo off
setlocal
cd /d "%~dp0"
set "COACH_NODE=node"
where node >nul 2>nul
if errorlevel 1 (
  if exist "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" (
    set "COACH_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
  ) else (
    echo Please install Node.js 24 or later, then try again.
    pause
    exit /b 1
  )
)
echo Tanxun: http://127.0.0.1:3210
"%COACH_NODE%" --env-file-if-exists=.env server.mjs
pause
