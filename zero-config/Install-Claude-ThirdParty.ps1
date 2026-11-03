param(
  [switch]$NoStart
)

$ErrorActionPreference = 'Stop'
$packageName = 'ClaudeThirdPartyZeroConfig'
$manifestPath = Join-Path $PSScriptRoot 'AppxManifest.xml'

if (-not (Test-Path $manifestPath)) {
  throw "AppxManifest.xml was not found next to this script."
}

$package = Get-AppxPackage -Name $packageName -ErrorAction SilentlyContinue
$currentLocation = if ($package) { $package.InstallLocation } else { $null }
if (-not $package -or $currentLocation -ne $PSScriptRoot) {
  Add-AppxPackage -Register $manifestPath -ForceApplicationShutdown
  $package = Get-AppxPackage -Name $packageName -ErrorAction Stop
}

Write-Host "Registered $($package.PackageFullName)"
if (-not $NoStart) {
  if (-not ('ClaudeZeroConfig.ApplicationActivationManager' -as [type])) {
    $compilerTemp = Join-Path $PSScriptRoot '.compiler-temp'
    New-Item -ItemType Directory -Path $compilerTemp -Force | Out-Null
    $env:TEMP = $compilerTemp
    $env:TMP = $compilerTemp
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

namespace ClaudeZeroConfig {
  [Flags]
  public enum ActivateOptions : uint {
    None = 0
  }

  [ComImport]
  [Guid("2E941141-7F97-4756-BA1D-9DECDE894A3D")]
  [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IApplicationActivationManager {
    int ActivateApplication(
      [MarshalAs(UnmanagedType.LPWStr)] string appUserModelId,
      [MarshalAs(UnmanagedType.LPWStr)] string arguments,
      ActivateOptions options,
      out uint processId);
  }

  [ComImport]
  [Guid("45BA127D-10A8-46EA-8AB7-56EA9078943C")]
  public class ApplicationActivationManager {
  }

  public static class Activation {
    public static uint Start(string appUserModelId) {
      var manager = (IApplicationActivationManager)new ApplicationActivationManager();
      uint processId;
      var result = manager.ActivateApplication(appUserModelId, null, ActivateOptions.None, out processId);
      Marshal.ThrowExceptionForHR(result);
      return processId;
    }
  }
}
'@
    Remove-Item -LiteralPath $compilerTemp -Recurse -Force -ErrorAction SilentlyContinue
  }

  $processId = [ClaudeZeroConfig.Activation]::Start("$($package.PackageFamilyName)!Claude")
  Write-Host "Started package process $processId"
}
