import { describe, expect, it, vi } from 'vitest'

import { AntigravityCredentialStore } from '../AntigravityCredentialStore'

function createRunner(output = '') {
  return { run: vi.fn().mockResolvedValue(output) }
}

describe('AntigravityCredentialStore', () => {
  it('reads macOS Keychain with UsageBar-compatible identifiers', async () => {
    const runner = createRunner('{"token":{}}')
    const store = new AntigravityCredentialStore('darwin', runner)

    await expect(store.read()).resolves.toBe('{"token":{}}')
    expect(runner.run).toHaveBeenCalledWith('security', [
      'find-generic-password',
      '-s',
      'gemini:antigravity',
      '-a',
      'antigravity',
      '-w'
    ])
  })

  it('reads Linux Secret Service with UsageBar-compatible attributes', async () => {
    const runner = createRunner('{"token":{}}')
    const store = new AntigravityCredentialStore('linux', runner)

    await expect(store.read()).resolves.toBe('{"token":{}}')
    expect(runner.run).toHaveBeenCalledWith('secret-tool', [
      'lookup',
      'application',
      'antigravity',
      'target',
      'gemini:antigravity'
    ])
  })

  it('decodes UTF-8 credentials returned by Windows Credential Manager', async () => {
    const credential = '{"token":{"access_token":"token"}}'
    const runner = createRunner(Buffer.from(credential).toString('base64'))
    const store = new AntigravityCredentialStore('win32', runner)

    await expect(store.read()).resolves.toBe(credential)
    expect(runner.run).toHaveBeenCalledWith(
      'powershell.exe',
      expect.arrayContaining(['-EncodedCommand', expect.any(String)])
    )
  })

  it('writes Linux credentials through stdin', async () => {
    const runner = createRunner()
    const store = new AntigravityCredentialStore('linux', runner)

    await store.write('credential-json')

    expect(runner.run).toHaveBeenCalledWith(
      'secret-tool',
      ['store', '--label=gemini:antigravity', 'application', 'antigravity', 'target', 'gemini:antigravity'],
      'credential-json'
    )
  })

  it('writes macOS credentials to the matching Keychain item', async () => {
    const runner = createRunner()
    const store = new AntigravityCredentialStore('darwin', runner)

    await store.write('credential-json')

    expect(runner.run).toHaveBeenCalledWith('security', [
      'add-generic-password',
      '-s',
      'gemini:antigravity',
      '-a',
      'antigravity',
      '-w',
      'credential-json',
      '-U'
    ])
  })

  it('returns null when the platform credential command fails', async () => {
    const runner = { run: vi.fn().mockRejectedValue(new Error('not found')) }
    const store = new AntigravityCredentialStore('linux', runner)

    await expect(store.read()).resolves.toBeNull()
  })
})
