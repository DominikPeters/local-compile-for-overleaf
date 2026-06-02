import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test'
import { createHash, generateKeyPairSync } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { chmodSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const REPO_ROOT = resolve(__dirname, '../..')
const EXTENSION_DIST = join(REPO_ROOT, 'extension/dist')
const HOST_NAME = 'com.overleaf_local_compile.host'
const PROJECT_ID = 'project-123'

test.describe('Chrome extension with real Native Messaging host', () => {
  let tempRoot: string
  let mockOverleaf: MockOverleaf
  let fakeTools: FakeTools
  let context: BrowserContext
  let cleanupNativeHostManifest: (() => Promise<void>) | undefined

  test.beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'ollc-e2e-'))
    mockOverleaf = await startMockOverleaf()
    fakeTools = await installFakeTools(tempRoot)
    const testExtension = await installTestExtension(tempRoot)
    cleanupNativeHostManifest = await installNativeHostManifest({
      home: process.env.OLLC_E2E_NATIVE_MANIFEST_HOME || homedir(),
      extraDirs: [join(tempRoot, 'profile', 'NativeMessagingHosts')],
      wrapperPath: await installNativeHostWrapper(tempRoot),
      extensionId: testExtension.extensionId,
    })

    context = await chromium.launchPersistentContext(join(tempRoot, 'profile'), {
      channel: process.env.PLAYWRIGHT_CHROME_CHANNEL || 'chromium',
      headless: process.env.OLLC_E2E_HEADLESS !== '0',
      args: [
        `--disable-extensions-except=${testExtension.path}`,
        `--load-extension=${testExtension.path}`,
      ],
      env: {
        ...process.env,
        HOME: join(tempRoot, 'home'),
        PYTHONPATH: join(REPO_ROOT, 'native-host/src'),
        OLLC_LATEXMK_PATH: fakeTools.latexmk,
        OLLC_SYNCTEX_PATH: fakeTools.synctex,
        OLLC_FAKE_LATEXMK_LOG: fakeTools.latexmkLog,
      },
    })
  })

  test.afterEach(async () => {
    await context?.close()
    await mockOverleaf?.close()
    await cleanupNativeHostManifest?.()
    cleanupNativeHostManifest = undefined
  })

  test('local Recompile snapshots Overleaf history, compiles through the real host, and serves output files', async () => {
    const page = await openProjectPage(context, mockOverleaf.port)

    await page.getByRole('button', { name: 'Recompile' }).click()
    const compile = await waitForCompile(page, 'success')

    expect(mockOverleaf.webCompileBodies).toHaveLength(0)
    expect(mockOverleaf.flushCount).toBe(1)
    expect(compile).toMatchObject({
      status: 'success',
      compileGroup: 'standard',
      clsiServerId: 'local',
      pdfCachingMinChunkSize: 0,
      validationProblems: null,
    })

    const pdf = compile.outputFiles.find((file: any) => file.path === 'output.pdf')
    const log = compile.outputFiles.find((file: any) => file.path === 'output.log')
    expect(pdf).toMatchObject({
      type: 'pdf',
      build: expect.any(String),
      contentId: expect.any(String),
      size: expect.any(Number),
      ranges: [],
    })
    expect(log).toMatchObject({ type: 'log' })

    const pdfText = await page.evaluate(async ({ domain, url }) => {
      const response = await fetch(domain + url)
      return await response.text()
    }, { domain: compile.pdfDownloadDomain, url: pdf.url })
    expect(pdfText).toContain('%PDF-1.4')

    const latexmkInvocations = await readJsonLines(fakeTools.latexmkLog)
    expect(latexmkInvocations).toHaveLength(1)
    expect(latexmkInvocations[0].argv).toEqual(
      expect.arrayContaining([
        '-jobname=output',
        '-synctex=1',
        '-interaction=batchmode',
        '-f',
        '-file-line-error',
        '-pdf',
      ])
    )
  })

  test('Compile on web bypasses the local shim once', async () => {
    const page = await openProjectPage(context, mockOverleaf.port)

    await page.getByRole('button', { name: 'Compile on web' }).click()
    await expect.poll(() => mockOverleaf.webCompileBodies.length).toBe(1)
    await expect.poll(async () => {
      return await page.evaluate(() => (window as any).lastCompileResponse?.status)
    }).toBe('web-success')

    const webCompile = await page.evaluate(() => (window as any).lastCompileResponse)
    expect(webCompile).toMatchObject({ status: 'web-success' })

    await page.evaluate(() => {
      ;(window as any).lastCompileResponse = null
    })
    await page.getByRole('button', { name: 'Recompile' }).click()
    const localCompile = await waitForCompile(page, 'success')
    expect(localCompile.status).toBe('success')
    expect(mockOverleaf.webCompileBodies).toHaveLength(1)
  })

  test('local compile options are forwarded to latexmk flags', async () => {
    const page = await openProjectPage(context, mockOverleaf.port)

    await page.evaluate(() => {
      ;(window as any).compileBody = {
        rootResourcePath: 'main.tex',
        compiler: 'xelatex',
        draft: true,
        stopOnFirstError: true,
        enableShellEscape: true,
        check: 'silent',
        incrementalCompilesEnabled: true,
      }
    })
    await page.getByRole('button', { name: 'Recompile' }).click()
    await waitForCompile(page, 'success')

    const latexmkInvocations = await readJsonLines(fakeTools.latexmkLog)
    expect(latexmkInvocations.at(-1).argv).toEqual(
      expect.arrayContaining(['-halt-on-error', '-shell-escape', '-xelatex'])
    )
    expect(latexmkInvocations.at(-1).rootContent).toContain(
      '\\PassOptionsToPackage{draft}{graphicx}'
    )
  })

  test('SyncTeX requests are bridged to the host and returned in Overleaf-compatible shapes', async () => {
    const page = await openProjectPage(context, mockOverleaf.port)

    await page.getByRole('button', { name: 'Recompile' }).click()
    const compile = await waitForCompile(page, 'success')
    const buildId = compile.outputFiles.find((file: any) => file.path === 'output.pdf').build

    await expect(
      page.evaluate(async build => await (window as any).syncCode(build), buildId)
    ).resolves.toEqual({
      pdf: [
        {
          page: 2,
          h: 133.75,
          v: 664.5,
          width: 42,
          height: 8,
        },
      ],
    })

    await expect(
      page.evaluate(async build => await (window as any).syncPdf(build), buildId)
    ).resolves.toEqual({
      code: [
        {
          file: 'main.tex',
          line: 7,
          column: 3,
        },
      ],
    })
  })
})

