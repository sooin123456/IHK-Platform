[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$PackageDirectory,

    [string]$ExpectedRevitVersion,

    [string]$EvidencePath
)

# This verifier deliberately has no dependency on Revit, .NET SDK, or PowerShell
# modules.  It reads a finished package and writes only the requested evidence JSON.
$ErrorActionPreference = 'Stop'

$expectedManifestHeaders = @(
    'product_version', 'exported_at_utc', 'revit_version', 'document_title',
    'ifc_configuration', 'ifc_file', 'ifc_sha256', 'qto_file', 'qto_sha256',
    'qto_row_count', 'element_count', 'element_ledger_file', 'element_ledger_sha256', 'element_ledger_row_count', 'status', 'failure_reason'
)
$expectedQtoHeaders = @('검산키', '분류', '패밀리', '타입', '레벨', '수량', '체적_m3', '면적_m2', '길이_m', '요소ID')
$expectedLedgerHeaders = @(
    'element_id', 'category', 'family', 'type', 'element_name', 'level',
    'volume_state', 'volume_m3', 'volume_source_parameter',
    'length_state', 'length_m', 'length_source_parameter',
    'height_state', 'height_m', 'height_source_parameter'
)
$checks = New-Object 'System.Collections.Generic.List[object]'
$script:manifestRows = $null
$script:qtoRows = $null
$script:manifest = $null
$script:qto = $null
$script:ifcHash = $null
$script:qtoHash = $null
$script:ledgerHash = $null
$script:uniqueElementCount = $null
$script:ledger = $null
$script:ledgerElementCount = $null
$script:ledgerStateCounts = $null

function Assert-Field([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw $Message }
}

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

