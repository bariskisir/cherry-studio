import { formatPrivateKey, hasProviderConfig, type StringKeys } from '@cherrystudio/ai-core/provider'
import { loggerService } from '@logger'
import type { AppProviderId, AppProviderSettingsMap } from '@renderer/aiCore/types'
import {
  getAwsBedrockAccessKeyId,
  getAwsBedrockApiKey,
  getAwsBedrockAuthType,
  getAwsBedrockRegion,
  getAwsBedrockSecretAccessKey
} from '@renderer/hooks/useAwsBedrock'
import { createVertexProvider, isVertexAIConfigured } from '@renderer/hooks/useVertexAI'
import { getProviderByModel } from '@renderer/services/AssistantService'
import { getProviderById } from '@renderer/services/ProviderService'
import store from '@renderer/store'
import { type Model, type Provider, SystemProviderIds } from '@renderer/types'
import {
  formatApiHost,
  formatOllamaApiHost,
  formatVertexApiHost,
  isWithTrailingSharp,
  routeToEndpoint
} from '@renderer/utils/api'
import {
  isAnthropicProvider,
  isAntigravityProvider,
  isAzureOpenAIProvider,
  isCherryAIProvider,
  isClaudeCodeProvider,
  isCodexProvider,
  isGeminiProvider,
  isOllamaProvider,
  isPerplexityProvider,
  isSupportStreamOptionsProvider,
  isVertexProvider
} from '@renderer/utils/provider'
import { defaultAppHeaders } from '@shared/utils'
import { cloneDeep, isEmpty } from 'lodash'

import type { ProviderConfig } from '../types'
import { CLAUDE_CODE_OAUTH_BETA, patchCodexRequestBody, transformAntigravityStream } from './cliProviderAdapters'
import { COPILOT_DEFAULT_HEADERS } from './constants'
import { getAiSdkProviderId } from './factory'

const logger = loggerService.withContext('ProviderConfig')

// === Types ===

interface BaseConfig {
  baseURL: string
  apiKey: string
}

interface BuilderContext {
  actualProvider: Provider
  model: Model
  baseConfig: BaseConfig
  endpoint?: string
  aiSdkProviderId: AppProviderId
}

// === Host Formatting ===

type HostFormatter = {
  match: (provider: Provider) => boolean
  format: (provider: Provider, appendApiVersion: boolean) => string
}

// WARNING: if any changes are made here, please sync it to src/main/aiCore/provider/providerConfig.ts:formatProviderApiHost
export function formatProviderApiHost(provider: Provider): Provider {
  const formatted = { ...provider }
  const appendApiVersion = !isWithTrailingSharp(provider.apiHost)

  if (formatted.anthropicApiHost) {
    formatted.anthropicApiHost = formatApiHost(formatted.anthropicApiHost, appendApiVersion)
  }

  // Anthropic is special: uses anthropicApiHost as source and syncs both fields
  if (isAnthropicProvider(provider)) {
    const baseHost = formatted.anthropicApiHost || formatted.apiHost
    formatted.apiHost = formatApiHost(baseHost, appendApiVersion)
    if (!formatted.anthropicApiHost) {
      formatted.anthropicApiHost = formatted.apiHost
    }
    return formatted
  }

  const formatters: HostFormatter[] = [
    {
      match: (p) => p.id === SystemProviderIds.copilot || p.id === SystemProviderIds.github,
      format: (p) => formatApiHost(p.apiHost, false)
    },
    { match: isCherryAIProvider, format: (p) => formatApiHost(p.apiHost, false) },
    { match: isPerplexityProvider, format: (p) => formatApiHost(p.apiHost, false) },
    { match: isCodexProvider, format: (p) => formatApiHost(p.apiHost, false) },
    { match: isAntigravityProvider, format: (p) => formatApiHost(p.apiHost, false) },
    { match: isClaudeCodeProvider, format: (p) => formatApiHost(p.apiHost, false) },
    { match: isOllamaProvider, format: (p) => formatOllamaApiHost(p.apiHost) },
    { match: isGeminiProvider, format: (p, av) => formatApiHost(p.apiHost, av, 'v1beta') },
    { match: isAzureOpenAIProvider, format: (p) => formatApiHost(p.apiHost, false) },
    { match: isVertexProvider, format: (p) => formatVertexApiHost(p as Parameters<typeof formatVertexApiHost>[0]) }
  ]

  const formatter = formatters.find((f) => f.match(provider))
  formatted.apiHost = formatter
    ? formatter.format(formatted, appendApiVersion)
    : formatApiHost(formatted.apiHost, appendApiVersion)

  return formatted
}

