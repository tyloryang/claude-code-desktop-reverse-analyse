'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  AnthropicStreamEncoder,
  anthropicRequestToOpenAI,
  openAIResponseToAnthropic,
} = require('../lib/adapter.cjs');
const { PROFILE_ID, ensureZeroConfigProfile } = require('../bootstrap.cjs');
const { createZeroConfigServer } = require('../lib/server.cjs');

function parseSse(events) {
  return events.map((event) => {
    const lines = event.trim().split('\n');
    return {
      event: lines[0].slice('event: '.length),
      data: JSON.parse(lines[1].slice('data: '.length)),
    };
  });
}

test('converts Anthropic messages and tools to OpenAI chat format', () => {
  const converted = anthropicRequestToOpenAI({
    model: 'qwen3',
    system: [{ type: 'text', text: 'Be concise.' }],
    messages: [
      { role: 'user', content: [{ type: 'text', text: 'List files.' }] },
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'toolu_1', name: 'list_files', input: { path: '.' } }],
      },
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'README.md' }],
      },
    ],
    tools: [{
      name: 'list_files',
      description: 'List files',
      input_schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    }],
    tool_choice: { type: 'auto' },
    max_tokens: 1024,
  });

  assert.equal(converted.messages[0].role, 'system');
  assert.equal(converted.messages[2].tool_calls[0].function.name, 'list_files');
  assert.equal(converted.messages[3].role, 'tool');
  assert.equal(converted.tools[0].function.parameters.required[0], 'path');
  assert.equal(converted.max_tokens, 1024);
});

test('converts OpenAI tool calls to Anthropic content blocks', () => {
  const converted = openAIResponseToAnthropic({
    id: 'chatcmpl_1',
    model: 'qwen3',
    choices: [{
      finish_reason: 'tool_calls',
      message: {
        role: 'assistant',
        content: null,
        tool_calls: [{ id: 'call_1', function: { name: 'read_file', arguments: '{"path":"a.txt"}' } }],
      },
    }],
    usage: { prompt_tokens: 10, completion_tokens: 5 },
  }, 'qwen3');

  assert.equal(converted.stop_reason, 'tool_use');
  assert.deepEqual(converted.content[0], {
    type: 'tool_use',
    id: 'call_1',
    name: 'read_file',
    input: { path: 'a.txt' },
  });
  assert.deepEqual(converted.usage, { input_tokens: 10, output_tokens: 5 });
});

test('encodes OpenAI streaming text as Anthropic SSE events', () => {
  const encoder = new AnthropicStreamEncoder('qwen3', 12);
  const events = [
    ...encoder.start(),
    ...encoder.push({ choices: [{ delta: { content: 'Hello' }, finish_reason: null }] }),
    ...encoder.push({ choices: [{ delta: { content: ' world' }, finish_reason: 'stop' }], usage: { completion_tokens: 2 } }),
    ...encoder.finish(),
  ];
  const parsed = parseSse(events);

  assert.equal(parsed[0].event, 'message_start');
  assert.equal(parsed.find((item) => item.data?.delta?.text === 'Hello').event, 'content_block_delta');
  assert.equal(parsed.at(-2).data.delta.stop_reason, 'end_turn');
  assert.equal(parsed.at(-1).event, 'message_stop');
});

test('seeds the Claude-3p config library without deleting unrelated settings', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-zero-config-'));
  fs.writeFileSync(path.join(directory, 'claude_desktop_config.json'), JSON.stringify({ mcpServers: { demo: {} } }));

  const result = ensureZeroConfigProfile('http://127.0.0.1:42121', { directory });
  const rootConfig = JSON.parse(fs.readFileSync(result.rootConfigPath, 'utf8'));
  const metadata = JSON.parse(fs.readFileSync(result.metadataPath, 'utf8'));
  const profile = JSON.parse(fs.readFileSync(result.profilePath, 'utf8'));

  assert.equal(rootConfig.deploymentMode, '3p');
  assert.deepEqual(rootConfig.mcpServers, { demo: {} });
  assert.equal(metadata.appliedId, PROFILE_ID);
  assert.equal(profile.inferenceProvider, 'gateway');
  assert.equal(profile.inferenceGatewayBaseUrl, 'http://127.0.0.1:42121');
  assert.equal(profile.inferenceGatewayManagedClaudeCode, true);
});

