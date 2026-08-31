[CmdletBinding()]
param(
    [string]$DiagnosticPath = (Join-Path (Split-Path -Parent $PSScriptRoot) 'deploy\diagnose-revit-addin.ps1'),
    [string]$AssemblyPath = (Join-Path (Split-Path -Parent $PSScriptRoot) 'build\Release\2025\Lukas.Qto.dll'),
    [string]$PowerShellExecutable
)

$ErrorActionPreference = 'Stop'
$canonicalAddInId = 'e36671a8-0944-465c-919e-1006dfd3610e'
$powerShell = if (-not [string]::IsNullOrWhiteSpace($PowerShellExecutable)) {
    [IO.Path]::GetFullPath($PowerShellExecutable)
} elseif ([IO.File]::Exists((Join-Path $PSHOME 'powershell.exe'))) {
    Join-Path $PSHOME 'powershell.exe'
} elseif ([IO.File]::Exists((Join-Path $PSHOME 'pwsh'))) {
    Join-Path $PSHOME 'pwsh'
} else { (Get-Process -Id $PID).Path }
$temp = Join-Path ([IO.Path]::GetTempPath()) ('lukas-diagnostic-contract-' + [Guid]::NewGuid().ToString('N'))

function Assert-Field([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw $Message }
}

function Write-Manifest([string]$Path, [string]$Assembly, [string]$Name = 'Hangil System', [string]$ClassName = 'Lukas.Qto.App') {
    [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($Path)) | Out-Null
    $escaped = [Security.SecurityElement]::Escape($Assembly)
    $xml = "<?xml version=`"1.0`" encoding=`"utf-8`"?><RevitAddIns><AddIn Type=`"Application`"><Name>$Name</Name><Assembly>$escaped</Assembly><AddInId>$canonicalAddInId</AddInId><FullClassName>$ClassName</FullClassName><VendorId>LUKS</VendorId></AddIn></RevitAddIns>"
    [IO.File]::WriteAllText($Path, $xml, (New-Object Text.UTF8Encoding($false)))
}

function Reset-Fixture {
    foreach ($path in @($script:userRoot, $script:machineRoot, $script:evidenceRoot)) {
        if ([IO.Directory]::Exists($path)) { Remove-Item -LiteralPath $path -Recurse -Force }
        [IO.Directory]::CreateDirectory($path) | Out-Null
    }
}

function Install-UserFixture {
    $addinRoot = Join-Path $script:userRoot 'Autodesk\Revit\Addins\2025'
    $assemblyDir = Join-Path $addinRoot 'Lukas.Qto'
    [IO.Directory]::CreateDirectory($assemblyDir) | Out-Null
    $assembly = Join-Path $assemblyDir 'Lukas.Qto.dll'
    Copy-Item -LiteralPath $AssemblyPath -Destination $assembly
    $manifest = Join-Path $addinRoot 'Lukas.Qto.addin'
    Write-Manifest $manifest $assembly
    $hash = (Get-FileHash -LiteralPath $assembly -Algorithm SHA256).Hash.ToUpperInvariant()
    $receipt = [pscustomobject]@{
        product = 'Hangil System Revit add-in'
        installed_at_utc = [DateTime]::UtcNow.ToString('o')
        revit_year = '2025'
        scope = 'User'
        manifest = $manifest
        assembly = $assembly
        assembly_sha256 = $hash
        addin_id = $canonicalAddInId
    }
    [IO.File]::WriteAllText((Join-Path $assemblyDir 'install-receipt.json'), ($receipt | ConvertTo-Json -Depth 3), (New-Object Text.UTF8Encoding($false)))
    return [pscustomobject]@{ root=$addinRoot; manifest=$manifest; assembly=$assembly; receipt=(Join-Path $assemblyDir 'install-receipt.json') }
}

function Invoke-DiagnosticCase([string]$Name, [int]$ExpectedExit) {
    $evidence = Join-Path $script:evidenceRoot ($Name + '.json')
    $log = Join-Path $script:evidenceRoot ($Name + '.log')
    & $powerShell -NoProfile -ExecutionPolicy Bypass -File $DiagnosticPath -RevitVersion 2025 -Scope Auto -EvidencePath $evidence *> $log
    $actualExit = $LASTEXITCODE
    Assert-Field ($actualExit -eq $ExpectedExit) "$Name exit code mismatch: expected=$ExpectedExit actual=$actualExit`n$([IO.File]::ReadAllText($log))"
    Assert-Field ([IO.File]::Exists($evidence)) "$Name did not create evidence JSON"
    $raw = [IO.File]::ReadAllText($evidence, [Text.Encoding]::UTF8)
    Assert-Field (-not $raw.Contains([char]0xFFFD)) "$Name evidence contains a replacement character"
    return ($raw | ConvertFrom-Json)
}