// === SDK Config Building ===

type ConfigBuilderEntry = {
  match: (provider: Provider, aiSdkProviderId: AppProviderId) => boolean
  build: (ctx: BuilderContext) => ProviderConfig | Promise<ProviderConfig>
}

export function providerToAiSdkConfig(
  actualProvider: Provider,
  model: Model
): ProviderConfig | Promise<ProviderConfig> {
  const aiSdkProviderId = getAiSdkProviderId(actualProvider)
  const { baseURL, endpoint } = routeToEndpoint(actualProvider.apiHost)

  const ctx: BuilderContext = {
    actualProvider,
    model,
    baseConfig: { baseURL, apiKey: actualProvider.apiKey },
    endpoint,
    aiSdkProviderId
  }

  const builders: ConfigBuilderEntry[] = [
    { match: (p) => p.id === SystemProviderIds.copilot, build: buildCopilotConfig },
    { match: (p) => p.id === 'cherryai', build: buildCherryAIConfig },
    { match: (p) => isCodexProvider(p), build: buildCodexConfig },
    { match: (p) => isAntigravityProvider(p), build: buildAntigravityConfig },
    { match: (p) => isClaudeCodeProvider(p), build: buildClaudeCodeConfig },
    { match: (p) => p.id === 'anthropic' && p.authType === 'oauth', build: buildAnthropicConfig },
    { match: (p) => isOllamaProvider(p), build: buildOllamaConfig },
    { match: (p) => isAzureOpenAIProvider(p), build: buildAzureConfig },
    { match: (_, id) => id === 'bedrock', build: buildBedrockConfig },
    { match: (_, id) => id === 'google-vertex', build: buildVertexConfig },
    { match: (_, id) => id === 'cherryin', build: buildCherryinConfig },
    { match: (_, id) => id === 'newapi', build: buildNewApiConfig },
    { match: (_, id) => id === 'aihubmix', build: buildAiHubMixConfig }
  ]

  const builder = builders.find((b) => b.match(actualProvider, aiSdkProviderId))
  if (builder) {
    return builder.build(ctx)
  }

  // SDK-supported provider → generic config; otherwise → openai-compatible fallback
  if (hasProviderConfig(aiSdkProviderId) && aiSdkProviderId !== 'openai-compatible') {
    return buildGenericProviderConfig(ctx)
  }
  return buildOpenAICompatibleConfig(ctx)
}

// === Public API ===

export function getActualProvider(model: Model): Provider {
  return adaptProvider({ provider: getProviderByModel(model), model })
}

export function adaptProvider({ provider }: { provider: Provider; model?: Model }): Provider {
  return formatProviderApiHost(cloneDeep(provider))
}

export function isModernSdkSupported(provider: Provider): boolean {
  return hasProviderConfig(getAiSdkProviderId(provider))
}

// === Config Builders ===

function buildCommonOptions(ctx: BuilderContext) {
  const options: Record<string, any> = {
    headers: {
      ...defaultAppHeaders(),
      ...ctx.actualProvider.extra_headers
    }
  }
  if (ctx.aiSdkProviderId === 'openai') {
    options.headers['X-Api-Key'] = ctx.baseConfig.apiKey
  }
  return options
}

