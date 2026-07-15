import { describe, expect, it } from 'vitest'

import { ClaudeWebSseNormalizer, parseClaudeWebSseText } from '../claude-web-fetch'

describe('parseClaudeWebSseText', () => {
  it('combines Claude Web text deltas and ignores thinking events', () => {
    const response = [
      'data: {"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"work"}}',
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello"}}',
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":" world"}}',
      'data: [DONE]'
    ].join('\n')

    expect(parseClaudeWebSseText(response)).toBe('Hello world')
  })
})

describe('ClaudeWebSseNormalizer', () => {
  it('adds Anthropic usage fields to a message_start split across chunks', () => {
    const normalizer = new ClaudeWebSseNormalizer()
    const event =
      'data: {"type":"message_start","message":{"id":"message-1","type":"message","role":"assistant","content":[]}}\n\n'
    const splitAt = 47
    const normalized =
      normalizer.push(event.slice(0, splitAt)) + normalizer.push(event.slice(splitAt)) + normalizer.flush()
    const payload = normalized
      .split(/\r?\n/)
      .find((line) => line.startsWith('data:'))!
      .slice(5)
      .trim()

    expect(JSON.parse(payload).message.usage).toEqual({
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0
    })
  })

  it('drops Claude Web message_limit events that the Anthropic SDK does not support', () => {
    const normalizer = new ClaudeWebSseNormalizer()
    const stream = [
      'data: {"type":"message_limit","message_limit":{"type":"within_limit"}}',
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"4"}}',
      ''
    ].join('\n')

    const normalized = normalizer.push(stream) + normalizer.flush()

    expect(normalized).not.toContain('message_limit')
    expect(normalized).toContain('content_block_delta')
  })

  it('drops Claude Web thinking summaries that have no Anthropic reasoning lifecycle', () => {
    const normalizer = new ClaudeWebSseNormalizer()
    const stream =
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_summary_delta","summary":{"summary":"Analyzed the request."}}}\n'

    const normalized = normalizer.push(stream) + normalizer.flush()
    expect(normalized).toBe('\n')
  })
})
