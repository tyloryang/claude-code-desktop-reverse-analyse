$ErrorActionPreference = 'Stop'
$packages = Get-AppxPackage -Name 'ClaudeThirdPartyZeroConfig' -ErrorAction SilentlyContinue
if (-not $packages) {
  Write-Host 'Claude Third-Party Zero Config is not registered.'
  exit 0
}

$packages | ForEach-Object {
  Remove-AppxPackage -Package $_.PackageFullName
  Write-Host "Removed $($_.PackageFullName)"
}
