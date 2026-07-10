import path from 'node:path'

import type { AntigravityAuthOptions, CliAuthFileOptions } from '@shared/cliProvider'

const MAX_PATH_LENGTH = 4096

function asOptions(value: unknown, label: string): Record<string, unknown> | undefined {
  if (value === undefined) return undefined
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

export function validateAuthFilePath(value: unknown): string | undefined {
  if (value === undefined || value === '') return undefined
  if (typeof value !== 'string') throw new TypeError('authFilePath must be a string')

  const filePath = value.trim()
  if (!filePath) return undefined
  if (filePath.length > MAX_PATH_LENGTH || filePath.includes('\0')) {
    throw new TypeError('authFilePath is invalid')
  }
  if (!path.isAbsolute(filePath) || path.extname(filePath).toLowerCase() !== '.json') {
    throw new TypeError('authFilePath must be an absolute JSON file path')
  }

  return path.normalize(filePath)
}

export function validateBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new TypeError(`${label} must be a boolean`)
  return value
}

export function validateCliAuthOptions(value: unknown): CliAuthFileOptions | undefined {
  const options = asOptions(value, 'CLI auth options')
  if (!options) return undefined

  return {
    authFilePath: validateAuthFilePath(options.authFilePath),
    refreshToken: options.refreshToken === undefined ? undefined : validateBoolean(options.refreshToken, 'refreshToken')
  }
}

export function validateAntigravityAuthOptions(value: unknown): AntigravityAuthOptions | undefined {
  const options = asOptions(value, 'Antigravity auth options')
  if (!options) return undefined

  return {
    refreshToken: options.refreshToken === undefined ? undefined : validateBoolean(options.refreshToken, 'refreshToken')
  }
}
