@echo off
REM ============================================================
REM  Lukas QTO - install add-in for all built Revit versions
REM
REM  ASCII ONLY. Do NOT put Korean text in this file.
REM  Do NOT save this file as UTF-8 with BOM.
REM  Save as ANSI (CP949) or pure ASCII, CRLF line endings.
REM
REM  Installs to the per-machine location:
REM    %ProgramData%\Autodesk\Revit\Addins\<version>\
REM  Requires Administrator. For per-user install use:
REM    %AppData%\Autodesk\Revit\Addins\<version>\
REM ============================================================

setlocal enabledelayedexpansion
pushd "%~dp0"

set VERSIONS=2017 2022 2023 2024 2025 2026
set SRCROOT=..\build\Release
set DESKTOP_SOURCE=..\build\desktop
set DESKTOP_MARKER=..\build\desktop\Lukas.Qto.Desktop.publish.ok
set FAILED=0
set INSTALLED=0
set DESKTOP_INSTALLED=0
set VALID_VERSION=0
set REQUIRED_SINGLE=0
set ADDIN_ONLY=0

if not "%~3"=="" (
    echo Usage: install.bat [2017^|2022^|2023^|2024^|2025^|2026] [addin-only]
    set FAILED=2
    goto :finish
)
if not "%~2"=="" (
    if /I not "%~2"=="addin-only" (
        echo Usage: install.bat [2017^|2022^|2023^|2024^|2025^|2026] [addin-only]
        set FAILED=2
        goto :finish
    )
    set ADDIN_ONLY=1
)
if not "%~1"=="" (
    for %%V in (%VERSIONS%) do if "%%V"=="%~1" set VALID_VERSION=1
    if "!VALID_VERSION!"=="0" (
        echo Usage: install.bat [2017^|2022^|2023^|2024^|2025^|2026]
        set FAILED=2
        goto :finish
    )
    set VERSIONS=%~1
    set REQUIRED_SINGLE=1
)

tasklist /FI "IMAGENAME eq Revit.exe" 2>nul | find /I "Revit.exe" >nul
if not errorlevel 1 (
    echo [FAIL] Revit is running. Close every Revit process before installing.
    set FAILED=1
    goto :finish
)

for %%V in (%VERSIONS%) do call :installVersion %%V
if !ADDIN_ONLY! EQU 0 call :installDesktop

goto :finish

:installVersion
set VERSION=%1
set TARGET=%ProgramData%\Autodesk\Revit\Addins\%VERSION%
set SOURCE=%SRCROOT%\%VERSION%
set MARKER=%SOURCE%\Lukas.Qto.build.ok
set SOURCE_DLL=%SOURCE%\Lukas.Qto.dll
set INSTALL_DIR=!TARGET!\Lukas.Qto
set TARGET_DLL=!INSTALL_DIR!\Lukas.Qto.dll
set TARGET_MANIFEST=!TARGET!\Lukas.Qto.addin
set LEGACY_MANIFEST=!TARGET!\THEKIE.Qto.addin
set LEGACY_DISABLED=!TARGET!\THEKIE.Qto.addin.disabled
set USER_TARGET=%APPDATA%\Autodesk\Revit\Addins\%VERSION%
set USER_MANIFEST=!USER_TARGET!\Lukas.Qto.addin
set USER_LEGACY_MANIFEST=!USER_TARGET!\THEKIE.Qto.addin
set TFM=net48
if %VERSION% EQU 2017 set TFM=net46
if %VERSION% GEQ 2025 set TFM=net8.0-windows
set REVIT_EXE=%ProgramW6432%\Autodesk\Revit %VERSION%\Revit.exe

if not exist "!REVIT_EXE!" (
    if !REQUIRED_SINGLE! EQU 1 (
        echo [FAIL] Revit %VERSION% executable is missing: !REVIT_EXE!
        set FAILED=1
    ) else (
        echo [SKIP] Revit %VERSION% not installed
    )
    exit /B 0
)
if not exist "!TARGET!" mkdir "!TARGET!"
if not exist "!TARGET!" (
    echo [FAIL] Cannot create Revit add-in folder: !TARGET!
    set FAILED=1
    exit /B 0
)

