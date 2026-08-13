@echo off
REM Lukas QTO read-only diagnostic launcher. ASCII and CRLF only.
setlocal
pushd "%~dp0"

set EVIDENCE=%~dp0field-evidence
if not exist "%EVIDENCE%" mkdir "%EVIDENCE%"

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy\diagnose-revit-addin.ps1" -RevitVersion 2025 -Scope User -EvidencePath "%EVIDENCE%\Lukas-QTO-Revit-2025-diagnostic.json"
set DIAG_EXIT=%ERRORLEVEL%

if "%DIAG_EXIT%"=="0" (
    echo [OK] Installation files are present. Start Revit 2025 again.
) else (
    echo [FAIL] Read the failed checks above.
    echo Send field-evidence\Lukas-QTO-Revit-2025-diagnostic.json if help is needed.
)
pause
popd
endlocal & exit /B %DIAG_EXIT%