async function openProjectPage(context: BrowserContext, port: number): Promise<Page> {
  const page = await context.newPage()
  await page.goto(`http://127.0.0.1:${port}/project/${PROJECT_ID}`)
  await expect(page.getByRole('button', { name: 'Compile on web' })).toBeVisible()
  return page
}

async function waitForCompile(page: Page, status: string): Promise<any> {
  await expect.poll(async () => {
    return await page.evaluate(() => Boolean((window as any).lastCompileResponse))
  }).toBe(true)
  const response = await page.evaluate(() => (window as any).lastCompileResponse)
  expect(response.status, JSON.stringify(response, null, 2)).toBe(status)
  return response
}

async function installTestExtension(tempRoot: string): Promise<{ path: string; extensionId: string }> {
  const extensionPath = join(tempRoot, 'extension')
  await cp(EXTENSION_DIST, extensionPath, { recursive: true })
  const publicKey = generateExtensionPublicKey()
  const manifestPath = join(extensionPath, 'manifest.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  manifest.key = publicKey.base64
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8')
  return {
    path: extensionPath,
    extensionId: extensionIdFromPublicKey(publicKey.der),
  }
}

function generateExtensionPublicKey(): { der: Buffer; base64: string } {
  const { publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: {
      type: 'spki',
      format: 'der',
    },
    privateKeyEncoding: {
      type: 'pkcs8',
      format: 'pem',
    },
  })
  const der = Buffer.from(publicKey)
  return { der, base64: der.toString('base64') }
}

function extensionIdFromPublicKey(publicKeyDer: Buffer): string {
  const hex = createHash('sha256').update(publicKeyDer).digest('hex').slice(0, 32)
  return [...hex].map(char => String.fromCharCode('a'.charCodeAt(0) + Number.parseInt(char, 16))).join('')
}

async function installNativeHostWrapper(tempRoot: string): Promise<string> {
  const wrapperPath = join(tempRoot, 'overleaf-local-compile-host')
  await writeFile(
    wrapperPath,
    [
      '#!/bin/sh',
      'exec "${PYTHON:-python3}" -m overleaf_local_compile "$@"',
      '',
    ].join('\n'),
    'utf8'
  )
  chmodSync(wrapperPath, 0o755)
  return wrapperPath
}