echo [INSTALL] Revit %VERSION%
if exist "!USER_MANIFEST!" (
    echo [FAIL] Revit %VERSION% already has a per-user Lukas.Qto.addin. Remove the per-user beta before a machine install: !USER_MANIFEST!
    set FAILED=1
    exit /B 0
)
if exist "!USER_LEGACY_MANIFEST!" (
    echo [FAIL] Revit %VERSION% already has a per-user THEKIE.Qto.addin. Remove the per-user legacy add-in before a machine install: !USER_LEGACY_MANIFEST!
    set FAILED=1
    exit /B 0
)
if not exist "!SOURCE_DLL!" (
    echo [FAIL] Revit %VERSION% production DLL is missing
    set FAILED=1
    exit /B 0
)
if not exist "!MARKER!" (
    echo [FAIL] Revit %VERSION% production build marker is missing
    set FAILED=1
    exit /B 0
)

set EXPECTED_API=%ProgramW6432%\Autodesk\Revit %VERSION%
set MARKERLINES=
for /F %%C in ('find /V /C "" ^< "!MARKER!"') do set MARKERLINES=%%C
if not "!MARKERLINES!"=="5" goto :invalidMarker
call :requireOneMarkerLine "!MARKER!" "RevitVersion=" "RevitVersion=%VERSION%"
if errorlevel 1 goto :invalidMarker
call :requireOneMarkerLine "!MARKER!" "TargetFramework=" "TargetFramework=!TFM!"
if errorlevel 1 goto :invalidMarker
call :requireOneMarkerLine "!MARKER!" "IsRevitStubBuild=" "IsRevitStubBuild=false"
if errorlevel 1 goto :invalidMarker
call :requireOneMarkerLine "!MARKER!" "RevitApiDir=" "RevitApiDir=!EXPECTED_API!"
if errorlevel 1 goto :invalidMarker
call :requireOneMarkerLine "!MARKER!" "AssemblySha256=" "AssemblySha256="
if errorlevel 1 goto :invalidMarker

set EXPECTEDHASH=
for /F "tokens=1,* delims==" %%A in ('findstr /X /R /C:"AssemblySha256=[0-9A-Fa-f][0-9A-Fa-f]*" "!MARKER!"') do set EXPECTEDHASH=%%B
set EXPECTEDHASH=!EXPECTEDHASH: =!
if "!EXPECTEDHASH:~63,1!"=="" goto :invalidMarker
if not "!EXPECTEDHASH:~64,1!"=="" goto :invalidMarker

set ACTUALHASH=
for /F "skip=1 tokens=*" %%H in ('certutil -hashfile "!SOURCE_DLL!" SHA256 2^>nul') do if not defined ACTUALHASH set ACTUALHASH=%%H
set ACTUALHASH=!ACTUALHASH: =!
if /I not "!ACTUALHASH!"=="!EXPECTEDHASH!" (
    echo [FAIL] Revit %VERSION% source DLL hash does not match its build marker
    set FAILED=1
    exit /B 0
)

if exist "!LEGACY_MANIFEST!" if exist "!LEGACY_DISABLED!" (
    echo [FAIL] Revit %VERSION% has both active and disabled legacy manifests; resolve them manually
    set FAILED=1
    exit /B 0
)
if not exist "!INSTALL_DIR!" mkdir "!INSTALL_DIR!"
if not exist "!INSTALL_DIR!" (
    echo [FAIL] Cannot create !INSTALL_DIR!
    set FAILED=1
    exit /B 0
)
if exist "!TARGET_DLL!.rollback" (
    echo [RECOVERY REQUIRED] Restore or archive !TARGET_DLL!.rollback before reinstalling
    set FAILED=1
    exit /B 0
)
if exist "!TARGET_MANIFEST!.rollback" (
    echo [RECOVERY REQUIRED] Restore or archive !TARGET_MANIFEST!.rollback before reinstalling
    set FAILED=1
    exit /B 0
)

