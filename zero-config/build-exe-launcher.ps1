param(
  [Parameter(Mandatory = $true)]
  [string]$AppDirectory,

  [Parameter(Mandatory = $true)]
  [string]$OutputExe
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $compiler)) {
  throw '.NET Framework 4.x C# compiler was not found.'
}
if (-not (Test-Path -LiteralPath (Join-Path $AppDirectory 'Claude.exe'))) {
  throw 'The application payload does not contain Claude.exe.'
}
$work = Join-Path ([System.IO.Path]::GetTempPath()) ('claude-exe-build-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $work | Out-Null
try {
  $payload = Join-Path $work 'payload.zip'
  $identity = Join-Path $work 'payload.sha256'
  [System.IO.Compression.ZipFile]::CreateFromDirectory($AppDirectory, $payload, [System.IO.Compression.CompressionLevel]::Optimal, $true)
  $digest = (Get-FileHash -LiteralPath $payload -Algorithm SHA256).Hash.ToLowerInvariant()
  [System.IO.File]::WriteAllText($identity, $digest, [System.Text.Encoding]::ASCII)
  $candidate = Join-Path $work 'Claude-ThirdParty-ZeroConfig.exe'
  & $compiler /nologo /target:winexe /platform:x64 /optimize+ `
    /reference:System.Windows.Forms.dll /reference:System.Drawing.dll `
    /reference:System.IO.Compression.dll /reference:System.IO.Compression.FileSystem.dll `
    "/win32manifest:$(Join-Path $PSScriptRoot 'ExeLauncher.manifest')" `
    "/resource:$payload,payload.zip" "/resource:$identity,payload.sha256" `
    "/out:$candidate" (Join-Path $PSScriptRoot 'ExeLauncher.cs')
  if ($LASTEXITCODE -ne 0) {
    throw "C# compiler exited with status $LASTEXITCODE"
  }
  Move-Item -LiteralPath $candidate -Destination $OutputExe -Force
  Write-Host "Self-extracting EXE: $OutputExe"
  Write-Host "Payload SHA-256: $digest"
} finally {
  Remove-Item -LiteralPath $work -Recurse -Force
}
