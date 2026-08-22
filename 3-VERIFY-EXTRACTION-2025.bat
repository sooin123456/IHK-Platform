@echo off
REM Lukas QTO package verifier launcher. ASCII and CRLF only.
setlocal
pushd "%~dp0"

if "%~1"=="" goto :usage
if not exist "%~f1\" goto :usage

echo Verifying Lukas QTO export package:
echo %~f1
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy\verify-field-package.ps1" -PackageDirectory "%~f1" -ExpectedRevitVersion 2025
set VERIFY_EXIT=%ERRORLEVEL%

if "%VERIFY_EXIT%"=="0" (
    echo [OK] Package is complete. field-verification.json was written in the package folder.
) else (
    echo [FAIL] Read the failed checks above and send field-verification.json if help is needed.
)
pause
popd
endlocal & exit /B %VERIFY_EXIT%

:usage
echo [USAGE] Drag the final IFC-QTO package folder onto this file.
echo The folder must contain model.ifc, qto.csv, element-ledger.csv, and export-manifest.csv.
pause
popd
endlocal & exit /B 2