copy /Y "!SOURCE_DLL!" "!TARGET_DLL!.new" >nul
if errorlevel 1 (
    echo [FAIL] Revit %VERSION% DLL staging failed
    set FAILED=1
    exit /B 0
)
set STAGEHASH=
for /F "skip=1 tokens=*" %%H in ('certutil -hashfile "!TARGET_DLL!.new" SHA256 2^>nul') do if not defined STAGEHASH set STAGEHASH=%%H
set STAGEHASH=!STAGEHASH: =!
if /I not "!STAGEHASH!"=="!EXPECTEDHASH!" (
    echo [FAIL] Revit %VERSION% staged DLL hash mismatch
    del /Q "!TARGET_DLL!.new" >nul 2>nul
    set FAILED=1
    exit /B 0
)

(
    echo ^<?xml version="1.0" encoding="utf-8"?^>
    echo ^<RevitAddIns^>
    echo   ^<AddIn Type="Application"^>
    echo     ^<Name^>Lukas QTO^</Name^>
    echo     ^<Assembly^>!TARGET_DLL!^</Assembly^>
    echo     ^<AddInId^>e36671a8-0944-465c-919e-1006dfd3610e^</AddInId^>
    echo     ^<FullClassName^>Lukas.Qto.App^</FullClassName^>
    echo     ^<VendorId^>LUKS^</VendorId^>
    echo     ^<VendorDescription^>Lukas^</VendorDescription^>
    echo   ^</AddIn^>
    echo ^</RevitAddIns^>
) > "!TARGET_MANIFEST!.new"
if errorlevel 1 (
    echo [FAIL] Revit %VERSION% manifest staging failed
    del /Q "!TARGET_DLL!.new" >nul 2>nul
    set FAILED=1
    exit /B 0
)

set HAD_DLL=0
set HAD_MANIFEST=0
set DISABLED_LEGACY=0
if exist "!TARGET_DLL!" (
    copy /Y "!TARGET_DLL!" "!TARGET_DLL!.rollback" >nul
    if errorlevel 1 goto :backupFailed
    set HAD_DLL=1
)
if exist "!TARGET_MANIFEST!" (
    copy /Y "!TARGET_MANIFEST!" "!TARGET_MANIFEST!.rollback" >nul
    if errorlevel 1 goto :backupFailed
    set HAD_MANIFEST=1
)
if exist "!LEGACY_MANIFEST!" (
    move /Y "!LEGACY_MANIFEST!" "!LEGACY_DISABLED!" >nul
    if errorlevel 1 goto :backupFailed
    set DISABLED_LEGACY=1
)

move /Y "!TARGET_MANIFEST!.new" "!TARGET_MANIFEST!" >nul
if errorlevel 1 goto :rollback
move /Y "!TARGET_DLL!.new" "!TARGET_DLL!" >nul
if errorlevel 1 goto :rollback

set INSTALLEDHASH=
for /F "skip=1 tokens=*" %%H in ('certutil -hashfile "!TARGET_DLL!" SHA256 2^>nul') do if not defined INSTALLEDHASH set INSTALLEDHASH=%%H
set INSTALLEDHASH=!INSTALLEDHASH: =!
if /I not "!INSTALLEDHASH!"=="!EXPECTEDHASH!" goto :rollback

del /Q "!TARGET_DLL!.rollback" "!TARGET_MANIFEST!.rollback" >nul 2>nul
if exist "!SOURCE!\Lukas.Qto.pdb" copy /Y "!SOURCE!\Lukas.Qto.pdb" "!INSTALL_DIR!\" >nul
set /A INSTALLED+=1
echo [OK] Revit %VERSION% -^> !TARGET!
if !DISABLED_LEGACY! EQU 1 echo [INFO] Legacy manifest retained as !LEGACY_DISABLED!
exit /B 0

:invalidMarker
echo [FAIL] Revit %VERSION% build marker content is invalid
set FAILED=1
exit /B 0

