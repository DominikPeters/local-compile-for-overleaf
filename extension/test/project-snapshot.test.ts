import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { deflateRawSync } from 'node:zlib'
import { ProjectSnapshotLoader } from '../src/project-snapshot'

const PROJECT_ID = 'project-123'

vi.mock('overleaf-editor-core', () => {
  class FakeFile {
    constructor(public content: string) {}

    isEditable() {
      return true
    }

    async load() {}

    getContent() {
      return this.content
    }

    getHash() {
      return null
    }
  }

  class FakeSnapshot {
    private files = new Map<string, FakeFile>()

    constructor() {}

    static fromRaw(raw: { files: Record<string, { content: string }> }) {
      const snapshot = new FakeSnapshot()
      for (const [path, file] of Object.entries(raw.files)) {
        snapshot.files.set(path, new FakeFile(file.content))
      }
      return snapshot
    }

    applyAll(changes: FakeChange[]) {
      for (const change of changes) {
        for (const operation of change.getOperations()) {
          if ('file' in operation) {
            this.files.set(operation.pathname, new FakeFile(operation.file.content))
          } else if ('newPathname' in operation) {
            if (operation.newPathname === '') {
              this.files.delete(operation.pathname)
            } else {
              const file = this.files.get(operation.pathname)
              if (file) {
                this.files.delete(operation.pathname)
                this.files.set(operation.newPathname, file)
              }
            }
          } else if ('textOperation' in operation) {
            const file = this.files.get(operation.pathname)
            if (!file) continue
            file.content = applyTextOperation(file.content, operation.textOperation)
          }
        }
      }
    }

    getFilePathnames() {
      return [...this.files.keys()]
    }

    getFile(path: string) {
      return this.files.get(path)
    }
  }

  class FakeChange {
    constructor(private readonly operations: any[]) {}

    static fromRaw(raw: { operations: any[] }) {
      return new FakeChange(raw.operations.map(operation => fakeOperation(operation)))
    }

    getOperations() {
      return this.operations
    }
  }

  class FakeChunk {
    constructor(private readonly snapshot: FakeSnapshot, private readonly startVersion: number) {}

    static fromRaw(raw: any) {
      return new FakeChunk(FakeSnapshot.fromRaw(raw.history.snapshot), raw.startVersion)
    }

    getSnapshot() {
      return this.snapshot
    }

    getChanges() {
      return []
    }

    getEndVersion() {
      return this.startVersion
    }
  }

  return {
    Change: FakeChange,
    Chunk: FakeChunk,
    Snapshot: FakeSnapshot,
  }
})

