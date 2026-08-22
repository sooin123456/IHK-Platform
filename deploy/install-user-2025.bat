@echo off
chcp 65001 >nul
setlocal
REM Per-user Lukas QTO beta install. No elevation is required.
if "%~1"=="" goto :full
if /I "%~1"=="addin-only" goto :addinOnly
echo Usage: install-user-2025.bat [addin-only]
endlocal & exit /b 2

:full
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-user-2025.ps1"
set RESULT=%ERRORLEVEL%
endlocal & exit /b %RESULT%

:addinOnly
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-user-2025.ps1" -AddinOnly
set RESULT=%ERRORLEVEL%
endlocal & exit /b %RESULT%