test('serves model discovery and converts non-streaming messages over HTTP', async (context) => {
  const upstream = http.createServer(async (request, response) => {
    if (request.url === '/v1/chat/completions') {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      assert.equal(body.model, 'qwen3-coder');
      assert.equal(body.messages.at(-1).content[0].text, 'Hello');
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        id: 'chatcmpl_test',
        model: 'qwen3-coder',
        choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'Hi!' } }],
        usage: { prompt_tokens: 4, completion_tokens: 2 },
      }));
      return;
    }
    response.writeHead(404).end();
  });
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  context.after(() => new Promise((resolve) => upstream.close(resolve)));
  const upstreamPort = upstream.address().port;
  const provider = {
    label: 'Test provider',
    baseUrl: `http://127.0.0.1:${upstreamPort}/v1`,
    apiKey: 'test',
    models: ['qwen3-coder'],
  };

  const gateway = createZeroConfigServer({ resolveProvider: async () => provider });
  await new Promise((resolve) => gateway.listen(0, '127.0.0.1', resolve));
  context.after(() => new Promise((resolve) => gateway.close(resolve)));
  const gatewayBaseUrl = `http://127.0.0.1:${gateway.address().port}`;

  const models = await fetch(`${gatewayBaseUrl}/v1/models`).then((response) => response.json());
  assert.equal(models.data[0].id, 'qwen3-coder');
  assert.equal(models.data[0].anthropic_family_tier, 'sonnet');

  const result = await fetch(`${gatewayBaseUrl}/v1/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'qwen3-coder',
      max_tokens: 64,
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }],
    }),
  }).then((response) => response.json());

  assert.equal(result.content[0].text, 'Hi!');
  assert.equal(result.stop_reason, 'end_turn');
  assert.deepEqual(result.usage, { input_tokens: 4, output_tokens: 2 });
});

test('converts streamed OpenAI function calls to Anthropic tool-use SSE', async (context) => {
  const upstream = http.createServer(async (request, response) => {
    for await (const _chunk of request) {
      // Drain the request body before sending the response.
    }
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.write(`data: ${JSON.stringify({
      choices: [{
        delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'read_file', arguments: '{"path":' } }] },
        finish_reason: null,
      }],
    })}\n\n`);
    response.write(`data: ${JSON.stringify({
      choices: [{
        delta: { tool_calls: [{ index: 0, function: { arguments: '"README.md"}' } }] },
        finish_reason: 'tool_calls',
      }],
      usage: { prompt_tokens: 8, completion_tokens: 3 },
    })}\n\n`);
    response.end('data: [DONE]\n\n');
  });
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  context.after(() => new Promise((resolve) => upstream.close(resolve)));
  const provider = {
    label: 'Test provider',
    baseUrl: `http://127.0.0.1:${upstream.address().port}/v1`,
    apiKey: 'test',
    models: ['qwen3-coder'],
  };

  const gateway = createZeroConfigServer({ resolveProvider: async () => provider });
  await new Promise((resolve) => gateway.listen(0, '127.0.0.1', resolve));
  context.after(() => new Promise((resolve) => gateway.close(resolve)));

  const response = await fetch(`http://127.0.0.1:${gateway.address().port}/v1/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'qwen3-coder',
      stream: true,
      max_tokens: 64,
      messages: [{ role: 'user', content: 'Read the file.' }],
    }),
  });
  const stream = await response.text();

  assert.equal(response.status, 200);
  const events = stream
    .split('\n\n')
    .filter(Boolean)
    .map((event) => JSON.parse(event.split('\n').find((line) => line.startsWith('data: ')).slice(6)));
  const toolBlock = events.find((event) => event.content_block?.type === 'tool_use');
  const toolInput = events
    .filter((event) => event.delta?.type === 'input_json_delta')
    .map((event) => event.delta.partial_json)
    .join('');

  assert.equal(toolBlock.content_block.id, 'call_1');
  assert.equal(toolBlock.content_block.name, 'read_file');
  assert.deepEqual(JSON.parse(toolInput), { path: 'README.md' });
  assert.equal(events.find((event) => event.type === 'message_delta').delta.stop_reason, 'tool_use');
  assert.equal(events.at(-1).type, 'message_stop');
});