async function installNativeHostManifest({
  home,
  extraDirs = [],
  wrapperPath,
  extensionId,
}: {
  home: string
  extraDirs?: string[]
  wrapperPath: string
  extensionId: string
}): Promise<() => Promise<void>> {
  const manifest = {
    name: HOST_NAME,
    description: 'Overleaf Local Compile test host',
    path: wrapperPath,
    type: 'stdio',
    allowed_origins: [`chrome-extension://${extensionId}/`],
  }
  const restorations: Array<() => Promise<void>> = []
  for (const dir of [...nativeHostManifestDirs(home), ...extraDirs]) {
    await mkdir(dir, { recursive: true })
    const manifestPath = join(dir, `${HOST_NAME}.json`)
    const existing = await readOptionalFile(manifestPath)
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8')
    restorations.push(async () => {
      if (existing == null) {
        await rm(manifestPath, { force: true })
      } else {
        await writeFile(manifestPath, existing)
      }
    })
  }
  return async () => {
    for (const restore of restorations.reverse()) await restore()
  }
}

function nativeHostManifestDirs(home: string): string[] {
  if (process.platform === 'darwin') {
    return [
      join(home, 'Library/Application Support/Chromium/NativeMessagingHosts'),
      join(home, 'Library/Application Support/Google/Chrome/NativeMessagingHosts'),
      join(home, 'Library/Application Support/Google/Chrome for Testing/NativeMessagingHosts'),
      join(home, 'Library/Application Support/Chrome for Testing/NativeMessagingHosts'),
      join(home, 'Library/Application Support/Microsoft Edge/NativeMessagingHosts'),
    ]
  }
  if (process.platform === 'win32') {
    throw new Error('The Native Messaging integration test is not wired for Windows yet')
  }
  return [
    join(home, '.config/chromium/NativeMessagingHosts'),
    join(home, '.config/google-chrome/NativeMessagingHosts'),
    join(home, '.config/microsoft-edge/NativeMessagingHosts'),
  ]
}

async function readOptionalFile(path: string): Promise<Buffer | null> {
  try {
    return await readFile(path)
  } catch (error: any) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

type MockOverleaf = {
  port: number
  flushCount: number
  webCompileBodies: unknown[]
  close: () => Promise<void>
}

async function startMockOverleaf(): Promise<MockOverleaf> {
  const state = {
    flushCount: 0,
    webCompileBodies: [] as unknown[],
  }

  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url || '/', `http://${request.headers.host}`)
      if (request.method === 'GET' && url.pathname === `/project/${PROJECT_ID}`) {
        html(response, projectHtml())
        return
      }
      if (request.method === 'POST' && url.pathname === `/project/${PROJECT_ID}/flush`) {
        state.flushCount += 1
        json(response, {})
        return
      }
      if (request.method === 'GET' && url.pathname === `/project/${PROJECT_ID}/latest/history`) {
        json(response, {
          chunk: {
            startVersion: 1,
            history: {
              snapshot: {
                files: {
                  'main.tex': {
                    content:
                      '\\documentclass{article}\n\\begin{document}\nHello local compile.\n\\end{document}\n',
                  },
                },
              },
              changes: [],
            },
          },
        })
        return
      }
      if (request.method === 'GET' && url.pathname === `/project/${PROJECT_ID}/changes`) {
        json(response, { changes: [], hasMore: false })
        return
      }
      if (request.method === 'POST' && url.pathname === `/project/${PROJECT_ID}/compile`) {
        state.webCompileBodies.push(await readJson(request))
        json(response, {
          status: 'web-success',
          outputFiles: [],
          validationProblems: null,
          pdfCachingMinChunkSize: 0,
        })
        return
      }
      response.writeHead(404)
      response.end('not found')
    } catch (error) {
      response.writeHead(500, { 'Content-Type': 'text/plain' })
      response.end(error instanceof Error ? error.stack : String(error))
    }
  })

  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  return {
    get port() {
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('Mock server has no port')
      return address.port
    },
    get flushCount() {
      return state.flushCount
    },
    get webCompileBodies() {
      return state.webCompileBodies
    },
    close: () => new Promise(resolve => server.close(() => resolve())),
  }
}

