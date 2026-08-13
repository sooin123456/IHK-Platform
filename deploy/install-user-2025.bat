@echo off
setlocal
REM Per-user Lukas QTO beta install. No elevation is required.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-user-2025.ps1"
exit /b %ERRORLEVEL%
