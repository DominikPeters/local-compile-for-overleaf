import pLimit from 'p-limit'
import { Change, Chunk, Snapshot } from 'overleaf-editor-core'
import type { ProjectFile, ProjectSnapshotPayload } from './types'

const DOWNLOAD_BLOBS_CONCURRENCY = 8

type RawChunkResponse = {
  chunk: unknown
}

type RawChangesResponse =
  | unknown[]
  | {
      changes: unknown[]
      hasMore: boolean
    }

export type SnapshotRefreshOptions = {
  preferZipFallback?: boolean
}

class OverleafRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly statusText: string,
    public readonly path: string
  ) {
    super(`Overleaf request failed: ${status} ${statusText} ${path}`)
  }
}

class BrowserBlobStore {
  constructor(private readonly projectId: string) {}

  async getString(hash: string, options?: { maxSize?: number }): Promise<string> {
    const init: RequestInit = {}
    if (options?.maxSize === 0) return ''
    if (options?.maxSize) {
      init.headers = {
        Range: `bytes=0-${options.maxSize - 1}`,
      }
    }
    const response = await fetch(`/project/${this.projectId}/blob/${hash}`, init)
    if (!response.ok) {
      throw new Error(`Failed to fetch Overleaf blob ${hash}: ${response.status}`)
    }
    const buffer = await response.arrayBuffer()
    return new TextDecoder('utf-8', { ignoreBOM: true }).decode(buffer)
  }

  async getObject(hash: string): Promise<unknown> {
    return JSON.parse(await this.getString(hash))
  }

  async getBase64(hash: string): Promise<string> {
    const response = await fetch(`/project/${this.projectId}/blob/${hash}`)
    if (!response.ok) {
      throw new Error(`Failed to fetch Overleaf blob ${hash}: ${response.status}`)
    }
    return arrayBufferToBase64(await response.arrayBuffer())
  }
}

export class ProjectSnapshotLoader {
  private snapshot: any = new Snapshot()
  private version = 0
  private initialized = false
  private readonly blobStore: BrowserBlobStore

  constructor(private readonly projectId: string) {
    this.blobStore = new BrowserBlobStore(projectId)
  }

  async refresh(options: SnapshotRefreshOptions = {}): Promise<ProjectSnapshotPayload> {
    if (options.preferZipFallback) {
      return await this.loadZipSnapshot()
    }
    try {
      await this.flushHistory()
      let full = false
      let changedPaths: Set<string> | null = null
      let deletedFiles: string[] = []
      if (!this.initialized) {
        await this.initialize()
        full = true
      } else {
        const delta = await this.loadChanges()
        changedPaths = delta.changedPaths
        deletedFiles = [...delta.deletedFiles]
      }
      await this.loadDocs(changedPaths)
      return await this.toPayload({ full, changedPaths, deletedFiles })
    } catch (error) {
      if (isHistorySnapshotUnavailable(error)) {
        return await this.loadZipSnapshot()
      }
      throw error
    }
  }

  private async flushHistory() {
    await fetchJSON(`/project/${this.projectId}/flush`, { method: 'POST' })
  }

  private async initialize() {
    const response = await fetchJSON<RawChunkResponse>(
      `/project/${this.projectId}/latest/history`
    )
    if (!response?.chunk) {
      throw new Error(
        `Overleaf latest history response did not include a chunk for project ${this.projectId}`
      )
    }
    const chunk = (Chunk as any).fromRaw(response.chunk)
    this.snapshot = chunk.getSnapshot()
    this.snapshot.applyAll(chunk.getChanges())
    this.version = chunk.getEndVersion()
    this.initialized = true
  }

  private async loadChanges(): Promise<{
    changedPaths: Set<string>
    deletedFiles: Set<string>
  }> {
    const changedPaths = new Set<string>()
    const deletedFiles = new Set<string>()
    let hasMore = true
    while (hasMore) {
      const response = await fetchJSON<RawChangesResponse>(
        `/project/${this.projectId}/changes?since=${this.version}&paginated=true`
      )
      if (!response) {
        throw new Error(
          `Overleaf changes response was empty for project ${this.projectId} since ${this.version}`
        )
      }
      const rawChanges = Array.isArray(response) ? response : response.changes
      const changes = rawChanges
        .map(raw => (Change as any).fromRaw(raw))
        .filter(Boolean)
      for (const change of changes) {
        collectChangedPaths(change, changedPaths, deletedFiles)
      }
      this.snapshot.applyAll(changes)
      this.version += changes.length
      hasMore = Array.isArray(response) ? false : response.hasMore
    }
    return { changedPaths, deletedFiles }
  }

