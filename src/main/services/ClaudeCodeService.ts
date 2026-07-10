import { loggerService } from '@logger'
import type {
  ClaudeCodeCredentials,
  ClaudeCodeQuota,
  ClaudeCodeStatus,
  CliAuthFileOptions,
  CliProviderModel
} from '@shared/cliProvider'
import { app, net } from 'electron'
import os from 'os'
import path from 'path'

import { parseClaudeModelsResponse } from './cliProviderModels'
import { readJsonFile, writeJsonFile } from './fileUtils'

const logger = loggerService.withContext('ClaudeCodeService')

const CLAUDE_DIR = '.claude'
const CREDENTIALS_FILE_NAME = '.credentials.json'

const API_BASE = 'https://api.anthropic.com'
const TOKEN_ENDPOINT = 'https://console.anthropic.com/v1/oauth/token'
const OAUTH_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e'
const ANTHROPIC_VERSION = '2023-06-01'
const ANTHROPIC_BETA_META = 'oauth-2025-04-20'
const EXPIRY_BUFFER_MS = 5 * 60 * 1000

class ClaudeCodeServiceError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown
  ) {
    super(message)
    this.name = 'ClaudeCodeServiceError'
  }
}

class ClaudeCodeService {
  private readonly refreshPromises = new Map<string, Promise<void>>()
  private authPathOverride = ''
  private skipRefreshOverride = false

  private getCredentialsPath = (): string => {
    const home = app.getPath('home') || os.homedir()
    return path.join(home, CLAUDE_DIR, CREDENTIALS_FILE_NAME)
  }