function Get-Sha256([string]$Path) {
    $stream = $null
    $sha = $null
    try {
        $stream = [System.IO.File]::OpenRead($Path)
        $sha = [System.Security.Cryptography.SHA256]::Create()
        return ([System.BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-', '')
    }
    finally {
        if ($null -ne $sha) { $sha.Dispose() }
        if ($null -ne $stream) { $stream.Dispose() }
    }
}

# Minimal RFC 4180 reader.  Import-Csv accepts malformed quoting in some Windows
# PowerShell versions, so evidence generation uses one parser on every machine.
function Read-CsvRecords([string]$Path) {
    $text = [System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::UTF8)
    if ($text.Length -gt 0 -and $text[0] -eq [char]0xFEFF) { $text = $text.Substring(1) }
    $rows = New-Object 'System.Collections.Generic.List[object]'
    $row = New-Object 'System.Collections.Generic.List[string]'
    $field = New-Object System.Text.StringBuilder
    $inQuotes = $false
    $afterQuote = $false
    $hasRecord = $false

    for ($i = 0; $i -lt $text.Length; $i++) {
        $ch = $text[$i]
        if ($inQuotes) {
            if ($ch -eq '"') {
                if ($i + 1 -lt $text.Length -and $text[$i + 1] -eq '"') {
                    [void]$field.Append('"')
                    $i++
                }
                else {
                    $inQuotes = $false
                    $afterQuote = $true
                }
            }
            else { [void]$field.Append($ch) }
            continue
        }

        if ($afterQuote -and $ch -ne ',' -and $ch -ne "`r" -and $ch -ne "`n") {
            throw "닫는 따옴표 뒤에 허용되지 않는 문자가 있습니다 (문자 위치 $i)."
        }
        if ($ch -eq '"') {
            if ($field.Length -ne 0) { throw "필드 중간의 따옴표가 허용되지 않습니다 (문자 위치 $i)." }
            $inQuotes = $true
            $afterQuote = $false
            $hasRecord = $true
        }
        elseif ($ch -eq ',') {
            $row.Add($field.ToString())
            [void]$field.Clear()
            $afterQuote = $false
            $hasRecord = $true
        }
        elseif ($ch -eq "`r" -or $ch -eq "`n") {
            if ($ch -eq "`r" -and $i + 1 -lt $text.Length -and $text[$i + 1] -eq "`n") { $i++ }
            $row.Add($field.ToString())
            $rows.Add([object]$row.ToArray())
            $row = New-Object 'System.Collections.Generic.List[string]'
            [void]$field.Clear()
            $afterQuote = $false
            $hasRecord = $false
        }
        else {
            [void]$field.Append($ch)
            $hasRecord = $true
        }
    }
    if ($inQuotes) { throw '닫히지 않은 CSV 따옴표가 있습니다.' }
    if ($hasRecord) {
        $row.Add($field.ToString())
        $rows.Add([object]$row.ToArray())
    }
    Write-Output -NoEnumerate ([object[]]$rows.ToArray())
}

function Test-ExactHeaders([object[]]$Actual, [string[]]$Expected, [string]$Label) {
    Assert-Field ($Actual.Count -eq $Expected.Count) "$Label 헤더 수가 $($Expected.Count)개가 아닙니다."
    for ($i = 0; $i -lt $Expected.Count; $i++) {
        Assert-Field ($Actual[$i] -ceq $Expected[$i]) "$Label 헤더 $($i + 1)이 '$($Expected[$i])'와 일치하지 않습니다."
    }
}

function Convert-Record([object[]]$Headers, [object[]]$Values, [string]$Label) {
    Assert-Field ($Values.Count -eq $Headers.Count) "$Label 필드 수가 헤더 수와 다릅니다."
    $record = @{}
    for ($i = 0; $i -lt $Headers.Count; $i++) { $record[$Headers[$i]] = [string]$Values[$i] }
    return $record
}

function Get-PositiveInt([string]$Text, [string]$Label) {
    $value = 0
    Assert-Field ([Int32]::TryParse($Text, [Globalization.NumberStyles]::None, [Globalization.CultureInfo]::InvariantCulture, [ref]$value)) "$Label 값이 정수가 아닙니다: '$Text'."
    Assert-Field ($value -gt 0) "$Label 값은 0보다 커야 합니다: '$Text'."
    return $value
}

function Get-NonNegativeDecimal([string]$Text, [string]$Label) {
    $value = [decimal]0
    Assert-Field ([decimal]::TryParse($Text, [Globalization.NumberStyles]::AllowLeadingSign -bor [Globalization.NumberStyles]::AllowDecimalPoint,
        [Globalization.CultureInfo]::InvariantCulture, [ref]$value)) "$Label 값이 불변 소수 형식이 아닙니다: '$Text'."
    Assert-Field ($value -ge 0) "$Label 값은 음수일 수 없습니다: '$Text'."
    return $value
}

try {
    $PackageDirectory = [System.IO.Path]::GetFullPath($PackageDirectory)
}
catch {
    # Keep the original argument in evidence; the directory check below will fail.
}
if ([string]::IsNullOrWhiteSpace($EvidencePath)) {
    # A missing package cannot receive an in-package evidence file: doing so would
    # create a fake package directory.  Keep its evidence beside the requested path.
    if ([System.IO.Directory]::Exists($PackageDirectory)) {
        $EvidencePath = Join-Path $PackageDirectory 'field-verification.json'
    }
    else {
        $packageParent = Split-Path -Parent $PackageDirectory
        $packageLeaf = Split-Path -Leaf $PackageDirectory
        $EvidencePath = Join-Path $packageParent ($packageLeaf + '.field-verification.json')
    }
}
else {
    try { $EvidencePath = [System.IO.Path]::GetFullPath($EvidencePath) } catch { }
}

$manifestPath = Join-Path $PackageDirectory 'export-manifest.csv'
$qtoPath = Join-Path $PackageDirectory 'qto.csv'
$ifcPath = Join-Path $PackageDirectory 'model.ifc'
$ledgerPath = Join-Path $PackageDirectory 'element-ledger.csv'
$evidenceOutputSafe = $true
$evidenceOutputProblem = ''
try {
    foreach ($inputPath in @($manifestPath, $qtoPath, $ifcPath, $ledgerPath)) {
        if ([string]::Equals($EvidencePath, $inputPath, [System.StringComparison]::OrdinalIgnoreCase)) {
            $evidenceOutputSafe = $false
            $evidenceOutputProblem = 'EvidencePath는 model.ifc, qto.csv, element-ledger.csv 또는 export-manifest.csv와 같을 수 없습니다.'
        }
    }
    $evidenceParent = Split-Path -Parent $EvidencePath
    if ([string]::IsNullOrWhiteSpace($evidenceParent) -or -not [System.IO.Directory]::Exists($evidenceParent)) {
        $evidenceOutputSafe = $false
        $evidenceOutputProblem = "증거 JSON의 상위 폴더가 없습니다: $evidenceParent"
    }
}
catch {
    $evidenceOutputSafe = $false
    $evidenceOutputProblem = "EvidencePath를 확인할 수 없습니다: $($_.Exception.Message)"
}

Add-Check 'package_directory' {
    Assert-Field ([System.IO.Directory]::Exists($PackageDirectory)) "패키지 폴더가 없습니다: $PackageDirectory"
    "읽기 전용 검증 대상: $PackageDirectory"
}
Add-Check 'evidence_output' {
    Assert-Field $evidenceOutputSafe $evidenceOutputProblem
    "증거 JSON: $EvidencePath"
}
Add-Check 'final_package_only' {
    Assert-Field (-not $PackageDirectory.EndsWith('.partial', [System.StringComparison]::OrdinalIgnoreCase)) '패키지 폴더가 .partial로 끝납니다.'
    $partials = @(Get-ChildItem -LiteralPath $PackageDirectory -Force | Where-Object { $_.Name.EndsWith('.partial', [System.StringComparison]::OrdinalIgnoreCase) })
    Assert-Field ($partials.Count -eq 0) '.partial 파일 또는 폴더가 패키지 안에 남아 있습니다.'
    'partial 흔적 없음'
}
Add-Check 'required_files' {
    foreach ($path in @($manifestPath, $qtoPath, $ifcPath, $ledgerPath)) {
        Assert-Field ([System.IO.File]::Exists($path)) "필수 파일이 없습니다: $path"
        Assert-Field ((New-Object System.IO.FileInfo($path)).Length -gt 0) "필수 파일이 비어 있습니다: $path"
    }
    'model.ifc, qto.csv, element-ledger.csv, export-manifest.csv 존재 및 비어있지 않음'
}
Add-Check 'manifest_layout' {
    $script:manifestRows = Read-CsvRecords $manifestPath
    Assert-Field ($script:manifestRows.Count -eq 2) "export-manifest.csv는 헤더와 데이터 1행, 정확히 2행이어야 합니다. 현재: $($script:manifestRows.Count)"
    Test-ExactHeaders $script:manifestRows[0] $expectedManifestHeaders 'export-manifest.csv'
    $script:manifest = Convert-Record $script:manifestRows[0] $script:manifestRows[1] 'export-manifest.csv 데이터행'
    '16개 정확한 헤더와 데이터 1행'
}
Add-Check 'manifest_status_and_names' {
    Assert-Field ($null -ne $script:manifest) 'manifest를 읽지 못했습니다.'
    Assert-Field ($script:manifest['status'] -ceq 'COMPLETE') "status가 COMPLETE가 아닙니다: '$($script:manifest['status'])'"
    Assert-Field ($script:manifest['ifc_file'] -ceq 'model.ifc') "ifc_file이 model.ifc가 아닙니다: '$($script:manifest['ifc_file'])'"
    Assert-Field ($script:manifest['qto_file'] -ceq 'qto.csv') "qto_file이 qto.csv가 아닙니다: '$($script:manifest['qto_file'])'"
    Assert-Field ($script:manifest['element_ledger_file'] -ceq 'element-ledger.csv') "element_ledger_file이 element-ledger.csv가 아닙니다: '$($script:manifest['element_ledger_file'])'"
    'COMPLETE / model.ifc / qto.csv / element-ledger.csv'
}
Add-Check 'manifest_timestamp' {
    Assert-Field ($null -ne $script:manifest) 'manifest를 읽지 못했습니다.'
    $parsed = [DateTimeOffset]::MinValue
    Assert-Field ([DateTimeOffset]::TryParse($script:manifest['exported_at_utc'], [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::RoundtripKind, [ref]$parsed)) 'exported_at_utc가 ISO UTC 시각이 아닙니다.'
    Assert-Field ($parsed.Offset -eq [TimeSpan]::Zero) 'exported_at_utc의 UTC 오프셋이 +00:00이 아닙니다.'
    $parsed.UtcDateTime.ToString('o')
}
Add-Check 'revit_version' {
    Assert-Field ($null -ne $script:manifest) 'manifest를 읽지 못했습니다.'
    Assert-Field (-not [string]::IsNullOrWhiteSpace($script:manifest['revit_version'])) 'revit_version이 비어 있습니다.'
    if (-not [string]::IsNullOrWhiteSpace($ExpectedRevitVersion)) {
        Assert-Field ($script:manifest['revit_version'] -ceq $ExpectedRevitVersion) "Revit 버전이 기대값 '$ExpectedRevitVersion'와 다릅니다: '$($script:manifest['revit_version'])'"
    }
    "Revit $($script:manifest['revit_version'])"
}
Add-Check 'manifest_counts' {
    Assert-Field ($null -ne $script:manifest) 'manifest를 읽지 못했습니다.'
    $rows = Get-PositiveInt $script:manifest['qto_row_count'] 'qto_row_count'
    $elements = Get-PositiveInt $script:manifest['element_count'] 'element_count'
    $ledgerRows = Get-PositiveInt $script:manifest['element_ledger_row_count'] 'element_ledger_row_count'
    "qto_row_count=$rows, element_count=$elements, element_ledger_row_count=$ledgerRows"
}
Add-Check 'qto_layout' {
    $script:qtoRows = Read-CsvRecords $qtoPath
    Assert-Field ($script:qtoRows.Count -ge 2) 'qto.csv에는 헤더와 최소 1개 데이터행이 있어야 합니다.'
    Test-ExactHeaders $script:qtoRows[0] $expectedQtoHeaders 'qto.csv'
    $script:qto = New-Object 'System.Collections.Generic.List[object]'
    for ($i = 1; $i -lt $script:qtoRows.Count; $i++) {
        $script:qto.Add((Convert-Record $script:qtoRows[0] $script:qtoRows[$i] "qto.csv 데이터행 $i"))
    }
    "$($script:qto.Count)개 QTO 데이터행"
}
Add-Check 'qto_audit_keys_and_element_ids' {
    Assert-Field ($null -ne $script:qto) 'qto.csv를 읽지 못했습니다.'
    $ids = New-Object 'System.Collections.Generic.HashSet[System.Int64]'
    for ($rowNumber = 0; $rowNumber -lt $script:qto.Count; $rowNumber++) {
        $row = $script:qto[$rowNumber]
        Assert-Field ($row['검산키'] -cmatch '^[0-9A-F]{64}$') "QTO $($rowNumber + 1)행 검산키가 64자리 대문자 SHA-256이 아닙니다."
        $count = Get-PositiveInt $row['수량'] "QTO $($rowNumber + 1)행 수량"
        $parts = @($row['요소ID'].Split('|'))
        Assert-Field ($parts.Count -eq $count) "QTO $($rowNumber + 1)행 수량($count)과 요소ID 수($($parts.Count))가 다릅니다."
        foreach ($part in $parts) {
            $id = [Int64]0
            Assert-Field ([Int64]::TryParse($part, [Globalization.NumberStyles]::None, [Globalization.CultureInfo]::InvariantCulture, [ref]$id)) "QTO $($rowNumber + 1)행 요소ID가 정수가 아닙니다: '$part'."
            Assert-Field ($id -gt 0) "QTO $($rowNumber + 1)행 요소ID는 양수여야 합니다: '$part'."
            Assert-Field ($ids.Add($id)) "요소ID $id 가 QTO 전체에서 중복됩니다."
        }
    }
    $script:uniqueElementCount = $ids.Count
    "검산키 $($script:qto.Count)개, 고유 요소ID $($ids.Count)개"
}
Add-Check 'counts_match_qto' {
    Assert-Field ($null -ne $script:manifest -and $null -ne $script:qto -and $null -ne $script:uniqueElementCount) 'manifest 또는 QTO 검증이 완료되지 않았습니다.'
    Assert-Field ((Get-PositiveInt $script:manifest['qto_row_count'] 'qto_row_count') -eq $script:qto.Count) "manifest qto_row_count와 QTO 데이터행 수가 다릅니다."
    Assert-Field ((Get-PositiveInt $script:manifest['element_count'] 'element_count') -eq $script:uniqueElementCount) "manifest element_count와 고유 요소ID 수가 다릅니다."
    'manifest count와 QTO 집계 일치'
}
Add-Check 'element_ledger_layout_and_states' {
    $rows = Read-CsvRecords $ledgerPath
    Assert-Field ($rows.Count -ge 2) 'element-ledger.csv에는 헤더와 최소 1개 데이터행이 있어야 합니다.'
    Test-ExactHeaders $rows[0] $expectedLedgerHeaders 'element-ledger.csv'
    $script:ledger = New-Object 'System.Collections.Generic.List[object]'
    $stateCounts = @{ MISSING = 0; ZERO = 0; COMPUTED = 0 }
    $ids = New-Object 'System.Collections.Generic.HashSet[System.Int64]'
    for ($rowNumber = 1; $rowNumber -lt $rows.Count; $rowNumber++) {
        $row = Convert-Record $rows[0] $rows[$rowNumber] "element-ledger.csv 데이터행 $rowNumber"
        $id = [Int64]0
        Assert-Field ([Int64]::TryParse($row['element_id'], [Globalization.NumberStyles]::None, [Globalization.CultureInfo]::InvariantCulture, [ref]$id)) "element-ledger $rowNumber 행 element_id가 양의 10진 정수가 아닙니다: '$($row['element_id'])'."
        Assert-Field ($id -gt 0) "element-ledger $rowNumber 행 element_id는 양수여야 합니다."
        Assert-Field ($ids.Add($id)) "element-ledger 전체에서 element_id가 중복됩니다: $id"
        $state = $row['volume_state']
        foreach ($measurement in @(
            @{ state = 'volume_state'; value = 'volume_m3'; source = 'volume_source_parameter' },
            @{ state = 'length_state'; value = 'length_m'; source = 'length_source_parameter' },
            @{ state = 'height_state'; value = 'height_m'; source = 'height_source_parameter' }
        )) {
            $measurementState = $row[$measurement.state]
            $hasValue = -not [string]::IsNullOrWhiteSpace($row[$measurement.value])
            $hasSource = -not [string]::IsNullOrWhiteSpace($row[$measurement.source])
            if ($measurementState -ceq 'MISSING') {
                Assert-Field (-not $hasValue -and -not $hasSource) "element-ledger $rowNumber 행 MISSING은 $($measurement.value)/$($measurement.source)가 비어야 합니다."
            }
            elseif ($measurementState -ceq 'ZERO') {
                Assert-Field ($hasValue -and $hasSource) "element-ledger $rowNumber 행 ZERO에는 $($measurement.value)/$($measurement.source)가 필요합니다."
                Assert-Field ((Get-NonNegativeDecimal $row[$measurement.value] "element-ledger $rowNumber 행 $($measurement.value)") -eq 0) "element-ledger $rowNumber 행 ZERO $($measurement.value)는 0이어야 합니다."
            }
            elseif ($measurementState -ceq 'COMPUTED') {
                Assert-Field ($hasValue -and $hasSource) "element-ledger $rowNumber 행 COMPUTED에는 $($measurement.value)/$($measurement.source)가 필요합니다."
                Assert-Field ((Get-NonNegativeDecimal $row[$measurement.value] "element-ledger $rowNumber 행 $($measurement.value)") -gt 0) "element-ledger $rowNumber 행 COMPUTED $($measurement.value)는 0보다 커야 합니다."
            }
            else { throw "element-ledger $rowNumber 행 $($measurement.state)는 MISSING, ZERO, COMPUTED 중 하나여야 합니다: '$measurementState'." }
        }
        $stateCounts[$state]++
        $script:ledger.Add([pscustomobject]@{ ElementId = $id; State = $state })
    }
    $script:ledgerElementCount = $ids.Count
    $script:ledgerStateCounts = $stateCounts
    "$($ids.Count)개 고유 element-ledger ID; MISSING=$($stateCounts['MISSING']), ZERO=$($stateCounts['ZERO']), COMPUTED=$($stateCounts['COMPUTED'])"
}
Add-Check 'element_ledger_qto_coverage' {
    Assert-Field ($null -ne $script:ledger -and $null -ne $script:qto) 'QTO 또는 element-ledger를 읽지 못했습니다.'
    $ledgerIds = New-Object 'System.Collections.Generic.HashSet[System.Int64]'
    foreach ($row in $script:ledger) { [void]$ledgerIds.Add($row.ElementId) }
    $qtoIds = New-Object 'System.Collections.Generic.HashSet[System.Int64]'
    foreach ($row in $script:qto) {
        foreach ($part in @($row['요소ID'].Split('|'))) {
            $id = [Int64]0
            Assert-Field ([Int64]::TryParse($part, [Globalization.NumberStyles]::None, [Globalization.CultureInfo]::InvariantCulture, [ref]$id)) '이미 검증한 QTO 요소ID를 다시 읽지 못했습니다.'
            [void]$qtoIds.Add($id)
        }
    }
    $missing = @($qtoIds | Where-Object { -not $ledgerIds.Contains($_) })
    $extra = @($ledgerIds | Where-Object { -not $qtoIds.Contains($_) })
    Assert-Field ($missing.Count -eq 0 -and $extra.Count -eq 0) "QTO와 element-ledger 요소ID 집합이 다릅니다. missing=$($missing -join '|');extra=$($extra -join '|')"
    "QTO와 element-ledger의 $($qtoIds.Count)개 요소ID 집합이 정확히 일치"
}
Add-Check 'counts_match_element_ledger' {
    Assert-Field ($null -ne $script:manifest -and $null -ne $script:ledgerElementCount) 'manifest 또는 element-ledger 검증이 완료되지 않았습니다.'
    Assert-Field ((Get-PositiveInt $script:manifest['element_ledger_row_count'] 'element_ledger_row_count') -eq $script:ledgerElementCount) 'manifest element_ledger_row_count와 element-ledger 고유 행 수가 다릅니다.'
    Assert-Field ((Get-PositiveInt $script:manifest['element_count'] 'element_count') -eq $script:ledgerElementCount) 'manifest element_count와 element-ledger 고유 행 수가 다릅니다.'
    'manifest element_count/element_ledger_row_count와 element-ledger 행 수 일치'
}
Add-Check 'file_hashes' {
    Assert-Field ($null -ne $script:manifest) 'manifest를 읽지 못했습니다.'
    Assert-Field ($script:manifest['ifc_sha256'] -cmatch '^[0-9A-F]{64}$') 'ifc_sha256이 64자리 대문자 SHA-256이 아닙니다.'
    Assert-Field ($script:manifest['qto_sha256'] -cmatch '^[0-9A-F]{64}$') 'qto_sha256이 64자리 대문자 SHA-256이 아닙니다.'
    Assert-Field ($script:manifest['element_ledger_sha256'] -cmatch '^[0-9A-F]{64}$') 'element_ledger_sha256이 64자리 대문자 SHA-256이 아닙니다.'
    $script:ifcHash = Get-Sha256 $ifcPath
    $script:qtoHash = Get-Sha256 $qtoPath
    $script:ledgerHash = Get-Sha256 $ledgerPath
    Assert-Field ($script:ifcHash -ceq $script:manifest['ifc_sha256']) 'model.ifc SHA-256이 manifest와 다릅니다.'
    Assert-Field ($script:qtoHash -ceq $script:manifest['qto_sha256']) 'qto.csv SHA-256이 manifest와 다릅니다.'
    Assert-Field ($script:ledgerHash -ceq $script:manifest['element_ledger_sha256']) 'element-ledger.csv SHA-256이 manifest와 다릅니다.'
    'IFC/QTO/element-ledger SHA-256 일치'
}
$allPassed = @($checks | Where-Object { -not $_.pass }).Count -eq 0
$evidence = [ordered]@{
        verifier = 'Lukas QTO field package verifier'
        verifier_version = '1.0.0'
        verified_at_utc = [DateTime]::UtcNow.ToString('o')
        package_directory = $PackageDirectory
        expected_revit_version = $ExpectedRevitVersion
        pass = $allPassed
        checks = @($checks)
        observed = [ordered]@{
            manifest_revit_version = if ($null -ne $script:manifest) { $script:manifest['revit_version'] } else { $null }
            manifest_exported_at_utc = if ($null -ne $script:manifest) { $script:manifest['exported_at_utc'] } else { $null }
            qto_row_count = if ($null -ne $script:qto) { $script:qto.Count } else { $null }
            unique_element_count = $script:uniqueElementCount
            element_ledger_row_count = $script:ledgerElementCount
            element_ledger_state_counts = $script:ledgerStateCounts
            ifc_sha256 = $script:ifcHash
            qto_sha256 = $script:qtoHash
            element_ledger_sha256 = $script:ledgerHash
        }
    }
try {
    if (-not $evidenceOutputSafe) { throw $evidenceOutputProblem }
    [System.IO.File]::WriteAllText($EvidencePath, ($evidence | ConvertTo-Json -Depth 6), (New-Object System.Text.UTF8Encoding($false)))
}
catch {
    Write-Error "검증 증거 JSON을 저장하지 못했습니다: $($_.Exception.Message)"
    exit 2
}

if ($allPassed) {
    Write-Host "PASS: $EvidencePath"
    exit 0
}
Write-Error "FAIL: $EvidencePath"
exit 1
