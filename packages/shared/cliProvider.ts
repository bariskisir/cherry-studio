export interface CliAuthFileOptions {
  authFilePath?: string
  refreshToken?: boolean
}

export interface CodexCredentials {
  accessToken: string
  accountId: string
  plan: string
  email: string
}

export interface CodexStatus extends Omit<CodexCredentials, 'accessToken'> {
  available: boolean
}

export interface CodexQuota {
  available: boolean
  email: string
  plan: string
  sessionUsedPercent: number | null
  sessionResetAt: string | null
  weeklyUsedPercent: number | null
  weeklyResetAt: string | null
  expiresAt: number | null
  hasRefreshToken: boolean
}

export interface ClaudeCodeCredentials {
  accessToken: string
  plan: string
}

export interface ClaudeCodeStatus extends Omit<ClaudeCodeCredentials, 'accessToken'> {
  available: boolean
}

export interface ClaudeCodeQuota {
  available: boolean
  plan: string
  fiveHourUsedPercent: number | null
  fiveHourResetsAt: string | null
  sevenDayUsedPercent: number | null
  sevenDayResetsAt: string | null
  expiresAt: number | null
  hasRefreshToken: boolean
}

export interface AntigravityAuthOptions {
  refreshToken?: boolean
}

export interface AntigravityCredentials {
  accessToken: string
  projectId: string
  userAgent: string
}

export interface AntigravityStatus {
  available: boolean
  email: string
  projectId: string
  plan: string
}

export interface AntigravityBucket {
  window: string
  usedPercent: number
  resetTime: string | null
}

export interface AntigravityGroup {
  displayName: string
  buckets: AntigravityBucket[]
}

export interface AntigravityQuota {
  available: boolean
  email: string
  plan: string
  projectId: string
  groups: AntigravityGroup[]
  expiresAt: number | null
  hasRefreshToken: boolean
}

export interface ReasoningLevelOption {
  effort: string
  description: string
}

export interface CliProviderModel {
  id: string
  name: string
  description?: string
  supportsVision?: boolean
  reasoningLevels?: ReasoningLevelOption[]
  defaultReasoningLevel?: string
  supportsThinking?: boolean
}
