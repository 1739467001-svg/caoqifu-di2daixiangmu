@echo off
cd /d "%~dp0"
set "YOUTH_NODE=C:\Users\xyzaa\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if not exist "%YOUTH_NODE%" set "YOUTH_NODE=node"
echo Local website: http://127.0.0.1:4173/
echo Keep this window open while using the website.
start "" "http://127.0.0.1:4173/"
"%YOUTH_NODE%" preview.cjs
pause
