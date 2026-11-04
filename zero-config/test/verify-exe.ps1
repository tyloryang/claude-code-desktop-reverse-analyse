param(
  [Parameter(Mandatory = $true)]
  [string]$ExePath,
  [Parameter(Mandatory = $true)]
  [string]$OutputDirectory
)

$ErrorActionPreference = 'Stop'
$ExePath = [System.IO.Path]::GetFullPath($ExePath)
$OutputDirectory = [System.IO.Path]::GetFullPath($OutputDirectory)
if (Test-Path -LiteralPath $OutputDirectory) { throw 'Verification output directory must be new.' }
New-Item -ItemType Directory -Path $OutputDirectory | Out-Null
$applicationProcess = $null
$launcher = $null
$report = [ordered]@{}
$environmentNames = @('CLAUDE_ZERO_CONFIG_USER_DATA_DIR', 'CLAUDE_ZERO_CONFIG_PORT', 'CLAUDE_THIRD_PARTY_BASE_URL', 'CLAUDE_THIRD_PARTY_API_KEY', 'TEMP', 'TMP')
$savedEnvironment = @{}
foreach ($name in $environmentNames) { $savedEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }

function Assert-Verified([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw $Message }
}

function Read-LiveLog([string]$Path) {
  $stream = [System.IO.File]::Open($Path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, ([System.IO.FileShare]::ReadWrite -bor [System.IO.FileShare]::Delete))
  $reader = New-Object System.IO.StreamReader($stream)
  try { return $reader.ReadToEnd() } finally { $reader.Dispose() }
}

function Get-TrustSnapshot {
  $rows = foreach ($store in @('Cert:\CurrentUser\Root', 'Cert:\CurrentUser\TrustedPeople')) {
    Get-ChildItem -LiteralPath $store | ForEach-Object { "$store/$($_.Thumbprint)" }
  }
  return ($rows | Sort-Object) -join "`n"
}

function Get-OfficialConfigSnapshot {
  $directory = Join-Path $env:LOCALAPPDATA 'Claude-3p'
  $files = @((Join-Path $directory 'claude_desktop_config.json'))
  $files += @(Get-ChildItem -LiteralPath (Join-Path $directory 'configLibrary') -Filter '*.json' -File -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName })
  $rows = foreach ($file in $files) { if (Test-Path -LiteralPath $file) { "$file/$((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash)" } }
  return ($rows | Sort-Object) -join "`n"
}