function projectHtml(): string {
  return `<!doctype html>
<html>
  <head><title>Mock Overleaf</title></head>
  <body>
    <div class="compile-button-group">
      <button class="compile-button" type="button">Recompile</button>
    </div>
    <script>
      window.compileBody = { rootResourcePath: 'main.tex', compiler: 'pdflatex' }
      window.compileResults = []
      document.querySelector('.compile-button').addEventListener('click', async () => {
        const response = await fetch('/project/${PROJECT_ID}/compile', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(window.compileBody),
        })
        const data = await response.json()
        window.lastCompileResponse = data
        window.compileResults.push(data)
      })
      window.syncCode = async buildId => {
        const response = await fetch('/project/${PROJECT_ID}/sync/code?buildId=' + encodeURIComponent(buildId) + '&file=main.tex&line=2&column=1')
        return await response.json()
      }
      window.syncPdf = async buildId => {
        const response = await fetch('/project/${PROJECT_ID}/sync/pdf?buildId=' + encodeURIComponent(buildId) + '&page=2&h=120&v=640')
        return await response.json()
      }
    </script>
  </body>
</html>`
}

type FakeTools = {
  latexmk: string
  synctex: string
  latexmkLog: string
}

async function installFakeTools(tempRoot: string): Promise<FakeTools> {
  const bin = join(tempRoot, 'bin')
  await mkdir(bin, { recursive: true })
  const latexmk = join(bin, 'latexmk.cjs')
  const synctex = join(bin, 'synctex.cjs')
  const latexmkLog = join(tempRoot, 'latexmk.jsonl')

  await writeFile(latexmk, fakeLatexmkScript(), 'utf8')
  await writeFile(synctex, fakeSynctexScript(), 'utf8')
  chmodSync(latexmk, 0o755)
  chmodSync(synctex, 0o755)
  return { latexmk, synctex, latexmkLog }
}

function fakeLatexmkScript(): string {
  return `#!/usr/bin/env node
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const argv = process.argv.slice(2)
const root = argv.find(arg => arg.endsWith('.tex')) || path.join(process.cwd(), 'main.tex')
const workDir = process.cwd()
const rootContent = fs.readFileSync(root, 'utf8')
const aux = path.join(workDir, 'output.aux')
const previousAux = fs.existsSync(aux) ? fs.readFileSync(aux, 'utf8') : ''
fs.writeFileSync(aux, previousAux + 'run\\n')
fs.writeFileSync(path.join(workDir, 'output.pdf'), '%PDF-1.4\\n% fake local compile ' + crypto.randomBytes(4).toString('hex') + '\\n')
fs.writeFileSync(path.join(workDir, 'output.log'), 'fake latexmk log\\n')
fs.writeFileSync(path.join(workDir, 'output.synctex.gz'), 'fake synctex\\n')
fs.appendFileSync(process.env.OLLC_FAKE_LATEXMK_LOG, JSON.stringify({
  argv,
  cwd: workDir,
  root,
  rootContent,
  auxRunCount: fs.readFileSync(aux, 'utf8').trim().split(/\\n/).filter(Boolean).length,
}) + '\\n')
process.exit(0)
`
}

function fakeSynctexScript(): string {
  return `#!/usr/bin/env node
const path = require('path')
const args = process.argv.slice(2)
if (args[0] === 'view') {
  process.stdout.write([
    'SyncTeX result begin',
    'Output:/tmp/output.pdf',
    'Page:2',
    'h:133.75',
    'v:664.5',
    'W:42',
    'H:8',
    'SyncTeX result end',
    '',
  ].join('\\n'))
  process.exit(0)
}
if (args[0] === 'edit') {
  const target = args[2] || ''
  const pdf = target.split(':').slice(3).join(':')
  const buildDir = path.dirname(pdf)
  const projectDir = path.resolve(buildDir, '../..')
  process.stdout.write([
    'SyncTeX result begin',
    'Output:' + pdf,
    'Input:' + path.join(projectDir, 'work', 'main.tex'),
    'Line:7',
    'Column:3',
    'Offset:0',
    'SyncTeX result end',
    '',
  ].join('\\n'))
  process.exit(0)
}
process.exit(1)
`
}

async function readJsonLines(path: string): Promise<any[]> {
  const text = await readFile(path, 'utf8')
  return text.trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.from(chunk))
  const text = Buffer.concat(chunks).toString('utf8')
  return text ? JSON.parse(text) : null
}

function json(response: ServerResponse, payload: unknown): void {
  const encoded = Buffer.from(JSON.stringify(payload))
  response.writeHead(200, {
    'Content-Type': 'application/json',
    'Content-Length': String(encoded.length),
  })
  response.end(encoded)
}

function html(response: ServerResponse, payload: string): void {
  response.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': String(Buffer.byteLength(payload)),
  })
  response.end(payload)
}
