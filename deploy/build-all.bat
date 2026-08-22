@echo off
REM ============================================================
REM  Lukas QTO - build for all supported Revit versions
REM
REM  ASCII ONLY. Do NOT put Korean text in this file.
REM  Do NOT save this file as UTF-8 with BOM.
REM  Save as ANSI (CP949) or pure ASCII, CRLF line endings.
REM ============================================================

setlocal EnableDelayedExpansion
pushd "%~dp0"

set VERSIONS=2017 2022 2023 2024 2025 2026
set PROJ=..\src\Lukas.Qto\Lukas.Qto.csproj
set PREFLIGHT=..\src\Lukas.Qto.Preflight\Lukas.Qto.Preflight.csproj
set DESKTOP=..\src\Lukas.Qto.Desktop\Lukas.Qto.Desktop.csproj
set DESKTOP_OUT=..\build\desktop
set DESKTOP_MARKER=..\build\desktop\Lukas.Qto.Desktop.publish.ok
set FAILED=0
set VALID_VERSION=0
set ADDIN_ONLY=0

where dotnet >nul 2>nul
if errorlevel 1 (
    echo [FAIL] .NET 8 SDK x64 is not installed or dotnet is not on PATH.
    echo Download: https://dotnet.microsoft.com/download/dotnet/8.0
    popd
    endlocal & exit /B 3
)
set HAS_NET8_SDK=0
for /F "tokens=1" %%S in ('dotnet --list-sdks 2^>nul') do (
    echo %%S| findstr /B /C:"8." >nul && set HAS_NET8_SDK=1
)
if "!HAS_NET8_SDK!"=="0" (
    echo [FAIL] .NET 8 SDK x64 is required. A runtime alone is not enough.
    echo Download: https://dotnet.microsoft.com/download/dotnet/8.0
    popd
    endlocal & exit /B 3
)

if not "%~3"=="" (
    echo Usage: build-all.bat [2017^|2022^|2023^|2024^|2025^|2026] [addin-only]
    popd
    endlocal & exit /B 2
)
if not "%~2"=="" (
    if /I not "%~2"=="addin-only" (
        echo Usage: build-all.bat [2017^|2022^|2023^|2024^|2025^|2026] [addin-only]
        popd
        endlocal & exit /B 2
    )
    set ADDIN_ONLY=1
)
if not "%~1"=="" (
    for %%V in (%VERSIONS%) do if "%%V"=="%~1" set VALID_VERSION=1
    if "!VALID_VERSION!"=="0" (
        echo Usage: build-all.bat [2017^|2022^|2023^|2024^|2025^|2026]
        popd
        endlocal & exit /B 2
    )
    set VERSIONS=%~1
)

