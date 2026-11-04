param(
  [switch]$TrustCertificate,
  [switch]$NoStart
)

$ErrorActionPreference = 'Stop'
$msixPath = Join-Path $PSScriptRoot 'Claude-ThirdParty-ZeroConfig-x64.msix'
$certificatePath = Join-Path $PSScriptRoot 'Claude-ThirdParty-ZeroConfig.cer'
$expectedSubject = 'CN=Claude Third-Party Zero Config'

if (-not (Test-Path -LiteralPath $msixPath)) {
  throw "MSIX not found: $msixPath"
}
if (-not (Test-Path -LiteralPath $certificatePath)) {
  throw "Certificate not found: $certificatePath"
}

$certificate = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($certificatePath)
if ($certificate.Subject -ne $expectedSubject) {
  throw "Unexpected certificate subject: $($certificate.Subject)"
}

$signature = Get-AuthenticodeSignature -LiteralPath $msixPath
if (-not $signature.SignerCertificate) {
  throw 'The MSIX does not contain a readable Authenticode signature.'
}
if ($signature.SignerCertificate.Thumbprint -ne $certificate.Thumbprint) {
  throw 'The MSIX signer does not match the supplied certificate.'
}

$trustedCertificate = Get-ChildItem -LiteralPath 'Cert:\CurrentUser\Root' |
  Where-Object { $_.Thumbprint -eq $certificate.Thumbprint }
if (-not $trustedCertificate) {
  Write-Host "Certificate subject: $($certificate.Subject)"
  Write-Host "Certificate SHA-1 thumbprint: $($certificate.Thumbprint)"
  Write-Warning 'This self-signed certificate will become a trusted root for the current Windows user.'
  Write-Warning 'It only signs this independent research build; it is not an Anthropic certificate.'
  if (-not $TrustCertificate) {
    $confirmation = Read-Host 'Type TRUST to add it to CurrentUser\Root'
    if ($confirmation -ne 'TRUST') {
      throw 'Certificate trust was not approved.'
    }
  }
  Import-Certificate -FilePath $certificatePath -CertStoreLocation 'Cert:\CurrentUser\Root' | Out-Null
}

if (-not (Test-Path -LiteralPath "Cert:\CurrentUser\Root\$($certificate.Thumbprint)")) {
  throw 'The certificate was not added to the current user trusted root store.'
}
$trustedSignature = Get-AuthenticodeSignature -LiteralPath $msixPath
if ($trustedSignature.Status -ne 'Valid') {
  throw "The MSIX signature is not trusted: $($trustedSignature.Status)"
}

Add-AppxPackage -Path $msixPath -ForceApplicationShutdown
$package = Get-AppxPackage -Name 'ClaudeThirdPartyZeroConfig' -ErrorAction Stop
Write-Host "Installed $($package.PackageFullName)"

if (-not $NoStart) {
  Start-Process explorer.exe -ArgumentList "shell:AppsFolder\$($package.PackageFamilyName)!Claude"
}