  private async loadDocs(changedPaths: Set<string> | null) {
    const paths = changedPaths
      ? this.getDocPaths().filter(path => changedPaths.has(path))
      : this.getDocPaths()
    const limit = pLimit(DOWNLOAD_BLOBS_CONCURRENCY)
    await Promise.all(
      paths.map(path =>
        limit(async () => {
          const file = this.snapshot.getFile(path)
          await file?.load('eager', this.blobStore)
        })
      )
    )
  }

  private getDocPaths(): string[] {
    const allPaths = this.snapshot.getFilePathnames()
    return allPaths.filter((path: string) => this.snapshot.getFile(path)?.isEditable())
  }

  private getBinaryFiles(): Array<{ path: string; hash: string }> {
    const files = []
    for (const path of this.snapshot.getFilePathnames()) {
      const file = this.snapshot.getFile(path)
      if (!file || file.isEditable()) continue
      const hash = file.getHash()
      if (hash) files.push({ path, hash })
    }
    return files
  }

  private async toPayload({
    full,
    changedPaths,
    deletedFiles,
  }: {
    full: boolean
    changedPaths: Set<string> | null
    deletedFiles: string[]
  }): Promise<ProjectSnapshotPayload> {
    const result: ProjectFile[] = []
    const docPaths = changedPaths
      ? this.getDocPaths().filter(path => changedPaths.has(path))
      : this.getDocPaths()
    for (const path of docPaths) {
      const file = this.snapshot.getFile(path)
      result.push({
        path,
        encoding: 'utf8',
        content: file.getContent({ filterTrackedDeletes: true }) ?? '',
      })
    }

    const limit = pLimit(DOWNLOAD_BLOBS_CONCURRENCY)
    const binaryFileList = changedPaths
      ? this.getBinaryFiles().filter(file => changedPaths.has(file.path))
      : this.getBinaryFiles()
    const binaryFiles = await Promise.all(
      binaryFileList.map(file =>
        limit(async () => ({
          path: file.path,
          encoding: 'base64' as const,
          content: await this.blobStore.getBase64(file.hash),
        }))
      )
    )
    result.push(...binaryFiles)

    return {
      projectId: this.projectId,
      version: this.version,
      full,
      files: result,
      deletedFiles,
    }
  }

  private async loadZipSnapshot(): Promise<ProjectSnapshotPayload> {
    const response = await fetch(`/Project/${this.projectId}/download/zip`, {
      credentials: 'same-origin',
    })
    if (!response.ok) {
      throw new OverleafRequestError(
        response.status,
        response.statusText,
        `/Project/${this.projectId}/download/zip`
      )
    }
    const files = await zipToProjectFiles(await response.arrayBuffer())
    this.snapshot = new Snapshot()
    this.initialized = false
    this.version = Date.now()
    return {
      projectId: this.projectId,
      version: this.version,
      full: true,
      files,
      deletedFiles: [],
    }
  }
}

function collectChangedPaths(
  change: any,
  changedPaths: Set<string>,
  deletedFiles: Set<string>
) {
  for (const operation of change.getOperations()) {
    const pathname =
      typeof operation.getPathname === 'function'
        ? operation.getPathname()
        : operation.pathname
    if (!pathname) continue

    if (typeof operation.isRemoveFile === 'function' && operation.isRemoveFile()) {
      deletedFiles.add(pathname)
      changedPaths.delete(pathname)
      continue
    }

    if (typeof operation.getNewPathname === 'function') {
      deletedFiles.add(pathname)
      const newPathname = operation.getNewPathname()
      if (newPathname) {
        changedPaths.add(newPathname)
        deletedFiles.delete(newPathname)
      }
      continue
    }

    changedPaths.add(pathname)
    deletedFiles.delete(pathname)
  }
}

async function fetchJSON<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...init,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Csrf-Token': csrfToken(),
      ...(init.headers || {}),
    },
  })
  if (!response.ok) {
    throw new OverleafRequestError(response.status, response.statusText, path)
  }
  const text = await response.text()
  if (!text.trim()) return undefined as T
  try {
    return JSON.parse(text) as T
  } catch (error) {
    throw new Error(
      [
        `Overleaf returned invalid JSON for ${path}`,
        `status=${response.status}`,
        `contentType=${response.headers.get('content-type') || 'unknown'}`,
        `body=${text.slice(0, 240)}`,
        `cause=${error instanceof Error ? error.message : String(error)}`,
      ].join(' ')
    )
  }
}

function isHistorySnapshotUnavailable(error: unknown): boolean {
  if (
    !(error instanceof OverleafRequestError) ||
    ![403, 404].includes(error.status)
  ) {
    return false
  }
  return (
    /^\/project\/[^/]+\/flush$/.test(error.path) ||
    /^\/project\/[^/]+\/latest\/history$/.test(error.path) ||
    /^\/project\/[^/]+\/changes(?:\?|$)/.test(error.path)
  )
}

