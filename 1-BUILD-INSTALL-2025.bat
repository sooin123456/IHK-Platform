@echo off
REM Lukas QTO field test launcher. ASCII and CRLF only.
setlocal
pushd "%~dp0"

set EVIDENCE=%~dp0field-evidence
if not exist "%EVIDENCE%" mkdir "%EVIDENCE%"

tasklist /FI "IMAGENAME eq Revit.exe" 2>nul | find /I "Revit.exe" >nul
if not errorlevel 1 (
    echo [FAIL] Close every Revit window before building and installing.
    pause
    popd
    endlocal & exit /B 2
)

where dotnet >nul 2>nul
if errorlevel 1 goto :sdkMissing
set HAS_NET8_SDK=0
for /F "tokens=1" %%S in ('dotnet --list-sdks 2^>nul') do (
    echo %%S| findstr /B /C:"8." >nul && set HAS_NET8_SDK=1
)
if "%HAS_NET8_SDK%"=="0" goto :sdkMissing

echo [1/2] Building Lukas QTO for Revit 2025 and the Desktop verifier...
call "%~dp0deploy\build-all.bat" 2025 > "%EVIDENCE%\build-2025.log" 2>&1
set BUILD_EXIT=%ERRORLEVEL%
type "%EVIDENCE%\build-2025.log"
if not "%BUILD_EXIT%"=="0" (
    echo [FAIL] Build failed. Send field-evidence\build-2025.log.
    pause
    popd
    endlocal & exit /B %BUILD_EXIT%
)

echo [2/2] Installing Lukas QTO for the current Windows user...
call "%~dp0deploy\install-user-2025.bat" > "%EVIDENCE%\install-2025.log" 2>&1
set INSTALL_EXIT=%ERRORLEVEL%
type "%EVIDENCE%\install-2025.log"
if not "%INSTALL_EXIT%"=="0" (
    echo [FAIL] Installation failed. Send field-evidence\install-2025.log.
    pause
    popd
    endlocal & exit /B %INSTALL_EXIT%
)

echo Verifying the installed add-in files...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy\diagnose-revit-addin.ps1" -RevitVersion 2025 -Scope User -EvidencePath "%EVIDENCE%\Lukas-QTO-Revit-2025-diagnostic.json"
set DIAG_EXIT=%ERRORLEVEL%
if not "%DIAG_EXIT%"=="0" (
    echo [FAIL] Installation command finished, but the add-in files are not valid.
    echo Send the entire field-evidence folder.
    pause
    popd
    endlocal & exit /B %DIAG_EXIT%
)

echo [OK] Build and installation completed.
echo Close this window, start Revit 2025, and look for the "Lukas QTO" tab.
echo If the tab is missing, close Revit and run 2-DIAGNOSE-2025.bat.
pause
popd
endlocal & exit /B 0

:sdkMissing
echo [FAIL] .NET 8 SDK x64 is not installed.
echo Revit includes a runtime, but building Lukas QTO requires the SDK.
echo Download and install the .NET 8 SDK x64 from:
echo https://dotnet.microsoft.com/download/dotnet/8.0
echo Restart Windows after installation, then run this file again.
start "" "https://dotnet.microsoft.com/download/dotnet/8.0"
pause
popd
endlocal & exit /B 3
