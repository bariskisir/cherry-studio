import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useAuthFileSettings } from '../useAuthFileSettings'

const mocks = vi.hoisted(() => ({
  loadPersisted: vi.fn(),
  loadPersistedBoolean: vi.fn(),
  persist: vi.fn(),
  selectJsonFile: vi.fn()
}))

vi.mock('../utils', () => mocks)

const OPTIONS = {
  authPathStorageKey: 'provider-auth-path',
  refreshTokenStorageKey: 'provider-refresh-token'
}

describe('useAuthFileSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.loadPersisted.mockReturnValue('C:\\auth.json')
    mocks.loadPersistedBoolean.mockReturnValue(true)
  })

  it('loads persisted settings', () => {
    const { result } = renderHook(() => useAuthFileSettings(OPTIONS))

    expect(result.current.authFilePath).toBe('C:\\auth.json')
    expect(result.current.refreshToken).toBe(true)
  })

  it('persists refresh-token changes', () => {
    const { result } = renderHook(() => useAuthFileSettings(OPTIONS))

    act(() => result.current.updateRefreshToken(false))

    expect(result.current.refreshToken).toBe(false)
    expect(mocks.persist).toHaveBeenCalledWith('provider-refresh-token', 'false')
  })

  it('persists a selected auth file and ignores cancelled selection', async () => {
    mocks.selectJsonFile.mockResolvedValueOnce('D:\\new-auth.json').mockResolvedValueOnce(undefined)
    const { result } = renderHook(() => useAuthFileSettings(OPTIONS))

    await act(result.current.browseAuthFile)
    expect(result.current.authFilePath).toBe('D:\\new-auth.json')
    expect(mocks.persist).toHaveBeenCalledWith('provider-auth-path', 'D:\\new-auth.json')

    await act(result.current.browseAuthFile)
    expect(result.current.authFilePath).toBe('D:\\new-auth.json')
    expect(mocks.persist).toHaveBeenCalledTimes(1)
  })
})
