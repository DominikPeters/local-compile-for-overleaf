import type {
  NativeHelloResponse,
  RuntimeCompileRequest,
  RuntimeClearCacheRequest,
  RuntimeHostStatusRequest,
  RuntimeRequest,
  RuntimeStopCompileRequest,
  RuntimeSyncRequest,
} from './types'
import { shapeCompileResponse } from './compile-response'
import { extensionOrigin, extensionRuntime } from './runtime'

const HOST_NAME = 'de.dominik_peters.local_compile_for_overleaf'
const LOG_PREFIX = '[LCFO]'
const DEBUG_BUILD = 'native-debug-2026-06-01T00:05Z'
const IDLE_SHUTDOWN_MS = 5 * 60 * 1000

let nativeClient: NativeClient | null = null
let hello: NativeHelloResponse | null = null
let nativeConnectAttempt = 0
let lastNativeError: string | null = null
let idleShutdownTimer: number | null = null

extensionRuntime.onMessage.addListener((message: RuntimeRequest, _sender, sendResponse) => {
  console.info(LOG_PREFIX, 'runtime request', summarizeRuntimeRequest(message))
  cancelIdleShutdown()
  handleRuntimeMessage(message).then(
    response => {
      scheduleIdleShutdown()
      sendResponse(response)
    },
    error => {
      scheduleIdleShutdown()
      console.error(LOG_PREFIX, 'runtime request failed', error)
      sendResponse({
        status: 'failure',
        outputFiles: [],
        validationProblems: null,
        pdfCachingMinChunkSize: 0,
        error: error instanceof Error ? error.message : String(error),
        lcfoDebug: nativeDebugState(),
      })
    }
  )
  return true
})

async function handleRuntimeMessage(message: RuntimeRequest): Promise<unknown> {
  if (message.type === 'compile') return await handleCompile(message)
  if (message.type === 'clear-cache') return await handleClearCache(message)
  if (message.type === 'stop-compile') return await handleStopCompile(message)
  if (message.type === 'sync') return await handleSync(message)
  if (message.type === 'host-status') return await handleHostStatus(message)
  throw new Error('Unknown runtime message')
}

async function handleHostStatus(_message: RuntimeHostStatusRequest): Promise<unknown> {
  try {
    const session = await ensureHost()
    return {
      connected: true,
      version: session.version,
      capabilities: session.capabilities,
      lcfoDebug: nativeDebugState(),
    }
  } catch (error) {
    return {
      connected: false,
      error: errorMessage(error),
      lcfoDebug: nativeDebugState(),
    }
  }
}

async function handleCompile(message: RuntimeCompileRequest): Promise<unknown> {
  const session = await ensureHost()
  console.info(LOG_PREFIX, 'sending snapshot', {
    projectId: message.snapshot.projectId,
    version: message.snapshot.version,
    files: message.snapshot.files.length,
  })
  await postJSON(session, `/v1/projects/${encodeURIComponent(message.snapshot.projectId)}/snapshot`, {
    snapshot: message.snapshot,
  })

  const compileBody = parseCompileBody(message.request.bodyText)
  console.info(LOG_PREFIX, 'starting local compile', {
    projectId: message.request.projectId,
    rootResourcePath: compileBody.rootResourcePath || 'main.tex',
    draft: Boolean(compileBody.draft),
    stopOnFirstError: Boolean(compileBody.stopOnFirstError),
    check: compileBody.check,
    incrementalCompilesEnabled: compileBody.incrementalCompilesEnabled,
  })
  const data = await postJSON(
    session,
    `/v1/projects/${encodeURIComponent(message.request.projectId)}/compile`,
    {
      ...compileBody,
      rootResourcePath: compileBody.rootResourcePath || 'main.tex',
    }
  )

  const shaped = shapeCompileResponse(data, session)
  console.info(LOG_PREFIX, 'local compile response', {
    status: shaped.status,
    outputFiles: Array.isArray(shaped.outputFiles) ? shaped.outputFiles.map(file => file.path) : [],
    pdfDownloadDomain: shaped.pdfDownloadDomain,
  })
  return shaped
}

async function handleClearCache(message: RuntimeClearCacheRequest): Promise<unknown> {
  const session = await ensureHost()
  console.info(LOG_PREFIX, 'clearing local compile cache', {
    projectId: message.request.projectId,
  })
  return await deleteJSON(
    session,
    `/v1/projects/${encodeURIComponent(message.request.projectId)}/output`
  )
}

async function handleStopCompile(message: RuntimeStopCompileRequest): Promise<unknown> {
  const session = await ensureHost()
  console.info(LOG_PREFIX, 'stopping local compile', {
    projectId: message.request.projectId,
  })
  return await postJSON(
    session,
    `/v1/projects/${encodeURIComponent(message.request.projectId)}/compile/stop`,
    {}
  )
}

async function handleSync(message: RuntimeSyncRequest): Promise<unknown> {
  const session = await ensureHost()
  const params = new URLSearchParams(message.request.query)
  const buildId = params.get('buildId')
  if (!buildId) {
    return message.request.kind === 'sync-code' ? { pdf: [] } : { code: [] }
  }
  params.delete('clsiserverid')
  params.delete('editorId')
  params.delete('buildId')
  const direction = message.request.kind === 'sync-code' ? 'code' : 'pdf'
  return await getJSON(
    session,
    `/v1/projects/${encodeURIComponent(message.request.projectId)}/builds/${encodeURIComponent(
      buildId
    )}/sync/${direction}?${params.toString()}`
  )
}

