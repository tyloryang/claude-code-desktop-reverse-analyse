param(
  [Parameter(Mandatory = $true)]
  [string]$SourceDirectory,

  [Parameter(Mandatory = $true)]
  [string]$Destination
)

$ErrorActionPreference = 'Stop'
if (Test-Path -LiteralPath $Destination) {
  Remove-Item -LiteralPath $Destination -Force
}

$items = @(
  (Join-Path $SourceDirectory 'Claude-ThirdParty-ZeroConfig-x64.msix'),
  (Join-Path $SourceDirectory 'Claude-ThirdParty-ZeroConfig.cer'),
  (Join-Path $SourceDirectory 'Install-Claude-ThirdParty-MSIX.ps1'),
  (Join-Path $SourceDirectory 'Install-Claude-ThirdParty-MSIX.cmd'),
  (Join-Path $SourceDirectory 'Uninstall-Claude-ThirdParty-MSIX.ps1'),
  (Join-Path $SourceDirectory 'README-MSIX.md')
)
Compress-Archive -Path $items -DestinationPath $Destination -CompressionLevel Optimal
