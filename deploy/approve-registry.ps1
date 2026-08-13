param(
    [Parameter(Mandatory = $true)]
    [ValidateScript({ Test-Path -LiteralPath $_ -PathType Leaf })]
    [string]$RegistryCsv
)

$ErrorActionPreference = 'Stop'
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Run PowerShell as Administrator.'
}

$resolved = (Resolve-Path -LiteralPath $RegistryCsv).Path
if ([IO.Path]::GetExtension($resolved) -ine '.csv') { throw 'Registry file must be CSV.' }
$hash = (Get-FileHash -LiteralPath $resolved -Algorithm SHA256).Hash.ToLowerInvariant()
if ($hash -notmatch '^[0-9a-f]{64}$') { throw 'Could not calculate a valid SHA-256.' }

$registryPath = 'HKLM:\SOFTWARE\Lukas QTO\Approvals'
New-Item -Path $registryPath -Force | Out-Null
$existingText = (Get-ItemProperty -Path $registryPath -Name TrustedRegistrySha256 -ErrorAction SilentlyContinue).TrustedRegistrySha256
$existing = @($existingText -split ';' | Where-Object { $_ -match '^[0-9a-f]{64}$' })
$all = @($existing + $hash | Sort-Object -Unique)
Set-ItemProperty -Path $registryPath -Name TrustedRegistrySha256 -Type String -Value ($all -join ';')

Write-Host ('Approved registry SHA-256: ' + $hash)
Write-Host ('Trust store: HKLM\SOFTWARE\Lukas QTO\Approvals\TrustedRegistrySha256')
