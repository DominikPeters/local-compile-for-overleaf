import {
  type PageBridgeResponse,
  type PageRequestPayload,
} from './types'

const BYPASS_NEXT_COMPILE = 'LCFO_BYPASS_NEXT_COMPILE'
const EXTENSION_RESPONSE = 'LCFO_EXTENSION_RESPONSE'
const PAGE_REQUEST = 'LCFO_PAGE_REQUEST'
const LOG_PREFIX = '[LCFO]'

type PendingRequest = {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timeout: number
}

const originalFetch = window.fetch.bind(window)
const pending = new Map<number, PendingRequest>()
let nextId = 1
let bypassNextCompile = false

function bypassNextCompileRequest() {
  bypassNextCompile = true
  console.info(LOG_PREFIX, 'next compile will bypass local shim')
}

function projectIdFromPath(pathname: string): string | null {
  const match = pathname.match(/\/project\/([^/]+)\//)
  return match?.[1] ?? null
}

function requestUrl(input: RequestInfo | URL): URL {
  if (typeof input === 'string') return new URL(input, window.location.origin)
  if (input instanceof URL) return input
  return new URL(input.url, window.location.origin)
}

function requestMethod(input: RequestInfo | URL, init?: RequestInit): string {
  if (init?.method) return init.method.toUpperCase()
  if (input instanceof Request) return input.method.toUpperCase()
  return 'GET'
}

async function requestBodyText(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<string | null> {
  if (typeof init?.body === 'string') return init.body
  if (init?.body != null) return String(init.body)
  if (input instanceof Request) return await input.clone().text()
  return null
}

function askExtension(payload: PageRequestPayload): Promise<unknown> {
  const id = nextId++
  window.postMessage({ type: PAGE_REQUEST, id, payload }, window.location.origin)

  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      pending.delete(id)
      reject(new Error('Local compile request timed out'))
    }, 10 * 60 * 1000)
    pending.set(id, { resolve, reject, timeout })
  })
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload ?? null), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
    },
  })
}

window.addEventListener('message', event => {
  if (event.source !== window) return
  const data = event.data as PageBridgeResponse | { type?: string }
  if (data.type !== EXTENSION_RESPONSE) return
  if (!isPageBridgeResponse(data)) return

  const pendingRequest = pending.get(data.id)
  if (!pendingRequest) return

  window.clearTimeout(pendingRequest.timeout)
  pending.delete(data.id)
  if ('error' in data && data.error) {
    pendingRequest.reject(new Error(data.error))
  } else {
    pendingRequest.resolve(data.payload)
  }
})

window.fetch = async function overleafLocalCompileFetch(input, init) {
  const url = requestUrl(input)
  const method = requestMethod(input, init)
  const projectId = projectIdFromPath(url.pathname)

  if (projectId && method === 'POST' && /\/project\/[^/]+\/compile$/.test(url.pathname)) {
    if (bypassNextCompile) {
      bypassNextCompile = false
      console.info(LOG_PREFIX, 'compile bypassed; using Overleaf web compile')
      return originalFetch(input, init)
    }

    try {
      const payload = await askExtension({
        kind: 'compile',
        projectId,
        url: url.href,
        bodyText: await requestBodyText(input, init),
      })
      console.info(LOG_PREFIX, 'compile intercepted response', payload)
      return jsonResponse(payload ?? compileFailure('Local compile returned no response'))
    } catch (error) {
      console.error(LOG_PREFIX, 'compile interception failed', error)
      return jsonResponse(compileFailure(errorMessage(error)))
    }
  }

  if (projectId && method === 'POST' && /\/project\/[^/]+\/compile\/stop$/.test(url.pathname)) {
    try {
      const payload = await askExtension({
        kind: 'stop-compile',
        projectId,
        query: url.search,
      })
      return jsonResponse(payload ?? { ok: true })
    } catch (error) {
      console.error(LOG_PREFIX, 'stop-compile interception failed', error)
      return jsonResponse({ error: errorMessage(error) })
    }
  }

  if (projectId && method === 'DELETE' && /\/project\/[^/]+\/output$/.test(url.pathname)) {
    try {
      const payload = await askExtension({
        kind: 'clear-cache',
        projectId,
        query: url.search,
      })
      return jsonResponse(payload ?? { ok: true })
    } catch (error) {
      console.error(LOG_PREFIX, 'clear-cache interception failed', error)
      return jsonResponse({ error: errorMessage(error) })
    }
  }

  if (projectId && method === 'GET' && /\/project\/[^/]+\/sync\/code$/.test(url.pathname)) {
    try {
      const payload = await askExtension({
        kind: 'sync-code',
        projectId,
        query: url.search,
      })
      return jsonResponse(payload ?? { pdf: [] })
    } catch {
      return jsonResponse({ pdf: [] })
    }
  }

  if (projectId && method === 'GET' && /\/project\/[^/]+\/sync\/pdf$/.test(url.pathname)) {
    try {
      const payload = await askExtension({
        kind: 'sync-pdf',
        projectId,
        query: url.search,
      })
      return jsonResponse(payload ?? { code: [] })
    } catch {
      return jsonResponse({ code: [] })
    }
  }

  return originalFetch(input, init)
}

document.addEventListener(BYPASS_NEXT_COMPILE, bypassNextCompileRequest)

function isPageBridgeResponse(value: unknown): value is PageBridgeResponse {
  const response = value as PageBridgeResponse
  return response.type === EXTENSION_RESPONSE && typeof response.id === 'number'
}

function compileFailure(message: string) {
  return {
    status: 'failure',
    outputFiles: [],
    compileGroup: 'standard',
    clsiServerId: 'local',
    clsiCacheShard: 'local',
    pdfCachingMinChunkSize: 0,
    validationProblems: null,
    stats: {},
    timings: {},
    error: message,
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
