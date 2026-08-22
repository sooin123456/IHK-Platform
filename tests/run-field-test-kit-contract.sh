#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(CDPATH= cd "$SCRIPT_DIR/.." && pwd)"
fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }

launcher="$REPO_ROOT/1-BUILD-INSTALL-2025.bat"
friendly="$REPO_ROOT/1-INSTALL-2025.bat"
diagnostic="$REPO_ROOT/deploy/diagnose-revit-addin.ps1"
packager="$REPO_ROOT/deploy/package-release.ps1"
addin_template="$REPO_ROOT/addin/Lukas.Qto.addin"
user_installer="$REPO_ROOT/deploy/install-user-2025.ps1"
machine_installer="$REPO_ROOT/deploy/install.bat"
diagnostic_launcher="$REPO_ROOT/2-DIAGNOSE-2025.bat"

for path in "$launcher" "$friendly" "$diagnostic" "$packager" "$addin_template" "$user_installer" "$machine_installer" "$diagnostic_launcher"; do
  test -f "$path" || fail "missing release contract file: $path"
done

launcher_text="$(tr -d '\r' < "$launcher")"
printf '%s\n' "$launcher_text" | grep -Fq 'build\Release\2025\Lukas.Qto.dll' || fail 'installer does not require the prebuilt DLL'
printf '%s\n' "$launcher_text" | grep -Fq 'install-user-2025.bat" addin-only' || fail 'installer does not use the isolated per-user add-in path'
printf '%s\n' "$launcher_text" | grep -Fq -- '-Scope Auto' || fail 'installer diagnostic does not inspect User and Machine locations'
if printf '%s\n' "$launcher_text" | grep -Eq 'dotnet --list-sdks|build-all\.bat|dotnet\.microsoft\.com/download'; then
  fail 'tester launcher still asks for an SDK or source build'
fi

grep -Fq '1-BUILD-INSTALL-2025.bat' "$friendly" || fail 'friendly installer does not delegate to the compatible entry point'
grep -Fq "ValidateSet('Auto', 'Machine', 'User')" "$diagnostic" || fail 'diagnostic has no Auto scope'
grep -Fq 'ProductVersion' "$diagnostic" || fail 'diagnostic does not record the Revit point build'
grep -Fq 'Duplicate valid add-ins' "$diagnostic" || fail 'diagnostic does not reject duplicate User/Machine installs'
if grep -Fq '@($candidates)' "$diagnostic" || grep -Fq '@($checks)' "$diagnostic"; then
  fail 'diagnostic uses a Windows PowerShell 5.1-incompatible generic-list array expression'
fi
grep -Fq '$candidates.ToArray()' "$diagnostic" || fail 'diagnostic does not materialize candidate manifests safely'
grep -Fq '$checks.ToArray()' "$diagnostic" || fail 'diagnostic does not materialize check results safely'

canonical_addin_id='e36671a8-0944-465c-919e-1006dfd3610e'
grep -Fqi "<AddInId>$canonical_addin_id</AddInId>" "$addin_template" || fail 'addin template does not use the canonical AddInId'
grep -Fqi "\$canonicalAddInId = '$canonical_addin_id'" "$user_installer" || fail 'per-user installer does not declare the canonical AddInId'
grep -Fq '<AddInId>$canonicalAddInId</AddInId>' "$user_installer" || fail 'per-user manifest does not use the canonical AddInId variable'
grep -Fqi "^<AddInId^>$canonical_addin_id^</AddInId^>" "$machine_installer" || fail 'machine installer does not use the canonical AddInId'

grep -Fq 'THEKIE.Qto.addin' "$diagnostic" || fail 'diagnostic does not inspect the legacy THEKIE manifest name'
grep -Fq 'THEKIE.Qto.addin' "$user_installer" || fail 'per-user installer does not handle the legacy THEKIE manifest name'
grep -Fq 'THEKIE.Qto.addin' "$machine_installer" || fail 'machine installer does not handle the legacy THEKIE manifest name'
grep -Fq 'Assert-NoActiveConflict (Join-Path $machineAddinRoot' "$user_installer" || fail 'per-user installer does not reject an active machine installation'
if grep -Fq 'Disable-KnownConflict' "$user_installer"; then
  fail 'per-user installer must not mutate a machine-wide installation'
fi
grep -Fq 'USER_MANIFEST' "$machine_installer" || fail 'machine installer does not reject a per-user duplicate'
grep -Fq "Add-Check 'installation_receipt'" "$diagnostic" || fail 'diagnostic does not bind the installed DLL to its receipt hash'

grep -Fq 'chcp 65001' "$launcher" || fail 'installer launcher does not select UTF-8 before writing field logs'
grep -Fq 'chcp 65001' "$diagnostic_launcher" || fail 'diagnostic launcher does not select UTF-8 before printing non-ASCII paths'
grep -Fq "[string[]]\$RevitVersions = @('2025')" "$packager" || fail 'official beta is not limited to Revit 2025 by default'
grep -Fq "'1-INSTALL-2025.bat'" "$packager" || fail 'release ZIP omits the friendly installer'
grep -Fq "prebuilt no-SDK install" "$packager" || fail 'release manifest does not identify the no-build package mode'

printf 'Field Test Kit contract passed: prebuilt Revit 2025 installer, Auto diagnostic, no tester SDK.\n'
