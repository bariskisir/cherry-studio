import os from 'node:os'

import { loggerService } from '@logger'
import type {
  AntigravityAuthOptions,
  AntigravityBucket,
  AntigravityCredentials,
  AntigravityGroup,
  AntigravityQuota,
  AntigravityStatus,
  CliProviderModel
} from '@shared/cliProvider'
import { net } from 'electron'

import { AntigravityCredentialStore } from './AntigravityCredentialStore'
import { parseAntigravityModelsResponse } from './cliProviderModels'
import { readJwtClaim } from './jwtUtils'

const logger = loggerService.withContext('AntigravityService')

const API_BASE = 'https://daily-cloudcode-pa.googleapis.com'
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
const OAUTH_CLIENT_ID = '1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com'
const OAUTH_CLIENT_SECRET = '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'
const DEFAULT_CLI_VERSION = '1.0.14'
const EXPIRY_BUFFER_MS = 5 * 60 * 1000

interface AntigravityAuth {
  accessToken: string
  refreshToken: string
  expiry: number
  idToken: string
  email: string
}

class AntigravityServiceError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown
  ) {
    super(message)
    this.name = 'AntigravityServiceError'
  }
}

class AntigravityService {
  private auth: AntigravityAuth | null = null
  private projectId = ''
  private plan = ''
  private cliVersion = ''
  private readonly refreshPromises = new Map<string, Promise<void>>()
  private readonly credentialStore = new AntigravityCredentialStore()
  private skipRefreshOverride = false

  public getUserAgent = (): string => {
    const version = this.cliVersion || DEFAULT_CLI_VERSION
    return `antigravity/cli/${version} (aidev_client; os_type=${os.platform()}; arch=${os.arch()}; auth_method=consumer)`
  }

  private parseCredentialValue = (input: unknown): AntigravityAuth | null => {
    try {
      const value = typeof input === 'string' ? JSON.parse(input.replace(/^\uFEFF/, '')) : input
      if (!value || typeof value !== 'object') return null
      const token = value?.token
      const accessToken: string = token?.access_token ?? ''
      if (!accessToken) return null
      const idToken: string = token?.id_token ?? ''
      const expiryStr: string = token?.expiry ?? ''
      const expiry = expiryStr ? Date.parse(expiryStr) : 0
      return {
        accessToken,
        refreshToken: token?.refresh_token ?? '',
        expiry: Number.isNaN(expiry) ? 0 : expiry,
        idToken,
        email: idToken ? readJwtClaim(idToken, 'email') : readJwtClaim(accessToken, 'email')
      }
    } catch {
      return null
    }
  }

  private readRawCredentials = async (): Promise<AntigravityAuth> => {
    const raw = await this.credentialStore.read()
    const auth = raw ? this.parseCredentialValue(raw) : null
    if (auth) return auth

    throw new AntigravityServiceError(
      'Antigravity credentials not found. Please sign in with the Antigravity/Gemini CLI first.'
    )
  }

