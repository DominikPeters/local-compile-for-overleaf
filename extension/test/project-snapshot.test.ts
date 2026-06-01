import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
