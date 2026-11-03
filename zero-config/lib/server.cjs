'use strict';

const http = require('node:http');
const {
  AnthropicStreamEncoder,
  anthropicRequestToOpenAI,
  estimateInputTokens,
  openAIResponseToAnthropic,
} = require('./adapter.cjs');

const DEFAULT_CANDIDATES = [
  { label: 'Ollama', baseUrl: 'http://127.0.0.1:11434/v1', apiKey: 'ollama' },
  { label: 'LM Studio', baseUrl: 'http://127.0.0.1:1234/v1', apiKey: 'lm-studio' },
  { label: 'vLLM', baseUrl: 'http://127.0.0.1:8000/v1', apiKey: 'vllm' },
  { label: 'LocalAI', baseUrl: 'http://127.0.0.1:8080/v1', apiKey: 'local-ai' },
];

function normalizeBaseUrl(value) {
  const url = new URL(value);
  url.search = '';
  url.hash = '';
  url.pathname = url.pathname.replace(/\/+$/, '');
  if (!url.pathname || url.pathname === '/') url.pathname = '/v1';
  return url.toString().replace(/\/$/, '');
}

function buildCandidates(environment = process.env) {
  const candidates = [];
  const configuredBaseUrl = environment.CLAUDE_THIRD_PARTY_BASE_URL
    || environment.OPENAI_BASE_URL
    || environment.OPENAI_API_BASE;
  if (configuredBaseUrl) {
    candidates.push({
      label: 'Configured provider',
      baseUrl: normalizeBaseUrl(configuredBaseUrl),
      apiKey: environment.CLAUDE_THIRD_PARTY_API_KEY
        || environment.OPENAI_API_KEY
        || environment.OPENROUTER_API_KEY
        || 'local',
      configuredModel: environment.CLAUDE_THIRD_PARTY_MODEL,
    });
  }
  candidates.push(...DEFAULT_CANDIDATES);

  const seen = new Set();
  return candidates.filter((candidate) => {
    const key = candidate.baseUrl.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function upstreamHeaders(provider) {
  return {
    'content-type': 'application/json',
    authorization: `Bearer ${provider.apiKey || 'local'}`,
  };
}

async function probeProvider(candidate, timeoutMs = 1500) {
  try {
    const response = await fetch(`${candidate.baseUrl}/models`, {
      headers: upstreamHeaders(candidate),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return null;
    const body = await response.json();
    const models = Array.isArray(body?.data)
      ? body.data.map((model) => model?.id).filter((id) => typeof id === 'string' && id)
      : [];
    if (!models.length && candidate.configuredModel) models.push(candidate.configuredModel);
    if (!models.length) return null;
    return { ...candidate, models };
  } catch {
    return null;
  }
}

function createProviderResolver(environment = process.env) {
  let cachedProvider = null;
  let expiresAt = 0;
  let inFlight = null;

  return async function resolveProvider() {
    if (cachedProvider && Date.now() < expiresAt) return cachedProvider;
    if (inFlight) return inFlight;
    inFlight = (async () => {
      for (const candidate of buildCandidates(environment)) {
        const provider = await probeProvider(candidate);
        if (provider) {
          cachedProvider = provider;
          expiresAt = Date.now() + 30_000;
          return provider;
        }
      }
      cachedProvider = null;
      expiresAt = Date.now() + 3_000;
      return null;
    })().finally(() => {
      inFlight = null;
    });
    return inFlight;
  };
}

function familyTier(modelId) {
  const normalized = modelId.toLowerCase();
  if (/(^|[-_/])(mini|small|tiny|flash|lite|haiku)([-_/]|$)/.test(normalized)) return 'haiku';
  if (/(^|[-_/])(max|large|reason|thinking|opus)([-_/]|$)/.test(normalized)) return 'opus';
  return 'sonnet';
}

function modelsResponse(provider) {
  const models = provider?.models ?? [];
  return {
    data: models.map((id, index) => ({
      id,
      type: 'model',
      display_name: `${id} · ${provider.label}`,
      description: `Auto-detected from ${provider.baseUrl}`,
      anthropic_family_tier: familyTier(id),
      is_family_default: index === 0,
      max_effort_level: 'high',
    })),
    has_more: false,
    first_id: models[0] ?? null,
    last_id: models.at(-1) ?? null,
  };
}

function selectModel(provider, requestedModel, environment = process.env) {
  const configured = environment.CLAUDE_THIRD_PARTY_MODEL;
  if (configured) return configured;
  if (provider.models.includes(requestedModel)) return requestedModel;
  return provider.models[0];
}

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(JSON.stringify(body));
}

function sendAnthropicError(response, statusCode, message, type = 'api_error') {
  sendJson(response, statusCode, { type: 'error', error: { type, message } });
}

async function readJson(request, maxBytes = 32 * 1024 * 1024) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > maxBytes) throw Object.assign(new Error('Request body is too large'), { statusCode: 413 });
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function upstreamError(response) {
  const text = await response.text().catch(() => '');
  try {
    const body = JSON.parse(text);
    return body?.error?.message || body?.message || text || `HTTP ${response.status}`;
  } catch {
    return text || `HTTP ${response.status}`;
  }
}

async function pipeOpenAIStream(upstream, response, requestedModel, inputTokens) {
  response.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-store',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });

  const encoder = new AnthropicStreamEncoder(requestedModel, inputTokens);
  for (const event of encoder.start()) response.write(event);

  const decoder = new TextDecoder();
  let buffer = '';
  let upstreamDone = false;

  for await (const chunk of upstream.body) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const data = trimmed.slice(5).trim();
      if (!data) continue;
      if (data === '[DONE]') {
        upstreamDone = true;
        break;
      }
      const parsed = JSON.parse(data);
      if (parsed.error) throw new Error(parsed.error.message || 'Upstream stream failed');
      for (const event of encoder.push(parsed)) response.write(event);
    }
    if (upstreamDone) break;
  }

  for (const event of encoder.finish()) response.write(event);
  response.end();
}

async function handleMessages(request, response, provider, environment) {
  const body = await readJson(request);
  const upstreamModel = selectModel(provider, body.model, environment);
  const upstreamRequest = anthropicRequestToOpenAI(body, upstreamModel);
  const upstream = await fetch(`${provider.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: upstreamHeaders(provider),
    body: JSON.stringify(upstreamRequest),
    signal: AbortSignal.timeout(Number(environment.CLAUDE_THIRD_PARTY_TIMEOUT_MS) || 10 * 60 * 1000),
  });

  if (!upstream.ok) {
    sendAnthropicError(response, upstream.status, await upstreamError(upstream), 'upstream_error');
    return;
  }

  if (body.stream) {
    await pipeOpenAIStream(upstream, response, body.model || upstreamModel, estimateInputTokens(body));
    return;
  }

  const upstreamBody = await upstream.json();
  sendJson(response, 200, openAIResponseToAnthropic(upstreamBody, body.model || upstreamModel));
}

function createZeroConfigServer(options = {}) {
  const environment = options.environment ?? process.env;
  const resolveProvider = options.resolveProvider ?? createProviderResolver(environment);
  const logger = options.logger ?? (() => {});

  return http.createServer(async (request, response) => {
    const requestUrl = new URL(request.url, 'http://127.0.0.1');
    try {
      if (request.method === 'GET' && requestUrl.pathname === '/_claude_zero_config/health') {
        const provider = await resolveProvider();
        sendJson(response, 200, {
          ok: true,
          service: 'claude-third-party-zero-config',
          provider: provider ? { label: provider.label, baseUrl: provider.baseUrl, models: provider.models } : null,
        });
        return;
      }

      if (request.method === 'GET' && requestUrl.pathname === '/v1/models') {
        const provider = await resolveProvider();
        if (!provider) {
          sendAnthropicError(
            response,
            503,
            'No OpenAI-compatible local model server was found. Start Ollama, LM Studio, vLLM, or LocalAI and retry.',
            'provider_unavailable',
          );
          return;
        }
        sendJson(response, 200, modelsResponse(provider));
        return;
      }

      if (request.method === 'POST' && requestUrl.pathname === '/v1/messages/count_tokens') {
        const body = await readJson(request);
        sendJson(response, 200, { input_tokens: estimateInputTokens(body) });
        return;
      }

      if (request.method === 'POST' && requestUrl.pathname === '/v1/messages') {
        const provider = await resolveProvider();
        if (!provider) {
          sendAnthropicError(
            response,
            503,
            'No OpenAI-compatible local model server was found. Start Ollama, LM Studio, vLLM, or LocalAI and retry.',
            'provider_unavailable',
          );
          return;
        }
        await handleMessages(request, response, provider, environment);
        return;
      }

      sendAnthropicError(response, 404, `Unsupported endpoint: ${request.method} ${requestUrl.pathname}`, 'not_found_error');
    } catch (error) {
      logger('gateway-error', { message: error instanceof Error ? error.message : String(error) });
      if (!response.headersSent) {
        sendAnthropicError(response, error.statusCode || 500, error.message || String(error));
      } else {
        response.destroy(error instanceof Error ? error : new Error(String(error)));
      }
    }
  });
}

async function startZeroConfigGateway(options = {}) {
  const server = createZeroConfigServer(options);
  const host = options.host ?? '127.0.0.1';
  const preferredPort = Number(options.port ?? process.env.CLAUDE_ZERO_CONFIG_PORT ?? 42121);

  const listen = (port) => new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });

  try {
    await listen(preferredPort);
  } catch (error) {
    if (error?.code !== 'EADDRINUSE' || preferredPort === 0) throw error;
    await listen(0);
  }

  const address = server.address();
  const baseUrl = `http://${host}:${address.port}`;
  return {
    baseUrl,
    server,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

module.exports = {
  buildCandidates,
  createProviderResolver,
  createZeroConfigServer,
  modelsResponse,
  startZeroConfigGateway,
};
