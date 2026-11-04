param(
  [switch]$RemoveCertificate
)

$ErrorActionPreference = 'Stop'
$certificatePath = Join-Path $PSScriptRoot 'Claude-ThirdParty-ZeroConfig.cer'
$packages = Get-AppxPackage -Name 'ClaudeThirdPartyZeroConfig' -ErrorAction SilentlyContinue
$packages | ForEach-Object {
  Remove-AppxPackage -Package $_.PackageFullName
  Write-Host "Removed $($_.PackageFullName)"
}

if ($RemoveCertificate -and (Test-Path -LiteralPath $certificatePath)) {
  $certificate = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($certificatePath)
  Remove-Item -LiteralPath "Cert:\CurrentUser\Root\$($certificate.Thumbprint)" -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath "Cert:\CurrentUser\TrustedPeople\$($certificate.Thumbprint)" -Force -ErrorAction SilentlyContinue
  Write-Host "Removed trusted certificate $($certificate.Thumbprint)"
}
