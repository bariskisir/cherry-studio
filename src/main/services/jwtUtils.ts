export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const payload = token.split('.')[1]
    if (!payload) return null
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/')
    const decoded = Buffer.from(normalized, 'base64').toString('utf-8')
    return JSON.parse(decoded)
  } catch {
    return null
  }
}

export function readJwtClaim(token: string, claimPath: string | string[]): string {
  const payload = decodeJwtPayload(token)
  if (!payload) return ''
  const keys = Array.isArray(claimPath) ? claimPath : [claimPath]
  let value: unknown = payload
  for (const key of keys) {
    if (value == null || typeof value !== 'object') return ''
    value = (value as Record<string, unknown>)[key]
  }
  return typeof value === 'string' ? value : ''
}

export function getJwtExpiry(token: string): number {
  const payload = decodeJwtPayload(token)
  const exp = payload?.exp
  return typeof exp === 'number' ? exp * 1000 : 0
}
