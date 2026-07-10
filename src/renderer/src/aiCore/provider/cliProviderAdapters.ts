const CLAUDE_CODE_OAUTH_BETA = 'oauth-2025-04-20'

export function patchCodexRequestBody(body: BodyInit | null | undefined): BodyInit | null | undefined {
  if (typeof body !== 'string') return body

  try {
    const request = JSON.parse(body)
    request.store = false
    if (!request.instructions || !String(request.instructions).trim()) {
      request.instructions = '.'
    }
    if (!request.reasoning) {
      request.reasoning = { effort: 'low', summary: 'auto' }
    }
    return JSON.stringify(request)
  } catch {
    return body
  }
}

function unwrapAntigravitySseLine(line: string): string {
  if (!line.startsWith('data:')) return line
  const payload = line.slice(5).trimStart()
  if (!payload || payload === '[DONE]') return line

  try {
    const parsed = JSON.parse(payload)
    if (parsed && typeof parsed === 'object' && 'response' in parsed) {
      return `data: ${JSON.stringify(parsed.response)}`
    }
  } catch {
    // Preserve malformed or incomplete server events.
  }

  return line
}

function unwrapAntigravitySseChunk(text: string): string {
  return text
    .split('\n')
    .map((line) => unwrapAntigravitySseLine(line))
    .join('\n')
}

export function transformAntigravityStream(body: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  let buffer = ''

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await reader.read()
      if (done) {
        buffer += decoder.decode()
        if (buffer) controller.enqueue(encoder.encode(unwrapAntigravitySseChunk(buffer)))
        controller.close()
        return
      }

      buffer += decoder.decode(value, { stream: true })
      const lastNewline = buffer.lastIndexOf('\n')
      if (lastNewline >= 0) {
        const ready = buffer.slice(0, lastNewline + 1)
        buffer = buffer.slice(lastNewline + 1)
        controller.enqueue(encoder.encode(unwrapAntigravitySseChunk(ready)))
      }
    },
    cancel(reason) {
      void reader.cancel(reason)
    }
  })
}

export function getAntigravityModelId(url: string, fallbackModelId: string): string {
  const match = url.match(/\/models\/([^:/?]+):/)
  return match ? decodeURIComponent(match[1]) : fallbackModelId
}

export function wrapAntigravityRequestBody(
  body: BodyInit | null | undefined,
  modelId: string,
  projectId: string
): BodyInit | null | undefined {
  if (typeof body !== 'string') return body

  try {
    const request = JSON.parse(body)
    request.sessionId ||= `-${Date.now()}`
    return JSON.stringify({
      model: modelId,
      project: projectId,
      requestId: `chat-${crypto.randomUUID()}`,
      userAgent: 'antigravity',
      requestType: 'checkpoint',
      request
    })
  } catch {
    return body
  }
}

export function buildClaudeCodeHeaders(initHeaders: HeadersInit | undefined, accessToken: string): Headers {
  const headers = new Headers(initHeaders)
  headers.delete('x-api-key')
  headers.set('Authorization', `Bearer ${accessToken}`)

  const existingBeta = headers.get('anthropic-beta')
  const betas = new Set((existingBeta ? existingBeta.split(',') : []).map((beta) => beta.trim()).filter(Boolean))
  betas.add(CLAUDE_CODE_OAUTH_BETA)
  headers.set('anthropic-beta', [...betas].join(','))
  return headers
}

export { CLAUDE_CODE_OAUTH_BETA }
