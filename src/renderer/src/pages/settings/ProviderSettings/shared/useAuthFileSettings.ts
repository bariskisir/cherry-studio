import { useCallback, useState } from 'react'

import { loadPersisted, loadPersistedBoolean, persist, selectJsonFile } from './utils'

interface UseAuthFileSettingsOptions {
  authPathStorageKey: string
  refreshTokenStorageKey: string
}

export function usePersistedBooleanSetting(storageKey: string, fallback = true) {
  const [value, setValue] = useState(() => loadPersistedBoolean(storageKey, fallback))

  const updateValue = useCallback(
    (nextValue: boolean) => {
      setValue(nextValue)
      persist(storageKey, String(nextValue))
    },
    [storageKey]
  )

  return { value, updateValue }
}

export function useAuthFileSettings({ authPathStorageKey, refreshTokenStorageKey }: UseAuthFileSettingsOptions) {
  const [authFilePath, setAuthFilePath] = useState(() => loadPersisted(authPathStorageKey, ''))
  const { value: refreshToken, updateValue: updateRefreshToken } = usePersistedBooleanSetting(refreshTokenStorageKey)

  const browseAuthFile = useCallback(async () => {
    const selectedPath = await selectJsonFile()
    if (!selectedPath) return

    setAuthFilePath(selectedPath)
    persist(authPathStorageKey, selectedPath)
  }, [authPathStorageKey])

  return { authFilePath, refreshToken, browseAuthFile, updateRefreshToken }
}
