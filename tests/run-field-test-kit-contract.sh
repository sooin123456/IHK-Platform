#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(CDPATH= cd "$SCRIPT_DIR/.." && pwd)"
ZIP="$REPO_ROOT/site/public/downloads/Lukas-QTO-0.1.0-field-test.zip"
SHA_FILE="$ZIP.sha256"
PREFIX="Lukas-QTO-0.1.0-field-test"

fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }

test -f "$ZIP" || fail "field-test ZIP is missing"
test -f "$SHA_FILE" || fail "field-test SHA file is missing"
unzip -t "$ZIP" >/dev/null || fail "field-test ZIP is corrupt"

expected="$(awk 'NR==1 { print $1 }' "$SHA_FILE")"
actual="$(shasum -a 256 "$ZIP" | awk '{ print $1 }')"
test "$expected" = "$actual" || fail "field-test ZIP SHA mismatch"

listing="$(unzip -Z1 "$ZIP")"
for required in \
    "$PREFIX/1-BUILD-INSTALL-2025.bat" \
    "$PREFIX/2-DIAGNOSE-2025.bat" \
    "$PREFIX/deploy/build-all.bat" \
    "$PREFIX/deploy/install.bat" \
    "$PREFIX/deploy/diagnose-revit-addin.ps1" \
    "$PREFIX/deploy/verify-properties-ledger.ps1" \
    "$PREFIX/src/THEKIE.Qto/THEKIE.Qto.csproj" \
    "$PREFIX/FIELD_TEST_README.md"; do
    printf '%s\n' "$listing" | grep -Fqx "$required" || fail "missing ZIP entry: $required"
done

if printf '%s\n' "$listing" | grep -Eq '(^|/)(__MACOSX|bin|obj)(/|$)'; then
    fail "ZIP contains generated or macOS metadata"
fi

launcher="$(unzip -p "$ZIP" "$PREFIX/1-BUILD-INSTALL-2025.bat" | tr -d '\r')"
printf '%s\n' "$launcher" | grep -Fq 'pushd "%~dp0"' || fail "launcher is not path-independent"
printf '%s\n' "$launcher" | grep -Fq 'deploy\build-all.bat" 2025' || fail "launcher does not build Revit 2025"
printf '%s\n' "$launcher" | grep -Fq 'deploy\install.bat" 2025' || fail "launcher does not install Revit 2025"
printf '%s\n' "$launcher" | grep -Fq 'build-all.bat" 2025 addin-only' || fail "field launcher lets unrelated Desktop errors block the add-in build"
printf '%s\n' "$launcher" | grep -Fq 'install.bat" 2025 addin-only' || fail "field launcher installs unrelated Desktop components"
printf '%s\n' "$launcher" | grep -Fq 'dotnet --list-sdks' || fail "launcher does not detect the .NET 8 SDK"
printf '%s\n' "$launcher" | grep -Fq 'https://dotnet.microsoft.com/download/dotnet/8.0' || fail "launcher does not provide the official SDK download page"

builder="$(unzip -p "$ZIP" "$PREFIX/deploy/build-all.bat" | tr -d '\r')"
printf '%s\n' "$builder" | grep -Fq 'dotnet --list-sdks' || fail "builder does not detect the .NET 8 SDK"
printf '%s\n' "$builder" | grep -Fq 'Preflight executable is missing' || fail "builder can falsely report a missing Preflight executable as OK"
printf '%s\n' "$builder" | grep -Fq 'if !ADDIN_ONLY! EQU 1 goto :buildFinish' || fail "builder does not isolate the add-in field test"

installer="$(unzip -p "$ZIP" "$PREFIX/deploy/install.bat" | tr -d '\r')"
printf '%s\n' "$installer" | grep -Fq 'set REVIT_EXE=%ProgramW6432%\Autodesk\Revit %VERSION%\Revit.exe' || fail "installer does not check Revit.exe"
printf '%s\n' "$installer" | grep -Fq 'if not exist "!TARGET!" mkdir "!TARGET!"' || fail "installer does not create add-in folder"
printf '%s\n' "$installer" | grep -Fq 'if !ADDIN_ONLY! EQU 0 call :installDesktop' || fail "installer does not isolate the add-in field test"

element_extractor="$(unzip -p "$ZIP" "$PREFIX/src/THEKIE.Qto/Core/ElementQuantityExtractor.cs")"
quantity_extractor="$(unzip -p "$ZIP" "$PREFIX/src/THEKIE.Qto/Core/QuantityExtractor.cs")"
if printf '%s\n%s\n' "$element_extractor" "$quantity_extractor" | grep -Eq 'PROPERTY_(VOLUME|AREA)_PARAM'; then
    fail "add-in references BuiltInParameter names absent from the real Revit 2025 API"
fi

page_hash="$(sed -n 's/.*sha256: "\([0-9a-f]\{64\}\)".*/\1/p' "$REPO_ROOT/site/app/page.tsx")"
test "$page_hash" = "$actual" || fail "website SHA does not match downloadable ZIP"

printf 'Field Test Kit contract passed: %s\n' "$actual"
