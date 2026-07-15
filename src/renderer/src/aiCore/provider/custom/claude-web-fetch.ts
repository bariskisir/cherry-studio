import type { ClaudeWebStreamEvent } from '@shared/claudeWeb'

type PendingRequest = {
  chunks: string[]
  normalizer: ClaudeWebSseNormalizer
  controller?: ReadableStreamDefaultController<Uint8Array>
  resolve: (value: string) => void
  reject: (error: Error) => void
}

const pendingRequests = new Map<string, PendingRequest>()
const encoder = new TextEncoder()
let listening = false

type JsonObject = Record<string, unknown>

const ANTHROPIC_SSE_EVENT_TYPES = new Set([
  'message_start',
  'content_block_start',
  'content_block_delta',
  'content_block_stop',
  'message_delta',
  'message_stop',
  'ping',
  'error'
])
const ANTHROPIC_CONTENT_DELTA_TYPES = new Set([
  'input_json_delta',
  'text_delta',
  'thinking_delta',
  'signature_delta',
  'compaction_delta',
  'citations_delta'
])

function numericUsage(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

export function normalizeClaudeWebSseEvent(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  const event = value as JsonObject

  if (event.type === 'content_block_delta') {
    const delta = event.delta && typeof event.delta === 'object' ? (event.delta as JsonObject) : undefined
    if (!delta || !ANTHROPIC_CONTENT_DELTA_TYPES.has(String(delta.type))) {
      return undefined
    }
  }

  if (event.type === 'message_start' && event.message && typeof event.message === 'object') {
    const message = event.message as JsonObject
    const usage = message.usage && typeof message.usage === 'object' ? (message.usage as JsonObject) : {}
    message.usage = {
      input_tokens: numericUsage(usage.input_tokens),
      output_tokens: numericUsage(usage.output_tokens),
      cache_creation_input_tokens: numericUsage(usage.cache_creation_input_tokens),
      cache_read_input_tokens: numericUsage(usage.cache_read_input_tokens)
    }
  }

  if (event.type === 'message_delta') {
    const usage = event.usage && typeof event.usage === 'object' ? (event.usage as JsonObject) : {}
    event.usage = { ...usage, output_tokens: numericUsage(usage.output_tokens) }
  }

  return event
}

export class ClaudeWebSseNormalizer {
  private buffer = ''

  public push(chunk: string): string {
    this.buffer += chunk
    const lines = this.buffer.split('\n')
    this.buffer = lines.pop() ?? ''
    return lines.map((line) => this.normalizeLine(line)).join('\n') + (lines.length > 0 ? '\n' : '')
  }

  public flush(): string {
    const tail = this.buffer
    this.buffer = ''
    return tail ? this.normalizeLine(tail) : ''
  }

  private normalizeLine(line: string): string {
    const cleanLine = line.endsWith('\r') ? line.slice(0, -1) : line
    if (!cleanLine.startsWith('data:')) return cleanLine
    const payload = cleanLine.slice(5).trim()
    if (!payload || payload === '[DONE]') return cleanLine
    try {
      const event = JSON.parse(payload)
      if (!event || typeof event !== 'object' || !ANTHROPIC_SSE_EVENT_TYPES.has(event.type)) return ''
      const normalized = normalizeClaudeWebSseEvent(event)
      return normalized ? `data: ${JSON.stringify(normalized)}` : ''
    } catch {
      return cleanLine
    }
  }
}

function ensureListener(): void {
  if (listening) return
  listening = true
  window.api.claudeWeb.onStreamEvent(handleStreamEvent)
}

function handleStreamEvent(event: ClaudeWebStreamEvent): void {
  const pending = pendingRequests.get(event.requestId)
  if (!pending) return
  if (event.type === 'chunk') {
    const normalized = pending.normalizer.push(event.data)
    if (normalized) {
      pending.chunks.push(normalized)
      pending.controller?.enqueue(encoder.encode(normalized))
    }
    return
  }

  pendingRequests.delete(event.requestId)
  if (event.type === 'error') {
    const error = new Error(event.error)
    pending.controller?.error(error)
    pending.reject(error)
    return
  }
  const tail = pending.normalizer.flush()
  if (tail) {
    pending.chunks.push(tail)
    pending.controller?.enqueue(encoder.encode(tail))
  }
  pending.controller?.close()
  pending.resolve(pending.chunks.join(''))
}

function completionPromise(requestId: string, controller?: ReadableStreamDefaultController<Uint8Array>) {
  return new Promise<string>((resolve, reject) => {
    pendingRequests.set(requestId, {
      chunks: [],
      normalizer: new ClaudeWebSseNormalizer(),
      controller,
      resolve,
      reject
    })
  })
}

export function parseClaudeWebSseText(value: string): string {
  let text = ''
  for (const line of value.split(/\r?\n/)) {
    if (!line.startsWith('data:')) continue
    const payload = line.slice(5).trim()
    if (!payload || payload === '[DONE]') continue
    try {
      const event = JSON.parse(payload)
      if (event?.type === 'content_block_delta' && event?.delta?.type === 'text_delta') {
        text += event.delta.text ?? ''
      }
    } catch {
      // Ignore non-JSON keepalive lines from the web stream.
    }
  }
  return text
}

export async function claudeWebFetch(
  providerId: string,
  _input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  if (typeof init?.body !== 'string') throw new TypeError('Claude Web requires a JSON request body.')
  const body = JSON.parse(init.body) as Record<string, unknown>
  if (init.signal?.aborted) throw new DOMException('Claude Web request was aborted.', 'AbortError')
  const requestId = crypto.randomUUID()
  ensureListener()

  if (body.stream === true) {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const finished = completionPromise(requestId, controller)
        init.signal?.addEventListener(
          'abort',
          () => {
            handleStreamEvent({ requestId, type: 'error', error: 'Claude Web request was aborted.' })
            void window.api.claudeWeb.cancelCompletion(requestId)
          },
          { once: true }
        )
        void window.api.claudeWeb.complete({ providerId, requestId, body }).catch((error) => {
          handleStreamEvent({ requestId, type: 'error', error: error instanceof Error ? error.message : String(error) })
        })
        void finished.catch(() => {})
      },
      cancel() {
        pendingRequests.delete(requestId)
        void window.api.claudeWeb.cancelCompletion(requestId)
      }
    })
    return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
  }

  const finished = completionPromise(requestId)
  void window.api.claudeWeb.complete({ providerId, requestId, body }).catch((error) => {
    handleStreamEvent({ requestId, type: 'error', error: error instanceof Error ? error.message : String(error) })
  })
  if (init.signal) {
    init.signal.addEventListener(
      'abort',
      () => {
        handleStreamEvent({ requestId, type: 'error', error: 'Claude Web request was aborted.' })
        void window.api.claudeWeb.cancelCompletion(requestId)
      },
      { once: true }
    )
  }
  const raw = await finished
  const text = parseClaudeWebSseText(raw)
  return Response.json({
    id: requestId,
    type: 'message',
    role: 'assistant',
    model: body.model,
    content: [{ type: 'text', text }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 0, output_tokens: 0 }
  })
}
