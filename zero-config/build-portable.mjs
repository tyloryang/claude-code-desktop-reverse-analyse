import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..');
const inputMsix = path.resolve(process.argv[2] || path.join(repositoryRoot, 'Claude.msix'));
const outputDirectory = path.resolve(process.argv[3] || path.join(repositoryRoot, 'dist', 'Claude-ThirdParty-Package'));
const outputArchive = `${outputDirectory}.zip`;
const releaseDirectory = path.dirname(outputDirectory);
const outputMsix = path.join(releaseDirectory, 'Claude-ThirdParty-ZeroConfig-x64.msix');
const outputCertificate = path.join(releaseDirectory, 'Claude-ThirdParty-ZeroConfig.cer');
const outputMsixArchive = path.join(releaseDirectory, 'Claude-ThirdParty-ZeroConfig-MSIX.zip');
const workDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-zero-config-build-'));
const unpackedMsix = path.join(workDirectory, 'msix');
const unpackedAsar = path.join(workDirectory, 'asar');

function run(command, args) {
  let executable = command;
  let executableArgs = args;
  if (process.platform === 'win32' && command === 'npx') {
    executable = 'powershell.exe';
    executableArgs = [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      path.join(scriptDirectory, 'invoke-npx.ps1'),
      ...args,
    ];
  }
  const result = spawnSync(executable, executableArgs, {
    cwd: repositoryRoot,
    stdio: 'inherit',
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with status ${result.status}`);
}

function copyIfMissing(source, destination) {
  if (!fs.existsSync(source) || fs.existsSync(destination)) return;
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
}

function copyDirectory(source, destination) {
  if (process.platform !== 'win32') {
    fs.cpSync(source, destination, { recursive: true });
    return;
  }
  const result = spawnSync('robocopy.exe', [
    source,
    destination,
    '/E',
    '/COPY:DAT',
    '/DCOPY:DAT',
    '/R:2',
    '/W:1',
    '/NFL',
    '/NDL',
    '/NJH',
    '/NJS',
    '/NP',
  ], {
    cwd: repositoryRoot,
    stdio: 'inherit',
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.status > 7) throw new Error(`robocopy exited with status ${result.status}`);
}

function injectedEntrySource(vendorSource) {
  const bootstrap = `'use strict';\nrequire('./zero-config/bootstrap.cjs').start().catch((error) => {\n  console.error('[zero-config] bootstrap failed', error);\n});\n`;
  return `${bootstrap}\n${vendorSource}`;
}

function loosePackageManifest(version) {
  const applicationsCloseTag = String.fromCharCode(60, 47) + 'Applications>';
  const manifest = `<?xml version="1.0" encoding="utf-8"?>
<Package
  xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10"
  xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10"
  xmlns:uap3="http://schemas.microsoft.com/appx/manifest/uap/windows10/3"
  xmlns:uap5="http://schemas.microsoft.com/appx/manifest/uap/windows10/5"
  xmlns:rescap="http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities"
  xmlns:virtualization="http://schemas.microsoft.com/appx/manifest/virtualization/windows10"
  IgnorableNamespaces="uap uap3 uap5 rescap virtualization">
  <Identity
    Name="ClaudeThirdPartyZeroConfig"
    ProcessorArchitecture="x64"
    Publisher="CN=Claude Third-Party Zero Config"
    Version="${version}" />
  <Properties>
    <DisplayName>Claude Third-Party</DisplayName>
    <PublisherDisplayName>Local research build</PublisherDisplayName>
    <Logo>Assets\\StoreLogo.png</Logo>
    <virtualization:FileSystemWriteVirtualization>
      <virtualization:ExcludedDirectories>
        <virtualization:ExcludedDirectory>$(KnownFolder:LocalAppData)\\Claude-3p-ZeroConfig</virtualization:ExcludedDirectory>
      </virtualization:ExcludedDirectories>
    </virtualization:FileSystemWriteVirtualization>
  </Properties>
  <Dependencies>
    <TargetDeviceFamily Name="Windows.Desktop" MinVersion="10.0.19041.0" MaxVersionTested="10.0.26100.0" />
  </Dependencies>
  <Resources>
    <Resource Language="en-us" />
  </Resources>
  <Capabilities>
    <rescap:Capability Name="runFullTrust" />
    <rescap:Capability Name="unvirtualizedResources" />
    <Capability Name="internetClient" />
  </Capabilities>
  <Applications>
    <Application Id="Claude" Executable="app\\Claude.exe" EntryPoint="Windows.FullTrustApplication">
      <uap:VisualElements
        DisplayName="Claude Third-Party"
        Description="Claude Desktop with a local third-party model gateway"
        Square44x44Logo="Assets\\Square44x44Logo.png"
        Square150x150Logo="Assets\\Square150x150Logo.png"
        BackgroundColor="transparent" />
      <Extensions>
        <uap3:Extension Category="windows.protocol">
          <uap3:Protocol Name="claude-3p" Parameters="&quot;%1&quot;" />
        </uap3:Extension>
        <uap5:Extension Category="windows.appExecutionAlias" Executable="app\\Claude.exe" EntryPoint="Windows.FullTrustApplication">
          <uap5:AppExecutionAlias>
            <uap5:ExecutionAlias Alias="claude-3p-desktop.exe" />
          </uap5:AppExecutionAlias>
        </uap5:Extension>
      </Extensions>
    </Application>
  </Applications>
</Package>
`;
  return manifest.replace(/^\s*<C:[^\r\n]+>\s*$/m, `  ${applicationsCloseTag}`);
}

try {
  if (!fs.existsSync(inputMsix)) throw new Error(`MSIX not found: ${inputMsix}`);
  fs.mkdirSync(unpackedMsix, { recursive: true });
  fs.mkdirSync(unpackedAsar, { recursive: true });

  console.log('[build] extracting MSIX');
  run('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    path.join(scriptDirectory, 'extract-msix.ps1'),
    '-Archive',
    inputMsix,
    '-Destination',
    unpackedMsix,
  ]);

  const resourcesDirectory = path.join(unpackedMsix, 'app', 'resources');
  const asarPath = path.join(resourcesDirectory, 'app.asar');
  const encodedNative = path.join(resourcesDirectory, 'app.asar.unpacked', 'node_modules', '%40ant', 'claude-native', 'claude-native-binding.node');
  const decodedNative = path.join(resourcesDirectory, 'app.asar.unpacked', 'node_modules', '@ant', 'claude-native', 'claude-native-binding.node');
  copyIfMissing(encodedNative, decodedNative);

  console.log('[build] extracting app.asar');
  run('npx', ['--yes', '@electron/asar', 'extract', asarPath, unpackedAsar]);

  const buildDirectory = path.join(unpackedAsar, '.vite', 'build');
  const originalEntry = path.join(buildDirectory, 'index.pre.js');
  const vendorSource = fs.readFileSync(originalEntry, 'utf8');
  fs.writeFileSync(originalEntry, injectedEntrySource(vendorSource));

  const injectedDirectory = path.join(buildDirectory, 'zero-config');
  fs.mkdirSync(path.join(injectedDirectory, 'lib'), { recursive: true });
  fs.copyFileSync(path.join(scriptDirectory, 'bootstrap.cjs'), path.join(injectedDirectory, 'bootstrap.cjs'));
  fs.copyFileSync(path.join(scriptDirectory, 'lib', 'adapter.cjs'), path.join(injectedDirectory, 'lib', 'adapter.cjs'));
  fs.copyFileSync(path.join(scriptDirectory, 'lib', 'server.cjs'), path.join(injectedDirectory, 'lib', 'server.cjs'));

  fs.rmSync(asarPath, { force: true });
  fs.rmSync(path.join(resourcesDirectory, 'app.asar.unpacked'), { recursive: true, force: true });
  console.log('[build] packing patched app.asar');
  run('npx', [
    '--yes',
    '@electron/asar',
    'pack',
    '--unpack',
    '**/*.{node,dll,exe}',
    unpackedAsar,
    asarPath,
  ]);

  const manifestPath = path.join(unpackedMsix, 'AppxManifest.xml');
  const sourceManifest = fs.readFileSync(manifestPath, 'utf8');
  const packageVersion = sourceManifest.match(/\bVersion="([0-9.]+)"/)?.[1] ?? '1.0.0.0';
  fs.writeFileSync(manifestPath, loosePackageManifest(packageVersion));
  fs.rmSync(path.join(unpackedMsix, 'AppxSignature.p7x'), { force: true });
  fs.rmSync(path.join(unpackedMsix, 'AppxBlockMap.xml'), { force: true });
  fs.rmSync(path.join(unpackedMsix, '[Content_Types].xml'), { force: true });
  fs.rmSync(path.join(unpackedMsix, '[Content_Types].old'), { force: true });

  console.log('[build] copying loose package directory');
  fs.rmSync(outputDirectory, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(outputDirectory), { recursive: true });
  copyDirectory(unpackedMsix, outputDirectory);
  console.log('[build] loose package directory copied');

  const executable = path.join(outputDirectory, 'app', 'Claude.exe');
  console.log('[build] disabling embedded ASAR integrity fuse');
  run('npx', [
    '--yes',
    '@electron/fuses',
    'write',
    '--app',
    executable,
    'EnableEmbeddedAsarIntegrityValidation=off',
  ]);

  for (const fileName of [
    'Install-Claude-ThirdParty.ps1',
    'Uninstall-Claude-ThirdParty.ps1',
    'Start-Claude-ThirdParty.cmd',
  ]) {
    fs.copyFileSync(path.join(scriptDirectory, fileName), path.join(outputDirectory, fileName));
  }
  fs.copyFileSync(path.join(scriptDirectory, 'PORTABLE-README.txt'), path.join(outputDirectory, 'README.txt'));
  fs.copyFileSync(path.join(scriptDirectory, 'README.md'), path.join(outputDirectory, 'README.md'));
  run('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    path.join(scriptDirectory, 'compress-release.ps1'),
    '-Source',
    outputDirectory,
    '-Destination',
    outputArchive,
  ]);

  for (const fileName of [
    'Install-Claude-ThirdParty-MSIX.ps1',
    'Install-Claude-ThirdParty-MSIX.cmd',
    'Uninstall-Claude-ThirdParty-MSIX.ps1',
    'README-MSIX.md',
  ]) {
    fs.copyFileSync(path.join(scriptDirectory, fileName), path.join(releaseDirectory, fileName));
  }

  run('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    path.join(scriptDirectory, 'build-signed-msix.ps1'),
    '-PackageDirectory',
    outputDirectory,
    '-OutputMsix',
    outputMsix,
    '-OutputCertificate',
    outputCertificate,
  ]);

  run('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    path.join(scriptDirectory, 'package-msix-release.ps1'),
    '-SourceDirectory',
    releaseDirectory,
    '-Destination',
    outputMsixArchive,
  ]);

  console.log(`\nLoose package build created at:\n${outputDirectory}`);
  console.log(`Loose release archive created at:\n${outputArchive}`);
  console.log(`Signed MSIX created at:\n${outputMsix}`);
  console.log(`MSIX release archive created at:\n${outputMsixArchive}`);
} finally {
  fs.rmSync(workDirectory, { recursive: true, force: true });
}