:backupFailed
echo [FAIL] Revit %VERSION% could not create a safe rollback state
if !DISABLED_LEGACY! EQU 1 move /Y "!LEGACY_DISABLED!" "!LEGACY_MANIFEST!" >nul
del /Q "!TARGET_DLL!.new" "!TARGET_MANIFEST!.new" "!TARGET_DLL!.rollback" "!TARGET_MANIFEST!.rollback" >nul 2>nul
set FAILED=1
exit /B 0

:rollback
echo [FAIL] Revit %VERSION% installation failed; restoring the previous state
set ROLLBACK_FAILED=0
if !HAD_DLL! EQU 1 (
    move /Y "!TARGET_DLL!.rollback" "!TARGET_DLL!" >nul
    if errorlevel 1 (
        echo [RECOVERY REQUIRED] DLL backup remains at !TARGET_DLL!.rollback
        set ROLLBACK_FAILED=1
    )
) else (
    del /Q "!TARGET_DLL!" >nul 2>nul
    if exist "!TARGET_DLL!" (
        echo [RECOVERY REQUIRED] Remove uncommitted DLL: !TARGET_DLL!
        set ROLLBACK_FAILED=1
    )
)
if !HAD_MANIFEST! EQU 1 (
    move /Y "!TARGET_MANIFEST!.rollback" "!TARGET_MANIFEST!" >nul
    if errorlevel 1 (
        echo [RECOVERY REQUIRED] Manifest backup remains at !TARGET_MANIFEST!.rollback
        set ROLLBACK_FAILED=1
    )
) else (
    del /Q "!TARGET_MANIFEST!" >nul 2>nul
    if exist "!TARGET_MANIFEST!" (
        echo [RECOVERY REQUIRED] Remove uncommitted manifest: !TARGET_MANIFEST!
        set ROLLBACK_FAILED=1
    )
)
if !DISABLED_LEGACY! EQU 1 (
    move /Y "!LEGACY_DISABLED!" "!LEGACY_MANIFEST!" >nul
    if errorlevel 1 (
        echo [RECOVERY REQUIRED] Restore legacy manifest from !LEGACY_DISABLED!
        set ROLLBACK_FAILED=1
    )
)
del /Q "!TARGET_DLL!.new" "!TARGET_MANIFEST!.new" >nul 2>nul
if !ROLLBACK_FAILED! EQU 0 echo [INFO] Revit %VERSION% previous installation was restored.
set FAILED=1
exit /B 0

:requireOneMarkerLine
set MARKER_COUNT=0
for /F "delims=" %%L in ('findstr /B /C:%2 %1') do set /A MARKER_COUNT+=1
if not "!MARKER_COUNT!"=="1" exit /B 1
if %3=="AssemblySha256=" exit /B 0
findstr /X /C:%3 %1 >nul 2>nul
exit /B !ERRORLEVEL!

:installDesktop
echo [INSTALL] Desktop
if not exist "!DESKTOP_SOURCE!\Lukas.Qto.Desktop.exe" (
    echo [FAIL] Desktop executable is missing
    set FAILED=1
    exit /B 0
)
if not exist "!DESKTOP_MARKER!" (
    echo [FAIL] Desktop publish marker is missing
    set FAILED=1
    exit /B 0
)
call :requireOneMarkerLine "!DESKTOP_MARKER!" "TargetFramework=" "TargetFramework=net8.0-windows"
if errorlevel 1 goto :invalidDesktopMarker
call :requireOneMarkerLine "!DESKTOP_MARKER!" "RuntimeIdentifier=" "RuntimeIdentifier=win-x64"
if errorlevel 1 goto :invalidDesktopMarker
call :requireOneMarkerLine "!DESKTOP_MARKER!" "SelfContained=" "SelfContained=false"
if errorlevel 1 goto :invalidDesktopMarker
findstr /B /C:"File=Lukas.Qto.Desktop.exe|" "!DESKTOP_MARKER!" >nul 2>nul
if errorlevel 1 goto :invalidDesktopMarker
call :verifyDesktopTree "!DESKTOP_SOURCE!" "!DESKTOP_MARKER!"
if errorlevel 1 (
    echo [FAIL] Desktop source hash verification failed
    set FAILED=1
    exit /B 0
)