async function buildCopilotConfig(ctx: BuilderContext): Promise<ProviderConfig<'github-copilot-openai-compatible'>> {
  const storedHeaders = store.getState().copilot.defaultHeaders ?? {}
  const headers = { ...COPILOT_DEFAULT_HEADERS, ...storedHeaders }
  const { token } = await window.api.copilot.getToken(headers)

  return {
    providerId: 'github-copilot-openai-compatible',
    endpoint: ctx.endpoint,
    providerSettings: {
      ...ctx.baseConfig,
      apiKey: token,
      headers: { ...headers, ...ctx.actualProvider.extra_headers },
      name: ctx.actualProvider.id
    }
  }
}

function buildOllamaConfig(ctx: BuilderContext): ProviderConfig<'ollama'> {
  const headers: ProviderConfig<'ollama'>['providerSettings']['headers'] = {
    ...defaultAppHeaders(),
    ...ctx.actualProvider.extra_headers
  }
  if (!isEmpty(ctx.baseConfig.apiKey)) {
    headers.Authorization = `Bearer ${ctx.baseConfig.apiKey}`
  }

  return {
    providerId: 'ollama',
    endpoint: ctx.endpoint,
    providerSettings: { ...ctx.baseConfig, headers }
  }
}

function buildBedrockConfig(ctx: BuilderContext): ProviderConfig<'bedrock'> {
  const authType = getAwsBedrockAuthType()
  const region = getAwsBedrockRegion().trim() || undefined

  const base = { providerId: 'bedrock' as const, endpoint: ctx.endpoint }

  const baseURL = ctx.baseConfig.baseURL || undefined

  if (authType === 'apiKey') {
    return { ...base, providerSettings: { ...ctx.baseConfig, baseURL, region, apiKey: getAwsBedrockApiKey() } }
  }
  return {
    ...base,
    providerSettings: {
      ...ctx.baseConfig,
      baseURL,
      region,
      accessKeyId: getAwsBedrockAccessKeyId(),
      secretAccessKey: getAwsBedrockSecretAccessKey()
    }
  }
}

function buildVertexConfig(
  ctx: BuilderContext
): ProviderConfig<'google-vertex'> | ProviderConfig<'google-vertex-anthropic'> {
  if (!isVertexAIConfigured()) {
    throw new Error('VertexAI is not configured. Please configure project, location and service account credentials.')
  }

  const { project, location, googleCredentials } = createVertexProvider(ctx.actualProvider)
  // Vertex 上的 Claude 模型走 google-vertex-anthropic variant
  const isAnthropic = ctx.aiSdkProviderId === 'google-vertex-anthropic' || ctx.model.id.startsWith('claude')
  const baseURL = ctx.baseConfig.baseURL + (isAnthropic ? '/publishers/anthropic/models' : '/publishers/google')
  const creds = { ...googleCredentials, privateKey: formatPrivateKey(googleCredentials.privateKey) }

  return {
    providerId: isAnthropic ? 'google-vertex-anthropic' : 'google-vertex',
    endpoint: ctx.endpoint,
    providerSettings: { ...ctx.baseConfig, baseURL, project, location, googleCredentials: creds }
  } as ProviderConfig<'google-vertex'> | ProviderConfig<'google-vertex-anthropic'>
}

function buildCherryinConfig(ctx: BuilderContext): ProviderConfig<'cherryin'> {
  const cherryinProvider = getProviderById(SystemProviderIds.cherryin)

  return {
    providerId: 'cherryin',
    endpoint: ctx.endpoint,
    providerSettings: {
      ...ctx.baseConfig,
      endpointType: ctx.model.endpoint_type,
      anthropicBaseURL: cherryinProvider ? cherryinProvider.anthropicApiHost + '/v1' : undefined,
      geminiBaseURL: cherryinProvider ? cherryinProvider.apiHost + '/v1beta' : undefined,
      headers: { ...defaultAppHeaders(), ...ctx.actualProvider.extra_headers }
    }
  }
}

