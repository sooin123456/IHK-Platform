@echo off
REM Preferred friendly entry point. The legacy filename remains for existing download links.
call "%~dp01-BUILD-INSTALL-2025.bat"
exit /B %ERRORLEVEL%