set DESKTOP_ROOT=%ProgramFiles%\Lukas QTO
set DESKTOP_TARGET=!DESKTOP_ROOT!\Desktop
set DESKTOP_STAGE=!DESKTOP_ROOT!\Desktop.new
set DESKTOP_BACKUP=!DESKTOP_ROOT!\Desktop.rollback
if exist "!DESKTOP_STAGE!" (
    echo [RECOVERY REQUIRED] Remove or archive !DESKTOP_STAGE! before reinstalling
    set FAILED=1
    exit /B 0
)
if exist "!DESKTOP_BACKUP!" (
    echo [RECOVERY REQUIRED] Restore or archive !DESKTOP_BACKUP! before reinstalling
    set FAILED=1
    exit /B 0
)
if not exist "!DESKTOP_ROOT!" mkdir "!DESKTOP_ROOT!"
if not exist "!DESKTOP_ROOT!" (
    echo [FAIL] Cannot create !DESKTOP_ROOT!
    set FAILED=1
    exit /B 0
)
xcopy /E /I /Y "!DESKTOP_SOURCE!\*" "!DESKTOP_STAGE!\" >nul
if errorlevel 1 (
    echo [FAIL] Desktop staging failed
    if exist "!DESKTOP_STAGE!" rmdir /S /Q "!DESKTOP_STAGE!"
    set FAILED=1
    exit /B 0
)
call :verifyDesktopTree "!DESKTOP_STAGE!" "!DESKTOP_STAGE!\Lukas.Qto.Desktop.publish.ok"
if errorlevel 1 (
    echo [FAIL] Desktop staged file hash mismatch
    rmdir /S /Q "!DESKTOP_STAGE!"
    set FAILED=1
    exit /B 0
)

set HAD_DESKTOP=0
if exist "!DESKTOP_TARGET!" (
    move /Y "!DESKTOP_TARGET!" "!DESKTOP_BACKUP!" >nul
    if errorlevel 1 (
        echo [FAIL] Desktop could not create a safe rollback state
        rmdir /S /Q "!DESKTOP_STAGE!"
        set FAILED=1
        exit /B 0
    )
    set HAD_DESKTOP=1
)
move /Y "!DESKTOP_STAGE!" "!DESKTOP_TARGET!" >nul
if errorlevel 1 goto :rollbackDesktop
call :verifyDesktopTree "!DESKTOP_TARGET!" "!DESKTOP_TARGET!\Lukas.Qto.Desktop.publish.ok"
if errorlevel 1 goto :rollbackDesktop
if !HAD_DESKTOP! EQU 1 (
    rmdir /S /Q "!DESKTOP_BACKUP!"
    if exist "!DESKTOP_BACKUP!" (
        echo [RECOVERY REQUIRED] Installed Desktop is valid, but backup remains at !DESKTOP_BACKUP!
        set FAILED=1
        exit /B 0
    )
)
set DESKTOP_INSTALLED=1
echo [OK] Desktop -^> !DESKTOP_TARGET!
exit /B 0

:invalidDesktopMarker
echo [FAIL] Desktop publish marker content is invalid
set FAILED=1
exit /B 0

