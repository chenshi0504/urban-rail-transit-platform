@echo off
chcp 65001 >nul
cd /d "%~dp0"
"C:\Users\Administrator\.workbuddy\binaries\python\envs\token-monitor\Scripts\python.exe" -X utf8 app.py
pause
