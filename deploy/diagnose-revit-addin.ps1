# Lukas QTO add-in installation diagnostic. Does not modify Revit or the add-in.
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('2017', '2022', '2023', '2024', '2025', '2026')]
    [string]$RevitVersion,

    [ValidateSet('Machine', 'User')]
    [string]$Scope = 'Machine',

    [string]$EvidencePath
)

$ErrorActionPreference = 'Stop'
$addinRoot = if ($Scope -eq 'User') {
    Join-Path $env:APPDATA ("Autodesk\Revit\Addins\" + $RevitVersion)
} else {
    Join-Path $env:ProgramData ("Autodesk\Revit\Addins\" + $RevitVersion)
}
$manifestPath = Join-Path $addinRoot 'Lukas.Qto.addin'
$revitExe = Join-Path $env:ProgramW6432 ("Autodesk\Revit " + $RevitVersion + '\Revit.exe')
$checks = New-Object 'System.Collections.Generic.List[object]'

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

if ([string]::IsNullOrWhiteSpace($EvidencePath)) {
    $EvidencePath = Join-Path $env:TEMP ("Lukas-QTO-Revit-" + $RevitVersion + '-diagnostic.json')
}
else {
    try { $EvidencePath = [IO.Path]::GetFullPath($EvidencePath) } catch { }
}

$assemblyPath = $null
Add-Check 'revit_installation' {
    Assert-Field ([IO.File]::Exists($revitExe)) "Revit $RevitVersion 실행 파일이 없습니다: $revitExe"
    $revitExe
}
Add-Check 'addin_manifest' {
    Assert-Field ([IO.File]::Exists($manifestPath)) "Lukas.Qto.addin이 없습니다: $manifestPath"
    [xml]$xml = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8
    $node = $xml.RevitAddIns.AddIn | Select-Object -First 1
    Assert-Field ($null -ne $node) 'addin manifest에 AddIn 노드가 없습니다.'
    Assert-Field ($node.Name -eq 'Lukas QTO') "addin 이름이 다릅니다: '$($node.Name)'"
    Assert-Field ($node.FullClassName -eq 'THEKIE.Qto.App') "addin 진입 클래스가 다릅니다: '$($node.FullClassName)'"
    $assemblyPath = [string]$node.Assembly
    Assert-Field (-not [string]::IsNullOrWhiteSpace($assemblyPath) -and [IO.Path]::IsPathRooted($assemblyPath)) 'addin Assembly는 절대 경로여야 합니다.'
    $assemblyPath
}
Add-Check 'addin_assembly' {
    Assert-Field (-not [string]::IsNullOrWhiteSpace($assemblyPath)) 'manifest Assembly 경로를 읽지 못했습니다.'
    Assert-Field ([IO.File]::Exists($assemblyPath)) "addin DLL이 없습니다: $assemblyPath"
    Assert-Field ([IO.Path]::GetFileName($assemblyPath) -eq 'THEKIE.Qto.dll') "addin DLL 파일명이 다릅니다: $assemblyPath"
    "SHA-256: $(Get-Sha256 $assemblyPath)"
}
Add-Check 'legacy_conflict' {
    $legacy = Join-Path $addinRoot 'THEKIE.Qto.addin'
    $disabled = Join-Path $addinRoot 'THEKIE.Qto.addin.disabled'
    Assert-Field (-not ([IO.File]::Exists($legacy) -and [IO.File]::Exists($disabled))) '활성/비활성 legacy manifest가 동시에 있습니다.'
    if ([IO.File]::Exists($legacy)) { 'legacy THEKIE.Qto.addin is active; remove it or rerun install.bat.' } else { 'no active legacy manifest' }
}
Add-Check 'revit_restart' {
    $running = @(Get-Process -Name Revit -ErrorAction SilentlyContinue)
    Assert-Field ($running.Count -eq 0) 'Revit.exe가 실행 중입니다. 설치 후 완전히 종료하고 다시 시작해야 리본이 로드됩니다.'
    'Revit.exe is not running; start it after this diagnostic.'
}

$passed = $checks.Count -gt 0 -and @($checks | Where-Object { -not $_.pass }).Count -eq 0
$evidence = [pscustomobject]@{
    product = 'Lukas QTO Revit add-in diagnostic'
    verified_at_utc = [DateTime]::UtcNow.ToString('o')
    revit_version = $RevitVersion
    install_scope = $Scope
    revit_exe = $revitExe
    manifest = $manifestPath
    assembly = $assemblyPath
    passed = $passed
    checks = $checks
}
try {
    $parent = Split-Path -Parent $EvidencePath
    Assert-Field ([IO.Directory]::Exists($parent)) "진단 JSON 상위 폴더가 없습니다: $parent"
    [IO.File]::WriteAllText($EvidencePath, ($evidence | ConvertTo-Json -Depth 5), (New-Object Text.UTF8Encoding($false)))
}
catch {
    Write-Error "진단 JSON을 쓸 수 없습니다: $($_.Exception.Message)"
    exit 2
}
if ($passed) { Write-Output "PASS: $EvidencePath"; exit 0 }
Write-Output ''
Write-Output 'Lukas QTO add-in diagnostic failed:'
foreach ($failedCheck in @($checks | Where-Object { -not $_.pass })) {
    Write-Output (" - [{0}] {1}" -f $failedCheck.name, $failedCheck.detail)
}
Write-Output ''
Write-Output ("Evidence JSON: {0}" -f $EvidencePath)
Write-Error 'FAIL: Fix the checks listed above, then run this diagnostic again.'
exit 1
