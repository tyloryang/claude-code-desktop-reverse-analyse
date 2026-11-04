'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { startZeroConfigGateway } = require('./lib/server.cjs');

const PROFILE_ID = '7f4a8b31-6b45-4a27-9c13-64ebdb839ed7';
const PROFILE_NAME = 'Auto-detected local model';

function dataDirectory(environment = process.env) {
  const commandLineDirectory = process.argv
    .find((argument) => argument.startsWith('--claude-zero-config-user-data-dir='))
    ?.slice('--claude-zero-config-user-data-dir='.length);
  if (commandLineDirectory) return path.resolve(commandLineDirectory);
  if (environment.CLAUDE_ZERO_CONFIG_USER_DATA_DIR) return environment.CLAUDE_ZERO_CONFIG_USER_DATA_DIR;
  if (environment.CLAUDE_USER_DATA_DIR) return environment.CLAUDE_USER_DATA_DIR;
  if (process.platform === 'win32') {
    return path.join(environment.LOCALAPPDATA || environment.APPDATA || os.homedir(), 'Claude-3p-ZeroConfig');
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'Claude-3p-ZeroConfig');
  }
  return path.join(environment.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'Claude-3p-ZeroConfig');
}

function readObject(filePath) {
  try {
    const value = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.rmSync(filePath, { force: true });
  fs.renameSync(temporaryPath, filePath);
}

function ensureZeroConfigProfile(baseUrl, options = {}) {
  const environment = options.environment ?? process.env;
  const directory = options.directory ?? dataDirectory(environment);
  const libraryDirectory = path.join(directory, 'configLibrary');
  const rootConfigPath = path.join(directory, 'claude_desktop_config.json');
  const metadataPath = path.join(libraryDirectory, '_meta.json');
  const profilePath = path.join(libraryDirectory, `${PROFILE_ID}.json`);

  const rootConfig = readObject(rootConfigPath);
  rootConfig.deploymentMode = '3p';
  writeJsonAtomic(rootConfigPath, rootConfig);

  const metadata = readObject(metadataPath);
  const entries = Array.isArray(metadata.entries) ? metadata.entries.filter((entry) => entry?.id !== PROFILE_ID) : [];
  entries.unshift({ id: PROFILE_ID, name: PROFILE_NAME });
  writeJsonAtomic(metadataPath, {
    ...metadata,
    appliedId: PROFILE_ID,
    entries,
  });

  const profile = readObject(profilePath);
  writeJsonAtomic(profilePath, {
    ...profile,
    inferenceProvider: 'gateway',
    inferenceCredentialKind: 'static',
    inferenceGatewayBaseUrl: baseUrl,
    inferenceGatewayApiKey: 'local-zero-config',
    inferenceGatewayAuthScheme: 'x-api-key',
    inferenceGatewayManagedClaudeCode: true,
    inferenceStreamIdleTimeoutSec: 1800,
    modelDiscoveryEnabled: true,
    modelCatalogEnabled: false,
    disableClaudeAiSignIn: true,
    disableAutoUpdates: true,
    disableEssentialTelemetry: true,
    disableNonessentialTelemetry: true,
  });

  return { directory, rootConfigPath, metadataPath, profilePath };
}

async function probeGateway(url) {
  try {
    const response = await fetch(`${url}/_claude_zero_config/health`, { signal: AbortSignal.timeout(600) });
    if (!response.ok) return false;
    const body = await response.json();
    return body?.service === 'claude-third-party-zero-config';
  } catch {
    // Endpoint is not running, or is still starting.
    return false;
  }
}

function createLogger(directory) {
  const logPath = path.join(directory, 'zero-config.log');
  return (event, details = {}) => {
    try {
      fs.mkdirSync(directory, { recursive: true });
      fs.appendFileSync(logPath, `${JSON.stringify({ time: new Date().toISOString(), event, ...details })}\n`);
    } catch {
      // Logging must never block application startup.
    }
  };
}

async function start(options = {}) {
  if (process.env.CLAUDE_ZERO_CONFIG_DISABLE === '1') return null;

  process.env.DISABLE_TELEMETRY ||= '1';
  process.env.DISABLE_ERROR_REPORTING ||= '1';
  process.env.CLAUDE_CODE_AUTOUPDATER_DISABLED_BY_HOST ||= '1';

  const environment = options.environment ?? process.env;
  const directory = dataDirectory(environment);
  globalThis.__CLAUDE_ZERO_CONFIG_DIRECTORY__ = directory;
  const logger = options.logger ?? createLogger(directory);
  fs.mkdirSync(directory, { recursive: true });
  try {
    const { app } = require('electron');
    const setPath = app.setPath.bind(app);
    setPath('userData', directory);
    app.setPath = (name, value) => {
      const effectiveValue = name === 'userData' ? directory : value;
      if (effectiveValue !== value) logger('user-data-path-override', { requested: value, effective: effectiveValue });
      return setPath(name, effectiveValue);
    };
  } catch (error) {
    logger('user-data-path-error', { message: error instanceof Error ? error.message : String(error) });
  }
  process.env.CLAUDE_USER_DATA_DIR = directory;
  const preferredPort = Number(options.port ?? environment.CLAUDE_ZERO_CONFIG_PORT ?? 42121);
  const preferredUrl = `http://127.0.0.1:${preferredPort}`;
  const existingProfilePath = path.join(directory, 'configLibrary', `${PROFILE_ID}.json`);
  const existingProfile = readObject(existingProfilePath);
  const existingUrl = typeof existingProfile.inferenceGatewayBaseUrl === 'string' && existingProfile.inferenceGatewayBaseUrl
    ? existingProfile.inferenceGatewayBaseUrl
    : null;
  const targetUrl = existingUrl ?? preferredUrl;
  const targetPort = Number(new URL(targetUrl).port) || preferredPort;

  // index.pre.js reads claude_desktop_config.json and configLibrary synchronously while the main
  // process evaluates, so the gateway profile and deploymentMode must be on disk before the first
  // await here; otherwise the application evaluates an empty configuration and falls back to the
  // claude.ai sign-in UI. A duplicate launch keeps the address the first instance already wrote,
  // so the port a live gateway holds is never rewritten.
  let config = ensureZeroConfigProfile(targetUrl, { directory, environment });

  // A known profile means another instance may own this port and could still be mid-startup, so
  // give its gateway a grace window before claiming the port ourselves. A fresh directory only
  // needs a single probe to avoid stealing a port an unrelated gateway already holds.
  const probeAttempts = existingUrl ? 20 : 1;
  for (let attempt = 0; attempt < probeAttempts; attempt += 1) {
    if (await probeGateway(targetUrl)) {
      logger('gateway-already-running', { baseUrl: targetUrl });
      process.env.CLAUDE_ZERO_CONFIG_GATEWAY_URL = targetUrl;
      return { gateway: { baseUrl: targetUrl, reused: true }, config };
    }
    if (attempt + 1 < probeAttempts) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  const gateway = await startZeroConfigGateway({
    environment,
    logger,
    port: targetPort,
  });
  if (gateway.baseUrl !== targetUrl) {
    config = ensureZeroConfigProfile(gateway.baseUrl, { directory, environment });
  }
  process.env.CLAUDE_ZERO_CONFIG_GATEWAY_URL = gateway.baseUrl;
  globalThis.__CLAUDE_ZERO_CONFIG_GATEWAY__ = gateway;
  logger('started', { baseUrl: gateway.baseUrl, configDirectory: config.directory });
  return { gateway, config };
}

module.exports = {
  PROFILE_ID,
  dataDirectory,
  ensureZeroConfigProfile,
  start,
};