async function ensureHost(): Promise<NativeHelloResponse> {
  if (hello) return hello
  try {
    hello = await connectHost()
  } catch (error) {
    lastNativeError = errorMessage(error)
    console.warn(LOG_PREFIX, 'native host hello failed; retrying once', error)
    nativeClient = null
    hello = null
    hello = await connectHost()
  }
  if (!hello?.ok || !hello.port || !hello.token) {
    throw new Error('Native host returned an invalid hello response')
  }
  console.info(LOG_PREFIX, 'native host connected', {
    version: hello.version,
    port: hello.port,
    capabilities: hello.capabilities,
  })
  return hello
}

async function connectHost(): Promise<NativeHelloResponse> {
  nativeConnectAttempt += 1
  console.info(LOG_PREFIX, 'connecting native host', nativeDebugState())
  if (!nativeClient) nativeClient = new NativeClient(HOST_NAME)
  return (await nativeClient.request({
    type: 'hello',
    extensionOrigin: extensionOrigin(),
  })) as NativeHelloResponse
}

function cancelIdleShutdown() {
  if (idleShutdownTimer == null) return
  clearTimeout(idleShutdownTimer)
  idleShutdownTimer = null
}

function scheduleIdleShutdown() {
  cancelIdleShutdown()
  idleShutdownTimer = setTimeout(() => {
    idleShutdownTimer = null
    shutdownIdleHost().catch(error => {
      console.warn(LOG_PREFIX, 'idle native host shutdown failed', error)
    })
  }, IDLE_SHUTDOWN_MS) as unknown as number
}

async function shutdownIdleHost() {
  if (!nativeClient || !hello) return
  const client = nativeClient
  try {
    const response = (await client.request({ type: 'shutdown' })) as { stopped?: boolean }
    console.info(LOG_PREFIX, 'idle native host shutdown response', response)
    if (response.stopped !== false) {
      nativeClient = null
      hello = null
    }
  } catch (error) {
    lastNativeError = errorMessage(error)
    nativeClient = null
    hello = null
    throw error
  }
}

async function postJSON(session: NativeHelloResponse, path: string, body: unknown) {
  const response = await fetch(`http://127.0.0.1:${session.port}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  })
  return await parseLocalResponse(response)
}

async function deleteJSON(session: NativeHelloResponse, path: string) {
  const response = await fetch(`http://127.0.0.1:${session.port}${path}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${session.token}`,
      Accept: 'application/json',
    },
  })
  return await parseLocalResponse(response)
}

async function getJSON(session: NativeHelloResponse, path: string) {
  const response = await fetch(`http://127.0.0.1:${session.port}${path}`, {
    headers: {
      Authorization: `Bearer ${session.token}`,
      Accept: 'application/json',
    },
  })
  return await parseLocalResponse(response)
}

async function parseLocalResponse(response: Response) {
  const text = await response.text()
  const data = text ? JSON.parse(text) : null
  if (!response.ok) {
    throw new Error(data?.error || `Local host request failed: ${response.status}`)
  }
  return data
}

function parseCompileBody(bodyText: string | null): Record<string, unknown> {
  if (!bodyText) return {}
  try {
    return JSON.parse(bodyText)
  } catch {
    return {}
  }
}

function summarizeRuntimeRequest(message: RuntimeRequest) {
  if (message.type === 'host-status') {
    return {
      type: message.type,
    }
  }
  if (message.type === 'compile') {
    return {
      type: message.type,
      projectId: message.request.projectId,
      snapshotFiles: message.snapshot.files.length,
      snapshotVersion: message.snapshot.version,
    }
  }
  return {
    type: message.type,
    kind: message.request.kind,
    projectId: message.request.projectId,
    query: message.request.query,
  }
}

function nativeDebugState() {
  return {
    debugBuild: DEBUG_BUILD,
    extensionId: extensionRuntime.id,
    extensionOrigin: extensionOrigin(),
    hostName: HOST_NAME,
    nativeConnectAttempt,
    lastNativeError,
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

class NativeClient {
  private port: chrome.runtime.Port
  private nextId = 1
  private pending = new Map<
    number,
    {
      resolve: (value: unknown) => void
      reject: (error: Error) => void
      timeout: number
    }
  >()

  constructor(hostName: string) {
    this.port = extensionRuntime.connectNative(hostName)
    this.port.onMessage.addListener(message => this.handleMessage(message))
    this.port.onDisconnect.addListener(() => this.handleDisconnect())
  }

  request(payload: Record<string, unknown>): Promise<unknown> {
    const id = this.nextId++
    this.port.postMessage({ id, ...payload })
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error('Native host request timed out'))
      }, 30_000) as unknown as number
      this.pending.set(id, { resolve, reject, timeout })
    })
  }

  private handleMessage(message: { id?: number; ok?: boolean; error?: string }) {
    if (typeof message.id !== 'number') return
    const pending = this.pending.get(message.id)
    if (!pending) return
    clearTimeout(pending.timeout)
    this.pending.delete(message.id)
    if (message.ok === false || message.error) {
      pending.reject(new Error(message.error || 'Native host request failed'))
    } else {
      pending.resolve(message)
    }
  }

  private handleDisconnect() {
    lastNativeError = extensionRuntime.lastError?.message || 'Native host disconnected'
    const error = new Error(lastNativeError)
    console.error(LOG_PREFIX, 'native host disconnected', error)
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout)
      pending.reject(error)
    }
    this.pending.clear()
    nativeClient = null
    hello = null
  }
}