for %%V in (%VERSIONS%) do (
    set TFM=net48
    if %%V EQU 2017 set TFM=net46
    if %%V GEQ 2025 set TFM=net8.0-windows
    echo.
    echo [BUILD] Revit %%V
    del /Q "..\build\Release\%%V\Lukas.Qto.build.ok" >nul 2>nul
    dotnet build "%PROJ%" -c Release -p:RevitVersion=%%V -p:TargetFramework=!TFM! -p:IsRevitStubBuild=false -p:RevitApiDir="%ProgramW6432%\Autodesk\Revit %%V"
    if errorlevel 1 (
        echo [FAIL] Revit %%V build failed - SDK or Revit API not found
        set FAILED=1
    ) else (
        call :validateBuildMarker %%V !TFM!
        if errorlevel 1 (
            echo [FAIL] Revit %%V build marker is incomplete or invalid
            del /Q "..\build\Release\%%V\Lukas.Qto.build.ok" >nul 2>nul
            set FAILED=1
        ) else (
            set BUILDHASH=
            for /F "skip=1 tokens=*" %%H in ('certutil -hashfile "..\build\Release\%%V\Lukas.Qto.dll" SHA256 2^>nul') do if not defined BUILDHASH set BUILDHASH=%%H
            set BUILDHASH=!BUILDHASH: =!
            set BUILDHASH=!BUILDHASH:a=A!
            set BUILDHASH=!BUILDHASH:b=B!
            set BUILDHASH=!BUILDHASH:c=C!
            set BUILDHASH=!BUILDHASH:d=D!
            set BUILDHASH=!BUILDHASH:e=E!
            set BUILDHASH=!BUILDHASH:f=F!
            if "!BUILDHASH:~63,1!"=="" (
                echo [FAIL] Revit %%V DLL SHA-256 could not be computed
                del /Q "..\build\Release\%%V\Lukas.Qto.build.ok" >nul 2>nul
                set FAILED=1
            ) else if not "!BUILDHASH:~64,1!"=="" (
                echo [FAIL] Revit %%V DLL SHA-256 is invalid
                del /Q "..\build\Release\%%V\Lukas.Qto.build.ok" >nul 2>nul
                set FAILED=1
            ) else (
                echo AssemblySha256=!BUILDHASH!>> "..\build\Release\%%V\Lukas.Qto.build.ok"
                set MARKERLINES=
                for /F %%C in ('find /V /C "" ^< "..\build\Release\%%V\Lukas.Qto.build.ok"') do set MARKERLINES=%%C
                findstr /X /C:"AssemblySha256=!BUILDHASH!" "..\build\Release\%%V\Lukas.Qto.build.ok" >nul 2>nul
                if errorlevel 1 (
                    echo [FAIL] Revit %%V assembly hash marker is invalid
                    del /Q "..\build\Release\%%V\Lukas.Qto.build.ok" >nul 2>nul
                    set FAILED=1
                ) else if not "!MARKERLINES!"=="5" (
                    echo [FAIL] Revit %%V build marker must contain exactly five lines
                    del /Q "..\build\Release\%%V\Lukas.Qto.build.ok" >nul 2>nul
                    set FAILED=1
                ) else (
                    echo [OK] Revit %%V
                )
            )
        )
    )
)

if !ADDIN_ONLY! EQU 1 goto :buildFinish

echo.
echo [PUBLISH] Preflight CLI
if exist "..\build\preflight" rmdir /S /Q "..\build\preflight"
dotnet publish "%PREFLIGHT%" -c Release -o ..\build\preflight
if errorlevel 1 (
    echo [FAIL] Preflight publish failed - .NET 8 SDK required
    set FAILED=1
) else if not exist "..\build\preflight\Lukas.Qto.Preflight.exe" (
    echo [FAIL] Preflight executable is missing
    set FAILED=1
) else (
    echo [OK] Preflight: ..\build\preflight\Lukas.Qto.Preflight.exe
)

