#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(CDPATH= cd "$SCRIPT_DIR/.." && pwd)"
PROJECT="$REPO_ROOT/tests/THEKIE.Qto.RevitStubTest/THEKIE.Qto.RevitStubTest.csproj"
TEST_DLL="$REPO_ROOT/tests/THEKIE.Qto.RevitStubTest/bin/Release/net8.0/THEKIE.Qto.RevitStubTest.dll"

if [ -x /private/tmp/thekie-dotnet/dotnet ]; then
    DOTNET_BIN=/private/tmp/thekie-dotnet/dotnet
elif command -v dotnet >/dev/null 2>&1; then
    DOTNET_BIN="$(command -v dotnet)"
else
    printf 'FAIL: dotnet was not found.\n' >&2
    exit 1
fi

for version in 2017 2022 2023 2024 2025 2026; do
    "$DOTNET_BIN" build "$PROJECT" -c Release -p:RevitStubVersion="$version" -m:1 --nologo
    "$DOTNET_BIN" "$TEST_DLL"
    printf 'Revit %s stub regression passed.\n' "$version"
done

printf 'All Revit stub regressions passed.\n'
