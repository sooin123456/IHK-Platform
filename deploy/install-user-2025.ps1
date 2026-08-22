# Installs the Revit 2025 beta and Desktop application for the current Windows user only.
# No administrator rights are requested. Build outputs are verified before any target is replaced.
[CmdletBinding()]
param(
    [switch]$AddinOnly
)

$ErrorActionPreference = 'Stop'
$version = '2025'
$canonicalAddInId = 'e36671a8-0944-465c-919e-1006dfd3610e'
$previousPerUserAddInId = '7F45DD1A-422A-4FE8-9646-6A1D54F26B9A'
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = [IO.Path]::GetFullPath((Join-Path $scriptRoot '..'))
$addinRoot = Join-Path $env:APPDATA 'Autodesk\Revit\Addins\2025'
$addinTarget = Join-Path $addinRoot 'Lukas.Qto'
$manifestTarget = Join-Path $addinRoot 'Lukas.Qto.addin'
$desktopRoot = Join-Path $env:LOCALAPPDATA 'Lukas QTO'
$desktopTarget = Join-Path $desktopRoot 'Desktop'
$machineAddinRoot = Join-Path $env:ProgramData 'Autodesk\Revit\Addins\2025'
$addinPrepared = $false
$addinCommitted = $false
$hadAddin = $false
$hadManifest = $false

