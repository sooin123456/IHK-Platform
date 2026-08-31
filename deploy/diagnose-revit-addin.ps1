# Read-only Hangil System Revit add-in diagnostic. Checks both per-user and machine-wide locations.
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('2017', '2022', '2023', '2024', '2025', '2026')]
    [string]$RevitVersion,
    [ValidateSet('Auto', 'Machine', 'User')]
    [string]$Scope = 'Auto',
    [string]$EvidencePath
)

$ErrorActionPreference = 'Stop'
$checks = New-Object 'System.Collections.Generic.List[object]'
$canonicalAddInId = 'e36671a8-0944-465c-919e-1006dfd3610e'
$programFiles64 = if ([string]::IsNullOrWhiteSpace($env:ProgramW6432)) { $env:ProgramFiles } else { $env:ProgramW6432 }
$revitExe = Join-Path $programFiles64 ("Autodesk\Revit " + $RevitVersion + '\Revit.exe')
$locations = @(
    [pscustomobject]@{ scope = 'User'; root = Join-Path $env:APPDATA ("Autodesk\Revit\Addins\" + $RevitVersion) },
    [pscustomobject]@{ scope = 'Machine'; root = Join-Path $env:ProgramData ("Autodesk\Revit\Addins\" + $RevitVersion) }
)
if ($Scope -ne 'Auto') { $locations = @($locations | Where-Object { $_.scope -eq $Scope }) }

function Add-Check([string]$Name, [scriptblock]$Action) {
    try { $detail = & $Action; if ($null -eq $detail) { $detail = 'OK' }; $checks.Add([pscustomobject]@{ name=$Name; pass=$true; detail=[string]$detail }) }
    catch { $checks.Add([pscustomobject]@{ name=$Name; pass=$false; detail=$_.Exception.Message }) }
}
function Assert-Field([bool]$Condition, [string]$Message) { if (-not $Condition) { throw $Message } }
function Get-Sha256([string]$Path) { (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToUpperInvariant() }

if ([string]::IsNullOrWhiteSpace($EvidencePath)) { $EvidencePath = Join-Path $env:TEMP ("Hangil-Revit-" + $RevitVersion + '-diagnostic.json') }
else { try { $EvidencePath = [IO.Path]::GetFullPath($EvidencePath) } catch { } }

$revitInfo = $null
Add-Check 'revit_installation' {
    Assert-Field ([IO.File]::Exists($revitExe)) "Revit executable is missing: $revitExe"
    $file = [Diagnostics.FileVersionInfo]::GetVersionInfo($revitExe)
    $script:revitInfo = [pscustomobject]@{ product_version=$file.ProductVersion; file_version=$file.FileVersion; path=$revitExe }
    "ProductVersion=$($file.ProductVersion); FileVersion=$($file.FileVersion)"
}

$candidates = New-Object 'System.Collections.Generic.List[object]'
foreach ($location in $locations) {
    $manifest = Join-Path $location.root 'Lukas.Qto.addin'
    if (-not [IO.File]::Exists($manifest)) { continue }
    try {
        [xml]$xml = Get-Content -LiteralPath $manifest -Raw -Encoding UTF8
        $node = $xml.RevitAddIns.AddIn | Select-Object -First 1
        $assembly = [string]$node.Assembly
        $addInId = ([string]$node.AddInId).Trim()
        $validName = @('Hangil System', 'Lukas QTO') -contains [string]$node.Name
        $valid = $validName -and $node.FullClassName -eq 'Lukas.Qto.App' -and $addInId -ieq $canonicalAddInId -and [IO.Path]::IsPathRooted($assembly) -and [IO.File]::Exists($assembly)
        $candidates.Add([pscustomobject]@{ scope=$location.scope; root=$location.root; manifest=$manifest; assembly=$assembly; addin_id=$addInId; name=[string]$node.Name; valid=$valid; error=$null })
    } catch {
        $candidates.Add([pscustomobject]@{ scope=$location.scope; root=$location.root; manifest=$manifest; assembly=$null; addin_id=$null; name=$null; valid=$false; error=$_.Exception.Message })
    }
}

$selected = $null
Add-Check 'single_active_installation' {
    $valid = @($candidates | Where-Object { $_.valid })
    Assert-Field ($candidates.Count -gt 0) ("No add-in manifest was found. Checked: " + (($locations | ForEach-Object { $_.root }) -join '; '))
    Assert-Field ($valid.Count -gt 0) ("No valid add-in manifest was found. Checked: " + (($candidates | ForEach-Object { $_.manifest }) -join '; '))
    Assert-Field ($valid.Count -eq 1) ("Duplicate valid add-ins were found in User/Machine locations. Keep exactly one: " + (($valid | ForEach-Object { $_.manifest }) -join '; '))
    $script:selected = $valid[0]
    "$($selected.scope): $($selected.manifest)"
}
Add-Check 'leftover_invalid_manifests' {
    $invalid = @($candidates | Where-Object { -not $_.valid })
    Assert-Field ($invalid.Count -eq 0) ("Leftover invalid add-in manifests must be removed: " + (($invalid | ForEach-Object { $_.manifest }) -join '; '))
    'No leftover invalid Lukas manifest'
}
Add-Check 'addin_manifest_and_assembly' {
    Assert-Field ($null -ne $selected) 'No selected installation is available.'
    Assert-Field ([IO.Path]::GetFileName($selected.assembly) -eq 'Lukas.Qto.dll') "Unexpected assembly name: $($selected.assembly)"
    Assert-Field ($selected.addin_id -ieq $canonicalAddInId) "Unexpected AddInId: $($selected.addin_id)"
    "Name=$($selected.name); AddInId=$($selected.addin_id); SHA256=$(Get-Sha256 $selected.assembly)"
}
Add-Check 'installation_receipt' {
    Assert-Field ($null -ne $selected) 'No selected installation is available.'
    if ($selected.scope -eq 'Machine') { return 'Machine installation: no per-user receipt required.' }
    $receiptPath = Join-Path ([IO.Path]::GetDirectoryName($selected.assembly)) 'install-receipt.json'
    Assert-Field ([IO.File]::Exists($receiptPath)) "Per-user installation receipt is missing: $receiptPath"
    $receipt = Get-Content -LiteralPath $receiptPath -Raw -Encoding UTF8 | ConvertFrom-Json
    Assert-Field ([string]$receipt.scope -ceq 'User' -and [string]$receipt.revit_year -ceq $RevitVersion) 'Installation receipt scope or Revit year is invalid.'
    Assert-Field ([string]$receipt.manifest -ceq $selected.manifest -and [string]$receipt.assembly -ceq $selected.assembly) 'Installation receipt paths do not match the active manifest.'
    Assert-Field ([string]$receipt.addin_id -ieq $canonicalAddInId) "Installation receipt AddInId is invalid: $($receipt.addin_id)"
    $actualHash = Get-Sha256 $selected.assembly
    Assert-Field ([string]$receipt.assembly_sha256 -ieq $actualHash) 'Installed DLL hash does not match the installation receipt.'
    "Receipt=$receiptPath; SHA256=$actualHash"
}
Add-Check 'legacy_and_duplicate_manifests' {
    $conflicts = @()
    foreach ($location in $locations) {
        foreach ($name in @('THEKIE.Qto.addin')) {
            $path = Join-Path $location.root $name
            if ([IO.File]::Exists($path)) { $conflicts += $path }
        }
    }
    Assert-Field ($conflicts.Count -eq 0) ("Active legacy manifests must be disabled before field verification: " + ($conflicts -join '; '))
    'No active THEKIE manifest conflict'
}
Add-Check 'revit_restart' {
    Assert-Field (@(Get-Process -Name Revit -ErrorAction SilentlyContinue).Count -eq 0) 'Revit is running. Close every Revit window and run this diagnostic again.'
    'Revit is closed and ready for a clean restart.'
}

$passed = $checks.Count -gt 0 -and @($checks | Where-Object { -not $_.pass }).Count -eq 0
$evidence = [pscustomobject]@{
    product = 'Hangil System Revit add-in diagnostic'
    verified_at_utc = [DateTime]::UtcNow.ToString('o')
    requested_revit_year = $RevitVersion
    revit = $revitInfo
    requested_scope = $Scope
    detected_scope = if ($selected) { $selected.scope } else { $null }
    searched_locations = @($locations | ForEach-Object { $_.root })
    discovered_manifests = $candidates.ToArray()
    manifest = if ($selected) { $selected.manifest } else { $null }
    assembly = if ($selected) { $selected.assembly } else { $null }
    assembly_sha256 = if ($selected -and [IO.File]::Exists($selected.assembly)) { Get-Sha256 $selected.assembly } else { $null }
    passed = $passed
    compatibility_note = 'Revit year compatibility is required. Each unverified 2025 point build remains a field warning until recorded here.'
    checks = $checks.ToArray()
}
try {
    $parent = Split-Path -Parent $EvidencePath
    Assert-Field ([IO.Directory]::Exists($parent)) "Evidence parent directory is missing: $parent"
    [IO.File]::WriteAllText($EvidencePath, ($evidence | ConvertTo-Json -Depth 7), (New-Object Text.UTF8Encoding($false)))
} catch { Write-Error "Cannot write diagnostic JSON: $($_.Exception.Message)"; exit 2 }

if ($passed) { Write-Output "PASS: $EvidencePath"; exit 0 }
Write-Output 'Hangil System add-in diagnostic failed:'
foreach ($failure in @($checks | Where-Object { -not $_.pass })) { Write-Output (" - [{0}] {1}" -f $failure.name, $failure.detail) }
Write-Output "Evidence JSON: $EvidencePath"
exit 1
