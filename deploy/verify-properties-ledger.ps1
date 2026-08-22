# Lukas QTO standalone Properties CSV verifier.
# It is intentionally Revit-free: run it after `Properties 추출` on Windows.
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$LedgerPath,

    [string]$EvidencePath
)

$ErrorActionPreference = 'Stop'
$expectedHeaders = @(
    'element_id', 'category', 'family', 'type', 'element_name', 'level',
    'volume_state', 'volume_m3', 'volume_source_parameter',
    'length_state', 'length_m', 'length_source_parameter',
    'height_state', 'height_m', 'height_source_parameter'
)
$checks = New-Object 'System.Collections.Generic.List[object]'
$ledgerHash = $null
$rowCount = 0
$stateCounts = @{}
$exportEvidencePath = $null

function Add-Check([string]$Name, [scriptblock]$Action) {
    try {
        $detail = & $Action
        if ($null -eq $detail) { $detail = 'OK' }
        $checks.Add([pscustomobject]@{ name = $Name; pass = $true; detail = [string]$detail })
    }
    catch {
        $checks.Add([pscustomobject]@{ name = $Name; pass = $false; detail = $_.Exception.Message })
    }
}

function Assert-Field([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw $Message }
}

function Get-Sha256([string]$Path) {
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToUpperInvariant()
}

function Test-Measurement([hashtable]$Row, [string]$Prefix, [int]$Line) {
    $state = [string]$Row[$Prefix + '_state']
    $value = [string]$Row[$Prefix + ($(if ($Prefix -eq 'volume') { '_m3' } else { '_m' }))]
    $source = [string]$Row[$Prefix + '_source_parameter']
    Assert-Field ($state -in @('MISSING', 'ZERO', 'COMPUTED')) "$Line 행 $Prefix 상태가 올바르지 않습니다: '$state'."
    if ($state -eq 'MISSING') {
        Assert-Field ([string]::IsNullOrEmpty($value) -and [string]::IsNullOrEmpty($source)) "$Line 행 MISSING $Prefix에는 값과 source parameter가 없어야 합니다."
        return
    }
    [decimal]$parsed = 0
    Assert-Field ([decimal]::TryParse($value, [Globalization.NumberStyles]::AllowLeadingSign -bor [Globalization.NumberStyles]::AllowDecimalPoint, [Globalization.CultureInfo]::InvariantCulture, [ref]$parsed)) "$Line 행 $Prefix 값이 불변 소수 형식이 아닙니다: '$value'."
    Assert-Field ($parsed -ge 0) "$Line 행 $Prefix 값은 음수일 수 없습니다."
    Assert-Field (-not [string]::IsNullOrWhiteSpace($source)) "$Line 행 $Prefix source parameter가 없습니다."
    if ($state -eq 'ZERO') { Assert-Field ($parsed -eq 0) "$Line 행 ZERO $Prefix 값은 0이어야 합니다." }
    if ($state -eq 'COMPUTED') { Assert-Field ($parsed -gt 0) "$Line 행 COMPUTED $Prefix 값은 0보다 커야 합니다." }
}

try { $LedgerPath = [IO.Path]::GetFullPath($LedgerPath) } catch { }
if ([string]::IsNullOrWhiteSpace($EvidencePath)) {
    $EvidencePath = $LedgerPath + '.field-verification.json'
}
else {
    try { $EvidencePath = [IO.Path]::GetFullPath($EvidencePath) } catch { }
}

Add-Check 'ledger_file' {
    Assert-Field ([IO.File]::Exists($LedgerPath)) "Properties CSV가 없습니다: $LedgerPath"
    Assert-Field ([IO.Path]::GetExtension($LedgerPath) -ieq '.csv') 'Properties 출력은 .csv여야 합니다.'
    Assert-Field ($EvidencePath -ine $LedgerPath) 'EvidencePath는 Properties CSV와 같을 수 없습니다.'
    $ledgerHash = Get-Sha256 $LedgerPath
    "SHA-256: $ledgerHash"
}

Add-Check 'v2_contract' {
    $rows = @(Import-Csv -LiteralPath $LedgerPath -Encoding UTF8)
    Assert-Field ($null -ne $rows -and $rows.Count -gt 0) 'Properties CSV에 데이터 행이 없습니다.'
    $headers = @((Get-Content -LiteralPath $LedgerPath -Encoding UTF8 -TotalCount 1).TrimStart([char]0xFEFF).Split(','))
    Assert-Field ($headers.Count -eq $expectedHeaders.Count) 'Properties CSV 헤더 수가 15개가 아닙니다.'
    for ($i = 0; $i -lt $expectedHeaders.Count; $i++) {
        Assert-Field ($headers[$i] -ceq $expectedHeaders[$i]) "Properties CSV 헤더 $($i + 1)이 '$($expectedHeaders[$i])'와 일치하지 않습니다."
    }
    $ids = New-Object 'System.Collections.Generic.HashSet[string]'
    $rowCount = 0
    foreach ($item in $rows) {
        $rowCount++
        $line = $rowCount + 1
        $id = [string]$item.element_id
        Assert-Field ($id -match '^[1-9][0-9]*$') "$line 행 element_id가 양의 canonical 정수가 아닙니다: '$id'."
        Assert-Field ($ids.Add($id)) "$line 행 element_id가 중복됩니다: '$id'."
        $row = @{}
        foreach ($header in $expectedHeaders) { $row[$header] = [string]$item.$header }
        Test-Measurement $row 'volume' $line
        Test-Measurement $row 'length' $line
        Test-Measurement $row 'height' $line
        foreach ($prefix in @('volume', 'length', 'height')) {
            $key = $prefix + '_' + [string]$row[$prefix + '_state']
            if (-not $stateCounts.ContainsKey($key)) { $stateCounts[$key] = 0 }
            $stateCounts[$key]++
        }
    }
    "$rowCount개 요소, V2 15열 계약"
}