describe('ProjectSnapshotLoader', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('materializes the latest Overleaf history chunk as a full snapshot payload', async () => {
    const requests: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const path = requestPath(input)
      requests.push(path)
      if (path === `/project/${PROJECT_ID}/flush`) return jsonResponse({})
      if (path === `/project/${PROJECT_ID}/latest/history`) {
        return jsonResponse({
          chunk: rawChunk({
            startVersion: 10,
            files: {
              'main.tex': { content: '\\documentclass{article}' },
              'chapters/intro.tex': { content: 'Intro' },
            },
          }),
        })
      }
      throw new Error(`Unexpected request: ${path}`)
    }))

    const payload = await new ProjectSnapshotLoader(PROJECT_ID).refresh()

    expect(payload).toEqual({
      projectId: PROJECT_ID,
      version: 10,
      full: true,
      deletedFiles: [],
      files: [
        {
          path: 'main.tex',
          encoding: 'utf8',
          content: '\\documentclass{article}',
        },
        {
          path: 'chapters/intro.tex',
          encoding: 'utf8',
          content: 'Intro',
        },
      ],
    })
    expect(requests).toEqual([
      `/project/${PROJECT_ID}/flush`,
      `/project/${PROJECT_ID}/latest/history`,
    ])
  })

  it('sends only changed and deleted files after the initial snapshot', async () => {
    let changesServed = false
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const path = requestPath(input)
      if (path === `/project/${PROJECT_ID}/flush`) return jsonResponse({})
      if (path === `/project/${PROJECT_ID}/latest/history`) {
        return jsonResponse({
          chunk: rawChunk({
            startVersion: 3,
            files: {
              'main.tex': { content: 'old' },
              'old.tex': { content: 'delete me' },
            },
          }),
        })
      }
      if (path === `/project/${PROJECT_ID}/changes?since=3&paginated=true`) {
        changesServed = true
        return jsonResponse({
          hasMore: false,
          changes: [
            rawChange([
              {
                pathname: 'main.tex',
                textOperation: [3, ' and new'],
              },
              {
                pathname: 'old.tex',
                newPathname: '',
              },
              {
                pathname: 'added.tex',
                file: { content: 'added' },
              },
            ]),
          ],
        })
      }
      throw new Error(`Unexpected request: ${path}`)
    }))

    const loader = new ProjectSnapshotLoader(PROJECT_ID)
    await loader.refresh()
    const payload = await loader.refresh()

    expect(changesServed).toBe(true)
    expect(payload).toEqual({
      projectId: PROJECT_ID,
      version: 4,
      full: false,
      deletedFiles: ['old.tex'],
      files: [
        {
          path: 'main.tex',
          encoding: 'utf8',
          content: 'old and new',
        },
        {
          path: 'added.tex',
          encoding: 'utf8',
          content: 'added',
        },
      ],
    })
  })

  it('uses the project zip download when restricted token mode is detected', async () => {
    const requests: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const path = requestPath(input)
      requests.push(path)
      if (path === `/Project/${PROJECT_ID}/download/zip`) {
        return new Response(
          makeStoredZip([
            { path: 'main.tex', content: textBytes('\\documentclass{article}') },
            { path: 'figures/dot.bin', content: new Uint8Array([0, 1, 2, 3]) },
          ]),
          { headers: { 'Content-Type': 'application/zip' } }
        )
      }
      throw new Error(`Unexpected request: ${path}`)
    }))

    const payload = await new ProjectSnapshotLoader(PROJECT_ID).refresh({
      preferZipFallback: true,
    })

    expect(requests).toEqual([`/Project/${PROJECT_ID}/download/zip`])
    expect(payload).toMatchObject({
      projectId: PROJECT_ID,
      full: true,
      deletedFiles: [],
      files: [
        {
          path: 'main.tex',
          encoding: 'utf8',
          content: '\\documentclass{article}',
        },
        {
          path: 'figures/dot.bin',
          encoding: 'base64',
          content: 'AAECAw==',
        },
      ],
    })
  })

  it.each([
    { status: 403, statusText: 'Forbidden' },
    { status: 404, statusText: 'Not Found' },
  ])(
    'falls back to project zip download only when history snapshot endpoints return $status',
    async ({ status, statusText }) => {
      const requests: string[] = []
      vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
        const path = requestPath(input)
        requests.push(path)
        if (path === `/project/${PROJECT_ID}/flush`) {
          return new Response(statusText, { status, statusText })
        }
        if (path === `/Project/${PROJECT_ID}/download/zip`) {
          return new Response(
            makeStoredZip([{ path: 'main.tex', content: textBytes('from zip') }])
          )
        }
        throw new Error(`Unexpected request: ${path}`)
      }))

      const payload = await new ProjectSnapshotLoader(PROJECT_ID).refresh()

      expect(requests).toEqual([
        `/project/${PROJECT_ID}/flush`,
        `/Project/${PROJECT_ID}/download/zip`,
      ])
      expect(payload.files).toEqual([
        {
          path: 'main.tex',
          encoding: 'utf8',
          content: 'from zip',
        },
      ])
    }
  )

  it('materializes deflated project zip entries', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const path = requestPath(input)
      if (path === `/Project/${PROJECT_ID}/download/zip`) {
        return new Response(
          makeStoredZip([
            {
              path: 'main.tex',
              content: textBytes('compressed text'),
              method: 8,
            },
          ])
        )
      }
      throw new Error(`Unexpected request: ${path}`)
    }))

    const payload = await new ProjectSnapshotLoader(PROJECT_ID).refresh({
      preferZipFallback: true,
    })

    expect(payload.files).toEqual([
      {
        path: 'main.tex',
        encoding: 'utf8',
        content: 'compressed text',
      },
    ])
  })
})