function Assert-Field([bool]$Condition, [string]$Message) { if (-not $Condition) { throw $Message } }
function Get-Sha256([string]$Path) { (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToUpperInvariant() }
function Assert-NoRecoveryArtifacts([string]$Target) {
    foreach ($suffix in @('.new', '.rollback')) {
        Assert-Field (-not (Test-Path -LiteralPath ($Target + $suffix))) "복구 확인이 필요한 잔존 경로가 있습니다: $Target$suffix"
    }
}
function Read-ExactMarker([string]$Path) {
    Assert-Field ([IO.File]::Exists($Path)) "빌드 표식이 없습니다: $Path"
    $map = @{}
    foreach ($line in [IO.File]::ReadAllLines($Path, [Text.Encoding]::ASCII)) {
        $pair = $line.Split('=', 2)
        Assert-Field ($pair.Count -eq 2 -and -not $map.ContainsKey($pair[0])) "표식 형식 또는 중복 key가 잘못되었습니다: $Path"
        $map[$pair[0]] = $pair[1]
    }
    return $map
}
function Verify-RevitSource {
    $source = Join-Path $repoRoot 'build\Release\2025'
    $dll = Join-Path $source 'Lukas.Qto.dll'
    $marker = Read-ExactMarker (Join-Path $source 'Lukas.Qto.build.ok')
    Assert-Field ($marker.Count -eq 5) 'Revit 2025 표식은 정확히 5행이어야 합니다.'
    Assert-Field ($marker['RevitVersion'] -ceq $version -and $marker['TargetFramework'] -ceq 'net8.0-windows' -and $marker['IsRevitStubBuild'] -ceq 'false') 'Revit 2025 표식의 버전/TFM/스텁 값이 다릅니다.'
    $programFiles64 = if ([string]::IsNullOrWhiteSpace($env:ProgramW6432)) { $env:ProgramFiles } else { $env:ProgramW6432 }
    Assert-Field ($marker['RevitApiDir'] -ceq (Join-Path $programFiles64 'Autodesk\Revit 2025')) 'Revit 2025 표식의 실제 API 경로가 다릅니다.'
    $expectedHash = ([string]$marker['AssemblySha256']).ToUpperInvariant()
    Assert-Field ($expectedHash -match '^[0-9A-F]{64}$' -and [IO.File]::Exists($dll) -and (Get-Sha256 $dll) -ceq $expectedHash) 'Revit DLL SHA-256이 표식과 다릅니다.'
    return $dll
}
function Get-DesktopFiles {
    $source = Join-Path $repoRoot 'build\desktop'
    $markerPath = Join-Path $source 'Lukas.Qto.Desktop.publish.ok'
    $lines = @([IO.File]::ReadAllLines($markerPath, [Text.Encoding]::ASCII))
    Assert-Field ($lines.Count -ge 4 -and $lines[0] -ceq 'TargetFramework=net8.0-windows' -and $lines[1] -ceq 'RuntimeIdentifier=win-x64' -and $lines[2] -ceq 'SelfContained=false') 'Desktop 게시 표식의 헤더가 다릅니다.'
    $files = @{}
    foreach ($line in @($lines | Select-Object -Skip 3)) {
        Assert-Field ($line -match '^File=([^\\/|]+)\|([0-9A-Fa-f]{64})$') "Desktop 파일 표식이 잘못되었습니다: $line"
        $name = $Matches[1]; Assert-Field (-not $files.ContainsKey($name)) "Desktop 파일 표식이 중복됩니다: $name"; $files[$name] = $Matches[2].ToUpperInvariant()
    }
    $actual = @(Get-ChildItem -LiteralPath $source -File | Where-Object { $_.Name -ne 'Lukas.Qto.Desktop.publish.ok' })
    Assert-Field ($files.Count -gt 0 -and $files.Count -eq $actual.Count -and $files.ContainsKey('Lukas.Qto.Desktop.exe')) 'Desktop 표식과 flat 게시 파일이 일치하지 않습니다.'
    foreach ($file in $actual) { Assert-Field ($files.ContainsKey($file.Name) -and (Get-Sha256 $file.FullName) -ceq $files[$file.Name]) "Desktop 파일 SHA-256이 표식과 다릅니다: $($file.Name)" }
    return [pscustomobject]@{ source = $source; marker = $markerPath; files = $files }
}
function Write-Manifest([string]$Path, [string]$Assembly) {
    $xml = "<?xml version=`"1.0`" encoding=`"utf-8`"?><RevitAddIns><AddIn Type=`"Application`"><Name>Hangil System</Name><Assembly>$([Security.SecurityElement]::Escape($Assembly))</Assembly><AddInId>$canonicalAddInId</AddInId><FullClassName>Lukas.Qto.App</FullClassName><VendorId>LUKS</VendorId><VendorDescription>Hangil System BIM quantity takeoff</VendorDescription></AddIn></RevitAddIns>"
    [IO.File]::WriteAllText($Path, $xml, (New-Object Text.UTF8Encoding($false)))
}
function Restore-Path([string]$Target, [string]$Backup, [bool]$HadTarget) {
    if (Test-Path -LiteralPath $Target) { Remove-Item -LiteralPath $Target -Recurse -Force }
    if ($HadTarget -and (Test-Path -LiteralPath $Backup)) { Move-Item -LiteralPath $Backup -Destination $Target }
}
function Assert-ExistingUserInstallIsOwned {
    $hasAddin = Test-Path -LiteralPath $addinTarget
    $hasManifest = Test-Path -LiteralPath $manifestTarget
    Assert-Field (-not $hasAddin -or $hasManifest) "Lukas.Qto 폴더에 대응하는 manifest가 없어 안전하게 교체할 수 없습니다: $addinTarget"
    if ($hasManifest) {
        [xml]$existing = Get-Content -LiteralPath $manifestTarget -Raw -Encoding UTF8
        $node = $existing.RevitAddIns.AddIn | Select-Object -First 1
        $knownId = ([string]$node.AddInId) -ieq $canonicalAddInId -or ([string]$node.AddInId) -ieq $previousPerUserAddInId
        $currentSignature = $node.FullClassName -eq 'Lukas.Qto.App' -and $node.Assembly -ceq (Join-Path $addinTarget 'Lukas.Qto.dll')
        $legacySignature = $node.FullClassName -eq 'THEKIE.Qto.App' -and $node.Assembly -ceq (Join-Path $addinTarget 'THEKIE.Qto.dll')
        Assert-Field (@('Lukas QTO','Hangil System','THEKIE QTO') -contains [string]$node.Name -and $knownId -and ($currentSignature -or $legacySignature)) "기존 manifest가 이 제품의 알려진 2025 사용자 설치본이 아니므로 교체하지 않습니다: $manifestTarget"
    }
}
function Assert-NoActiveConflict([string]$Path) {
    Assert-Field (-not [IO.File]::Exists($Path)) "다른 위치에 활성화된 이전/공용 add-in이 있어 사용자 설치를 중단합니다. 관리자에게 해당 설치본 제거를 요청하거나 이 경로를 확인하세요: $Path"
}

try {
    Assert-Field (@(Get-Process -Name Revit -ErrorAction SilentlyContinue).Count -eq 0) 'Revit.exe를 완전히 종료한 뒤 설치하십시오.'
    $revitDll = Verify-RevitSource
    if (-not $AddinOnly) { $desktop = Get-DesktopFiles }
    Assert-NoRecoveryArtifacts $addinTarget; Assert-NoRecoveryArtifacts $manifestTarget
    if (-not $AddinOnly) { Assert-NoRecoveryArtifacts $desktopTarget }
    Assert-ExistingUserInstallIsOwned
    Assert-NoActiveConflict (Join-Path $addinRoot 'THEKIE.Qto.addin')
    Assert-NoActiveConflict (Join-Path $machineAddinRoot 'Lukas.Qto.addin')
    Assert-NoActiveConflict (Join-Path $machineAddinRoot 'THEKIE.Qto.addin')
    [IO.Directory]::CreateDirectory($addinRoot) | Out-Null
    if (-not $AddinOnly) { [IO.Directory]::CreateDirectory($desktopRoot) | Out-Null }

    $addinStage = $addinTarget + '.new'; $addinBackup = $addinTarget + '.rollback'
    $manifestStage = $manifestTarget + '.new'; $manifestBackup = $manifestTarget + '.rollback'
    [IO.Directory]::CreateDirectory($addinStage) | Out-Null
    Copy-Item -LiteralPath $revitDll -Destination (Join-Path $addinStage 'Lukas.Qto.dll') -Force
    Assert-Field ((Get-Sha256 (Join-Path $addinStage 'Lukas.Qto.dll')) -ceq (Get-Sha256 $revitDll)) '스테이지 Revit DLL SHA-256이 다릅니다.'
    Write-Manifest $manifestStage (Join-Path $addinTarget 'Lukas.Qto.dll')
    $hadAddin = Test-Path -LiteralPath $addinTarget; $hadManifest = Test-Path -LiteralPath $manifestTarget
    try {
        if ($hadAddin) { Move-Item -LiteralPath $addinTarget -Destination $addinBackup }
        if ($hadManifest) { Move-Item -LiteralPath $manifestTarget -Destination $manifestBackup }
        Move-Item -LiteralPath $addinStage -Destination $addinTarget; Move-Item -LiteralPath $manifestStage -Destination $manifestTarget
        [xml]$xml = Get-Content -LiteralPath $manifestTarget -Raw -Encoding UTF8
        Assert-Field ($xml.RevitAddIns.AddIn.Assembly -ceq (Join-Path $addinTarget 'Lukas.Qto.dll')) '설치된 add-in manifest의 Assembly 경로가 다릅니다.'
        Assert-Field ((Get-Sha256 (Join-Path $addinTarget 'Lukas.Qto.dll')) -ceq (Get-Sha256 $revitDll)) '설치된 Revit DLL SHA-256이 다릅니다.'
        $addinPrepared = $true
    } catch { Restore-Path $addinTarget $addinBackup $hadAddin; Restore-Path $manifestTarget $manifestBackup $hadManifest; throw }

    $receipt = [pscustomobject]@{
        product = 'Hangil System Revit add-in'
        installed_at_utc = [DateTime]::UtcNow.ToString('o')
        revit_year = '2025'
        scope = 'User'
        manifest = $manifestTarget
        assembly = (Join-Path $addinTarget 'Lukas.Qto.dll')
        assembly_sha256 = Get-Sha256 (Join-Path $addinTarget 'Lukas.Qto.dll')
        addin_id = $canonicalAddInId
    }
    [IO.File]::WriteAllText((Join-Path $addinTarget 'install-receipt.json'), ($receipt | ConvertTo-Json -Depth 3), (New-Object Text.UTF8Encoding($false)))

    if (-not $AddinOnly) {
        $desktopStage = $desktopTarget + '.new'; $desktopBackup = $desktopTarget + '.rollback'
        [IO.Directory]::CreateDirectory($desktopStage) | Out-Null
        foreach ($name in $desktop.files.Keys) { Copy-Item -LiteralPath (Join-Path $desktop.source $name) -Destination (Join-Path $desktopStage $name) -Force }
        Copy-Item -LiteralPath $desktop.marker -Destination (Join-Path $desktopStage 'Lukas.Qto.Desktop.publish.ok') -Force
        foreach ($name in $desktop.files.Keys) { Assert-Field ((Get-Sha256 (Join-Path $desktopStage $name)) -ceq $desktop.files[$name]) "Desktop 스테이지 SHA-256이 다릅니다: $name" }
        $hadDesktop = Test-Path -LiteralPath $desktopTarget
        try {
            if ($hadDesktop) { Move-Item -LiteralPath $desktopTarget -Destination $desktopBackup }
            Move-Item -LiteralPath $desktopStage -Destination $desktopTarget
            foreach ($name in $desktop.files.Keys) { Assert-Field ((Get-Sha256 (Join-Path $desktopTarget $name)) -ceq $desktop.files[$name]) "설치된 Desktop SHA-256이 다릅니다: $name" }
            if ($hadDesktop) { Remove-Item -LiteralPath $desktopBackup -Recurse -Force }
        } catch { Restore-Path $desktopTarget $desktopBackup $hadDesktop; throw }
        Write-Output "PASS: per-user beta installed. Revit=$manifestTarget Desktop=$desktopTarget"
    }
    $addinCommitted = $true
    try {
        if ($hadAddin -and (Test-Path -LiteralPath $addinBackup)) { Remove-Item -LiteralPath $addinBackup -Recurse -Force }
        if ($hadManifest -and (Test-Path -LiteralPath $manifestBackup)) { Remove-Item -LiteralPath $manifestBackup -Force }
    } catch { Write-Warning "설치는 완료됐지만 이전 설치 백업 정리가 필요합니다: $($_.Exception.Message)" }
    if ($AddinOnly) { Write-Output "PASS: per-user extraction add-in installed. Revit=$manifestTarget" }
    exit 0
} catch {
    if ($addinPrepared -and -not $addinCommitted) {
        try { Restore-Path $addinTarget $addinBackup $hadAddin; Restore-Path $manifestTarget $manifestBackup $hadManifest }
        catch { Write-Warning "이전 사용자 add-in 복구 상태를 확인하세요: $($_.Exception.Message)" }
    }
    Write-Error "FAIL: $($_.Exception.Message)"
    exit 1
}
