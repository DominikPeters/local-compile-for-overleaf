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

  async refresh(): Promise<ProjectSnapshotPayload> {
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
    throw new Error(
      `Overleaf request failed: ${response.status} ${response.statusText} ${path}`
    )
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