async function buildCherryAIConfig(ctx: BuilderContext): Promise<ProviderConfig<'openai-compatible'>> {
  return {
    providerId: 'openai-compatible',
    endpoint: ctx.endpoint,
    providerSettings: {
      ...ctx.baseConfig,
      name: ctx.actualProvider.id,
      headers: { ...defaultAppHeaders(), ...ctx.actualProvider.extra_headers },
      fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
        const signature = await window.api.cherryai.generateSignature({
          method: 'POST',
          path: '/chat/completions',
          query: '',
          body: init?.body && typeof init.body === 'string' ? JSON.parse(init.body) : undefined
        })
        return fetch(input, { ...init, headers: { ...init?.headers, ...signature } })
      }
    }
  }
}

// ChatGPT backend endpoint used by the Codex CLI (OpenAI Responses API).
const CODEX_BASE_URL = 'https://chatgpt.com/backend-api/codex'

/**
 * Builds the Codex provider config.
 *
 * Codex talks to the ChatGPT backend using the OpenAI Responses API, authenticating with
 * the OAuth token maintained by the official Codex CLI in `~/.codex/auth.json`. The token
 * and account id are read fresh from disk on every request (via IPC), mirroring the CLI's
 * "no in-app login" model. The request body is patched to always disable server-side
 * storage and to guarantee a non-empty `instructions` field, as the backend requires.
 */
async function buildCodexConfig(ctx: BuilderContext): Promise<ProviderConfig<'openai'>> {
  const { accessToken, accountId } = await window.api.codex.getCredentials()

  const headers: Record<string, string> = {
    originator: 'codex_cli_rs',
    'OpenAI-Beta': 'responses=experimental',
    ...ctx.actualProvider.extra_headers
  }
  if (accountId) {
    headers['chatgpt-account-id'] = accountId
  }

  return {
    providerId: 'openai',
    endpoint: ctx.endpoint,
    providerSettings: {
      baseURL: ctx.baseConfig.baseURL || CODEX_BASE_URL,
      apiKey: accessToken,
      headers,
      fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
        init = { ...init, body: patchCodexRequestBody(init?.body) }
        const response = await fetch(input, init)
        if (!response.ok) {
          response
            .clone()
            .text()
            .then((text) => logger.error(`Codex API request failed (${response.status}): ${text}`))
            .catch(() => {})
        }
        return response
      }
    }
  }
}

// Google Cloud Code (Gemini Code Assist) endpoint used by the Antigravity CLI.
const ANTIGRAVITY_API_BASE = 'https://daily-cloudcode-pa.googleapis.com'

/**
 * Builds the Antigravity provider config.
 *
 * Antigravity talks to Google's Cloud Code (Gemini Code Assist) API using OAuth
 * credentials maintained by the local Gemini/Antigravity CLI. It maps to the AI SDK
 * Google provider, then a custom `fetch` rewrites the request URL to the Cloud Code
 * endpoint, wraps the Gemini request body in the Cloud Code envelope
 * (`{ project, request, model, ... }`), and unwraps the `response` envelope from the
 * streamed result. The access token and project id are read via IPC and cached in the
 * main process.
 */
