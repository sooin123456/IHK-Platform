# Installs the Revit 2025 beta and Desktop application for the current Windows user only.
# No administrator rights are requested. Build outputs are verified before any target is replaced.
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$version = '2025'
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = [IO.Path]::GetFullPath((Join-Path $scriptRoot '..'))
$addinRoot = Join-Path $env:APPDATA 'Autodesk\Revit\Addins\2025'
$addinTarget = Join-Path $addinRoot 'Lukas.Qto'
$manifestTarget = Join-Path $addinRoot 'Lukas.Qto.addin'
$desktopRoot = Join-Path $env:LOCALAPPDATA 'Lukas QTO'
$desktopTarget = Join-Path $desktopRoot 'Desktop'

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
    $dll = Join-Path $source 'THEKIE.Qto.dll'
    $marker = Read-ExactMarker (Join-Path $source 'THEKIE.Qto.build.ok')
    Assert-Field ($marker.Count -eq 5) 'Revit 2025 표식은 정확히 5행이어야 합니다.'
    Assert-Field ($marker['RevitVersion'] -ceq $version -and $marker['TargetFramework'] -ceq 'net8.0-windows' -and $marker['IsRevitStubBuild'] -ceq 'false') 'Revit 2025 표식의 버전/TFM/스텁 값이 다릅니다.'
    $programFiles64 = if ([string]::IsNullOrWhiteSpace($env:ProgramW6432)) { $env:ProgramFiles } else { $env:ProgramW6432 }
    Assert-Field ($marker['RevitApiDir'] -ceq (Join-Path $programFiles64 'Autodesk\Revit 2025')) 'Revit 2025 표식의 실제 API 경로가 다릅니다.'
    Assert-Field ($marker['AssemblySha256'] -match '^[0-9A-F]{64}$' -and [IO.File]::Exists($dll) -and (Get-Sha256 $dll) -ceq $marker['AssemblySha256']) 'Revit DLL SHA-256이 표식과 다릅니다.'
    return $dll
}
function Get-DesktopFiles {
    $source = Join-Path $repoRoot 'build\desktop'
    $markerPath = Join-Path $source 'Lukas.Qto.Desktop.publish.ok'
    $lines = @([IO.File]::ReadAllLines($markerPath, [Text.Encoding]::ASCII))
    Assert-Field ($lines.Count -ge 4 -and $lines[0] -ceq 'TargetFramework=net8.0-windows' -and $lines[1] -ceq 'RuntimeIdentifier=win-x64' -and $lines[2] -ceq 'SelfContained=false') 'Desktop 게시 표식의 헤더가 다릅니다.'
    $files = @{}
    foreach ($line in @($lines | Select-Object -Skip 3)) {
        Assert-Field ($line -match '^File=([^\\/|]+)\|([0-9A-F]{64})$') "Desktop 파일 표식이 잘못되었습니다: $line"
        $name = $Matches[1]; Assert-Field (-not $files.ContainsKey($name)) "Desktop 파일 표식이 중복됩니다: $name"; $files[$name] = $Matches[2]
    }
    $actual = @(Get-ChildItem -LiteralPath $source -File | Where-Object { $_.Name -ne 'Lukas.Qto.Desktop.publish.ok' })
    Assert-Field ($files.Count -gt 0 -and $files.Count -eq $actual.Count -and $files.ContainsKey('Lukas.Qto.Desktop.exe')) 'Desktop 표식과 flat 게시 파일이 일치하지 않습니다.'
    foreach ($file in $actual) { Assert-Field ($files.ContainsKey($file.Name) -and (Get-Sha256 $file.FullName) -ceq $files[$file.Name]) "Desktop 파일 SHA-256이 표식과 다릅니다: $($file.Name)" }
    return [pscustomobject]@{ source = $source; marker = $markerPath; files = $files }
}
function Write-Manifest([string]$Path, [string]$Assembly) {
    $xml = "<?xml version=`"1.0`" encoding=`"utf-8`"?><RevitAddIns><AddIn Type=`"Application`"><Name>Lukas QTO</Name><Assembly>$([Security.SecurityElement]::Escape($Assembly))</Assembly><AddInId>7F45DD1A-422A-4FE8-9646-6A1D54F26B9A</AddInId><FullClassName>THEKIE.Qto.App</FullClassName><VendorId>THEKIE</VendorId><VendorDescription>Lukas QTO</VendorDescription></AddIn></RevitAddIns>"
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
        Assert-Field ($node.Name -eq 'Lukas QTO' -and $node.FullClassName -eq 'THEKIE.Qto.App' -and $node.Assembly -ceq (Join-Path $addinTarget 'THEKIE.Qto.dll')) "기존 manifest가 Lukas QTO 2025 사용자 설치본이 아니므로 교체하지 않습니다: $manifestTarget"
    }
}

