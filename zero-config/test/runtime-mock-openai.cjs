'use strict';

const http = require('node:http');

const server = http.createServer(async (request, response) => {
  if (request.method === 'GET' && request.url === '/v1/models') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ data: [{ id: 'runtime-test-model', object: 'model' }] }));
    return;
  }

  if (request.method === 'POST' && request.url === '/v1/chat/completions') {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (body.stream) {
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'runtime ' }, finish_reason: null }] })}\n\n`);
      response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'stream ok' }, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 3 } })}\n\n`);
      response.end('data: [DONE]\n\n');
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({
      id: 'chatcmpl_runtime',
      model: body.model,
      choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'runtime message ok' } }],
      usage: { prompt_tokens: 5, completion_tokens: 3 },
    }));
    return;
  }

  if (request.method === 'POST' && request.url === '/shutdown') {
    response.writeHead(204).end();
    server.close();
    return;
  }

  response.writeHead(404).end();
});

server.listen(8000, '127.0.0.1', () => {
  console.log('runtime mock listening on http://127.0.0.1:8000/v1');
});
