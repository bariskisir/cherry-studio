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
import { execFile } from 'child_process'
import { app, net } from 'electron'
import path from 'path'

import { readJsonFile, writeJsonFile } from './fileUtils'
import { readJwtClaim } from './jwtUtils'

const logger = loggerService.withContext('AntigravityService')

const ANTIGRAVITY_DIR = '.antigravity'
const CREDENTIALS_FILE_NAME = '.credentials.json'
const CREDENTIAL_TARGET = 'gemini:antigravity'

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
  private authSourceKey = ''
  private readonly refreshPromises = new Map<string, Promise<void>>()
  private authPathOverride = ''
  private useCredentialManagerOverride = true
  private skipRefreshOverride = false

  private getFilePath = (): string => {
    const home = app.getPath('home')
    return path.join(home, ANTIGRAVITY_DIR, CREDENTIALS_FILE_NAME)
  }

  public getUserAgent = (): string => {
    const version = this.cliVersion || DEFAULT_CLI_VERSION
    return `antigravity/cli/${version} (aidev_client; os_type=${os.platform()}; arch=${os.arch()}; auth_method=consumer)`
  }

  private readCredentialManager = (): Promise<string | null> => {
    if (process.platform !== 'win32') return Promise.resolve(null)

    const script = `
$ErrorActionPreference = 'Stop'
$sig = @"
using System;
using System.Runtime.InteropServices;
public class CredMan {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public struct CREDENTIAL {
    public uint Flags; public uint Type; public IntPtr TargetName; public IntPtr Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public uint CredentialBlobSize; public IntPtr CredentialBlob; public uint Persist;
    public uint AttributeCount; public IntPtr Attributes; public IntPtr TargetAlias; public IntPtr UserName;
  }
  [DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern bool CredRead(string target, uint type, uint flags, out IntPtr credential);
  [DllImport("advapi32.dll")] public static extern void CredFree(IntPtr cred);
  public static string Read(string target) {
    IntPtr credPtr;
    if(!CredRead(target, 1, 0, out credPtr)) return null;
    try {
      CREDENTIAL c = (CREDENTIAL)Marshal.PtrToStructure(credPtr, typeof(CREDENTIAL));
      byte[] buf = new byte[c.CredentialBlobSize];
      Marshal.Copy(c.CredentialBlob, buf, 0, (int)c.CredentialBlobSize);
      return System.Convert.ToBase64String(buf);
    } finally { CredFree(credPtr); }
  }
}
"@
Add-Type -TypeDefinition $sig
$r = [CredMan]::Read('${CREDENTIAL_TARGET}')
if ($r -eq $null) { exit 1 }
[Console]::Out.Write($r)
`
    const encoded = Buffer.from(script, 'utf16le').toString('base64')
    return new Promise((resolve) => {
      execFile(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
        { timeout: 10000, windowsHide: true },
        (error, stdout) => {
          if (error || !stdout?.trim()) {
            resolve(null)
            return
          }
          try {
            const blob = Buffer.from(stdout.trim(), 'base64').toString('utf-8')
            resolve(blob.replace(/\0+$/, ''))
          } catch {
            resolve(null)
          }
        }
      )
    })
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
        email: idToken ? readJwtClaim(idToken, 'email') : ''
      }
    } catch {
      return null
    }
  }

  private readRawCredentials = async (options: {
    useCredentialManager: boolean
    authFilePath: string
  }): Promise<AntigravityAuth> => {
    let fromManager: AntigravityAuth | null = null
    if (options.useCredentialManager) {
      const raw = await this.readCredentialManager()
      if (raw) fromManager = this.parseCredentialValue(raw)
    }
    let fromFile: AntigravityAuth | null = null
    try {
      fromFile = this.parseCredentialValue(await readJsonFile(options.authFilePath))
    } catch {
      // ignore
    }
    const newer = [fromManager, fromFile].filter(Boolean) as AntigravityAuth[]
    if (newer.length === 1) return newer[0]
    if (newer.length === 2) return newer[0].expiry >= newer[1].expiry ? newer[0] : newer[1]
    throw new AntigravityServiceError(
      'Antigravity credentials not found. Please sign in with the Antigravity/Gemini CLI first.'
    )
  }

  private refreshTokens = async (auth: AntigravityAuth, authFilePath: string): Promise<void> => {
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
    await this.persistCredentials(auth, authFilePath)
  }

  private persistCredentials = async (auth: AntigravityAuth, authFilePath: string): Promise<void> => {
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
      await writeJsonFile(authFilePath, payload)
    } catch (error) {
      logger.warn('Could not persist refreshed Antigravity credentials', error as Error)
    }
  }

  private ensureAuth = async (
    options?: AntigravityAuthOptions & { skipRefresh?: boolean }
  ): Promise<AntigravityAuth> => {
    const useCredentialManager = options?.useCredentialManager ?? this.useCredentialManagerOverride
    const authFilePath = options?.authFilePath || this.authPathOverride || this.getFilePath()
    const sourceKey = `${useCredentialManager ? 'credential-manager' : 'file'}:${authFilePath}`

    if (!this.auth || sourceKey !== this.authSourceKey) {
      this.auth = await this.readRawCredentials({ useCredentialManager, authFilePath })
      this.authSourceKey = sourceKey
      this.projectId = ''
      this.plan = ''
    }

    const skipRefresh = options?.skipRefresh ?? this.skipRefreshOverride
    if (skipRefresh) return this.auth
    const expired = this.auth.expiry > 0 && Date.now() >= this.auth.expiry - EXPIRY_BUFFER_MS
    if (expired && this.auth.refreshToken) {
      const auth = this.auth
      let refreshPromise = this.refreshPromises.get(sourceKey)
      if (!refreshPromise) {
        refreshPromise = this.refreshTokens(auth, authFilePath).finally(() => {
          this.refreshPromises.delete(sourceKey)
        })
        this.refreshPromises.set(sourceKey, refreshPromise)
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

  public setAuthPath = (path: string): void => {
    if (this.authPathOverride === path) return
    this.authPathOverride = path
    this.resetIdentityCache()
  }

  public setUseCredentialManager = (value: boolean): void => {
    if (this.useCredentialManagerOverride === value) return
    this.useCredentialManagerOverride = value
    this.resetIdentityCache()
  }

  public setSkipRefresh = (value: boolean): void => {
    this.skipRefreshOverride = value
  }

  private resetIdentityCache(): void {
    this.auth = null
    this.authSourceKey = ''
    this.projectId = ''
    this.plan = ''
  }

  public getCredentials = async (): Promise<AntigravityCredentials> => {
    const auth = await this.ensureAuth({
      useCredentialManager: this.useCredentialManagerOverride,
      authFilePath: this.authPathOverride || undefined,
      skipRefresh: this.skipRefreshOverride
    })
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
      const auth = await this.ensureAuth({
        useCredentialManager: options?.useCredentialManager,
        authFilePath: options?.authFilePath,
        skipRefresh
      })
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
    const data: any = await response.json()
    const modelsObj = data?.models
    if (!modelsObj || typeof modelsObj !== 'object') {
      throw new AntigravityServiceError('Antigravity models response is missing a model list.')
    }
    const models: CliProviderModel[] = []
    for (const [id, info] of Object.entries(
      modelsObj as Record<string, { isInternal?: boolean; displayName?: string; supportsThinking?: boolean }>
    )) {
      if (info?.isInternal === true) continue
      models.push({ id, name: info?.displayName || id, supportsThinking: info?.supportsThinking === true })
    }
    return models
  }
}

export default new AntigravityService()