async function buildAntigravityConfig(ctx: BuilderContext): Promise<ProviderConfig<'google'>> {
  const { accessToken, projectId } = await window.api.antigravity.getCredentials()

  return {
    providerId: 'google',
    endpoint: ctx.endpoint,
    providerSettings: {
      baseURL: `${ANTIGRAVITY_API_BASE}/v1beta`,
      apiKey: accessToken || 'antigravity-oauth',
      fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
        const urlString = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
        const isStream = urlString.includes(':streamGenerateContent')

        const modelMatch = urlString.match(/\/models\/([^:/?]+):/)
        const modelId = modelMatch ? decodeURIComponent(modelMatch[1]) : ctx.model.id

        let outgoingBody = init?.body
        if (init?.body && typeof init.body === 'string') {
          try {
            const geminiRequest = JSON.parse(init.body)
            geminiRequest.sessionId = geminiRequest.sessionId || `-${Date.now()}`
            outgoingBody = JSON.stringify({
              model: modelId,
              project: projectId,
              requestId: `chat-${crypto.randomUUID()}`,
              userAgent: 'antigravity',
              requestType: 'checkpoint',
              request: geminiRequest
            })
          } catch {
            // Leave the body untouched if it is not JSON.
          }
        }

        const method = isStream ? 'streamGenerateContent' : 'generateContent'
        const newUrl = `${ANTIGRAVITY_API_BASE}/v1internal:${method}${isStream ? '?alt=sse' : ''}`

        const headers: Record<string, string> = {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          Accept: isStream ? 'text/event-stream' : 'application/json',
          ...ctx.actualProvider.extra_headers
        }

        const response = await fetch(newUrl, { ...init, method: 'POST', headers, body: outgoingBody })
        if (!response.ok) {
          response
            .clone()
            .text()
            .then((text) => logger.error(`Antigravity API request failed (${response.status}) at ${newUrl}: ${text}`))
            .catch(() => {})
          return response
        }

        // Unwrap the Cloud Code `response` envelope for the AI SDK Google parser.
        if (isStream && response.body) {
          return new Response(transformAntigravityStream(response.body), {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers
          })
        }
        const json = await response.json().catch(() => null)
        const unwrapped = json && typeof json === 'object' && 'response' in json ? json.response : json
        return new Response(JSON.stringify(unwrapped), {
          status: response.status,
          statusText: response.statusText,
          headers: { 'Content-Type': 'application/json' }
        })
      }
    }
  }
}

/**
 * Builds the Claude Code provider config.
 *
 * Claude Code talks to the Anthropic API using an OAuth token maintained by the local
 * Claude Code CLI (`~/.claude/.credentials.json`), read (and refreshed) via IPC. It
 * maps to the AI SDK Anthropic provider; a custom `fetch` injects the OAuth bearer
 * token and guarantees the `oauth-2025-04-20` beta header is present. The required
 * "You are Claude Code" system prompt is injected in `AiProvider.completions`.
 */
async function buildClaudeCodeConfig(ctx: BuilderContext): Promise<ProviderConfig<'anthropic'>> {
  const { accessToken } = await window.api.claudeCode.getCredentials()

  return {
    providerId: 'anthropic',
    endpoint: ctx.endpoint,
    providerSettings: {
      baseURL: 'https://api.anthropic.com/v1',
      apiKey: '',
      headers: {
        'anthropic-version': '2023-06-01',
        'anthropic-beta': CLAUDE_CODE_OAUTH_BETA,
        'anthropic-dangerous-direct-browser-access': 'true',
        Authorization: `Bearer ${accessToken}`,
        ...ctx.actualProvider.extra_headers
      },
      fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
        const headers = new Headers(init?.headers)
        headers.delete('x-api-key')
        headers.set('Authorization', `Bearer ${accessToken}`)
        const existingBeta = headers.get('anthropic-beta')
        const betas = new Set((existingBeta ? existingBeta.split(',') : []).map((b) => b.trim()).filter(Boolean))
        betas.add(CLAUDE_CODE_OAUTH_BETA)
        headers.set('anthropic-beta', Array.from(betas).join(','))
        const response = await fetch(input, { ...init, headers })
        if (!response.ok) {
          response
            .clone()
            .text()
            .then((text) => logger.error(`Claude Code API request failed (${response.status}): ${text}`))
            .catch(() => {})
        }
        return response
      }
    }
  }
}

function formatAzureBaseURL(baseURL: string, forAnthropic: boolean): string {
  // Normalize: strip trailing /v1 and /openai that user may have included
  const normalized = baseURL.replace(/\/v1$/, '').replace(/\/openai$/, '')
  // Azure OpenAI endpoints need /openai suffix; Azure Anthropic does not
  return forAnthropic ? normalized : normalized + '/openai'
}