echo.
echo [PUBLISH] Desktop win-x64 framework-dependent
if exist "%DESKTOP_OUT%" rmdir /S /Q "%DESKTOP_OUT%"
dotnet publish "%DESKTOP%" -c Release -r win-x64 --self-contained false -o "%DESKTOP_OUT%"
if errorlevel 1 (
    echo [FAIL] Desktop publish failed - .NET 8 SDK required
    set FAILED=1
) else if not exist "%DESKTOP_OUT%\Lukas.Qto.Desktop.exe" (
    echo [FAIL] Desktop executable is missing
    set FAILED=1
) else (
    > "%DESKTOP_MARKER%" echo TargetFramework=net8.0-windows
    >> "%DESKTOP_MARKER%" echo RuntimeIdentifier=win-x64
    >> "%DESKTOP_MARKER%" echo SelfContained=false
    set DESKTOP_FILES=0
    set DESKTOP_HASH_FAILED=0
    for /F "delims=" %%D in ('dir /B /AD "%DESKTOP_OUT%" 2^>nul') do set DESKTOP_HASH_FAILED=1
    for /F "delims=" %%F in ('dir /B /A-D /ON "%DESKTOP_OUT%"') do if /I not "%%F"=="Lukas.Qto.Desktop.publish.ok" (
        set DESKTOP_HASH=
        for /F "skip=1 tokens=*" %%H in ('certutil -hashfile "%DESKTOP_OUT%\%%F" SHA256 2^>nul') do if not defined DESKTOP_HASH set DESKTOP_HASH=%%H
        set DESKTOP_HASH=!DESKTOP_HASH: =!
        set DESKTOP_HASH=!DESKTOP_HASH:a=A!
        set DESKTOP_HASH=!DESKTOP_HASH:b=B!
        set DESKTOP_HASH=!DESKTOP_HASH:c=C!
        set DESKTOP_HASH=!DESKTOP_HASH:d=D!
        set DESKTOP_HASH=!DESKTOP_HASH:e=E!
        set DESKTOP_HASH=!DESKTOP_HASH:f=F!
        if "!DESKTOP_HASH:~63,1!"=="" set DESKTOP_HASH_FAILED=1
        if not "!DESKTOP_HASH:~64,1!"=="" set DESKTOP_HASH_FAILED=1
        if !DESKTOP_HASH_FAILED! EQU 0 (
            >> "%DESKTOP_MARKER%" echo File=%%F^|!DESKTOP_HASH!
            set /A DESKTOP_FILES+=1
        )
    )
    if !DESKTOP_HASH_FAILED! EQU 1 (
        echo [FAIL] Desktop publish must be flat and every file must have a SHA-256
        del /Q "%DESKTOP_MARKER%" >nul 2>nul
        set FAILED=1
    ) else if !DESKTOP_FILES! EQU 0 (
        echo [FAIL] Desktop publish contains no files
        del /Q "%DESKTOP_MARKER%" >nul 2>nul
        set FAILED=1
    ) else (
        echo [OK] Desktop: %DESKTOP_OUT%\Lukas.Qto.Desktop.exe
    )
)

:buildFinish
echo.
if !ADDIN_ONLY! EQU 1 (
    echo Done. Add-in output: ..\build\Release\^<version^>\
) else (
    echo Done. Output: ..\build\Release\^<version^>\, ..\build\preflight\, and ..\build\desktop\
)
if !FAILED! EQU 1 echo One or more builds failed. Review the messages above.
set EXITCODE=!FAILED!
popd
endlocal & exit /B %EXITCODE%

:validateBuildMarker
set CHECK_VERSION=%1
set CHECK_TFM=%2
set CHECK_MARKER=..\build\Release\%CHECK_VERSION%\Lukas.Qto.build.ok
set CHECK_API=%ProgramW6432%\Autodesk\Revit %CHECK_VERSION%
if not exist "%CHECK_MARKER%" exit /B 1
set CHECK_LINES=
for /F %%C in ('find /V /C "" ^< "%CHECK_MARKER%"') do set CHECK_LINES=%%C
if not "%CHECK_LINES%"=="4" exit /B 1
call :requireOneMarkerLine "%CHECK_MARKER%" "RevitVersion=" "RevitVersion=%CHECK_VERSION%"
if errorlevel 1 exit /B 1
call :requireOneMarkerLine "%CHECK_MARKER%" "TargetFramework=" "TargetFramework=%CHECK_TFM%"
if errorlevel 1 exit /B 1
call :requireOneMarkerLine "%CHECK_MARKER%" "IsRevitStubBuild=" "IsRevitStubBuild=false"
if errorlevel 1 exit /B 1
call :requireOneMarkerLine "%CHECK_MARKER%" "RevitApiDir=" "RevitApiDir=%CHECK_API%"
exit /B %ERRORLEVEL%

:requireOneMarkerLine
set CHECK_COUNT=0
for /F "delims=" %%L in ('findstr /B /C:%2 %1') do set /A CHECK_COUNT+=1
if not "%CHECK_COUNT%"=="1" exit /B 1
findstr /X /C:%3 %1 >nul 2>nul
exit /B %ERRORLEVEL%
