@echo off
rem Double-click to install the AL POS desktop app on this computer.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Install-AL-POS.ps1" %*
echo.
pause