function buildAzureConfig(
  ctx: BuilderContext
): ProviderConfig<'azure'> | ProviderConfig<'azure-responses'> | ProviderConfig<'azure-anthropic'> {
  // Azure 上的 Claude 模型走 azure-anthropic variant（内部使用 Anthropic SDK）
  if (ctx.model.id.startsWith('claude')) {
    return {
      providerId: 'azure-anthropic',
      endpoint: ctx.endpoint,
      providerSettings: {
        ...ctx.baseConfig,
        baseURL: formatAzureBaseURL(ctx.baseConfig.baseURL, true),
        headers: { ...defaultAppHeaders(), ...ctx.actualProvider.extra_headers }
      }
    }
  }

  const apiVersion = ctx.actualProvider.apiVersion?.trim()
  const useResponsesMode = apiVersion && ['preview', 'v1'].includes(apiVersion)

  const providerSettings: ProviderConfig<'azure'>['providerSettings'] = {
    ...ctx.baseConfig,
    baseURL: formatAzureBaseURL(ctx.baseConfig.baseURL, false),
    headers: { ...defaultAppHeaders(), ...ctx.actualProvider.extra_headers }
  }

  if (apiVersion) {
    providerSettings.apiVersion = apiVersion
    if (!useResponsesMode) {
      providerSettings.useDeploymentBasedUrls = true
    }
  }

  return {
    providerId: useResponsesMode ? 'azure-responses' : 'azure',
    endpoint: ctx.endpoint,
    providerSettings
  } as ProviderConfig<'azure'> | ProviderConfig<'azure-responses'>
}

async function buildAnthropicConfig(ctx: BuilderContext): Promise<ProviderConfig<'anthropic'>> {
  const oauthToken: string = await window.api.anthropic_oauth.getAccessToken()

  return {
    providerId: 'anthropic',
    endpoint: ctx.endpoint,
    providerSettings: {
      baseURL: 'https://api.anthropic.com/v1',
      apiKey: '',
      headers: {
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
        Authorization: `Bearer ${oauthToken}`
      }
    }
  }
}

function buildOpenAICompatibleConfig(ctx: BuilderContext): ProviderConfig<'openai-compatible'> {
  const commonOptions = buildCommonOptions(ctx)
  const includeUsage = isSupportStreamOptionsProvider(ctx.actualProvider)
    ? store.getState().settings.openAI?.streamOptions?.includeUsage
    : undefined

  return {
    providerId: 'openai-compatible',
    endpoint: ctx.endpoint,
    providerSettings: { ...ctx.baseConfig, ...commonOptions, name: ctx.actualProvider.id, includeUsage }
  }
}

function buildGenericProviderConfig(ctx: BuilderContext): ProviderConfig {
  const commonOptions = buildCommonOptions(ctx)

  return {
    providerId: ctx.aiSdkProviderId as StringKeys<AppProviderSettingsMap>,
    endpoint: ctx.endpoint,
    providerSettings: { ...ctx.baseConfig, ...commonOptions }
  }
}

function buildAiHubMixConfig(ctx: BuilderContext): ProviderConfig<'aihubmix'> {
  return {
    providerId: 'aihubmix',
    endpoint: ctx.endpoint,
    providerSettings: {
      ...ctx.baseConfig,
      headers: { ...defaultAppHeaders(), ...ctx.actualProvider.extra_headers }
    }
  }
}

function formatNewApiBaseURL(baseURL: string, endpointType?: string): string {
  switch (endpointType) {
    case 'gemini':
      return formatApiHost(baseURL, true, 'v1beta')
    case 'anthropic':
      return formatApiHost(baseURL, false)
    default:
      return formatApiHost(baseURL, true)
  }
}

function buildNewApiConfig(ctx: BuilderContext): ProviderConfig<'newapi'> {
  const endpointType = ctx.model.endpoint_type
  let rawBaseURL: string

  if (endpointType === 'anthropic' && ctx.actualProvider.anthropicApiHost) {
    rawBaseURL = ctx.actualProvider.anthropicApiHost
  } else {
    rawBaseURL = ctx.baseConfig.baseURL
  }

  const baseURL = formatNewApiBaseURL(rawBaseURL, endpointType)

  return {
    providerId: 'newapi',
    endpoint: ctx.endpoint,
    providerSettings: {
      ...ctx.baseConfig,
      baseURL,
      endpointType,
      headers: { ...defaultAppHeaders(), ...ctx.actualProvider.extra_headers }
    }
  }
}
