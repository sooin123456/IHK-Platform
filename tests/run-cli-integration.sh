#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(CDPATH= cd "$SCRIPT_DIR/.." && pwd)"
PROJECT="$REPO_ROOT/src/THEKIE.Qto.Preflight/THEKIE.Qto.Preflight.csproj"
CLI_DLL="$REPO_ROOT/src/THEKIE.Qto.Preflight/bin/Release/net8.0/THEKIE.Qto.Preflight.dll"

if [ -x /private/tmp/thekie-dotnet/dotnet ]; then
    DOTNET_BIN=/private/tmp/thekie-dotnet/dotnet
elif command -v dotnet >/dev/null 2>&1; then
    DOTNET_BIN="$(command -v dotnet)"
else
    printf 'FAIL: dotnet was not found.\n' >&2
    exit 1
fi

TEMP_PARENT="${TMPDIR:-/private/tmp}"
TEMP_PARENT="$(CDPATH= cd "$TEMP_PARENT" && pwd -P)"
if [ "$TEMP_PARENT" != / ]; then
    TEMP_PARENT="${TEMP_PARENT%/}"
fi
WORK_DIR="$(mktemp -d "$TEMP_PARENT/thekie-cli-integration.XXXXXX")"

cleanup() {
    if [ -n "$WORK_DIR" ] && [ -d "$WORK_DIR" ]; then
        case "$WORK_DIR" in
            "$TEMP_PARENT"/thekie-cli-integration.*) rm -rf "$WORK_DIR" ;;
            *) printf 'WARNING: refusing to clean unexpected path: %s\n' "$WORK_DIR" >&2 ;;
        esac
    fi
}
trap cleanup EXIT
trap 'exit 130' HUP INT TERM

fail() {
    printf 'FAIL: %s\n' "$*" >&2
    exit 1
}

run_expect() {
    local expected label stdout_file stderr_file actual
    expected="$1"
    label="$2"
    shift 2
    stdout_file="$WORK_DIR/$label.stdout"
    stderr_file="$WORK_DIR/$label.stderr"

    set +e
    "$@" >"$stdout_file" 2>"$stderr_file"
    actual=$?
    set -e

    if [ "$actual" -ne "$expected" ]; then
        printf 'FAIL: %s exited %s; expected %s.\n' "$label" "$actual" "$expected" >&2
        printf '%s\n' '--- stdout ---' >&2
        sed -n '1,120p' "$stdout_file" >&2
        printf '%s\n' '--- stderr ---' >&2
        sed -n '1,120p' "$stderr_file" >&2
        exit 1
    fi
}

assert_file() {
    [ -f "$1" ] || fail "missing file: $1"
}

assert_rule_status() {
    local report rule status
    report="$1"
    rule="$2"
    status="$3"
    if ! awk -F, -v expected_rule="$rule" -v expected_status="$status" '
        {
            value = $2
            sub(/\r$/, "", value)
            if ($1 == expected_rule && value == expected_status) found = 1
        }
        END { exit(found ? 0 : 1) }
    ' "$report"; then
        fail "$report does not contain $rule,$status"
    fi
}

assert_has_r_rule() {
    if ! awk -F, '
        $1 ~ /^R[0-9][0-9][0-9]$/ { found = 1 }
        END { exit(found ? 0 : 1) }
    ' "$1"; then
        fail "$1 does not contain an R rule"
    fi
}

assert_no_r_rule() {
    if awk -F, '
        $1 ~ /^R[0-9][0-9][0-9]$/ { found = 1 }
        END { exit(found ? 0 : 1) }
    ' "$1"; then
        fail "$1 unexpectedly contains an R rule"
    fi
}

assert_manifest_value() {
    local manifest key expected
    manifest="$1"
    key="$2"
    expected="$3"
    if ! awk -F, -v expected_key="$key" -v expected_value="$expected" '
        {
            value = $2
            sub(/\r$/, "", value)
            if ($1 == expected_key && value == expected_value) found = 1
        }
        END { exit(found ? 0 : 1) }
    ' "$manifest"; then
        fail "$manifest does not contain $key=$expected"
    fi
}

assert_manifest_hex64() {
    local manifest key
    manifest="$1"
    key="$2"
    if ! awk -F, -v expected_key="$key" '
        {
            value = $2
            sub(/\r$/, "", value)
            if ($1 == expected_key && length(value) == 64 && value !~ /[^0-9A-Fa-f]/) found = 1
        }
        END { exit(found ? 0 : 1) }
    ' "$manifest"; then
        fail "$manifest does not contain a 64-digit hexadecimal $key"
    fi
}

manifest_value() {
    local manifest key
    manifest="$1"
    key="$2"
    awk -F, -v expected_key="$key" '$1 == expected_key { sub(/\r$/, "", $2); print $2; exit }' "$manifest"
}

file_sha256() {
    if command -v sha256sum >/dev/null 2>&1; then
        sha256sum "$1" | awk '{print toupper($1)}'
    else
        shasum -a 256 "$1" | awk '{print toupper($1)}'
    fi
}

