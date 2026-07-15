import { loggerService } from '@logger'
import type {
  ClaudeWebCompletionRequest,
  ClaudeWebModel,
  ClaudeWebStatus,
  ClaudeWebStreamEvent
} from '@shared/claudeWeb'
import { IpcChannel } from '@shared/IpcChannel'
import { BrowserWindow, type Session, session, type WebContents } from 'electron'

import { parseClaudeWebAccount, parseClaudeWebModels, resolveClaudeWebThinking } from './claudeWebModels'

const logger = loggerService.withContext('ClaudeWebService')

const CLAUDE_ORIGIN = 'https://claude.ai'
const SYSTEM_SESSION_PARTITION = 'persist:claude-web'
const PROVIDER_MARKER_URL = 'https://claude-web.cherry-studio.local'
const PROVIDER_MARKER_COOKIE = 'claudeWebProviderId'
const LOGIN_POLL_INTERVAL_MS = 1500
const MAX_PROMPT_LENGTH = 2_000_000

type JsonObject = Record<string, any>

class ClaudeWebServiceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ClaudeWebServiceError'
  }
}

class ClaudeWebService {
  private readonly loginWindows = new Map<string, BrowserWindow>()
  private readonly completionControllers = new Map<string, AbortController>()
  private readonly modelCaches = new Map<string, { organizationId: string; models: Map<string, ClaudeWebModel> }>()

  private validateProviderId(providerId: string): string {
    if (typeof providerId !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(providerId)) {
      throw new TypeError('Claude Web providerId is invalid')
    }
    return providerId
  }

  private getSession(providerId: string): Session {
    const validProviderId = this.validateProviderId(providerId)
    const partition =
      validProviderId === 'claude-web' ? SYSTEM_SESSION_PARTITION : `persist:claude-web-${validProviderId}`
    return session.fromPartition(partition)
  }

  private async hasProviderMarker(providerId: string): Promise<boolean> {
    if (providerId === 'claude-web') return true
    const markers = await this.getSession(providerId).cookies.get({
      url: PROVIDER_MARKER_URL,
      name: PROVIDER_MARKER_COOKIE
    })
    return markers.some((cookie) => cookie.value === providerId)
  }

  private async prepareLoginSession(providerId: string): Promise<void> {
    if (providerId === 'claude-web' || (await this.hasProviderMarker(providerId))) return
    const providerSession = this.getSession(providerId)
    await providerSession.clearStorageData()
    await providerSession.cookies.set({
      url: PROVIDER_MARKER_URL,
      name: PROVIDER_MARKER_COOKIE,
      value: providerId,
      secure: true,
      expirationDate: Math.floor(Date.now() / 1000) + 10 * 365 * 24 * 60 * 60
    })
  }

  private claudeHeaders(extra?: Record<string, string>): Record<string, string> {
    return {
      Accept: 'application/json',
      Origin: CLAUDE_ORIGIN,
      Referer: `${CLAUDE_ORIGIN}/`,
      'anthropic-client-platform': 'web_claude_ai',
      'anthropic-client-version': '1.0.0',
      ...extra
    }
  }

