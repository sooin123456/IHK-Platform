@echo off
chcp 65001 >nul
REM Hangil System Revit 2025 beta installer. Prebuilt package only; no SDK or build required.
setlocal
pushd "%~dp0"
set EVIDENCE=%~dp0field-evidence
if not exist "%EVIDENCE%" mkdir "%EVIDENCE%"

tasklist /FI "IMAGENAME eq Revit.exe" 2>nul | find /I "Revit.exe" >nul
if not errorlevel 1 (
  echo [FAIL] Close every Revit window, then run this file again.
  pause
  popd
  endlocal & exit /B 2
)

if not exist "%~dp0build\Release\2025\Lukas.Qto.dll" (
  echo [FAIL] The prebuilt Revit 2025 DLL is missing from this ZIP.
  echo Download the complete official beta ZIP again. Do not install the source kit.
  pause
  popd
  endlocal & exit /B 3
)

echo [1/2] Installing the verified Hangil System add-in for this Windows user...
call "%~dp0deploy\install-user-2025.bat" addin-only > "%EVIDENCE%\install-2025.log" 2>&1
set INSTALL_EXIT=%ERRORLEVEL%
type "%EVIDENCE%\install-2025.log"
if not "%INSTALL_EXIT%"=="0" goto :failed

echo [2/2] Checking both user and machine Revit add-in locations...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy\diagnose-revit-addin.ps1" -RevitVersion 2025 -Scope Auto -EvidencePath "%EVIDENCE%\Hangil-Revit-2025-diagnostic.json"
set DIAG_EXIT=%ERRORLEVEL%
if not "%DIAG_EXIT%"=="0" goto :diagnosticFailed

echo [OK] Installation completed. Start Revit 2025 and open the newly added product tab.
echo The exact Korean tab name is shown in FIELD_TEST_README.md.
echo No .NET SDK or source build was required.
pause
popd
endlocal & exit /B 0

:diagnosticFailed
echo [FAIL] Files were installed, but verification found an old or duplicate add-in.
echo Do not reinstall repeatedly. Send the entire field-evidence folder for repair guidance.
pause
popd
endlocal & exit /B 1

:failed
echo [FAIL] Installation was not completed. Send the entire field-evidence folder.
pause
popd
endlocal & exit /B 1