run_expect 0 build-release "$DOTNET_BIN" build "$PROJECT" -c Release --no-restore --nologo
assert_file "$CLI_DLL"

RUN_DIR="$WORK_DIR/samples"
BASELINE_DIR="$WORK_DIR/baseline"
mkdir -p "$RUN_DIR" "$BASELINE_DIR"
cp -R "$REPO_ROOT/samples/." "$RUN_DIR/"

for input_name in source-manifest.csv qto.csv estimate.csv mapping.csv; do
    cp "$RUN_DIR/$input_name" "$BASELINE_DIR/$input_name"
done

SOURCE_MANIFEST="$RUN_DIR/source-manifest.csv"
QTO="$RUN_DIR/qto.csv"
ESTIMATE="$RUN_DIR/estimate.csv"
MAPPING="$RUN_DIR/mapping.csv"

SAFE_REPORT="$RUN_DIR/safe-report.csv"
run_expect 0 safe-run "$DOTNET_BIN" "$CLI_DLL" \
    --sources "$SOURCE_MANIFEST" "$QTO" "$ESTIMATE" "$MAPPING" "$SAFE_REPORT"
assert_file "$SAFE_REPORT"
assert_file "$SAFE_REPORT.html"
assert_file "$SAFE_REPORT.manifest.csv"
for rule in S001 S002 S003 S004 S005; do
    assert_rule_status "$SAFE_REPORT" "$rule" PASS
done
assert_has_r_rule "$SAFE_REPORT"
assert_manifest_hex64 "$SAFE_REPORT.manifest.csv" "엔진_코어_SHA256"
assert_manifest_hex64 "$SAFE_REPORT.manifest.csv" "엔진_CLI_SHA256"
assert_manifest_hex64 "$SAFE_REPORT.manifest.csv" "결과_CSV_SHA256"
assert_manifest_value "$SAFE_REPORT.manifest.csv" "결과_CSV_파일" "safe-report.csv"
[ "$(manifest_value "$SAFE_REPORT.manifest.csv" "결과_CSV_SHA256")" = "$(file_sha256 "$SAFE_REPORT")" ] || fail "safe report hash does not match its manifest"
assert_manifest_value "$SAFE_REPORT.manifest.csv" "소스게이트" PASS

CONCURRENT_REPORT="$RUN_DIR/concurrent-report.csv"
set +e
"$DOTNET_BIN" "$CLI_DLL" --sources "$SOURCE_MANIFEST" "$QTO" "$ESTIMATE" "$MAPPING" "$CONCURRENT_REPORT" >"$WORK_DIR/concurrent-1.stdout" 2>"$WORK_DIR/concurrent-1.stderr" &
concurrent_pid_1=$!
"$DOTNET_BIN" "$CLI_DLL" --sources "$SOURCE_MANIFEST" "$QTO" "$ESTIMATE" "$MAPPING" "$CONCURRENT_REPORT" >"$WORK_DIR/concurrent-2.stdout" 2>"$WORK_DIR/concurrent-2.stderr" &
concurrent_pid_2=$!
wait "$concurrent_pid_1"
concurrent_status_1=$?
wait "$concurrent_pid_2"
concurrent_status_2=$?
set -e
if ! { [ "$concurrent_status_1" -eq 0 ] && [ "$concurrent_status_2" -eq 2 ]; } &&
   ! { [ "$concurrent_status_1" -eq 2 ] && [ "$concurrent_status_2" -eq 0 ]; }; then
    fail "concurrent runs exited $concurrent_status_1 and $concurrent_status_2; expected one 0 and one 2"
fi
assert_file "$CONCURRENT_REPORT"
assert_file "$CONCURRENT_REPORT.html"
assert_file "$CONCURRENT_REPORT.manifest.csv"
[ "$(manifest_value "$CONCURRENT_REPORT.manifest.csv" "결과_CSV_SHA256")" = "$(file_sha256 "$CONCURRENT_REPORT")" ] || fail "concurrent report bundle is mixed"
if find "$RUN_DIR" -maxdepth 1 -type d -name '.concurrent-report.csv.*.tmp' | grep -q .; then
    fail "concurrent run left a staging directory"
fi

MAPPING_TEMPLATE="$RUN_DIR/mapping-template.xlsx"
QTO_INDEX="$RUN_DIR/qto-index.xlsx"
run_expect 0 mapping-template "$DOTNET_BIN" "$CLI_DLL" \
    --sources "$SOURCE_MANIFEST" --mapping-template "$QTO" "$ESTIMATE" "$MAPPING_TEMPLATE" "$QTO_INDEX"
assert_file "$MAPPING_TEMPLATE"
assert_file "$QTO_INDEX"
unzip -p "$MAPPING_TEMPLATE" xl/worksheets/sheet1.xml > "$WORK_DIR/mapping-template-sheet.xml"
grep -q 't="inlineStr"' "$WORK_DIR/mapping-template-sheet.xml" || fail "mapping template cells are not explicit XLSX text"

