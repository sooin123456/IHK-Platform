# Removes only the current user's Lukas QTO 2025 beta files. No administrator rights are requested.
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$addinRoot = Join-Path $env:APPDATA 'Autodesk\Revit\Addins\2025'
$addinTarget = Join-Path $addinRoot 'Lukas.Qto'
$manifestTarget = Join-Path $addinRoot 'Lukas.Qto.addin'
$desktopTarget = Join-Path (Join-Path $env:LOCALAPPDATA 'Lukas QTO') 'Desktop'
function Assert-Field([bool]$Condition, [string]$Message) { if (-not $Condition) { throw $Message } }
function Assert-NoRecoveryArtifacts([string]$Target) { foreach ($suffix in @('.new', '.rollback')) { Assert-Field (-not (Test-Path -LiteralPath ($Target + $suffix))) "복구 확인이 필요한 잔존 경로가 있습니다: $Target$suffix" } }

try {
    Assert-Field (@(Get-Process -Name Revit -ErrorAction SilentlyContinue).Count -eq 0) 'Revit.exe를 완전히 종료한 뒤 제거하십시오.'
    Assert-NoRecoveryArtifacts $addinTarget; Assert-NoRecoveryArtifacts $manifestTarget; Assert-NoRecoveryArtifacts $desktopTarget
    $hasManifest = Test-Path -LiteralPath $manifestTarget
    $hasAddin = Test-Path -LiteralPath $addinTarget
    Assert-Field (-not $hasAddin -or $hasManifest) "Lukas.Qto 폴더에 대응하는 manifest가 없어 안전하게 제거할 수 없습니다: $addinTarget"
    if ($hasManifest) {
        [xml]$xml = Get-Content -LiteralPath $manifestTarget -Raw -Encoding UTF8
        $node = $xml.RevitAddIns.AddIn | Select-Object -First 1
        Assert-Field (@('Lukas QTO','Hangil System') -contains [string]$node.Name -and $node.FullClassName -eq 'Lukas.Qto.App' -and $node.Assembly -ceq (Join-Path $addinTarget 'Lukas.Qto.dll')) '대상 manifest가 이 제품의 Revit 2025 사용자 설치본이 아니므로 제거하지 않습니다.'
    }
    if (Test-Path -LiteralPath $desktopTarget) { Assert-Field (Test-Path -LiteralPath (Join-Path $desktopTarget 'Lukas.Qto.Desktop.publish.ok')) 'Desktop 소유 표식이 없으므로 제거하지 않습니다.' }
    if ($hasManifest) { Remove-Item -LiteralPath $manifestTarget -Force }
    if ($hasAddin) { Remove-Item -LiteralPath $addinTarget -Recurse -Force }
    if (Test-Path -LiteralPath $desktopTarget) { Remove-Item -LiteralPath $desktopTarget -Recurse -Force }
    Write-Output 'PASS: per-user beta files were removed; no machine-wide files were touched.'
    exit 0
} catch { Write-Error "FAIL: $($_.Exception.Message)"; exit 1 }