  private refreshTokens = async (auth: AntigravityAuth): Promise<void> => {
    if (!auth.refreshToken) return
    logger.info('Refreshing Antigravity access token')
    const body = new URLSearchParams({
      client_id: OAUTH_CLIENT_ID,
      client_secret: OAUTH_CLIENT_SECRET,
      refresh_token: auth.refreshToken,
      grant_type: 'refresh_token'
    })
    const response = await net.fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: body.toString()
    })
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new AntigravityServiceError(`Antigravity token refresh failed (${response.status}): ${detail}`)
    }
    const data: any = await response.json()
    if (data.access_token) auth.accessToken = data.access_token
    if (typeof data.expires_in === 'number') auth.expiry = Date.now() + data.expires_in * 1000
    if (data.refresh_token) auth.refreshToken = data.refresh_token
    if (data.id_token) {
      auth.idToken = data.id_token
      auth.email = readJwtClaim(data.id_token, 'email') || auth.email
    }
    await this.persistCredentials(auth)
  }

  private persistCredentials = async (auth: AntigravityAuth): Promise<void> => {
    try {
      const payload = {
        token: {
          access_token: auth.accessToken,
          refresh_token: auth.refreshToken,
          token_type: 'Bearer',
          expiry: auth.expiry ? new Date(auth.expiry).toISOString() : undefined,
          id_token: auth.idToken || undefined
        },
        auth_method: 'consumer'
      }
      await this.credentialStore.write(JSON.stringify(payload))
    } catch (error) {
      logger.warn('Could not persist refreshed Antigravity credentials', error as Error)
    }
  }

  private ensureAuth = async (options?: { skipRefresh?: boolean }): Promise<AntigravityAuth> => {
    if (!this.auth) {
      this.auth = await this.readRawCredentials()
      this.projectId = ''
      this.plan = ''
    }

    const skipRefresh = options?.skipRefresh ?? this.skipRefreshOverride
    if (skipRefresh) return this.auth
    const expired = this.auth.expiry > 0 && Date.now() >= this.auth.expiry - EXPIRY_BUFFER_MS
    if (expired && this.auth.refreshToken) {
      const auth = this.auth
      let refreshPromise = this.refreshPromises.get('native')
      if (!refreshPromise) {
        refreshPromise = this.refreshTokens(auth).finally(() => {
          this.refreshPromises.delete('native')
        })
        this.refreshPromises.set('native', refreshPromise)
      }
      try {
        await refreshPromise
      } catch (error) {
        logger.error('Antigravity token refresh failed, using existing token', error as Error)
      }
    }
    return this.auth
  }

  private ensureProject = async (accessToken: string): Promise<void> => {
    if (this.projectId) return
    await this.ensureCliVersion()
    const response = await net.fetch(`${API_BASE}/v1internal:loadCodeAssist`, {
      method: 'POST',
      headers: this.apiHeaders(accessToken),
      body: JSON.stringify({ metadata: { ideType: 'ANTIGRAVITY' } })
    })
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new AntigravityServiceError(`Antigravity project fetch failed (${response.status}): ${detail}`)
    }
    const data: any = await response.json()
    const projectId: string = data?.cloudaicompanionProject ?? ''
    if (!projectId) {
      throw new AntigravityServiceError('Antigravity project response is missing a project id.')
    }
    this.projectId = projectId
    const tierId: string = data?.currentTier?.id ?? ''
    this.plan = this.formatPlan(tierId)
  }

  private formatPlan = (tierId: string): string => {
    const first = (tierId.split('-')[0] || tierId).trim()
    return first ? first.charAt(0).toUpperCase() + first.slice(1) : ''
  }

  private ensureCliVersion = async (): Promise<void> => {
    if (this.cliVersion) return
    try {
      const response = await net.fetch(
        'https://api.github.com/repos/google-antigravity/antigravity-cli/releases/latest',
        { method: 'GET', headers: { 'User-Agent': 'cherry-studio', Accept: 'application/json' } }
      )
      if (response.ok) {
        const data: any = await response.json()
        const tag = data?.tag_name
        if (typeof tag === 'string' && tag.trim()) {
          this.cliVersion = tag.trim().replace(/^v/, '')
        }
      }
    } catch (error) {
      logger.warn('Could not fetch Antigravity CLI version, using default', error as Error)
    }
    if (!this.cliVersion) {
      this.cliVersion = DEFAULT_CLI_VERSION
    }
  }

  private apiHeaders = (accessToken: string): Record<string, string> => ({
    Accept: 'application/json',
    'Content-Type': 'application/json',
    Authorization: `Bearer ${accessToken}`,
    'User-Agent': this.getUserAgent()
  })

  public setSkipRefresh = (value: boolean): void => {
    this.skipRefreshOverride = value
  }

  public getCredentials = async (): Promise<AntigravityCredentials> => {
    const auth = await this.ensureAuth({ skipRefresh: this.skipRefreshOverride })
    await this.ensureProject(auth.accessToken)
    return { accessToken: auth.accessToken, projectId: this.projectId, userAgent: this.getUserAgent() }
  }

  public getStatus = async (): Promise<AntigravityStatus> => {
    try {
      const auth = await this.ensureAuth()
      await this.ensureProject(auth.accessToken)
      return { available: true, email: auth.email, projectId: this.projectId, plan: this.plan }
    } catch {
      return { available: false, email: '', projectId: '', plan: '' }
    }
  }

  public getQuota = async (options?: AntigravityAuthOptions): Promise<AntigravityQuota> => {
    try {
      const skipRefresh = options?.refreshToken === false
      const auth = await this.ensureAuth({ skipRefresh })
      await this.ensureProject(auth.accessToken)

      const response = await net.fetch(`${API_BASE}/v1internal:retrieveUserQuotaSummary`, {
        method: 'POST',
        headers: this.apiHeaders(auth.accessToken),
        body: JSON.stringify({ project: this.projectId })
      })

      if (!response.ok) {
        throw new AntigravityServiceError(`Antigravity quota request failed (${response.status})`)
      }

      const data: any = await response.json()
      const groups: AntigravityGroup[] = []

      if (data?.groups && Array.isArray(data.groups)) {
        for (const group of data.groups) {
          const displayName = (group.displayName || '').replace(/Models$/i, '').trim()
          const buckets: AntigravityBucket[] = []

          if (group?.buckets && Array.isArray(group.buckets)) {
            for (const bucket of group.buckets) {
              const remainingFraction = bucket.remainingFraction
              if (remainingFraction == null) continue
              const window = (bucket.window || '').replace(/^\w/, (c: string) => c.toUpperCase())
              const usedPercent = Math.min(Math.max((1 - remainingFraction) * 100, 0), 100)
              const resetTime = bucket.resetTime ?? null
              buckets.push({ window, usedPercent, resetTime })
            }
          }

          if (buckets.length > 0) {
            groups.push({ displayName, buckets })
          }
        }
      }

      return {
        available: true,
        email: auth.email,
        plan: this.plan,
        projectId: this.projectId,
        groups,
        expiresAt: auth.expiry > 0 ? auth.expiry : null,
        hasRefreshToken: !!auth.refreshToken
      }
    } catch {
      return {
        available: false,
        email: '',
        plan: '',
        projectId: '',
        groups: [],
        expiresAt: null,
        hasRefreshToken: false
      }
    }
  }

  public fetchModels = async (): Promise<CliProviderModel[]> => {
    const auth = await this.ensureAuth()
    await this.ensureProject(auth.accessToken)
    const response = await net.fetch(`${API_BASE}/v1internal:fetchAvailableModels`, {
      method: 'POST',
      headers: this.apiHeaders(auth.accessToken),
      body: JSON.stringify({ project: this.projectId })
    })
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new AntigravityServiceError(`Antigravity models request failed (${response.status}): ${detail}`)
    }
    const models = parseAntigravityModelsResponse(await response.json())
    if (!models) {
      throw new AntigravityServiceError('Antigravity models response is missing a model list.')
    }
    return models
  }
}

export default new AntigravityService()