async function zipToProjectFiles(buffer: ArrayBuffer): Promise<ProjectFile[]> {
  const bytes = new Uint8Array(buffer)
  const entries: ProjectFile[] = []
  const centralDirectory = findCentralDirectory(bytes)
  let offset = centralDirectory.offset
  for (let index = 0; index < centralDirectory.entries; index += 1) {
    if (offset + 46 > bytes.length || uint32(bytes, offset) !== 0x02014b50) {
      throw new Error('Overleaf zip fallback received an invalid central directory')
    }
    const method = uint16(bytes, offset + 10)
    const compressedSize = uint32(bytes, offset + 20)
    const fileNameLength = uint16(bytes, offset + 28)
    const extraLength = uint16(bytes, offset + 30)
    const commentLength = uint16(bytes, offset + 32)
    const localHeaderOffset = uint32(bytes, offset + 42)
    if (compressedSize === 0xffffffff || localHeaderOffset === 0xffffffff) {
      throw new Error('Overleaf zip fallback does not support Zip64 archives')
    }
    const path = normalizeZipPath(decodeUtf8(bytes.subarray(offset + 46, offset + 46 + fileNameLength)))
    offset += 46 + fileNameLength + extraLength + commentLength
    if (!path || path.endsWith('/')) continue
    if (localHeaderOffset + 30 > bytes.length || uint32(bytes, localHeaderOffset) !== 0x04034b50) {
      throw new Error('Overleaf zip fallback received an invalid local file header')
    }
    const localNameLength = uint16(bytes, localHeaderOffset + 26)
    const localExtraLength = uint16(bytes, localHeaderOffset + 28)
    const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength
    const dataEnd = dataStart + compressedSize
    if (dataEnd > bytes.length) {
      throw new Error('Overleaf zip fallback received a truncated zip entry')
    }
    const data = await unzipEntry(bytes.subarray(dataStart, dataEnd), method)
    entries.push({
      path,
      ...projectFileContent(data),
    })
  }
  return entries
}

function findCentralDirectory(bytes: Uint8Array): { offset: number; entries: number } {
  const minimumEndOfCentralDirectorySize = 22
  const maxCommentSize = 0xffff
  const start = Math.max(0, bytes.length - minimumEndOfCentralDirectorySize - maxCommentSize)
  for (let offset = bytes.length - minimumEndOfCentralDirectorySize; offset >= start; offset -= 1) {
    if (uint32(bytes, offset) !== 0x06054b50) continue
    return {
      entries: uint16(bytes, offset + 10),
      offset: uint32(bytes, offset + 16),
    }
  }
  throw new Error('Overleaf zip fallback could not find the zip central directory')
}

async function unzipEntry(data: Uint8Array, method: number): Promise<Uint8Array> {
  if (method === 0) return data
  if (method !== 8) {
    throw new Error(`Overleaf zip fallback does not support zip method ${method}`)
  }
  const DecompressionStreamConstructor = globalThis.DecompressionStream
  if (!DecompressionStreamConstructor) {
    throw new Error('Overleaf zip fallback requires browser DecompressionStream support')
  }
  const transform = new DecompressionStreamConstructor(
    'deflate-raw'
  ) as unknown as ReadableWritablePair<Uint8Array, Uint8Array>
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(data)
      controller.close()
    },
  }).pipeThrough(transform)
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

function projectFileContent(data: Uint8Array): Omit<ProjectFile, 'path'> {
  if (isLikelyUtf8(data)) {
    return {
      encoding: 'utf8',
      content: decodeUtf8(data),
    }
  }
  return {
    encoding: 'base64',
    content: arrayBufferToBase64(bytesToArrayBuffer(data)),
  }
}

function normalizeZipPath(path: string): string | null {
  const normalized = path.replace(/\\/g, '/').replace(/^\/+/, '')
  const parts = normalized.split('/')
  if (!normalized || parts.some(part => part === '..')) return null
  return normalized
}

function isLikelyUtf8(data: Uint8Array): boolean {
  if (data.includes(0)) return false
  const decoded = decodeUtf8(data)
  return !decoded.includes('\uFFFD')
}

function decodeUtf8(data: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: false, ignoreBOM: true }).decode(data)
}

function uint16(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8)
}

function uint32(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] |
      (bytes[offset + 1] << 8) |
      (bytes[offset + 2] << 16) |
      (bytes[offset + 3] << 24)) >>>
    0
  )
}

function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}

function csrfToken(): string {
  return (
    document.querySelector<HTMLMetaElement>('meta[name="ol-csrfToken"]')?.content ?? ''
  )
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}
