import { describe, expect, it } from 'vitest'
import {
  contentScriptIdForOrigin,
  isOfficialOverleafOrigin,
  isProjectUrl,
  permissionPatternForOrigin,
  projectContentScriptMatch,
  removeCustomOrigin,
  upsertCustomOrigin,
} from '../src/custom-origins'

describe('custom Overleaf origin helpers', () => {
  it('recognizes official Overleaf origins separately from CE instances', () => {
    expect(isOfficialOverleafOrigin('https://www.overleaf.com')).toBe(true)
    expect(isOfficialOverleafOrigin('https://da.overleaf.com')).toBe(true)
    expect(isOfficialOverleafOrigin('https://overleaf.example.edu')).toBe(false)
  })

  it('identifies Overleaf project URLs', () => {
    expect(isProjectUrl('https://overleaf.example.edu/project/abc123')).toBe(true)
    expect(isProjectUrl('https://overleaf.example.edu/project/abc123/file/main.tex')).toBe(true)
    expect(isProjectUrl('https://overleaf.example.edu/login')).toBe(false)
  })

  it('derives per-host optional permissions and project-only content script matches', () => {
    const pattern = permissionPatternForOrigin('https://overleaf.example.edu')

    expect(pattern).toBe('https://overleaf.example.edu/*')
    expect(projectContentScriptMatch(pattern)).toBe('https://overleaf.example.edu/project/*')
  })

  it('uses stable dynamic content script IDs', () => {
    expect(contentScriptIdForOrigin('https://overleaf.example.edu')).toBe(
      contentScriptIdForOrigin('https://overleaf.example.edu')
    )
    expect(contentScriptIdForOrigin('https://overleaf.example.edu')).not.toBe(
      contentScriptIdForOrigin('https://overleaf.example.com')
    )
  })

  it('upserts and removes custom origins by normalized origin', () => {
    const records = upsertCustomOrigin([], {
      origin: 'https://overleaf.example.edu',
      pattern: 'https://overleaf.example.edu/*',
      enabledAt: '2026-06-02T00:00:00.000Z',
    })
    const updated = upsertCustomOrigin(records, {
      origin: 'https://overleaf.example.edu',
      pattern: 'https://overleaf.example.edu/*',
      enabledAt: '2026-06-02T01:00:00.000Z',
    })

    expect(updated).toHaveLength(1)
    expect(updated[0].enabledAt).toBe('2026-06-02T01:00:00.000Z')
    expect(removeCustomOrigin(updated, 'https://overleaf.example.edu')).toEqual([])
  })
})