  private async fetchJson(providerId: string, url: string, init?: RequestInit): Promise<unknown> {
    const response = await this.getSession(providerId).fetch(url, {
      ...init,
      headers: { ...this.claudeHeaders(), ...Object.fromEntries(new Headers(init?.headers).entries()) }
    })
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new ClaudeWebServiceError(`Claude Web request failed (${response.status}): ${detail.slice(0, 240)}`)
    }
    return response.json()
  }

  private async getOrganizationId(providerId: string): Promise<string> {
    const cookies = await this.getSession(providerId).cookies.get({ url: CLAUDE_ORIGIN, name: 'sessionKey' })
    if (cookies.length === 0) {
      throw new ClaudeWebServiceError('Sign in to Claude Web first.')
    }

    const organizations = await this.fetchJson(providerId, `${CLAUDE_ORIGIN}/api/organizations`)
    if (!Array.isArray(organizations))
      throw new ClaudeWebServiceError('Claude Web returned an invalid organization list.')
    const organization = organizations.find((item) => item && typeof item === 'object') as JsonObject | undefined
    const id = organization?.uuid ?? organization?.id
    if (typeof id !== 'string' || !id.trim()) {
      throw new ClaudeWebServiceError('No Claude Web organization was found for this account.')
    }
    return id
  }

  private async fetchBootstrap(providerId: string, organizationId: string): Promise<unknown> {
    const url =
      `${CLAUDE_ORIGIN}/edge-api/bootstrap/${encodeURIComponent(organizationId)}/app_start` +
      '?statsig_hashing_algorithm=djb2&growthbook_format=sdk&include_system_prompts=false'
    return this.fetchJson(providerId, url)
  }

  public getStatus = async (providerId: string): Promise<ClaudeWebStatus> => {
    try {
      this.validateProviderId(providerId)
      if (!(await this.hasProviderMarker(providerId))) return { available: false, email: '', plan: '' }
      const organizationId = await this.getOrganizationId(providerId)
      const bootstrap = await this.fetchBootstrap(providerId, organizationId)
      this.cacheModels(providerId, organizationId, bootstrap)
      return { available: true, ...parseClaudeWebAccount(bootstrap) }
    } catch {
      return { available: false, email: '', plan: '' }
    }
  }

  public startLogin = async (providerId: string): Promise<ClaudeWebStatus> => {
    this.validateProviderId(providerId)
    await this.prepareLoginSession(providerId)
    const currentLoginWindow = this.loginWindows.get(providerId)
    if (currentLoginWindow && !currentLoginWindow.isDestroyed()) {
      currentLoginWindow.focus()
      return new Promise((resolve, reject) => this.waitForLogin(providerId, currentLoginWindow, resolve, reject))
    }

    const loginWindow = new BrowserWindow({
      width: 1100,
      height: 780,
      title: 'Sign in to Claude Web',
      autoHideMenuBar: true,
      webPreferences: {
        partition: providerId === 'claude-web' ? SYSTEM_SESSION_PARTITION : `persist:claude-web-${providerId}`,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true
      }
    })
    this.loginWindows.set(providerId, loginWindow)
    await loginWindow.loadURL(`${CLAUDE_ORIGIN}/new`)

    return new Promise((resolve, reject) => this.waitForLogin(providerId, loginWindow, resolve, reject))
  }

  private waitForLogin(
    providerId: string,
    loginWindow: BrowserWindow,
    resolve: (status: ClaudeWebStatus) => void,
    reject: (error: Error) => void
  ): void {
    let settled = false
    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      clearInterval(timer)
      callback()
    }
    const timer = setInterval(async () => {
      const status = await this.getStatus(providerId)
      if (!status.available) return
      finish(() => {
        if (!loginWindow.isDestroyed()) loginWindow.close()
        resolve(status)
      })
    }, LOGIN_POLL_INTERVAL_MS)

    loginWindow.once('closed', () => {
      this.loginWindows.delete(providerId)
      finish(() => reject(new ClaudeWebServiceError('Claude Web sign-in was cancelled.')))
    })
  }

  public logout = async (providerId: string): Promise<void> => {
    this.modelCaches.delete(providerId)
    await this.getSession(providerId).clearStorageData()
  }

  public fetchModels = async (providerId: string): Promise<ClaudeWebModel[]> => {
    const organizationId = await this.getOrganizationId(providerId)
    const models = this.cacheModels(providerId, organizationId, await this.fetchBootstrap(providerId, organizationId))
    if (models.length === 0) throw new ClaudeWebServiceError('Claude Web did not return any available models.')
    return models
  }

  public cancelCompletion = (requestId: string): void => {
    this.completionControllers.get(requestId)?.abort()
  }

  public complete = async (sender: WebContents, request: ClaudeWebCompletionRequest): Promise<void> => {
    const { providerId, requestId, body } = this.validateCompletionRequest(request)
    const controller = new AbortController()
    this.completionControllers.set(requestId, controller)
    const emit = (event: ClaudeWebStreamEvent) => {
      if (!sender.isDestroyed()) sender.send(IpcChannel.ClaudeWeb_StreamEvent, event)
    }

    try {
      const organizationId = await this.getOrganizationId(providerId)
      const conversationId = crypto.randomUUID()
      const modelId = typeof body.model === 'string' ? body.model : ''
      const model = await this.getModel(providerId, organizationId, modelId)
      await this.createConversation(providerId, organizationId, conversationId, modelId, controller.signal)
      try {
        await this.streamConversation(
          providerId,
          organizationId,
          conversationId,
          body,
          model,
          controller.signal,
          (chunk) => {
            emit({ requestId, type: 'chunk', data: chunk })
          }
        )
      } finally {
        void this.deleteConversation(providerId, organizationId, conversationId)
      }
      emit({ requestId, type: 'done' })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error('Claude Web completion failed', error as Error)
      emit({ requestId, type: 'error', error: message })
    } finally {
      this.completionControllers.delete(requestId)
    }
  }

  private validateCompletionRequest(request: ClaudeWebCompletionRequest): ClaudeWebCompletionRequest {
    if (!request || typeof request !== 'object') throw new TypeError('Claude Web completion request must be an object')
    if (typeof request.requestId !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(request.requestId)) {
      throw new TypeError('Claude Web requestId is invalid')
    }
    this.validateProviderId(request.providerId)
    if (!request.body || typeof request.body !== 'object' || Array.isArray(request.body)) {
      throw new TypeError('Claude Web request body must be an object')
    }
    if (typeof request.body.model !== 'string' || !/^claude-[\w.-]+$/.test(request.body.model)) {
      throw new TypeError('Claude Web model is invalid')
    }
    return request
  }

  private async createConversation(
    providerId: string,
    organizationId: string,
    conversationId: string,
    model: string,
    signal: AbortSignal
  ): Promise<void> {
    const response = await this.getSession(providerId).fetch(
      `${CLAUDE_ORIGIN}/api/organizations/${encodeURIComponent(organizationId)}/chat_conversations`,
      {
        method: 'POST',
        headers: this.claudeHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ name: '', model, uuid: conversationId }),
        signal
      }
    )
    if (response.status !== 201) {
      throw new ClaudeWebServiceError(`Could not create a Claude Web conversation (${response.status}).`)
    }
  }

  private async deleteConversation(providerId: string, organizationId: string, conversationId: string): Promise<void> {
    await this.getSession(providerId)
      .fetch(
        `${CLAUDE_ORIGIN}/api/organizations/${encodeURIComponent(organizationId)}/chat_conversations/${conversationId}`,
        { method: 'DELETE', headers: this.claudeHeaders() }
      )
      .catch(() => {})
  }

  private async streamConversation(
    providerId: string,
    organizationId: string,
    conversationId: string,
    body: JsonObject,
    model: ClaudeWebModel,
    signal: AbortSignal,
    onChunk: (chunk: string) => void
  ): Promise<void> {
    const { prompt, images } = this.buildPrompt(body)
    const files = await this.uploadImages(providerId, organizationId, conversationId, images, signal)
    const requestedEffort = body.output_config?.effort ?? body.effort
    const thinking = resolveClaudeWebThinking(model, requestedEffort)
    const payload: JsonObject = {
      prompt,
      model: body.model,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Etc/UTC',
      locale: 'en-US',
      rendering_mode: 'messages',
      turn_message_uuids: {
        human_message_uuid: crypto.randomUUID(),
        assistant_message_uuid: crypto.randomUUID()
      },
      attachments: [],
      files,
      sync_sources: [],
      thinking_mode: thinking.thinkingMode
    }
    if (thinking.effort) payload.effort = thinking.effort

    const response = await this.getSession(providerId).fetch(
      `${CLAUDE_ORIGIN}/api/organizations/${encodeURIComponent(organizationId)}` +
        `/chat_conversations/${conversationId}/completion`,
      {
        method: 'POST',
        headers: this.claudeHeaders({ Accept: 'text/event-stream', 'Content-Type': 'application/json' }),
        body: JSON.stringify(payload),
        signal
      }
    )
    if (!response.ok || !response.body) {
      const detail = await response.text().catch(() => '')
      throw new ClaudeWebServiceError(`Claude Web completion failed (${response.status}): ${detail.slice(0, 240)}`)
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      onChunk(decoder.decode(value, { stream: true }))
    }
    const tail = decoder.decode()
    if (tail) onChunk(tail)
  }

  private cacheModels(providerId: string, organizationId: string, bootstrap: unknown): ClaudeWebModel[] {
    const models = parseClaudeWebModels(bootstrap)
    this.modelCaches.set(providerId, {
      organizationId,
      models: new Map(models.map((model) => [model.id, model]))
    })
    return models
  }

  private async getModel(providerId: string, organizationId: string, modelId: string): Promise<ClaudeWebModel> {
    let cache = this.modelCaches.get(providerId)
    if (cache?.organizationId !== organizationId || !cache.models.has(modelId)) {
      this.cacheModels(providerId, organizationId, await this.fetchBootstrap(providerId, organizationId))
      cache = this.modelCaches.get(providerId)
    }
    const model = cache?.models.get(modelId)
    if (!model) throw new ClaudeWebServiceError(`Claude Web model is not available: ${modelId}`)
    return model
  }

  private buildPrompt(body: JsonObject): { prompt: string; images: Array<{ mediaType: string; data: string }> } {
    const images: Array<{ mediaType: string; data: string }> = []
    const sections: string[] = []
    const system = this.contentToText(body.system, images)
    if (system) sections.push(`System: ${system}`)

    if (Array.isArray(body.messages)) {
      for (const message of body.messages) {
        if (!message || typeof message !== 'object') continue
        const role = message.role === 'assistant' ? 'Assistant' : 'Human'
        const content = this.contentToText(message.content, images)
        if (content) sections.push(`${role}: ${content}`)
      }
    }
    const prompt = sections.join('\n\n')
    if (!prompt.trim()) throw new ClaudeWebServiceError('Claude Web requires a non-empty prompt.')
    if (prompt.length > MAX_PROMPT_LENGTH) throw new ClaudeWebServiceError('Claude Web prompt is too large.')
    return { prompt, images }
  }

  private contentToText(content: unknown, images: Array<{ mediaType: string; data: string }>): string {
    if (typeof content === 'string') return content
    if (!Array.isArray(content)) return ''
    return content
      .flatMap((part): string[] => {
        if (!part || typeof part !== 'object') return []
        if (part.type === 'text' && typeof part.text === 'string') return [part.text]
        if (part.type === 'image' && part.source?.type === 'base64') {
          if (typeof part.source.media_type === 'string' && typeof part.source.data === 'string') {
            images.push({ mediaType: part.source.media_type, data: part.source.data })
            return ['[Image attached]']
          }
        }
        if (part.type === 'tool_use') return [`Tool call ${part.name ?? ''}: ${JSON.stringify(part.input ?? {})}`]
        if (part.type === 'tool_result') return [`Tool result: ${this.contentToText(part.content, images)}`]
        return []
      })
      .join('\n')
  }

  private async uploadImages(
    providerId: string,
    organizationId: string,
    conversationId: string,
    images: Array<{ mediaType: string; data: string }>,
    signal: AbortSignal
  ): Promise<string[]> {
    const files: string[] = []
    for (const [index, image] of images.entries()) {
      const bytes = Buffer.from(image.data, 'base64')
      const form = new FormData()
      form.append(
        'file',
        new Blob([bytes], { type: image.mediaType }),
        `image-${index + 1}.${this.imageExtension(image.mediaType)}`
      )
      form.append('orgUuid', organizationId)
      const response = await this.getSession(providerId).fetch(
        `${CLAUDE_ORIGIN}/api/${encodeURIComponent(organizationId)}/upload`,
        {
          method: 'POST',
          headers: this.claudeHeaders({ Referer: `${CLAUDE_ORIGIN}/chat/${conversationId}` }),
          body: form,
          signal
        }
      )
      if (!response.ok) throw new ClaudeWebServiceError(`Claude Web image upload failed (${response.status}).`)
      const result = (await response.json()) as JsonObject
      const id = result.file_uuid ?? result.uuid ?? (typeof result === 'string' ? result : undefined)
      if (typeof id !== 'string') throw new ClaudeWebServiceError('Claude Web image upload returned no file id.')
      files.push(id)
    }
    return files
  }

  private imageExtension(mediaType: string): string {
    return { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp' }[mediaType] ?? 'img'
  }
}

export default new ClaudeWebService()
