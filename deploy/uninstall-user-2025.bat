@echo off
setlocal
REM Per-user Lukas QTO beta uninstall. No elevation is required.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0uninstall-user-2025.ps1"
exit /b %ERRORLEVEL%
