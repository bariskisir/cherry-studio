import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  buildClaudeCodeHeaders,
  getAntigravityModelId,
  patchCodexRequestBody,
  transformAntigravityStream,
  wrapAntigravityRequestBody
} from '../cliProviderAdapters'

describe('patchCodexRequestBody', () => {
  it('returns non-string body unchanged', () => {
    const body = new Uint8Array([1, 2, 3])
    expect(patchCodexRequestBody(body)).toBe(body)
    expect(patchCodexRequestBody(null)).toBeNull()
    expect(patchCodexRequestBody(undefined)).toBeUndefined()
  })

  it('sets store=false and injects reasoning defaults', () => {
    const result = patchCodexRequestBody(JSON.stringify({ model: 'gpt-4' }))
    const parsed = JSON.parse(result as string)
    expect(parsed.store).toBe(false)
    expect(parsed.reasoning).toEqual({ effort: 'low', summary: 'auto' })
  })

  it('sets instructions to "." when missing or empty', () => {
    const withMissing = JSON.parse(patchCodexRequestBody(JSON.stringify({ model: 'gpt-4' })) as string)
    expect(withMissing.instructions).toBe('.')

    const withEmpty = JSON.parse(patchCodexRequestBody(JSON.stringify({ model: 'gpt-4', instructions: '' })) as string)
    expect(withEmpty.instructions).toBe('.')

    const withBlank = JSON.parse(
      patchCodexRequestBody(JSON.stringify({ model: 'gpt-4', instructions: '   ' })) as string
    )
    expect(withBlank.instructions).toBe('.')
  })

  it('preserves existing instructions and reasoning', () => {
    const result = JSON.parse(
      patchCodexRequestBody(
        JSON.stringify({ model: 'gpt-4', instructions: 'do something', reasoning: { effort: 'high', summary: 'off' } })
      ) as string
    )
    expect(result.instructions).toBe('do something')
    expect(result.reasoning).toEqual({ effort: 'high', summary: 'off' })
  })

  it('returns body as-is on JSON parse failure', () => {
    const invalid = 'not-json'
    expect(patchCodexRequestBody(invalid)).toBe(invalid)
  })
})

describe('getAntigravityModelId', () => {
  it('extracts model ID from URL path', () => {
    const url = 'https://cloudcode.googleapis.com/v1/models/gemini-2.0-flash-001:streamGenerateContent'
    expect(getAntigravityModelId(url, 'fallback')).toBe('gemini-2.0-flash-001')
  })

  it('returns fallback when no match', () => {
    expect(getAntigravityModelId('https://example.com/api/chat', 'fallback')).toBe('fallback')
    expect(getAntigravityModelId('', 'fallback')).toBe('fallback')
  })

  it('decodes URI-encoded model IDs', () => {
    const url = 'https://example.com/models/gemini%2D2%2E0%2Dflash:generateContent'
    expect(getAntigravityModelId(url, 'fallback')).toBe('gemini-2.0-flash')
  })
})

describe('wrapAntigravityRequestBody', () => {
  beforeEach(() => {
    vi.stubGlobal('crypto', { randomUUID: () => 'test-uuid' })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('wraps the request body with model, project, and metadata', () => {
    const body = JSON.stringify({ contents: [{ parts: [{ text: 'hello' }] }] })
    const result = wrapAntigravityRequestBody(body, 'gemini-model', 'my-project')
    const parsed = JSON.parse(result as string)
    expect(parsed.model).toBe('gemini-model')
    expect(parsed.project).toBe('my-project')
    expect(parsed.requestId).toBe('chat-test-uuid')
    expect(parsed.userAgent).toBe('antigravity')
    expect(parsed.requestType).toBe('checkpoint')
    expect(parsed.request.contents[0].parts[0].text).toBe('hello')
  })

  it('adds a sessionId if not present', () => {
    const body = JSON.stringify({ contents: [] })
    const result = JSON.parse(wrapAntigravityRequestBody(body, 'm', 'p') as string)
    expect(result.request.sessionId).toBeDefined()
    expect(result.request.sessionId).toMatch(/^-\d+$/)
  })

  it('preserves existing sessionId', () => {
    const body = JSON.stringify({ contents: [], sessionId: 'my-session' })
    const result = JSON.parse(wrapAntigravityRequestBody(body, 'm', 'p') as string)
    expect(result.request.sessionId).toBe('my-session')
  })

  it('returns non-string body unchanged', () => {
    expect(wrapAntigravityRequestBody(null, 'm', 'p')).toBeNull()
    expect(wrapAntigravityRequestBody(undefined, 'm', 'p')).toBeUndefined()
  })

  it('returns body as-is on JSON parse failure', () => {
    const broken = '{{{'
    expect(wrapAntigravityRequestBody(broken, 'm', 'p')).toBe(broken)
  })
})

describe('buildClaudeCodeHeaders', () => {
  it('sets Authorization header and removes x-api-key', () => {
    const headers = buildClaudeCodeHeaders(
      { 'x-api-key': 'old-key', 'Content-Type': 'application/json' },
      'bearer-token'
    )
    expect(headers.get('Authorization')).toBe('Bearer bearer-token')
    expect(headers.get('x-api-key')).toBeNull()
    expect(headers.get('Content-Type')).toBe('application/json')
  })

  it('injects oauth beta header', () => {
    const headers = buildClaudeCodeHeaders(undefined, 'token')
    const betas =
      headers
        .get('anthropic-beta')
        ?.split(',')
        .map((b) => b.trim()) ?? []
    expect(betas).toContain('oauth-2025-04-20')
  })

  it('preserves existing anthropic-beta values', () => {
    const headers = buildClaudeCodeHeaders({ 'anthropic-beta': 'some-beta-2025-01-01' }, 'token')
    const betas =
      headers
        .get('anthropic-beta')
        ?.split(',')
        .map((b) => b.trim()) ?? []
    expect(betas).toContain('some-beta-2025-01-01')
    expect(betas).toContain('oauth-2025-04-20')
  })
})

describe('transformAntigravityStream', () => {
  function createStream(chunks: string[]): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder()
    return new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk))
        }
        controller.close()
      }
    })
  }

  async function collectText(stream: ReadableStream<Uint8Array>): Promise<string> {
    const reader = stream.getReader()
    const decoder = new TextDecoder()
    let result = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      result += decoder.decode(value, { stream: true })
    }
    result += decoder.decode()
    return result
  }

  it('unwraps Antigravity response envelope in SSE', async () => {
    const input = 'data: {"response": {"candidates": [{"text": "hello"}]}}\n'
    const stream = transformAntigravityStream(createStream([input]))
    const output = await collectText(stream)
    expect(output).toBe('data: {"candidates":[{"text":"hello"}]}\n')
  })

  it('passes non-envelope SSE lines through', async () => {
    const input = 'data: {"candidates": [{"text": "hello"}]}\n'
    const stream = transformAntigravityStream(createStream([input]))
    const output = await collectText(stream)
    expect(output).toBe(input)
  })

  it('passes through [DONE] and non-data lines', async () => {
    const lines = ['data: [DONE]\n', 'event: ping\n', ':\n']
    const stream = transformAntigravityStream(createStream(lines))
    const output = await collectText(stream)
    expect(output).toBe(lines.join(''))
  })

  it('handles complete Antigravity SSE chunk with unwrapping', async () => {
    const input = 'data: {"response": {"text": "hello world"}}\n'
    const stream = transformAntigravityStream(createStream([input]))
    const output = await collectText(stream)
    expect(output).toBe('data: {"text":"hello world"}\n')
  })
})
