export function loadPersisted(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback
  } catch {
    return fallback
  }
}

export function persist(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // ignore
  }
}

export function loadPersistedBoolean(key: string, fallback = true): boolean {
  return loadPersisted(key, String(fallback)) !== 'false'
}

export async function selectJsonFile(): Promise<string | undefined> {
  return window.api.select({
    properties: ['openFile'],
    filters: [{ name: 'JSON', extensions: ['json'] }]
  })
}

export function formatDuration(ms: number, t: (key: string) => string): string {
  if (!Number.isFinite(ms)) return ''
  if (ms <= 0) return t('common.expired')
  const totalMin = Math.floor(ms / 60000)
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  const d = Math.floor(h / 24)
  if (d > 0) return d + 'd ' + (h % 24) + 'h'
  if (h > 0) return h + 'h ' + m + 'm'
  return m + 'm'
}

export function formatExpiry(
  expiresAt: number | null,
  t: (key: string) => string,
  translationKey: string
): string | null {
  if (!expiresAt) return null
  return t(translationKey) + ': ' + formatDuration(expiresAt - Date.now(), t)
}

export function formatReset(iso: string | null, t: (key: string) => string): string {
  if (!iso) return ''
  const resetAt = Date.parse(iso)
  return Number.isFinite(resetAt) ? formatDuration(resetAt - Date.now(), t) : ''
}
