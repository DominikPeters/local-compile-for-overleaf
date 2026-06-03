import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { BYPASS_NEXT_COMPILE, EXTENSION_RESPONSE, PAGE_REQUEST } from '../src/types'

describe('page fetch shim', () => {
  const originalFetch = vi.fn()

  beforeAll(async () => {
    window.fetch = originalFetch as unknown as typeof fetch
    await import('../src/page-shim')
  })

  beforeEach(() => {
    originalFetch.mockReset()
  })

  it('intercepts Overleaf compile fetches and returns the extension response as JSON', async () => {
    const requestSeen = new Promise<void>(resolve => {
      window.addEventListener(
        'message',
        event => {
          if (event.data?.type !== PAGE_REQUEST) return
          expect(event.data.payload).toMatchObject({
            kind: 'compile',
            projectId: 'abc123',
            bodyText: '{"rootResourcePath":"main.tex"}',
          })
          window.dispatchEvent(
            new MessageEvent('message', {
              source: window,
              origin: window.location.origin,
              data: {
                type: EXTENSION_RESPONSE,
                id: event.data.id,
                payload: { status: 'success', outputFiles: [{ path: 'output.pdf' }] },
              },
            })
          )
          resolve()
        },
        { once: true }
      )
    })

    const responsePromise = window
      .fetch('/project/abc123/compile', {
        method: 'POST',
        body: '{"rootResourcePath":"main.tex"}',
      })
      .then(response => response.json())

    await requestSeen

    await expect(responsePromise).resolves.toMatchObject({
      status: 'success',
      outputFiles: [{ path: 'output.pdf' }],
    })
    expect(originalFetch).not.toHaveBeenCalled()
  })

  it('bypasses exactly one compile request when Compile on web dispatches the bypass event', async () => {
    originalFetch.mockResolvedValue(jsonResponse({ status: 'web-success' }))

    document.dispatchEvent(new Event(BYPASS_NEXT_COMPILE))
    const first = await window.fetch('/project/abc123/compile', { method: 'POST' })

    expect(await first.json()).toEqual({ status: 'web-success' })
    expect(originalFetch).toHaveBeenCalledTimes(1)

    const requestSeen = new Promise<void>(resolve => {
      window.addEventListener(
        'message',
        event => {
          if (event.data?.type !== PAGE_REQUEST) return
          window.dispatchEvent(
            new MessageEvent('message', {
              source: window,
              origin: window.location.origin,
              data: {
                type: EXTENSION_RESPONSE,
                id: event.data.id,
                payload: { status: 'local-success' },
              },
            })
          )
          resolve()
        },
        { once: true }
      )
    })

    const secondPromise = window
      .fetch('/project/abc123/compile', { method: 'POST' })
      .then(response => response.json())
    await requestSeen

    await expect(secondPromise).resolves.toEqual({ status: 'local-success' })
    expect(originalFetch).toHaveBeenCalledTimes(1)
  })

  it('turns bridge failures into Overleaf-shaped compile failures', async () => {
    const requestSeen = new Promise<void>(resolve => {
      window.addEventListener(
        'message',
        event => {
          if (event.data?.type !== PAGE_REQUEST) return
          window.dispatchEvent(
            new MessageEvent('message', {
              source: window,
              origin: window.location.origin,
              data: {
                type: EXTENSION_RESPONSE,
                id: event.data.id,
                error: 'native host unavailable',
              },
            })
          )
          resolve()
        },
        { once: true }
      )
    })

    const responsePromise = window
      .fetch('/project/abc123/compile', { method: 'POST' })
      .then(response => response.json())
    await requestSeen

    await expect(responsePromise).resolves.toMatchObject({
      status: 'failure',
      compileGroup: 'standard',
      clsiServerId: 'local',
      validationProblems: null,
      error: 'native host unavailable',
    })
  })

  it('intercepts legacy Angular XMLHttpRequest compile requests', async () => {
    const requestSeen = new Promise<void>(resolve => {
      window.addEventListener(
        'message',
        event => {
          if (event.data?.type !== PAGE_REQUEST) return
          expect(event.data.payload).toMatchObject({
            kind: 'compile',
            projectId: 'legacy123',
            bodyText: '{"draft":false}',
          })
          window.dispatchEvent(
            new MessageEvent('message', {
              source: window,
              origin: window.location.origin,
              data: {
                type: EXTENSION_RESPONSE,
                id: event.data.id,
                payload: { status: 'success', outputFiles: [{ path: 'output.pdf' }] },
              },
            })
          )
          resolve()
        },
        { once: true }
      )
    })

    const responsePromise = new Promise<Record<string, unknown>>(resolve => {
      const xhr = new XMLHttpRequest()
      xhr.open('POST', '/project/legacy123/compile')
      xhr.onload = () => {
        resolve(JSON.parse(xhr.responseText))
      }
      xhr.send('{"draft":false}')
    })
    await requestSeen

    await expect(responsePromise).resolves.toMatchObject({
      status: 'success',
      outputFiles: [{ path: 'output.pdf' }],
    })
  })
})

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    headers: { 'Content-Type': 'application/json' },
  })
}
