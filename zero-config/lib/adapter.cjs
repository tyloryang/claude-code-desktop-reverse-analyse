'use strict';

const crypto = require('node:crypto');

function asText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return content == null ? '' : JSON.stringify(content);
  return content
    .map((block) => {
      if (typeof block === 'string') return block;
      if (block?.type === 'text') return block.text ?? '';
      if (block?.type === 'tool_result') return asText(block.content);
      if (block?.type === 'document') return '[Document omitted by local compatibility gateway]';
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

function imageBlockToOpenAI(block) {
  const source = block?.source;
  if (!source) return null;
  if (source.type === 'base64' && source.data) {
    return {
      type: 'image_url',
      image_url: { url: `data:${source.media_type || 'image/png'};base64,${source.data}` },
    };
  }
  if (source.type === 'url' && source.url) {
    return { type: 'image_url', image_url: { url: source.url } };
  }
  return null;
}

function convertAnthropicMessage(message) {
  if (typeof message.content === 'string') {
    return [{ role: message.role, content: message.content }];
  }

  const blocks = Array.isArray(message.content) ? message.content : [];
  const textParts = [];
  const toolCalls = [];
  const toolResults = [];

  for (const block of blocks) {
    if (block?.type === 'text') {
      textParts.push({ type: 'text', text: block.text ?? '' });
    } else if (block?.type === 'image') {
      const converted = imageBlockToOpenAI(block);
      if (converted) textParts.push(converted);
    } else if (block?.type === 'document') {
      textParts.push({ type: 'text', text: '[Document omitted by local compatibility gateway]' });
    } else if (block?.type === 'tool_use') {
      toolCalls.push({
        id: block.id,
        type: 'function',
        function: {
          name: block.name,
          arguments: JSON.stringify(block.input ?? {}),
        },
      });
    } else if (block?.type === 'tool_result') {
      toolResults.push({
        role: 'tool',
        tool_call_id: block.tool_use_id,
        content: asText(block.content),
      });
    }
  }

  if (message.role === 'assistant') {
    return [{
      role: 'assistant',
      content: textParts.length ? textParts : null,
      ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
    }];
  }

  const converted = [...toolResults];
  if (textParts.length) converted.push({ role: message.role, content: textParts });
  if (!converted.length) converted.push({ role: message.role, content: '' });
  return converted;
}

function normalizeToolChoice(toolChoice) {
  if (!toolChoice) return undefined;
  if (typeof toolChoice === 'string') return toolChoice;
  switch (toolChoice.type) {
    case 'auto':
      return 'auto';
    case 'none':
      return 'none';
    case 'any':
      return 'required';
    case 'tool':
      return { type: 'function', function: { name: toolChoice.name } };
    default:
      return undefined;
  }
}

function anthropicRequestToOpenAI(body, model) {
  const messages = [];
  const systemText = asText(body.system);
  if (systemText) messages.push({ role: 'system', content: systemText });

  for (const message of body.messages ?? []) {
    messages.push(...convertAnthropicMessage(message));
  }

  const request = {
    model: model ?? body.model,
    messages,
    stream: Boolean(body.stream),
  };

  if (body.max_tokens != null) request.max_tokens = body.max_tokens;
  if (body.temperature != null) request.temperature = body.temperature;
  if (body.top_p != null) request.top_p = body.top_p;
  if (Array.isArray(body.stop_sequences) && body.stop_sequences.length) {
    request.stop = body.stop_sequences;
  }
  if (Array.isArray(body.tools) && body.tools.length) {
    request.tools = body.tools.map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description ?? '',
        parameters: tool.input_schema ?? { type: 'object', properties: {} },
      },
    }));
    const toolChoice = normalizeToolChoice(body.tool_choice);
    if (toolChoice !== undefined) request.tool_choice = toolChoice;
  }
  if (request.stream) request.stream_options = { include_usage: true };
  return request;
}

function mapStopReason(reason) {
  switch (reason) {
    case 'length':
      return 'max_tokens';
    case 'tool_calls':
    case 'function_call':
      return 'tool_use';
    case 'content_filter':
      return 'refusal';
    default:
      return 'end_turn';
  }
}

function openAIResponseToAnthropic(response, requestedModel) {
  const choice = response.choices?.[0] ?? {};
  const message = choice.message ?? {};
  const content = [];

  if (typeof message.content === 'string' && message.content) {
    content.push({ type: 'text', text: message.content });
  } else if (Array.isArray(message.content)) {
    const text = message.content
      .map((part) => typeof part === 'string' ? part : part?.text ?? '')
      .join('');
    if (text) content.push({ type: 'text', text });
  }

  for (const call of message.tool_calls ?? []) {
    let input = {};
    try {
      input = JSON.parse(call.function?.arguments || '{}');
    } catch {
      input = { _raw: call.function?.arguments || '' };
    }
    content.push({
      type: 'tool_use',
      id: call.id || `toolu_${crypto.randomUUID().replaceAll('-', '')}`,
      name: call.function?.name || 'tool',
      input,
    });
  }

  return {
    id: response.id || `msg_${crypto.randomUUID().replaceAll('-', '')}`,
    type: 'message',
    role: 'assistant',
    content,
    model: requestedModel || response.model || 'third-party-model',
    stop_reason: mapStopReason(choice.finish_reason),
    stop_sequence: null,
    usage: {
      input_tokens: response.usage?.prompt_tokens ?? 0,
      output_tokens: response.usage?.completion_tokens ?? 0,
    },
  };
}

