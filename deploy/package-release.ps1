# Creates a downloadable Lukas QTO release ZIP from a verified Windows build.
# Run only after deploy\build-all.bat and before publishing a download URL.
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$OutputDirectory,

    [string[]]$RevitVersions = @('2017', '2022', '2023', '2024', '2025', '2026'),

    [string]$ReleaseVersion
)

$ErrorActionPreference = 'Stop'
$validVersions = @('2017', '2022', '2023', '2024', '2025', '2026')
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = [IO.Path]::GetFullPath((Join-Path $scriptRoot '..'))
$buildRoot = Join-Path $repoRoot 'build'

function Assert-Field([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw $Message }
}

function Get-Sha256([string]$Path) {
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToUpperInvariant()
}

function Read-Marker([string]$Path, [bool]$AllowFileLines = $false) {
    Assert-Field ([IO.File]::Exists($Path)) "빌드 표식이 없습니다: $Path"
    $map = @{}
    foreach ($line in [IO.File]::ReadAllLines($Path, [Text.Encoding]::ASCII)) {
        $parts = $line.Split('=', 2)
        Assert-Field ($parts.Count -eq 2 -and -not [string]::IsNullOrWhiteSpace($parts[0])) "빌드 표식 형식이 잘못되었습니다: $Path"
        if ($AllowFileLines -and $parts[0] -ceq 'File') { continue }
        Assert-Field (-not $map.ContainsKey($parts[0])) "빌드 표식 key가 중복되었습니다: $($parts[0])"
        $map[$parts[0]] = $parts[1]
    }
    return $map
}

