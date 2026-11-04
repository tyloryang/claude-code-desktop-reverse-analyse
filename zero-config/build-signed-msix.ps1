param(
  [Parameter(Mandatory = $true)]
  [string]$PackageDirectory,

  [Parameter(Mandatory = $true)]
  [string]$OutputMsix,

  [Parameter(Mandatory = $true)]
  [string]$OutputCertificate
)

$ErrorActionPreference = 'Stop'
$publisher = 'CN=Claude Third-Party Zero Config'
$sdkRoot = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\10\bin'
$sdkDirectory = Get-ChildItem -LiteralPath $sdkRoot -Directory |
  Where-Object { $_.Name -match '^\d+\.\d+\.\d+\.\d+$' } |
  Sort-Object { [version]$_.Name } -Descending |
  Where-Object {
    (Test-Path (Join-Path $_.FullName 'x64\makeappx.exe')) -and
    (Test-Path (Join-Path $_.FullName 'x64\signtool.exe'))
  } |
  Select-Object -First 1

if (-not $sdkDirectory) {
  throw 'Windows SDK makeappx.exe and signtool.exe were not found.'
}

$makeAppx = Join-Path $sdkDirectory.FullName 'x64\makeappx.exe'
$signTool = Join-Path $sdkDirectory.FullName 'x64\signtool.exe'
$certificate = $null

try {
  Remove-Item -LiteralPath $OutputMsix -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $OutputCertificate -Force -ErrorAction SilentlyContinue

  & $makeAppx pack /d $PackageDirectory /p $OutputMsix /o /l
  if ($LASTEXITCODE -ne 0) {
    throw "makeappx.exe exited with status $LASTEXITCODE"
  }

  $certificate = New-SelfSignedCertificate `
    -Type Custom `
    -Subject $publisher `
    -FriendlyName 'Claude Third-Party Zero Config MSIX' `
    -CertStoreLocation 'Cert:\CurrentUser\My' `
    -KeyAlgorithm RSA `
    -KeyLength 3072 `
    -HashAlgorithm SHA256 `
    -KeyUsage DigitalSignature `
    -TextExtension @('2.5.29.37={text}1.3.6.1.5.5.7.3.3') `
    -NotAfter (Get-Date).AddYears(3)

  Export-Certificate -Cert $certificate -FilePath $OutputCertificate -Type CERT | Out-Null

  & $signTool sign /fd SHA256 /sha1 $certificate.Thumbprint /s My $OutputMsix
  if ($LASTEXITCODE -ne 0) {
    throw "signtool.exe exited with status $LASTEXITCODE"
  }

  Write-Host "MSIX signed with certificate $($certificate.Thumbprint)"
} finally {
  if ($certificate) {
    Remove-Item -LiteralPath "Cert:\CurrentUser\My\$($certificate.Thumbprint)" -Force -ErrorAction SilentlyContinue
  }
}