:verifyDesktopTree
set VERIFY_ROOT=%~1
set VERIFY_MARKER=%~2
set VERIFY_LISTED=0
set VERIFY_ACTUAL=0
set VERIFY_FAILED=0
for /F "delims=" %%D in ('dir /B /AD "%VERIFY_ROOT%" 2^>nul') do set VERIFY_FAILED=1
for /F "usebackq tokens=1,2,* delims=|" %%A in (`findstr /B /C:"File=" "%VERIFY_MARKER%"`) do (
    set VERIFY_ENTRY=%%A
    set VERIFY_FILE=!VERIFY_ENTRY:~5!
    set VERIFY_EXPECTED=%%B
    set VERIFY_HASH=
    if not "%%C"=="" (
        set VERIFY_FAILED=1
    ) else if not exist "%VERIFY_ROOT%\!VERIFY_FILE!" (
        set VERIFY_FAILED=1
    ) else (
        for /F "skip=1 tokens=*" %%H in ('certutil -hashfile "%VERIFY_ROOT%\!VERIFY_FILE!" SHA256 2^>nul') do if not defined VERIFY_HASH set VERIFY_HASH=%%H
        set VERIFY_HASH=!VERIFY_HASH: =!
        if /I not "!VERIFY_HASH!"=="!VERIFY_EXPECTED!" set VERIFY_FAILED=1
    )
    set /A VERIFY_LISTED+=1
)
for /F "delims=" %%F in ('dir /B /A-D "%VERIFY_ROOT%"') do if /I not "%%F"=="Lukas.Qto.Desktop.publish.ok" (
    set VERIFY_NAME_COUNT=0
    for /F "delims=" %%L in ('findstr /B /L /C:"File=%%F|" "%VERIFY_MARKER%"') do set /A VERIFY_NAME_COUNT+=1
    if not !VERIFY_NAME_COUNT! EQU 1 set VERIFY_FAILED=1
    set /A VERIFY_ACTUAL+=1
)
if !VERIFY_LISTED! EQU 0 set VERIFY_FAILED=1
if not !VERIFY_LISTED! EQU !VERIFY_ACTUAL! set VERIFY_FAILED=1
set VERIFY_LINES=0
for /F %%C in ('find /V /C "" ^< "%VERIFY_MARKER%"') do set VERIFY_LINES=%%C
set /A VERIFY_EXPECTED_LINES=VERIFY_ACTUAL+3
if not !VERIFY_LINES! EQU !VERIFY_EXPECTED_LINES! set VERIFY_FAILED=1
exit /B !VERIFY_FAILED!

:rollbackDesktop
echo [FAIL] Desktop installation failed; restoring the previous state
set DESKTOP_ROLLBACK_FAILED=0
if exist "!DESKTOP_TARGET!" (
    if exist "!DESKTOP_STAGE!" (
        echo [RECOVERY REQUIRED] Both uncommitted paths exist: !DESKTOP_TARGET! and !DESKTOP_STAGE!
        set DESKTOP_ROLLBACK_FAILED=1
    ) else (
        move /Y "!DESKTOP_TARGET!" "!DESKTOP_STAGE!" >nul
        if errorlevel 1 (
            echo [RECOVERY REQUIRED] Uncommitted Desktop remains at !DESKTOP_TARGET!
            set DESKTOP_ROLLBACK_FAILED=1
        )
    )
)
if !HAD_DESKTOP! EQU 1 if !DESKTOP_ROLLBACK_FAILED! EQU 0 (
    move /Y "!DESKTOP_BACKUP!" "!DESKTOP_TARGET!" >nul
    if errorlevel 1 (
        echo [RECOVERY REQUIRED] Desktop backup remains at !DESKTOP_BACKUP!
        set DESKTOP_ROLLBACK_FAILED=1
    )
)
if !HAD_DESKTOP! EQU 0 if exist "!DESKTOP_TARGET!" set DESKTOP_ROLLBACK_FAILED=1
if !DESKTOP_ROLLBACK_FAILED! EQU 0 if exist "!DESKTOP_STAGE!" rmdir /S /Q "!DESKTOP_STAGE!"
if !DESKTOP_ROLLBACK_FAILED! EQU 0 echo [INFO] Previous Desktop installation was restored.
set FAILED=1
exit /B 0

:finish
echo.
echo Installed versions: !INSTALLED!
echo Desktop installed: !DESKTOP_INSTALLED!
if !FAILED! EQU 0 (
    echo Done. Restart Revit to load the add-in.
) else (
    echo Installation failed or was incomplete. Review the messages above.
)
set EXITCODE=!FAILED!
popd
endlocal & exit /B %EXITCODE%
