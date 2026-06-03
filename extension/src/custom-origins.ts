export const CUSTOM_ORIGINS_STORAGE_KEY = 'lcfoCustomOrigins'

export type CustomOriginRecord = {
  origin: string
  pattern: string
  enabledAt: string
}

export function isSupportedCustomOriginUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

export function normalizeOrigin(value: string): string {
  const url = new URL(value)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only http and https Overleaf instances are supported')
  }
  return url.origin
}

export function isProjectUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return /^\/project\/[^/]+/.test(url.pathname)
  } catch {
    return false
  }
}

export function isOfficialOverleafOrigin(value: string): boolean {
  try {
    const hostname = new URL(value).hostname.toLowerCase()
    return hostname === 'overleaf.com' || hostname.endsWith('.overleaf.com')
  } catch {
    return false
  }
}

export function permissionPatternForOrigin(origin: string): string {
  const url = new URL(origin)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only http and https Overleaf instances are supported')
  }
  return `${url.protocol}//${url.hostname}/*`
}

export function projectContentScriptMatch(pattern: string): string {
  if (!pattern.endsWith('/*')) {
    throw new Error(`Unsupported host permission pattern: ${pattern}`)
  }
  return `${pattern.slice(0, -1)}project/*`
}

export function contentScriptIdForOrigin(origin: string): string {
  return `lcfo-ce-${stableHash(origin)}`
}

export function upsertCustomOrigin(
  records: CustomOriginRecord[],
  record: CustomOriginRecord
): CustomOriginRecord[] {
  const others = records.filter(item => item.origin !== record.origin)
  return [...others, record].sort((a, b) => a.origin.localeCompare(b.origin))
}

export function removeCustomOrigin(
  records: CustomOriginRecord[],
  origin: string
): CustomOriginRecord[] {
  return records.filter(item => item.origin !== origin)
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36)
}
