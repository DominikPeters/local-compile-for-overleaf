export const PAGE_REQUEST = 'LCFO_PAGE_REQUEST'
export const EXTENSION_RESPONSE = 'LCFO_EXTENSION_RESPONSE'
export const BYPASS_NEXT_COMPILE = 'LCFO_BYPASS_NEXT_COMPILE'

export type ProjectFile = {
  path: string
  encoding: 'utf8' | 'base64'
  content: string
}

export type ProjectSnapshotPayload = {
  projectId: string
  version: number
  full: boolean
  files: ProjectFile[]
  deletedFiles: string[]
}

export type CompileRequestPayload = {
  kind: 'compile'
  projectId: string
  url: string
  bodyText: string | null
}

export type ClearCacheRequestPayload = {
  kind: 'clear-cache'
  projectId: string
  query: string
}

export type StopCompileRequestPayload = {
  kind: 'stop-compile'
  projectId: string
  query: string
}

export type SyncRequestPayload = {
  kind: 'sync-code' | 'sync-pdf'
  projectId: string
  query: string
}

export type PageRequestPayload =
  | CompileRequestPayload
  | ClearCacheRequestPayload
  | StopCompileRequestPayload
  | SyncRequestPayload

export type PageBridgeRequest = {
  type: typeof PAGE_REQUEST
  id: number
  payload: PageRequestPayload
}

export type PageBridgeResponse = {
  type: typeof EXTENSION_RESPONSE
  id: number
  payload?: unknown
  error?: string
}

export type RuntimeCompileRequest = {
  type: 'compile'
  request: CompileRequestPayload
  snapshot: ProjectSnapshotPayload
}

export type RuntimeClearCacheRequest = {
  type: 'clear-cache'
  request: ClearCacheRequestPayload
}

export type RuntimeStopCompileRequest = {
  type: 'stop-compile'
  request: StopCompileRequestPayload
}

export type RuntimeSyncRequest = {
  type: 'sync'
  request: SyncRequestPayload
}

export type RuntimeRequest =
  | RuntimeCompileRequest
  | RuntimeClearCacheRequest
  | RuntimeStopCompileRequest
  | RuntimeSyncRequest

export type NativeHelloResponse = {
  ok: true
  version: string
  port: number
  token: string
  capabilities: {
    latexmk: boolean
    synctex: boolean
  }
}