function fakeOperation(raw: any) {
  const operation = {
    ...raw,
    getPathname: () => raw.pathname,
    isRemoveFile: () => raw.newPathname === '',
  }
  if ('newPathname' in raw) {
    return {
      ...operation,
      getNewPathname: () => raw.newPathname,
    }
  }
  return operation
}

function applyTextOperation(content: string, operations: Array<string | number>): string {
  let cursor = 0
  let result = ''
  for (const operation of operations) {
    if (typeof operation === 'number' && operation >= 0) {
      result += content.slice(cursor, cursor + operation)
      cursor += operation
    } else if (typeof operation === 'number') {
      cursor += -operation
    } else {
      result += operation
    }
  }
  result += content.slice(cursor)
  return result
}

function rawChunk({
  startVersion,
  files,
}: {
  startVersion: number
  files: Record<string, unknown>
}) {
  return {
    startVersion,
    history: {
      snapshot: { files },
      changes: [],
    },
  }
}

function rawChange(operations: unknown[]) {
  return {
    operations,
    timestamp: '2026-06-01T00:00:00.000Z',
    authors: [],
  }
}

function requestPath(input: RequestInfo | URL): string {
  const url = typeof input === 'string' ? input : input.toString()
  return url.startsWith('http') ? new URL(url).pathname + new URL(url).search : url
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    headers: { 'Content-Type': 'application/json' },
  })
}

function makeStoredZip(
  entries: Array<{ path: string; content: Uint8Array; method?: 0 | 8 }>
): ArrayBuffer {
  const chunks: Uint8Array[] = []
  const centralDirectory: Uint8Array[] = []
  let localOffset = 0
  for (const entry of entries) {
    const path = textBytes(entry.path)
    const method = entry.method ?? 0
    const compressedContent =
      method === 8 ? new Uint8Array(deflateRawSync(entry.content)) : entry.content
    const header = new Uint8Array(30)
    writeUint32(header, 0, 0x04034b50)
    writeUint16(header, 4, 20)
    writeUint16(header, 6, 0)
    writeUint16(header, 8, method)
    writeUint32(header, 18, compressedContent.byteLength)
    writeUint32(header, 22, entry.content.byteLength)
    writeUint16(header, 26, path.byteLength)
    chunks.push(header, path, compressedContent)

    const centralHeader = new Uint8Array(46)
    writeUint32(centralHeader, 0, 0x02014b50)
    writeUint16(centralHeader, 4, 20)
    writeUint16(centralHeader, 6, 20)
    writeUint16(centralHeader, 8, 0)
    writeUint16(centralHeader, 10, method)
    writeUint32(centralHeader, 20, compressedContent.byteLength)
    writeUint32(centralHeader, 24, entry.content.byteLength)
    writeUint16(centralHeader, 28, path.byteLength)
    writeUint32(centralHeader, 42, localOffset)
    centralDirectory.push(centralHeader, path)
    localOffset += header.byteLength + path.byteLength + compressedContent.byteLength
  }
  const centralDirectoryOffset = localOffset
  const centralDirectorySize = centralDirectory.reduce(
    (size, chunk) => size + chunk.byteLength,
    0
  )
  chunks.push(...centralDirectory)
  const end = new Uint8Array(22)
  writeUint32(end, 0, 0x06054b50)
  writeUint16(end, 8, entries.length)
  writeUint16(end, 10, entries.length)
  writeUint32(end, 12, centralDirectorySize)
  writeUint32(end, 16, centralDirectoryOffset)
  chunks.push(end)
  return bytesToArrayBuffer(concat(chunks))
}

function textBytes(value: string): Uint8Array {
  return new TextEncoder().encode(value)
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.length, 0))
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.length
  }
  return result
}

function writeUint16(bytes: Uint8Array, offset: number, value: number) {
  bytes[offset] = value & 0xff
  bytes[offset + 1] = (value >> 8) & 0xff
}

function writeUint32(bytes: Uint8Array, offset: number, value: number) {
  bytes[offset] = value & 0xff
  bytes[offset + 1] = (value >> 8) & 0xff
  bytes[offset + 2] = (value >> 16) & 0xff
  bytes[offset + 3] = (value >> 24) & 0xff
}

function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}