  private readCredentialsFile = async (filePath?: string): Promise<any> => {
    const resolvedPath = filePath || this.getCredentialsPath()
    try {
      return await readJsonFile(resolvedPath)
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new ClaudeCodeServiceError('Could not parse Claude Code credentials file', error)
      }
      logger.warn(`Claude Code credentials file not found at ${resolvedPath}`)
      throw new ClaudeCodeServiceError(
        `Claude Code credentials not found. Please sign in with the Claude Code CLI first (${resolvedPath}).`
      )
    }
  }

  private refreshTokens = async (value: any, authFilePath?: string): Promise<void> => {
    const oauth = value?.claudeAiOauth
    const refreshToken: string = oauth?.refreshToken ?? ''
    if (!refreshToken) return

    logger.info('Refreshing Claude Code access token')
    const response = await net.fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: OAUTH_CLIENT_ID
      })
    })

    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new ClaudeCodeServiceError(`Claude Code token refresh failed (${response.status}): ${detail}`)
    }

    const data: any = await response.json()
    if (data.access_token) oauth.accessToken = data.access_token
    if (data.refresh_token) oauth.refreshToken = data.refresh_token
    if (typeof data.expires_in === 'number') oauth.expiresAt = Date.now() + data.expires_in * 1000

    try {
      await writeJsonFile(authFilePath || this.getCredentialsPath(), value)
    } catch (error) {
      logger.warn('Could not persist refreshed Claude Code credentials', error as Error)
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
  }): Promise<ClaudeCodeCredentials> => {
    const filePath = options?.authFilePath || this.authPathOverride || undefined
    const skip = options?.skipRefresh !== undefined ? options.skipRefresh : this.skipRefreshOverride
    let value = await this.readCredentialsFile(filePath)

    let accessToken: string = value?.claudeAiOauth?.accessToken ?? ''
    const expiresAtMs: number = value?.claudeAiOauth?.expiresAt ?? 0
    const needsRefresh = !skip && (!accessToken || (expiresAtMs > 0 && Date.now() >= expiresAtMs - EXPIRY_BUFFER_MS))

    if (needsRefresh && value?.claudeAiOauth?.refreshToken) {
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
        value = await this.readCredentialsFile(filePath)
        accessToken = value?.claudeAiOauth?.accessToken ?? ''
      } catch (error) {
        logger.error('Claude Code token refresh failed, using existing token', error as Error)
      }
    }

    if (!accessToken || !accessToken.trim()) {
      throw new ClaudeCodeServiceError(
        'Claude Code credentials are missing an access token. Please re-authenticate the Claude Code CLI.'
      )
    }

    const plan: string = value?.claudeAiOauth?.subscriptionType ?? ''
    return { accessToken, plan }
  }

  public getStatus = async (): Promise<ClaudeCodeStatus> => {
    try {
      const { plan } = await this.getCredentials()
      return { available: true, plan }
    } catch {
      return { available: false, plan: '' }
    }
  }

  public getQuota = async (options?: CliAuthFileOptions): Promise<ClaudeCodeQuota> => {
    try {
      const skipRefresh = options?.refreshToken === false
      const creds = await this.getCredentials({ authFilePath: options?.authFilePath, skipRefresh })

      const response = await net.fetch(`${API_BASE}/api/oauth/usage`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${creds.accessToken}`,
          'anthropic-beta': ANTHROPIC_BETA_META,
          'User-Agent': 'claude-code/2.1.0'
        }
      })

      if (!response.ok) {
        throw new ClaudeCodeServiceError(`Claude Code quota request failed (${response.status})`)
      }

      const data: any = await response.json()

      const fiveHour = data?.five_hour
      const sevenDay = data?.seven_day

      const fiveHourUsedPercent =
        fiveHour?.utilization != null ? Math.min(Math.max(fiveHour.utilization, 0), 100) : null
      const fiveHourResetsAt = fiveHour?.resets_at ?? null
      const sevenDayUsedPercent =
        sevenDay?.utilization != null ? Math.min(Math.max(sevenDay.utilization, 0), 100) : null
      const sevenDayResetsAt = sevenDay?.resets_at ?? null

      let expiresAt: number | null = null
      let hasRefreshToken = false
      try {
        const authFile = options?.authFilePath || this.authPathOverride || undefined
        const value = await this.readCredentialsFile(authFile)
        const oauthExpiresAt: number = value?.claudeAiOauth?.expiresAt ?? 0
        expiresAt = oauthExpiresAt > 0 ? oauthExpiresAt : null
        hasRefreshToken = !!value?.claudeAiOauth?.refreshToken
      } catch {
        // ignore
      }

      return {
        available: true,
        plan: creds.plan,
        fiveHourUsedPercent,
        fiveHourResetsAt,
        sevenDayUsedPercent,
        sevenDayResetsAt,
        expiresAt,
        hasRefreshToken
      }
    } catch {
      return {
        available: false,
        plan: '',
        fiveHourUsedPercent: null,
        fiveHourResetsAt: null,
        sevenDayUsedPercent: null,
        sevenDayResetsAt: null,
        expiresAt: null,
        hasRefreshToken: false
      }
    }
  }

  public fetchModels = async (): Promise<CliProviderModel[]> => {
    const { accessToken } = await this.getCredentials()
    const models: CliProviderModel[] = []
    let afterId: string | undefined
    const seenCursors = new Set<string>()

    do {
      const params = new URLSearchParams({ limit: '1000' })
      if (afterId) params.set('after_id', afterId)
      const response = await net.fetch(`${API_BASE}/v1/models?${params.toString()}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'anthropic-version': ANTHROPIC_VERSION,
          'anthropic-beta': ANTHROPIC_BETA_META
        }
      })
      if (!response.ok) {
        const detail = await response.text().catch(() => '')
        throw new ClaudeCodeServiceError(`Claude Code models request failed (${response.status}): ${detail}`)
      }
      const { models: pageModels, nextAfterId } = parseClaudeModelsResponse(await response.json())
      models.push(...pageModels)
      if (nextAfterId && seenCursors.has(nextAfterId)) break
      if (nextAfterId) seenCursors.add(nextAfterId)
      afterId = nextAfterId
    } while (afterId)

    return models
  }
}

export default new ClaudeCodeService()