function encodeSse(event, payload) {
  return `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
}

class AnthropicStreamEncoder {
  constructor(model, inputTokens = 0) {
    this.model = model;
    this.inputTokens = inputTokens;
    this.outputTokens = 0;
    this.messageId = `msg_${crypto.randomUUID().replaceAll('-', '')}`;
    this.nextBlockIndex = 0;
    this.textBlockIndex = null;
    this.toolBlocks = new Map();
    this.openBlocks = new Set();
    this.finishReason = 'stop';
    this.started = false;
    this.finished = false;
  }

  start() {
    if (this.started) return [];
    this.started = true;
    return [encodeSse('message_start', {
      type: 'message_start',
      message: {
        id: this.messageId,
        type: 'message',
        role: 'assistant',
        content: [],
        model: this.model,
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: this.inputTokens, output_tokens: 0 },
      },
    })];
  }

  ensureTextBlock(events) {
    if (this.textBlockIndex !== null) return this.textBlockIndex;
    const index = this.nextBlockIndex++;
    this.textBlockIndex = index;
    this.openBlocks.add(index);
    events.push(encodeSse('content_block_start', {
      type: 'content_block_start',
      index,
      content_block: { type: 'text', text: '' },
    }));
    return index;
  }

  ensureToolBlock(toolDelta, events) {
    const upstreamIndex = toolDelta.index ?? 0;
    let state = this.toolBlocks.get(upstreamIndex);
    if (!state) {
      state = {
        id: toolDelta.id,
        name: toolDelta.function?.name,
        pendingArguments: '',
        blockIndex: null,
      };
      this.toolBlocks.set(upstreamIndex, state);
    } else {
      state.id ||= toolDelta.id;
      state.name ||= toolDelta.function?.name;
    }
    state.pendingArguments += toolDelta.function?.arguments ?? '';

    if (state.blockIndex === null && state.name) {
      state.blockIndex = this.nextBlockIndex++;
      state.id ||= `toolu_${crypto.randomUUID().replaceAll('-', '')}`;
      this.openBlocks.add(state.blockIndex);
      events.push(encodeSse('content_block_start', {
        type: 'content_block_start',
        index: state.blockIndex,
        content_block: { type: 'tool_use', id: state.id, name: state.name, input: {} },
      }));
    }

    if (state.blockIndex !== null && state.pendingArguments) {
      events.push(encodeSse('content_block_delta', {
        type: 'content_block_delta',
        index: state.blockIndex,
        delta: { type: 'input_json_delta', partial_json: state.pendingArguments },
      }));
      state.pendingArguments = '';
    }
  }

  push(chunk) {
    if (this.finished) return [];
    const events = this.start();
    const choice = chunk.choices?.[0];
    const delta = choice?.delta ?? {};

    if (typeof delta.content === 'string' && delta.content) {
      const index = this.ensureTextBlock(events);
      events.push(encodeSse('content_block_delta', {
        type: 'content_block_delta',
        index,
        delta: { type: 'text_delta', text: delta.content },
      }));
    }

    for (const toolDelta of delta.tool_calls ?? []) {
      this.ensureToolBlock(toolDelta, events);
    }

    if (choice?.finish_reason) this.finishReason = choice.finish_reason;
    if (chunk.usage?.prompt_tokens != null) this.inputTokens = chunk.usage.prompt_tokens;
    if (chunk.usage?.completion_tokens != null) this.outputTokens = chunk.usage.completion_tokens;
    return events;
  }

  finish() {
    if (this.finished) return [];
    this.finished = true;
    const events = this.start();

    for (const state of this.toolBlocks.values()) {
      if (state.blockIndex === null) {
        state.name ||= 'tool';
        this.ensureToolBlock({ index: [...this.toolBlocks.values()].indexOf(state), function: { name: state.name } }, events);
      }
    }

    for (const index of [...this.openBlocks].sort((left, right) => left - right)) {
      events.push(encodeSse('content_block_stop', { type: 'content_block_stop', index }));
    }
    events.push(encodeSse('message_delta', {
      type: 'message_delta',
      delta: { stop_reason: mapStopReason(this.finishReason), stop_sequence: null },
      usage: { output_tokens: this.outputTokens },
    }));
    events.push(encodeSse('message_stop', { type: 'message_stop' }));
    return events;
  }
}

function estimateInputTokens(body) {
  const serialized = JSON.stringify({ system: body.system, messages: body.messages, tools: body.tools });
  return Math.max(1, Math.ceil(serialized.length / 4));
}

module.exports = {
  AnthropicStreamEncoder,
  anthropicRequestToOpenAI,
  estimateInputTokens,
  mapStopReason,
  openAIResponseToAnthropic,
};
