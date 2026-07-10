import { loggerService } from '@logger'
import type {
  CliAuthFileOptions,
  CliProviderModel,
  CodexCredentials,
  CodexQuota,
  CodexStatus
} from '@shared/cliProvider'
import { app, net } from 'electron'
import os from 'os'
import path from 'path'

import { readJsonFile, writeJsonFile } from './fileUtils'
import { getJwtExpiry, readJwtClaim } from './jwtUtils'

const logger = loggerService.withContext('CodexService')

const CODEX_DIR = '.codex'
const AUTH_FILE_NAME = 'auth.json'

const TOKEN_ENDPOINT = 'https://auth.openai.com/oauth/token'
const OAUTH_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
const EXPIRY_BUFFER_MS = 5 * 60 * 1000

class CodexServiceError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown
  ) {
    super(message)
    this.name = 'CodexServiceError'
  }
}

class CodexService {
  private readonly refreshPromises = new Map<string, Promise<void>>()
  private authPathOverride = ''
  private skipRefreshOverride = false

  private getCredentialsPath = (): string => {
    const home = app.getPath('home') || os.homedir()
    return path.join(home, CODEX_DIR, AUTH_FILE_NAME)
  }

  private readAuthFile = async (filePath?: string): Promise<any> => {
    const resolvedPath = filePath || this.getCredentialsPath()
    try {
      return await readJsonFile(resolvedPath)
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new CodexServiceError('Could not parse Codex credentials file', error)
      }
      logger.warn(`Codex credentials file not found at ${resolvedPath}`)
      throw new CodexServiceError(
        `Codex credentials not found. Please sign in with the Codex CLI first (${resolvedPath}).`
      )
    }
  }

  private refreshTokens = async (value: any, authFilePath?: string): Promise<void> => {
    const refreshToken: string = value?.tokens?.refresh_token ?? ''
    if (!refreshToken) return

    logger.info('Refreshing Codex access token')
    const response = await net.fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: OAUTH_CLIENT_ID,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        scope: 'openid profile email'
      })
    })

    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new CodexServiceError(`Codex token refresh failed (${response.status}): ${detail}`)
    }

    const data: any = await response.json()
    if (data.access_token) value.tokens.access_token = data.access_token
    if (data.id_token) value.tokens.id_token = data.id_token
    if (data.refresh_token) value.tokens.refresh_token = data.refresh_token
    value.last_refresh = new Date().toISOString()

    try {
      await writeJsonFile(authFilePath || this.getCredentialsPath(), value)
    } catch (error) {
      logger.warn('Could not persist refreshed Codex credentials', error as Error)
    }
  }

  public setAuthPath = (authFilePath: string): void => {
    this.authPathOverride = authFilePath
  }

  public setSkipRefresh = (value: boolean): void => {
    this.skipRefreshOverride = value
  }

  public getCredentials = async (options?: {
    authFilePath?: string
    skipRefresh?: boolean
  }): Promise<CodexCredentials> => {
    const filePath = options?.authFilePath || this.authPathOverride || undefined
    const skip = options?.skipRefresh !== undefined ? options.skipRefresh : this.skipRefreshOverride
    let value = await this.readAuthFile(filePath)

    let accessToken: string = value?.tokens?.access_token ?? ''
    const expiry = accessToken ? getJwtExpiry(accessToken) : 0
    const needsRefresh = !skip && (!accessToken || (expiry > 0 && Date.now() >= expiry - EXPIRY_BUFFER_MS))

    if (needsRefresh && value?.tokens?.refresh_token) {
      const refreshKey = filePath || this.getCredentialsPath()
      let refreshPromise = this.refreshPromises.get(refreshKey)
      if (!refreshPromise) {
        refreshPromise = this.refreshTokens(value, filePath).finally(() => {
          this.refreshPromises.delete(refreshKey)
        })
        this.refreshPromises.set(refreshKey, refreshPromise)
      }
      try {
        await refreshPromise
        value = await this.readAuthFile(filePath)
        accessToken = value?.tokens?.access_token ?? ''
      } catch (error) {
        logger.error('Codex token refresh failed, using existing token', error as Error)
      }
    }

    if (!accessToken || !accessToken.trim()) {
      throw new CodexServiceError(
        'Codex credentials are missing an access token. Please re-authenticate the Codex CLI.'
      )
    }

    const accountId: string = value?.tokens?.account_id ?? ''
    const idToken: string = value?.tokens?.id_token ?? ''

    const plan = idToken ? readJwtClaim(idToken, ['https://api.openai.com/auth', 'chatgpt_plan_type']) : ''
    const email = idToken
      ? readJwtClaim(idToken, ['https://api.openai.com/profile', 'email']) || readJwtClaim(idToken, ['email'])
      : ''

    return { accessToken, accountId, plan, email }
  }

  public getStatus = async (): Promise<CodexStatus> => {
    try {
      const { accountId, plan, email } = await this.getCredentials()
      return { available: true, accountId, plan, email }
    } catch {
      return { available: false, accountId: '', plan: '', email: '' }
    }
  }

  private fetchCodexClientVersion = async (): Promise<string> => {
    try {
      const response = await net.fetch('https://registry.npmjs.org/@openai/codex/latest', {
        method: 'GET',
        headers: { Accept: 'application/json' }
      })
      if (!response.ok) return '0.138.0'
      const data: any = await response.json()
      return data?.version || '0.138.0'
    } catch {
      return '0.138.0'
    }
  }

  public fetchModels = async (): Promise<CliProviderModel[]> => {
    try {
      const { accessToken, accountId } = await this.getCredentials()
      const clientVersion = await this.fetchCodexClientVersion()
      const headers: Record<string, string> = {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
        originator: 'codex_cli_rs'
      }
      if (accountId) {
        headers['chatgpt-account-id'] = accountId
      }
      const response = await net.fetch(
        `https://chatgpt.com/backend-api/codex/models?client_version=${encodeURIComponent(clientVersion)}`,
        { method: 'GET', headers }
      )
      if (!response.ok) {
        throw new CodexServiceError(`Codex models request failed (${response.status})`)
      }
      const data: any = await response.json()
      const models: CliProviderModel[] = []
      if (data?.models && Array.isArray(data.models)) {
        for (const item of data.models) {
          const id = item?.slug || item?.model || item?.id
          const name = item?.display_name || item?.displayName || id
          if (id && !id.toLowerCase().includes('auto-review') && !id.toLowerCase().includes('auto_review')) {
            models.push({ id, name })
          }
        }
      }
      return models
    } catch (error) {
      logger.warn('Codex model listing via API failed', error as Error)
      return []
    }
  }

  public getQuota = async (options?: CliAuthFileOptions): Promise<CodexQuota> => {
    try {
      const skipRefresh = options?.refreshToken === false
      const creds = await this.getCredentials({ authFilePath: options?.authFilePath, skipRefresh })

      const response = await net.fetch('https://chatgpt.com/backend-api/wham/usage', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${creds.accessToken}`,
          'User-Agent': 'CherryStudio',
          originator: 'codex_cli_rs',
          ...(creds.accountId ? { 'ChatGPT-Account-Id': creds.accountId } : {})
        }
      })

      if (!response.ok) {
        throw new CodexServiceError(`Codex quota request failed (${response.status})`)
      }

      const data: any = await response.json()

      const planType: string = data?.plan_type ?? ''
      const plan = this.planLabel(planType) || creds.plan

      const rateLimit = data?.rate_limit ?? data?.additional_rate_limits?.[0]?.rate_limit ?? {}

      const primaryWindow = rateLimit?.primary_window
      const secondaryWindow = rateLimit?.secondary_window

      const sessionUsedPercent =
        primaryWindow?.used_percent != null ? Math.min(Math.max(primaryWindow.used_percent, 0), 100) : null
      const sessionResetAt =
        primaryWindow?.reset_at != null ? new Date(primaryWindow.reset_at * 1000).toISOString() : null
      const weeklyUsedPercent =
        secondaryWindow?.used_percent != null ? Math.min(Math.max(secondaryWindow.used_percent, 0), 100) : null
      const weeklyResetAt =
        secondaryWindow?.reset_at != null ? new Date(secondaryWindow.reset_at * 1000).toISOString() : null

      let expiresAt: number | null = null
      let hasRefreshToken = false
      try {
        const authFile = options?.authFilePath || this.authPathOverride || undefined
        const value = await this.readAuthFile(authFile)
        const accessToken = value?.tokens?.access_token ?? ''
        expiresAt = accessToken ? getJwtExpiry(accessToken) : null
        if (expiresAt === 0) expiresAt = null
        hasRefreshToken = !!value?.tokens?.refresh_token
      } catch {
        // ignore
      }

      return {
        available: true,
        email: creds.email,
        plan,
        sessionUsedPercent,
        sessionResetAt,
        weeklyUsedPercent,
        weeklyResetAt,
        expiresAt,
        hasRefreshToken
      }
    } catch {
      return {
        available: false,
        email: '',
        plan: '',
        sessionUsedPercent: null,
        sessionResetAt: null,
        weeklyUsedPercent: null,
        weeklyResetAt: null,
        expiresAt: null,
        hasRefreshToken: false
      }
    }
  }

  private planLabel = (planType: string): string | null => {
    if (!planType) return null
    const normalized = planType.toLowerCase()
    const labels: Record<string, string> = {
      free: 'Free',
      plus: 'Plus',
      pro: 'Pro',
      pro_lite: 'Pro Lite',
      prolite: 'Pro Lite',
      'pro-lite': 'Pro Lite',
      go: 'Go',
      team: 'Team',
      business: 'Business',
      enterprise: 'Enterprise',
      education: 'Education',
      edu: 'Education',
      guest: 'Guest'
    }
    return labels[normalized] || normalized.charAt(0).toUpperCase() + normalized.slice(1)
  }
}

export default new CodexService()
