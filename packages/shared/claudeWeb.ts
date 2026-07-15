import type { CliProviderModel } from './cliProvider'

export interface ClaudeWebStatus {
  available: boolean
  email: string
  plan: string
}

export type ClaudeWebModel = CliProviderModel

export interface ClaudeWebCompletionRequest {
  providerId: string
  requestId: string
  body: Record<string, unknown>
}

export type ClaudeWebStreamEvent =
  | { requestId: string; type: 'chunk'; data: string }
  | { requestId: string; type: 'done' }
  | { requestId: string; type: 'error'; error: string }
