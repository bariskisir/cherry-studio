import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { useProviderQuota } from '../useProviderQuota'

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      error: vi.fn()
    })
  }
}))

interface TestQuota {
  available: boolean
  value: number
}

const UNAVAILABLE: TestQuota = { available: false, value: 0 }
const SUCCESS: TestQuota = { available: true, value: 42 }

describe('useProviderQuota', () => {
  it('starts with loading=true and quota=null', () => {
    const loadQuota = vi.fn().mockResolvedValue(SUCCESS)
    const { result } = renderHook(() =>
      useProviderQuota({ providerName: 'Test', loadQuota, unavailableQuota: UNAVAILABLE })
    )
    expect(result.current.loading).toBe(true)
    expect(result.current.quota).toBeNull()
  })

  it('sets quota from loadQuota on success', async () => {
    const loadQuota = vi.fn().mockResolvedValue(SUCCESS)
    const { result } = renderHook(() =>
      useProviderQuota({ providerName: 'Test', loadQuota, unavailableQuota: UNAVAILABLE })
    )
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.quota).toEqual(SUCCESS)
  })

  it('sets unavailableQuota on load failure', async () => {
    const loadQuota = vi.fn().mockRejectedValue(new Error('network error'))
    const { result } = renderHook(() =>
      useProviderQuota({ providerName: 'Test', loadQuota, unavailableQuota: UNAVAILABLE })
    )
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.quota).toEqual(UNAVAILABLE)
  })

  it('refreshQuota can be called manually', async () => {
    const loadQuota = vi.fn().mockResolvedValue(SUCCESS)
    const { result } = renderHook(() =>
      useProviderQuota({ providerName: 'Test', loadQuota, unavailableQuota: UNAVAILABLE })
    )

    await waitFor(() => expect(result.current.quota).toEqual(SUCCESS))

    const updated = { available: true, value: 99 }
    loadQuota.mockResolvedValue(updated)

    await act(async () => {
      await result.current.refreshQuota()
    })

    expect(loadQuota).toHaveBeenCalledTimes(2)
    expect(result.current.quota).toEqual(updated)
  })

  it('ignores stale responses on rapid sequential refreshes', async () => {
    let resolveSlow: (v: TestQuota) => void
    const slow = new Promise<TestQuota>((resolve) => {
      resolveSlow = resolve
    })
    const fast = Promise.resolve({ available: true, value: 2 })
    const loadQuota = vi.fn().mockReturnValueOnce(slow).mockReturnValueOnce(fast)

    const { result } = renderHook(() =>
      useProviderQuota({ providerName: 'Test', loadQuota, unavailableQuota: UNAVAILABLE })
    )

    await act(async () => {
      await result.current.refreshQuota()
    })

    expect(result.current.quota).toEqual({ available: true, value: 2 })

    await act(async () => {
      resolveSlow({ available: true, value: 1 })
    })

    expect(result.current.quota).toEqual({ available: true, value: 2 })
  })

  it('cleans up on unmount by incrementing requestSequence', () => {
    const loadQuota = vi.fn().mockResolvedValue(SUCCESS)
    const { result, unmount } = renderHook(() =>
      useProviderQuota({ providerName: 'Test', loadQuota, unavailableQuota: UNAVAILABLE })
    )
    unmount()
    expect(result.current.quota).toBeNull()
  })
})