function Verify-RevitBuild([string]$Version) {
    Assert-Field ($validVersions -contains $Version) "지원하지 않는 Revit 버전: $Version"
    $source = Join-Path $buildRoot ('Release\' + $Version)
    $dll = Join-Path $source 'THEKIE.Qto.dll'
    $marker = Read-Marker (Join-Path $source 'THEKIE.Qto.build.ok')
    Assert-Field ($marker.Count -eq 5) "Revit $Version 표식은 5행이어야 합니다."
    Assert-Field ($marker['RevitVersion'] -ceq $Version) "Revit $Version 표식 버전이 다릅니다."
    Assert-Field ($marker['IsRevitStubBuild'] -ceq 'false') "Revit $Version 스텁 산출물은 배포할 수 없습니다."
    Assert-Field ($marker['TargetFramework'] -ceq $(if ($Version -eq '2017') { 'net46' } elseif ([int]$Version -ge 2025) { 'net8.0-windows' } else { 'net48' })) "Revit $Version TFM 표식이 다릅니다."
    Assert-Field ($marker['AssemblySha256'] -match '^[0-9A-F]{64}$') "Revit $Version DLL SHA-256 표식이 올바르지 않습니다."
    Assert-Field ((Get-Sha256 $dll) -ceq $marker['AssemblySha256']) "Revit $Version DLL SHA-256이 표식과 다릅니다."
    return $source
}

function Verify-DesktopBuild {
    $source = Join-Path $buildRoot 'desktop'
    $marker = Read-Marker (Join-Path $source 'Lukas.Qto.Desktop.publish.ok') $true
    Assert-Field ($marker['TargetFramework'] -ceq 'net8.0-windows') 'Desktop TargetFramework 표식이 다릅니다.'
    Assert-Field ($marker['RuntimeIdentifier'] -ceq 'win-x64') 'Desktop RuntimeIdentifier 표식이 다릅니다.'
    Assert-Field ($marker['SelfContained'] -ceq 'false') 'Desktop self-contained 표식이 다릅니다.'
    Assert-Field ([IO.File]::Exists((Join-Path $source 'Lukas.Qto.Desktop.exe'))) 'Desktop 실행 파일이 없습니다.'
    # File= entries intentionally repeat, so parse them directly and bind every flat file.
    $fileLines = @([IO.File]::ReadAllLines((Join-Path $source 'Lukas.Qto.Desktop.publish.ok'), [Text.Encoding]::ASCII) | Where-Object { $_.StartsWith('File=') })
    $actual = @(Get-ChildItem -LiteralPath $source -File | Where-Object { $_.Name -ne 'Lukas.Qto.Desktop.publish.ok' } | Sort-Object Name)
    Assert-Field ($fileLines.Count -eq $actual.Count -and $actual.Count -gt 0) 'Desktop 파일 SHA 표식 수가 실제 파일 수와 다릅니다.'
    foreach ($file in $actual) {
        $matches = @($fileLines | Where-Object { $_.StartsWith(('File=' + $file.Name + '|'), [StringComparison]::Ordinal) })
        Assert-Field ($matches.Count -eq 1) "Desktop 파일 표식이 정확히 하나가 아닙니다: $($file.Name)"
        $expected = $matches[0].Substring(('File=' + $file.Name + '|').Length)
        Assert-Field ($expected -match '^[0-9A-F]{64}$') "Desktop 파일 SHA-256 표식이 올바르지 않습니다: $($file.Name)"
        Assert-Field ((Get-Sha256 $file.FullName) -ceq $expected) "Desktop 파일 SHA-256이 표식과 다릅니다: $($file.Name)"
    }
    return $source
}

try {
    $OutputDirectory = [IO.Path]::GetFullPath($OutputDirectory)
    Assert-Field ([IO.Directory]::Exists($OutputDirectory)) "출력 폴더가 없습니다: $OutputDirectory"
    Assert-Field ($RevitVersions.Count -gt 0) '하나 이상의 Revit 버전이 필요합니다.'
    $RevitVersions = @($RevitVersions | Select-Object -Unique)
    $revitSources = @($RevitVersions | ForEach-Object { Verify-RevitBuild $_ })
    $desktopSource = Verify-DesktopBuild
    $preflightSource = Join-Path $buildRoot 'preflight'
    Assert-Field ([IO.File]::Exists((Join-Path $preflightSource 'THEKIE.Qto.Preflight.exe'))) 'Preflight 실행 파일이 없습니다.'
    if ([string]::IsNullOrWhiteSpace($ReleaseVersion)) { $ReleaseVersion = 'field-' + [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss') }
    Assert-Field ($ReleaseVersion -match '^[A-Za-z0-9][A-Za-z0-9._-]*$') 'ReleaseVersion에는 영문·숫자·점·밑줄·하이픈만 사용할 수 있습니다.'

    $leaf = 'Lukas-QTO-' + $ReleaseVersion
    $zipPath = Join-Path $OutputDirectory ($leaf + '.zip')
    $shaPath = $zipPath + '.sha256'
    Assert-Field (-not [IO.File]::Exists($zipPath) -and -not [IO.File]::Exists($shaPath)) "기존 릴리스 파일을 덮어쓰지 않습니다: $zipPath"
    $stage = Join-Path $OutputDirectory ('.' + $leaf + '.' + [Guid]::NewGuid().ToString('N') + '.partial')
    [IO.Directory]::CreateDirectory($stage) | Out-Null
    try {
        $root = Join-Path $stage $leaf
        [IO.Directory]::CreateDirectory($root) | Out-Null
        [IO.Directory]::CreateDirectory((Join-Path $root 'deploy')) | Out-Null
        [IO.Directory]::CreateDirectory((Join-Path $root 'build\Release')) | Out-Null
        foreach ($document in @('README.md', 'FIELD_TEST_README.md', '1-BUILD-INSTALL-2025.bat', '2-DIAGNOSE-2025.bat')) {
            Copy-Item -LiteralPath (Join-Path $repoRoot $document) -Destination (Join-Path $root $document) -Force
        }
        foreach ($script in @('install.bat', 'install-user-2025.bat', 'uninstall-user-2025.bat', 'install-user-2025.ps1', 'uninstall-user-2025.ps1', 'diagnose-revit-addin.ps1', 'verify-field-package.ps1', 'verify-properties-ledger.ps1')) {
            Copy-Item -LiteralPath (Join-Path $scriptRoot $script) -Destination (Join-Path $root ('deploy\' + $script)) -Force
        }
        foreach ($version in $RevitVersions) {
            Copy-Item -LiteralPath (Join-Path $buildRoot ('Release\' + $version)) -Destination (Join-Path $root 'build\Release') -Recurse
        }
        Copy-Item -LiteralPath $desktopSource -Destination (Join-Path $root 'build') -Recurse
        Copy-Item -LiteralPath $preflightSource -Destination (Join-Path $root 'build') -Recurse
        $files = @(Get-ChildItem -LiteralPath $root -Recurse -File | Sort-Object FullName | ForEach-Object {
            [pscustomobject]@{ path = $_.FullName.Substring($root.Length + 1).Replace('\', '/'); sha256 = Get-Sha256 $_.FullName; bytes = $_.Length }
        })
        $manifest = [pscustomobject]@{
            product = 'Lukas QTO'
            release_version = $ReleaseVersion
            created_at_utc = [DateTime]::UtcNow.ToString('o')
            revit_versions = $RevitVersions
            desktop_runtime = 'net8.0-windows win-x64 framework-dependent'
            files = $files
        }
        [IO.File]::WriteAllText((Join-Path $root 'release-manifest.json'), ($manifest | ConvertTo-Json -Depth 4), (New-Object Text.UTF8Encoding($false)))
        Compress-Archive -LiteralPath $root -DestinationPath $zipPath -CompressionLevel Optimal
        Assert-Field ([IO.File]::Exists($zipPath)) '릴리스 ZIP 생성에 실패했습니다.'
        [IO.File]::WriteAllText($shaPath, ((Get-Sha256 $zipPath) + '  ' + [IO.Path]::GetFileName($zipPath) + [Environment]::NewLine), (New-Object Text.ASCIIEncoding))
        Write-Output "PASS: $zipPath"
        Write-Output "SHA256: $(Get-Sha256 $zipPath)"
    }
    finally {
        if ([IO.Directory]::Exists($stage)) { Remove-Item -LiteralPath $stage -Recurse -Force }
    }
}
catch {
    Write-Error "FAIL: $($_.Exception.Message)"
    exit 1
}