UNSAFE_REPORT="$RUN_DIR/unsafe-report.csv"
run_expect 3 unsafe-run "$DOTNET_BIN" "$CLI_DLL" \
    --unsafe-no-source-gate "$QTO" "$ESTIMATE" "$MAPPING" "$UNSAFE_REPORT"
assert_file "$UNSAFE_REPORT"
assert_file "$UNSAFE_REPORT.manifest.csv"
assert_rule_status "$UNSAFE_REPORT" S000 REVIEW
assert_has_r_rule "$UNSAFE_REPORT"
assert_manifest_value "$UNSAFE_REPORT.manifest.csv" "소스게이트" SKIPPED

EMPTY_ESTIMATE="$RUN_DIR/empty-estimate.csv"
printf 'ID,Description,Unit,Quantity,UnitPriceKrw,AmountKrw\n' > "$EMPTY_ESTIMATE"
EMPTY_REPORT="$RUN_DIR/empty-estimate-report.csv"
run_expect 2 empty-estimate "$DOTNET_BIN" "$CLI_DLL" \
    --unsafe-no-source-gate "$QTO" "$EMPTY_ESTIMATE" "$MAPPING" "$EMPTY_REPORT"
[ ! -e "$EMPTY_REPORT" ] || fail "empty estimate unexpectedly produced a successful report"

DANGEROUS_ESTIMATE="$RUN_DIR/dangerous-id-estimate.csv"
printf 'ID,Description,Unit,Quantity,UnitPriceKrw,AmountKrw\n=BOQ-1,Wall,m3,10,120000,1200000\n' > "$DANGEROUS_ESTIMATE"
DANGEROUS_REPORT="$RUN_DIR/dangerous-id-report.csv"
run_expect 2 dangerous-machine-id "$DOTNET_BIN" "$CLI_DLL" \
    --unsafe-no-source-gate "$QTO" "$DANGEROUS_ESTIMATE" "$MAPPING" "$DANGEROUS_REPORT"
[ ! -e "$DANGEROUS_REPORT" ] || fail "formula-leading machine ID unexpectedly produced a report"

FORMULA_QTO="$RUN_DIR/=qto.csv"
cp "$QTO" "$FORMULA_QTO"
FORMULA_REPORT="$RUN_DIR/formula-filename-report.csv"
run_expect 3 formula-filename "$DOTNET_BIN" "$CLI_DLL" \
    --unsafe-no-source-gate "$FORMULA_QTO" "$ESTIMATE" "$MAPPING" "$FORMULA_REPORT"
assert_manifest_value "$FORMULA_REPORT.manifest.csv" "QTO_파일" "'=qto.csv"

cp "$SAFE_REPORT" "$WORK_DIR/safe-report.before"
run_expect 2 existing-output "$DOTNET_BIN" "$CLI_DLL" \
    --sources "$SOURCE_MANIFEST" "$QTO" "$ESTIMATE" "$MAPPING" "$SAFE_REPORT"
cmp -s "$WORK_DIR/safe-report.before" "$SAFE_REPORT" || fail "existing report was overwritten"

SYMLINK_REPORT="$RUN_DIR/symlink-report.csv"
ln -s qto.csv "$SYMLINK_REPORT"
run_expect 2 report-symlink "$DOTNET_BIN" "$CLI_DLL" \
    --sources "$SOURCE_MANIFEST" "$QTO" "$ESTIMATE" "$MAPPING" "$SYMLINK_REPORT"
cmp -s "$BASELINE_DIR/qto.csv" "$QTO" || fail "QTO changed through the report symlink"

WRONG_SLOT_REPORT="$RUN_DIR/wrong-slot-report.csv"
run_expect 1 wrong-slot "$DOTNET_BIN" "$CLI_DLL" \
    --sources "$SOURCE_MANIFEST" "$MAPPING" "$ESTIMATE" "$QTO" "$WRONG_SLOT_REPORT"
assert_file "$WRONG_SLOT_REPORT"
assert_file "$WRONG_SLOT_REPORT.manifest.csv"
assert_rule_status "$WRONG_SLOT_REPORT" S001 PASS
assert_rule_status "$WRONG_SLOT_REPORT" S002 FAIL
assert_no_r_rule "$WRONG_SLOT_REPORT"
assert_manifest_value "$WRONG_SLOT_REPORT.manifest.csv" "소스게이트" FAIL

for input_name in source-manifest.csv qto.csv estimate.csv mapping.csv; do
    cmp -s "$BASELINE_DIR/$input_name" "$RUN_DIR/$input_name" || fail "temporary input changed: $input_name"
    cmp -s "$BASELINE_DIR/$input_name" "$REPO_ROOT/samples/$input_name" || fail "workspace sample changed: $input_name"
done

printf 'CLI integration tests passed.\n'
