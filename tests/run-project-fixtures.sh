#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 || ! -d "$1" ]]; then
  echo "Usage: $0 <kindergarten-project-folder>" >&2
  exit 2
fi

ROOT=$1
REPO=$(cd "$(dirname "$0")/.." && pwd -P)
if [[ -x /private/tmp/lukas-dotnet/dotnet ]]; then
  DOTNET=/private/tmp/lukas-dotnet/dotnet
else
  DOTNET=$(command -v dotnet || true)
fi
if [[ -z "$DOTNET" ]]; then
  echo "dotnet not found" >&2
  exit 2
fi

find_one() {
  local pattern=$1
  local matches=()
  while IFS= read -r -d '' candidate; do matches+=("$candidate"); done < <(find "$ROOT" -type f -name "$pattern" -print0)
  if [[ ${#matches[@]} -ne 1 ]]; then
    echo "Expected exactly one '$pattern' under $ROOT, found ${#matches[@]}" >&2
    exit 2
  fi
  printf '%s' "${matches[0]}"
}

X0910=$(find_one '*0910*.xlsx')
EMS7=$(find_one 'EMS7_*.xlsx')
X0614=$(find_one '*0614.xlsx')
X0614_1=$(find_one '*0614_1.xlsx')
ZG02=$(find_one 'ZG240507_02*')
ZG03=$(find_one 'ZG240507_03*')
ZJ01=$(find_one 'ZJ240507_01*')
ZG04A=$(find_one 'ZG240507_04A*')
ZJ02=$(find_one 'ZJ240507_02*')

export DOTNET_CLI_HOME=${DOTNET_CLI_HOME:-/private/tmp/lukas-dotnet-home}
export NUGET_PACKAGES=${NUGET_PACKAGES:-/private/tmp/lukas-nuget}
"$DOTNET" build "$REPO/src/Lukas.Qto.Preflight/Lukas.Qto.Preflight.csproj" -c Release --no-restore -p:UseSharedCompilation=false >/dev/null
"$DOTNET" build "$REPO/tests/Lukas.Qto.StructuralFixtureTest/Lukas.Qto.StructuralFixtureTest.csproj" -c Release --no-restore -p:UseSharedCompilation=false >/dev/null

"$DOTNET" "$REPO/tests/Lukas.Qto.StructuralFixtureTest/bin/Release/net8.0/Lukas.Qto.StructuralFixtureTest.dll" \
  "$ZG02" "$ZG03" "$ZJ01" "$ZG04A" "$ZJ02"

TMP_DIR=$(mktemp -d "/private/tmp/lukas-project-fixtures.XXXXXX")
trap 'rm -rf "$TMP_DIR"' EXIT
CLI="$REPO/src/Lukas.Qto.Preflight/bin/Release/net8.0/Lukas.Qto.Preflight.dll"

assert_count() {
  local report=$1 rule=$2 status=$3 expected=$4
  local actual
  actual=$(awk -F, -v rule="$rule" -v status="$status" 'NR > 1 { gsub(/^"|"$/, "", $1); gsub(/^"|"$/, "", $2); if ($1 == rule && $2 == status) count++ } END { print count + 0 }' "$report")
  if [[ "$actual" -ne "$expected" ]]; then
    echo "$(basename "$report"): expected $rule/$status=$expected, actual=$actual" >&2
    exit 1
  fi
}

run_ems() {
  local label=$1 workbook=$2 r010=$3 r011_pass=$4 r011_ne=$5 r012_pass=$6 r012_ne=$7
  local report="$TMP_DIR/$label.csv"
  set +e
  "$DOTNET" "$CLI" --unsafe-no-source-gate "$REPO/samples/empty-qto.csv" "$workbook" \
    "$REPO/samples/empty-mapping.csv" "$report" >/dev/null
  local code=$?
  set -e
  if [[ $code -ne 3 ]]; then
    echo "$label: diagnostic preflight must exit 3, actual=$code" >&2
    exit 1
  fi
  assert_count "$report" R010 PASS "$r010"
  assert_count "$report" R011 PASS "$r011_pass"
  assert_count "$report" R011 NOT_EVALUATED "$r011_ne"
  assert_count "$report" R012 PASS "$r012_pass"
  assert_count "$report" R012 NOT_EVALUATED "$r012_ne"
  assert_count "$report" S000 REVIEW 1
  assert_count "$report" R010 FAIL 0
  assert_count "$report" R011 FAIL 0
  assert_count "$report" R012 FAIL 0
  echo "$label EMS regression passed."
}

run_ems 0910 "$X0910" 96 94 2 8 0
run_ems EMS7 "$EMS7" 96 94 2 8 0
run_ems 0614 "$X0614" 191 188 3 6 2
run_ems 0614_1 "$X0614_1" 186 183 3 6 2

echo "Project fixture regressions passed."