try {
  $trustBefore = Get-TrustSnapshot
  $officialBefore = Get-OfficialConfigSnapshot
  $packageBefore = @(Get-AppxPackage -Name ClaudeThirdPartyZeroConfig | ForEach-Object { $_.PackageFullName }) -join ','
  $env:TEMP = $OutputDirectory
  $env:TMP = $OutputDirectory
  $env:CLAUDE_ZERO_CONFIG_USER_DATA_DIR = Join-Path $OutputDirectory 'data'
  $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
  $listener.Start()
  $env:CLAUDE_ZERO_CONFIG_PORT = [string]$listener.LocalEndpoint.Port
  $listener.Stop()
  $env:CLAUDE_THIRD_PARTY_BASE_URL = 'http://127.0.0.1:8000/v1'
  $env:CLAUDE_THIRD_PARTY_API_KEY = 'runtime-test'
  $mock = Invoke-RestMethod 'http://127.0.0.1:8000/v1/models'
  Assert-Verified ($mock.data[0].id -eq 'runtime-test-model') 'The isolated mock provider must be running on port 8000.'
  $started = Get-Date
  $launcher = Start-Process -FilePath $ExePath -PassThru
  Assert-Verified ($launcher.WaitForExit(90000)) 'The launcher did not finish within 90 seconds; inspect its window.'
  Assert-Verified ($launcher.ExitCode -eq 0) "Launcher failed: $($launcher.ExitCode)"
  $launcherLog = Join-Path $env:LOCALAPPDATA 'Claude-ThirdParty-ZeroConfig\launcher.log'
  $lastLaunch = [System.IO.File]::ReadAllLines($launcherLog) | Where-Object { $_ -match 'started pid=' } | Select-Object -Last 1
  Assert-Verified ($lastLaunch -match 'started pid=(\d+)') 'Launcher did not record the child process.'
  $applicationProcess = Get-Process -Id ([int]$Matches[1])
  Assert-Verified ($applicationProcess.StartTime -ge $started.AddSeconds(-2)) 'The recorded process is not from this verification.'
  $profilePath = Join-Path $env:CLAUDE_ZERO_CONFIG_USER_DATA_DIR 'configLibrary\7f4a8b31-6b45-4a27-9c13-64ebdb839ed7.json'
  $baseUrl = $null
  $healthy = $false
  $deadline = (Get-Date).AddSeconds(60)
  $mainLog = Join-Path $env:CLAUDE_ZERO_CONFIG_USER_DATA_DIR 'logs\main.log'
  do {
    # The gateway address is whatever the isolated instance actually bound to. CLAUDE_ZERO_CONFIG_PORT
    # is only its preferred port, so the live profile is the source of truth for the route.
    $liveProfile = $null
    try { $liveProfile = Get-Content -Raw -LiteralPath $profilePath -ErrorAction Stop | ConvertFrom-Json } catch { }
    $healthy = $false
    if ($liveProfile -and $liveProfile.inferenceGatewayBaseUrl) {
      $baseUrl = $liveProfile.inferenceGatewayBaseUrl
      try { $healthy = (Invoke-RestMethod "$baseUrl/_claude_zero_config/health").ok } catch { }
    }
    $loaded = $false
    try { $logText = Read-LiveLog $mainLog; $loaded = $logText.Contains('Loaded app://localhost') } catch { }
    if ($healthy -and $loaded) { break }
    Start-Sleep -Milliseconds 500
  } while ((Get-Date) -lt $deadline)
  Assert-Verified ($healthy -and $loaded) 'Application UI and gateway did not both become ready.'
  Assert-Verified ($logText.Contains("inference apiHost=$baseUrl")) 'The application did not select its own isolated gateway.'
  Assert-Verified ($logText.Contains("[managedConfig] configuration at launch { type: 'local'")) 'The application did not load the zero-config profile at launch.'
  Assert-Verified ($logText.Contains('not an MSIX install')) 'Expected an unpackaged application launch.'
  $discoveryMatch = [regex]::Match($logText, 'Model discovery: (\d+) found in \d+ms; picker = (\d+)')
  Assert-Verified ($discoveryMatch.Success -and [int]$discoveryMatch.Groups[2].Value -gt 0) 'The third-party model did not reach the application model picker.'

  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class PortableProbe {
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
  public static extern int GetPackageFullName(IntPtr process, ref uint length, IntPtr name);
  [DllImport("user32.dll")]
  public static extern bool PrintWindow(IntPtr window, IntPtr device, uint flags);
}
'@
  [uint32]$length = 0
  $identityResult = [PortableProbe]::GetPackageFullName($applicationProcess.Handle, [ref]$length, [IntPtr]::Zero)
  Assert-Verified ($identityResult -eq 15700) "Process unexpectedly has package identity: $identityResult"
  $models = Invoke-RestMethod "$baseUrl/v1/models"
  Assert-Verified ($models.data[0].id -eq 'runtime-test-model') 'Model discovery failed.'
  $body = @{ model='runtime-test-model'; max_tokens=32; messages=@(@{role='user';content='portable runtime test'}) }
  $message = Invoke-RestMethod "$baseUrl/v1/messages" -Method Post -ContentType 'application/json' -Body ($body | ConvertTo-Json -Depth 6)
  Assert-Verified ($message.content[0].text -eq 'runtime message ok') 'Non-streaming conversion failed.'
  $body.stream = $true
  $stream = Invoke-WebRequest "$baseUrl/v1/messages" -UseBasicParsing -Method Post -ContentType 'application/json' -Body ($body | ConvertTo-Json -Depth 6)
  Assert-Verified ($stream.Content.Contains('message_stop') -and $stream.Content.Contains('stream ok')) 'Streaming conversion failed.'

  $duplicate = Start-Process -FilePath $ExePath -PassThru
  Assert-Verified ($duplicate.WaitForExit(30000) -and $duplicate.ExitCode -eq 0) 'Duplicate launch failed.'
  Start-Sleep -Seconds 3
  $profile = Get-Content -Raw -LiteralPath (Join-Path $env:CLAUDE_ZERO_CONFIG_USER_DATA_DIR 'configLibrary\7f4a8b31-6b45-4a27-9c13-64ebdb839ed7.json') | ConvertFrom-Json
  Assert-Verified ($profile.inferenceGatewayBaseUrl -eq $baseUrl) 'Duplicate launch overwrote the live gateway address.'
  Assert-Verified (-not $applicationProcess.HasExited) 'Duplicate launch stopped the first application.'

  Add-Type -AssemblyName UIAutomationClient
  Add-Type -AssemblyName UIAutomationTypes
  Add-Type -AssemblyName System.Drawing
  $condition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $applicationProcess.Id)
  $windows = [System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, $condition)
  $window = $windows | Where-Object { -not $_.Current.IsOffscreen -and $_.Current.BoundingRectangle.Width -gt 300 } | Select-Object -First 1
  Assert-Verified ($null -ne $window) 'No visible application window was found.'
  $bounds = $window.Current.BoundingRectangle
  $bitmap = New-Object System.Drawing.Bitmap([int]$bounds.Width, [int]$bounds.Height)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $device = $graphics.GetHdc()
  try { $captured = [PortableProbe]::PrintWindow([IntPtr]$window.Current.NativeWindowHandle, $device, 2) } finally { $graphics.ReleaseHdc($device) }
  try {
    Assert-Verified $captured 'Window screenshot capture failed.'
    $bitmap.Save((Join-Path $OutputDirectory 'window.png'), [System.Drawing.Imaging.ImageFormat]::Png)
  } finally { $graphics.Dispose(); $bitmap.Dispose() }
  $names = @($window.Current.Name)
  $children = $window.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
  $names += @($children | Select-Object -First 200 | ForEach-Object { $_.Current.Name } | Where-Object { $_ })
  $names | Set-Content -LiteralPath (Join-Path $OutputDirectory 'window.txt') -Encoding UTF8
  Assert-Verified ((Get-TrustSnapshot) -eq $trustBefore) 'Certificate trust stores changed during launch.'
  Assert-Verified ((Get-OfficialConfigSnapshot) -eq $officialBefore) 'Official third-party configuration changed during launch.'
  $packageAfter = @(Get-AppxPackage -Name ClaudeThirdPartyZeroConfig | ForEach-Object { $_.PackageFullName }) -join ','
  Assert-Verified ($packageBefore -eq $packageAfter) 'Package registration changed during launch.'
  $report.status = 'PASS'
  $report.packageIdentityResult = $identityResult
  $report.windowTitle = $window.Current.Name
  $report.gateway = $baseUrl
  $report.models = @($models.data.id)
  $report.nonStreaming = $message.content[0].text
  $report.streaming = 'message_stop'
  $report.duplicateLaunch = 'preserved original gateway'
  $report.officialConfiguration = 'unchanged'
  $report.certificateStores = 'unchanged'
  $report.packageRegistration = 'unchanged'
} catch {
  $report.status = 'FAIL'
  $report.error = $_.Exception.Message
  throw
} finally {
  $report | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $OutputDirectory 'result.json') -Encoding UTF8
  if ($applicationProcess -and -not $applicationProcess.HasExited) { & taskkill.exe /PID $applicationProcess.Id /T /F | Out-Null }
  if ($launcher -and -not $launcher.HasExited) { Stop-Process -Id $launcher.Id }
  foreach ($name in $environmentNames) { [Environment]::SetEnvironmentVariable($name, $savedEnvironment[$name], 'Process') }
  $report | ConvertTo-Json -Depth 5
}