Add-Check 'extraction_evidence' {
    $exportEvidencePath = $LedgerPath + '.evidence.json'
    Assert-Field ([IO.File]::Exists($exportEvidencePath)) "Properties 추출 evidence JSON이 없습니다: $exportEvidencePath"
    $export = Get-Content -LiteralPath $exportEvidencePath -Raw -Encoding UTF8 | ConvertFrom-Json
    Assert-Field ($export.schema_version -eq 'revit-properties-evidence-v2') 'Properties 추출 evidence schema_version이 다릅니다. 물리 객체 필터가 적용된 최신 추출본을 사용하십시오.'
    Assert-Field ($export.physical_category_filter -eq 'built-in-category-physical-v1') 'Properties 추출 evidence의 물리 객체 필터가 올바르지 않습니다.'
    Assert-Field ($export.csv_file -ceq [IO.Path]::GetFileName($LedgerPath)) 'Properties 추출 evidence CSV 파일명이 다릅니다.'
    Assert-Field ($export.csv_sha256 -match '^[0-9A-F]{64}$' -and $export.csv_sha256 -ceq $ledgerHash) 'Properties 추출 evidence CSV SHA-256이 다릅니다.'
    Assert-Field ($export.scope -in @('Selection', 'ActiveView', 'EntireHostModel')) 'Properties 추출 evidence scope이 올바르지 않습니다.'
    Assert-Field (-not [string]::IsNullOrWhiteSpace([string]$export.revit_version) -and -not [string]::IsNullOrWhiteSpace([string]$export.revit_build)) 'Properties 추출 evidence Revit version/build가 없습니다.'
    Assert-Field ($null -ne $export.counts) 'Properties 추출 evidence counts가 없습니다.'
    foreach ($key in @('candidate', 'eligible_host_model', 'excluded_link_instances', 'excluded_non_model', 'excluded_non_quantity', 'missing_selection_ids', 'csv_rows')) {
        Assert-Field ($export.counts.PSObject.Properties.Name -contains $key) "Properties 추출 evidence count가 없습니다: $key"
        Assert-Field ([int]$export.counts.$key -ge 0) "Properties 추출 evidence count가 올바르지 않습니다: $key"
    }
    Assert-Field ([int]$export.counts.csv_rows -eq $rowCount) 'Properties 추출 evidence CSV 행 수가 다릅니다.'
    Assert-Field ([int]$export.counts.eligible_host_model -eq $rowCount) 'Properties 추출 evidence의 물리 요소 수와 CSV 행 수가 다릅니다.'
    $accounted = [int]$export.counts.eligible_host_model + [int]$export.counts.excluded_link_instances + [int]$export.counts.excluded_non_model + [int]$export.counts.excluded_non_quantity
    Assert-Field ([int]$export.counts.candidate -eq $accounted) 'Properties 추출 evidence의 후보/포함/제외 수가 닫히지 않습니다.'
    "scope=$($export.scope), Revit $($export.revit_version) build $($export.revit_build)"
}

$passed = $checks.Count -gt 0 -and @($checks | Where-Object { -not $_.pass }).Count -eq 0
$evidence = [pscustomobject]@{
    product = 'Lukas QTO Properties extraction'
    verified_at_utc = [DateTime]::UtcNow.ToString('o')
    ledger_file = [IO.Path]::GetFileName($LedgerPath)
    ledger_sha256 = $ledgerHash
    extraction_evidence_file = if ($null -eq $exportEvidencePath) { $null } else { [IO.Path]::GetFileName($exportEvidencePath) }
    element_count = $rowCount
    measurement_state_counts = $stateCounts
    passed = $passed
    checks = $checks
}
try {
    $parent = Split-Path -Parent $EvidencePath
    Assert-Field (-not [string]::IsNullOrWhiteSpace($parent) -and [IO.Directory]::Exists($parent)) "증거 JSON 상위 폴더가 없습니다: $parent"
    [IO.File]::WriteAllText($EvidencePath, ($evidence | ConvertTo-Json -Depth 5), (New-Object Text.UTF8Encoding($false)))
}
catch {
    Write-Error "증거 JSON을 쓸 수 없습니다: $($_.Exception.Message)"
    exit 2
}

if ($passed) {
    Write-Output "PASS: $EvidencePath"
    exit 0
}
Write-Error "FAIL: $EvidencePath"
exit 1