try {
    Assert-Field ([IO.File]::Exists($DiagnosticPath)) "Diagnostic script is missing: $DiagnosticPath"
    Assert-Field ([IO.File]::Exists($AssemblyPath)) "Verified test assembly is missing: $AssemblyPath"
    [IO.Directory]::CreateDirectory($temp) | Out-Null
    $script:userRoot = Join-Path $temp '테스트 사용자 AppData'
    $script:machineRoot = Join-Path $temp 'ProgramData'
    $script:programFiles = Join-Path $temp 'Program Files'
    $script:evidenceRoot = Join-Path $temp 'field-evidence'
    $revitExe = Join-Path $script:programFiles 'Autodesk\Revit 2025\Revit.exe'
    [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($revitExe)) | Out-Null
    Copy-Item -LiteralPath $AssemblyPath -Destination $revitExe
    $env:APPDATA = $script:userRoot
    $env:ProgramData = $script:machineRoot
    $env:ProgramW6432 = $script:programFiles

    Reset-Fixture
    $user = Install-UserFixture
    $valid = Invoke-DiagnosticCase 'valid-korean-user-path' 0
    Assert-Field ($valid.passed -eq $true -and $valid.detected_scope -ceq 'User') 'Valid user fixture did not pass.'

    Reset-Fixture
    $user = Install-UserFixture
    $machineAssembly = Join-Path $script:machineRoot 'Autodesk\Revit\Addins\2025\Lukas.Qto\Lukas.Qto.dll'
    [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($machineAssembly)) | Out-Null
    Copy-Item -LiteralPath $AssemblyPath -Destination $machineAssembly
    Write-Manifest (Join-Path $script:machineRoot 'Autodesk\Revit\Addins\2025\Lukas.Qto.addin') $machineAssembly
    $duplicate = Invoke-DiagnosticCase 'duplicate-user-machine' 1
    Assert-Field (@($duplicate.checks | Where-Object { $_.name -eq 'single_active_installation' -and -not $_.pass }).Count -eq 1) 'Duplicate fixture was not reported.'

    Reset-Fixture
    $user = Install-UserFixture
    $brokenMachine = Join-Path $script:machineRoot 'Autodesk\Revit\Addins\2025\Lukas.Qto.addin'
    [IO.Directory]::CreateDirectory((Split-Path -Parent $brokenMachine)) | Out-Null
    Write-Manifest $brokenMachine (Join-Path $script:machineRoot 'missing-Lukas.Qto.dll')
    $leftover = Invoke-DiagnosticCase 'invalid-machine-leftover' 1
    Assert-Field (@($leftover.checks | Where-Object { $_.name -eq 'single_active_installation' -and $_.pass }).Count -eq 1) 'A leftover invalid Machine manifest was counted as a duplicate valid add-in.'
    Assert-Field (@($leftover.checks | Where-Object { $_.name -eq 'leftover_invalid_manifests' -and -not $_.pass }).Count -eq 1) 'A leftover invalid Machine manifest was not reported separately.'
    Assert-Field ($leftover.detected_scope -ceq 'User') 'The valid User install was not selected when an invalid Machine leftover existed.'

    Reset-Fixture
    $user = Install-UserFixture
    Write-Manifest (Join-Path $user.root 'THEKIE.Qto.addin') $user.assembly 'THEKIE QTO' 'THEKIE.Qto.App'
    $legacy = Invoke-DiagnosticCase 'active-legacy-manifest' 1
    Assert-Field (@($legacy.checks | Where-Object { $_.name -eq 'legacy_and_duplicate_manifests' -and -not $_.pass }).Count -eq 1) 'Legacy fixture was not reported.'

    Reset-Fixture
    $user = Install-UserFixture
    $receipt = Get-Content -LiteralPath $user.receipt -Raw -Encoding UTF8 | ConvertFrom-Json
    $receipt.assembly_sha256 = ('0' * 64)
    [IO.File]::WriteAllText($user.receipt, ($receipt | ConvertTo-Json -Depth 3), (New-Object Text.UTF8Encoding($false)))
    $tampered = Invoke-DiagnosticCase 'tampered-receipt-hash' 1
    Assert-Field (@($tampered.checks | Where-Object { $_.name -eq 'installation_receipt' -and -not $_.pass }).Count -eq 1) 'Tampered receipt fixture was not reported.'

    Write-Output 'Revit add-in diagnostic behavioral contract passed.'
}
finally {
    if ([IO.Directory]::Exists($temp)) { Remove-Item -LiteralPath $temp -Recurse -Force }
}