try {
    Assert-Field (@(Get-Process -Name Revit -ErrorAction SilentlyContinue).Count -eq 0) 'Revit.exe를 완전히 종료한 뒤 설치하십시오.'
    $revitDll = Verify-RevitSource
    $desktop = Get-DesktopFiles
    Assert-NoRecoveryArtifacts $addinTarget; Assert-NoRecoveryArtifacts $manifestTarget; Assert-NoRecoveryArtifacts $desktopTarget
    Assert-ExistingUserInstallIsOwned
    [IO.Directory]::CreateDirectory($addinRoot) | Out-Null; [IO.Directory]::CreateDirectory($desktopRoot) | Out-Null

    $addinStage = $addinTarget + '.new'; $addinBackup = $addinTarget + '.rollback'
    $manifestStage = $manifestTarget + '.new'; $manifestBackup = $manifestTarget + '.rollback'
    [IO.Directory]::CreateDirectory($addinStage) | Out-Null
    Copy-Item -LiteralPath $revitDll -Destination (Join-Path $addinStage 'THEKIE.Qto.dll') -Force
    Assert-Field ((Get-Sha256 (Join-Path $addinStage 'THEKIE.Qto.dll')) -ceq (Get-Sha256 $revitDll)) '스테이지 Revit DLL SHA-256이 다릅니다.'
    Write-Manifest $manifestStage (Join-Path $addinTarget 'THEKIE.Qto.dll')
    $hadAddin = Test-Path -LiteralPath $addinTarget; $hadManifest = Test-Path -LiteralPath $manifestTarget
    try {
        if ($hadAddin) { Move-Item -LiteralPath $addinTarget -Destination $addinBackup }
        if ($hadManifest) { Move-Item -LiteralPath $manifestTarget -Destination $manifestBackup }
        Move-Item -LiteralPath $addinStage -Destination $addinTarget; Move-Item -LiteralPath $manifestStage -Destination $manifestTarget
        [xml]$xml = Get-Content -LiteralPath $manifestTarget -Raw -Encoding UTF8
        Assert-Field ($xml.RevitAddIns.AddIn.Assembly -ceq (Join-Path $addinTarget 'THEKIE.Qto.dll')) '설치된 add-in manifest의 Assembly 경로가 다릅니다.'
        Assert-Field ((Get-Sha256 (Join-Path $addinTarget 'THEKIE.Qto.dll')) -ceq (Get-Sha256 $revitDll)) '설치된 Revit DLL SHA-256이 다릅니다.'
        if ($hadAddin) { Remove-Item -LiteralPath $addinBackup -Recurse -Force }; if ($hadManifest) { Remove-Item -LiteralPath $manifestBackup -Force }
    } catch { Restore-Path $addinTarget $addinBackup $hadAddin; Restore-Path $manifestTarget $manifestBackup $hadManifest; throw }

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
    exit 0
} catch { Write-Error "FAIL: $($_.Exception.Message)"; exit 1 }
