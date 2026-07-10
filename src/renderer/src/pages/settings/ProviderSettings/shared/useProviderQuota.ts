import { loggerService } from '@logger'
import { useCallback, useEffect, useRef, useState } from 'react'

const logger = loggerService.withContext('CliProviderSettings')

interface UseProviderQuotaOptions<T> {
  providerName: string
  loadQuota: () => Promise<T>
  unavailableQuota: T
}

export function useProviderQuota<T>({ providerName, loadQuota, unavailableQuota }: UseProviderQuotaOptions<T>) {
  const [quota, setQuota] = useState<T | null>(null)
  const [loading, setLoading] = useState(false)
  const requestSequence = useRef(0)

  const refreshQuota = useCallback(async () => {
    const requestId = ++requestSequence.current
    setLoading(true)

    try {
      const result = await loadQuota()
      if (requestId === requestSequence.current) setQuota(result)
    } catch (error) {
      logger.error(`Failed to load ${providerName} quota`, error as Error)
      if (requestId === requestSequence.current) setQuota(unavailableQuota)
    } finally {
      if (requestId === requestSequence.current) setLoading(false)
    }
  }, [loadQuota, providerName, unavailableQuota])

  useEffect(() => {
    void refreshQuota()
    return () => {
      requestSequence.current += 1
    }
  }, [refreshQuota])

  return { loading, quota, refreshQuota }
}
