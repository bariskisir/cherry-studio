import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  validateAntigravityAuthOptions,
  validateAuthFilePath,
  validateBoolean,
  validateCliAuthOptions
} from '../cliProviderValidation'

const ABSOLUTE_JSON = path.resolve('C:\\Users\\test\\auth.json')

describe('validateAuthFilePath', () => {
  it('returns undefined for undefined or empty input', () => {
    expect(validateAuthFilePath(undefined)).toBeUndefined()
    expect(validateAuthFilePath('')).toBeUndefined()
  })

  it('throws for non-string input', () => {
    expect(() => validateAuthFilePath(123)).toThrow('authFilePath must be a string')
    expect(() => validateAuthFilePath(null)).toThrow('authFilePath must be a string')
    expect(() => validateAuthFilePath([])).toThrow('authFilePath must be a string')
  })

  it('throws for non-absolute paths', () => {
    expect(() => validateAuthFilePath('relative/path.json')).toThrow('authFilePath must be an absolute JSON file path')
    expect(() => validateAuthFilePath('auth.json')).toThrow('authFilePath must be an absolute JSON file path')
  })

  it('throws for non-JSON extensions', () => {
    expect(() => validateAuthFilePath('C:\\auth.txt')).toThrow('authFilePath must be an absolute JSON file path')
    expect(() => validateAuthFilePath('C:\\auth')).toThrow('authFilePath must be an absolute JSON file path')
  })

  it('accepts an absolute JSON path', () => {
    const result = validateAuthFilePath(ABSOLUTE_JSON)
    expect(result).toBe(path.normalize(ABSOLUTE_JSON))
  })

  it('returns undefined for whitespace-only string after trim', () => {
    expect(validateAuthFilePath('   ')).toBeUndefined()
  })

  it('throws for path with null characters', () => {
    expect(() => validateAuthFilePath('C:\\auth\0.json')).toThrow('authFilePath is invalid')
  })

  it('throws for overly long path', () => {
    const long = 'C:\\' + 'a'.repeat(4096) + '.json'
    expect(() => validateAuthFilePath(long)).toThrow('authFilePath is invalid')
  })
})

describe('validateBoolean', () => {
  it('returns the boolean value', () => {
    expect(validateBoolean(true, 'flag')).toBe(true)
    expect(validateBoolean(false, 'flag')).toBe(false)
  })

  it('throws for non-boolean input', () => {
    expect(() => validateBoolean('true', 'flag')).toThrow('flag must be a boolean')
    expect(() => validateBoolean(1, 'flag')).toThrow('flag must be a boolean')
    expect(() => validateBoolean(null, 'flag')).toThrow('flag must be a boolean')
    expect(() => validateBoolean(undefined, 'flag')).toThrow('flag must be a boolean')
  })
})

describe('validateCliAuthOptions', () => {
  it('returns undefined for undefined input', () => {
    expect(validateCliAuthOptions(undefined)).toBeUndefined()
  })

  it('throws for non-object input', () => {
    expect(() => validateCliAuthOptions('string')).toThrow('CLI auth options must be an object')
    expect(() => validateCliAuthOptions(42)).toThrow('CLI auth options must be an object')
    expect(() => validateCliAuthOptions(null)).toThrow('CLI auth options must be an object')
    expect(() => validateCliAuthOptions([])).toThrow('CLI auth options must be an object')
  })

  it('validates authFilePath and refreshToken', () => {
    const result = validateCliAuthOptions({
      authFilePath: ABSOLUTE_JSON,
      refreshToken: true
    })
    expect(result?.authFilePath).toBe(path.normalize(ABSOLUTE_JSON))
    expect(result?.refreshToken).toBe(true)
  })

  it('returns undefined fields when not provided', () => {
    const result = validateCliAuthOptions({})
    expect(result?.authFilePath).toBeUndefined()
    expect(result?.refreshToken).toBeUndefined()
  })
})

describe('validateAntigravityAuthOptions', () => {
  it('extends CLI options with useCredentialManager', () => {
    const result = validateAntigravityAuthOptions({
      useCredentialManager: false
    })
    expect(result?.useCredentialManager).toBe(false)
  })

  it('leaves useCredentialManager undefined when not provided', () => {
    const result = validateAntigravityAuthOptions({})
    expect(result?.useCredentialManager).toBeUndefined()
  })

  it('throws for invalid useCredentialManager', () => {
    expect(() => validateAntigravityAuthOptions({ useCredentialManager: 'yes' })).toThrow(
      'useCredentialManager must be a boolean'
    )
  })
})
