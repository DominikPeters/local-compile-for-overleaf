import {
  type PageBridgeRequest,
  type PageBridgeResponse,
  type RuntimeRequest,
} from './types'
import { ProjectSnapshotLoader } from './project-snapshot'
import { findCompileToolbarTarget } from './compile-toolbar'

const extensionRuntime = getExtensionRuntime()

const BYPASS_NEXT_COMPILE = 'LCFO_BYPASS_NEXT_COMPILE'
const EXTENSION_RESPONSE = 'LCFO_EXTENSION_RESPONSE'
const PAGE_REQUEST = 'LCFO_PAGE_REQUEST'
const LOG_PREFIX = '[LCFO]'
const INSTALL_COMMAND =
  'python3 -m pip install --user --upgrade local-compile-for-overleaf && python3 -m local_compile_for_overleaf'

const snapshotLoaders = new Map<string, ProjectSnapshotLoader>()
let hostPanelOpen = false
let hostMissing = false
let hostCheckInFlight = false

const contentWindow = window as typeof window & { __lcfoContentLoaded?: boolean }
if (!contentWindow.__lcfoContentLoaded) {
  contentWindow.__lcfoContentLoaded = true
  injectPageShim()
  injectHostInstallStyles()
  installBridge()
  installCompileOnWebButton()
  document.addEventListener('pointerdown', closeHostPanelOnOutsidePointerDown, true)
  checkHostStatus({ showPanelOnMissing: true }).catch(error => {
    console.warn(LOG_PREFIX, 'initial native host status check failed', error)
  })
}

function injectPageShim() {
  const script = document.createElement('script')
  script.src = extensionRuntime.getURL('page-shim.js')
  script.async = false
  script.onload = () => script.remove()
  ;(document.documentElement || document.head).appendChild(script)
}

function installBridge() {
  window.addEventListener('message', event => {
    if (event.source !== window) return
    const data = event.data as PageBridgeRequest | { type?: string }
    if (data.type !== PAGE_REQUEST) return
    if (!isPageBridgeRequest(data)) return
    handlePageRequest(data).catch(error => {
      postPageResponse({
        type: EXTENSION_RESPONSE,
        id: data.id,
        error: error instanceof Error ? error.message : String(error),
      })
    })
  })
}

function isPageBridgeRequest(value: unknown): value is PageBridgeRequest {
  const request = value as PageBridgeRequest
  return request.type === PAGE_REQUEST && typeof request.id === 'number' && !!request.payload
}

async function handlePageRequest(data: PageBridgeRequest) {
  const payload = data.payload
  let runtimeRequest: RuntimeRequest
  if (payload.kind === 'compile') {
    const loader = getSnapshotLoader(payload.projectId)
    console.info(LOG_PREFIX, 'building Overleaf history snapshot', {
      projectId: payload.projectId,
    })
    const snapshot = await loader.refresh()
    console.info(LOG_PREFIX, 'built Overleaf history snapshot', {
      projectId: payload.projectId,
      version: snapshot.version,
      files: snapshot.files.length,
    })
    runtimeRequest = {
      type: 'compile',
      request: payload,
      snapshot,
    }
  } else if (payload.kind === 'clear-cache') {
    runtimeRequest = {
      type: 'clear-cache',
      request: payload,
    }
  } else if (payload.kind === 'stop-compile') {
    runtimeRequest = {
      type: 'stop-compile',
      request: payload,
    }
  } else {
    runtimeRequest = {
      type: 'sync',
      request: payload,
    }
  }

  const response = await extensionRuntime.sendMessage(runtimeRequest)
  if (response == null) {
    throw new Error('Extension background returned no response')
  }
  console.info(LOG_PREFIX, 'background response', response)
  updateHostUiFromRuntimeResponse(response)
  postPageResponse({
    type: EXTENSION_RESPONSE,
    id: data.id,
    payload: response,
  })
}

function postPageResponse(response: PageBridgeResponse) {
  window.postMessage(response, window.location.origin)
}

function getSnapshotLoader(projectId: string): ProjectSnapshotLoader {
  let loader = snapshotLoaders.get(projectId)
  if (!loader) {
    loader = new ProjectSnapshotLoader(projectId)
    snapshotLoaders.set(projectId, loader)
  }
  return loader
}

function installCompileOnWebButton() {
  const observer = new MutationObserver(() => {
    ensureCompileOnWebButton()
    ensureHostInstallUi()
  })
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  })
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      ensureCompileOnWebButton()
      ensureHostInstallUi()
    })
  } else {
    ensureCompileOnWebButton()
    ensureHostInstallUi()
  }
}

function ensureCompileOnWebButton() {
  if (document.querySelector('[data-lcfo-compile-on-web]')) return

  const target = findCompileToolbarTarget(document)
  if (!target) return

  const button = document.createElement('button')
  button.type = 'button'
  button.textContent = 'Compile on web'
  button.dataset.lcfoCompileOnWeb = 'true'
  button.className = 'btn btn-secondary btn-sm lcfo-compile-on-web'
  button.style.marginLeft = '6px'
  button.style.height = '28px'
  button.style.alignSelf = 'center'
  button.addEventListener('click', event => {
    event.preventDefault()
    event.stopPropagation()
    document.dispatchEvent(new Event(BYPASS_NEXT_COMPILE))
    target.compileButton.click()
  })

  target.group.insertAdjacentElement('afterend', button)
}

function ensureHostInstallUi() {
  if (document.querySelector('[data-lcfo-host-status]')) {
    updateHostInstallUiVisibility()
    return
  }

  const target = findCompileToolbarTarget(document)
  if (!target) return

  const wrapper = document.createElement('div')
  wrapper.dataset.lcfoHostStatus = 'true'
  wrapper.className = 'lcfo-host-status'

  const pill = document.createElement('button')
  pill.type = 'button'
  pill.className = 'lcfo-host-pill'
  pill.setAttribute('aria-expanded', 'false')
  const warningIcon = document.createElement('span')
  warningIcon.className = 'lcfo-warning-icon'
  warningIcon.textContent = '!'
  const warningLabel = document.createElement('span')
  warningLabel.textContent = 'Local helper missing'
  pill.append(warningIcon, warningLabel)
  pill.addEventListener('click', event => {
    event.preventDefault()
    event.stopPropagation()
    hostPanelOpen = !hostPanelOpen
    updateHostInstallUiVisibility()
  })

  const panel = document.createElement('section')
  panel.className = 'lcfo-host-panel'
  panel.setAttribute('aria-label', 'Local Compile for Overleaf install panel')

  const titleRow = document.createElement('div')
  titleRow.className = 'lcfo-panel-title-row'

  const title = document.createElement('div')
  title.className = 'lcfo-panel-title'
  title.textContent = 'Local compiler not connected'

  const close = document.createElement('button')
  close.type = 'button'
  close.className = 'lcfo-icon-button'
  close.setAttribute('aria-label', 'Close')
  close.textContent = 'x'
  close.addEventListener('click', event => {
    event.preventDefault()
    event.stopPropagation()
    hostPanelOpen = false
    updateHostInstallUiVisibility()
  })

  titleRow.append(title, close)

  const description = document.createElement('p')
  description.className = 'lcfo-panel-description'
  description.textContent = 'Install the helper app to compile this project on your computer.'

  const commandRow = document.createElement('div')
  commandRow.className = 'lcfo-command-row'

  const command = document.createElement('code')
  command.textContent = INSTALL_COMMAND

  const copy = document.createElement('button')
  copy.type = 'button'
  copy.className = 'lcfo-copy-button'
  copy.setAttribute('aria-label', 'Copy install command')
  setCopyButtonLabel(copy, 'Copy')
  copy.addEventListener('click', event => {
    event.preventDefault()
    event.stopPropagation()
    copyInstallCommand(copy)
  })

  commandRow.append(command, copy)

  const actions = document.createElement('div')
  actions.className = 'lcfo-panel-actions'

  const retry = document.createElement('button')
  retry.type = 'button'
  retry.className = 'lcfo-primary-button'
  retry.textContent = 'Retry'
  retry.addEventListener('click', event => {
    event.preventDefault()
    event.stopPropagation()
    checkHostStatus({ showPanelOnMissing: true }).catch(error => {
      console.warn(LOG_PREFIX, 'native host retry failed', error)
    })
  })

  const options = document.createElement('button')
  options.type = 'button'
  options.className = 'lcfo-link-button'
  options.textContent = 'Other install options'
  options.addEventListener('click', event => {
    event.preventDefault()
    event.stopPropagation()
    toggleOtherInstallOptions()
  })

  actions.append(retry, options)

  const otherOptions = document.createElement('div')
  otherOptions.className = 'lcfo-other-options'
  otherOptions.hidden = true
  const devInstallLabel = document.createElement('div')
  devInstallLabel.textContent = 'For this unpacked development extension:'
  const devInstallCode = document.createElement('code')
  devInstallCode.textContent = devInstallCommand()
  otherOptions.append(devInstallLabel, devInstallCode)

  panel.append(titleRow, description, commandRow, actions, otherOptions)
  wrapper.append(pill, panel)
  target.group.insertAdjacentElement('afterend', wrapper)
  updateHostInstallUiVisibility()
}

function updateHostInstallUiVisibility() {
  const wrapper = document.querySelector<HTMLElement>('[data-lcfo-host-status]')
  if (!wrapper) return
  const pill = wrapper.querySelector<HTMLButtonElement>('.lcfo-host-pill')
  const panel = wrapper.querySelector<HTMLElement>('.lcfo-host-panel')
  wrapper.hidden = !hostMissing
  if (pill) pill.setAttribute('aria-expanded', String(hostPanelOpen && hostMissing))
  if (panel) panel.hidden = !hostMissing || !hostPanelOpen
}

function closeHostPanelOnOutsidePointerDown(event: PointerEvent) {
  if (!hostPanelOpen) return
  const wrapper = document.querySelector<HTMLElement>('[data-lcfo-host-status]')
  if (!wrapper) return
  const target = event.target
  if (target instanceof Node && wrapper.contains(target)) return
  hostPanelOpen = false
  updateHostInstallUiVisibility()
}

async function checkHostStatus({ showPanelOnMissing }: { showPanelOnMissing: boolean }) {
  if (hostCheckInFlight) return
  hostCheckInFlight = true
  setRetryBusy(true)
  try {
    const response = await extensionRuntime.sendMessage({ type: 'host-status' })
    const connected = Boolean(response?.connected)
    hostMissing = !connected
    hostPanelOpen = !connected && showPanelOnMissing
    updateHostInstallUiVisibility()
    if (connected) {
      console.info(LOG_PREFIX, 'native host connected', response)
    } else {
      console.info(LOG_PREFIX, 'native host missing', response)
    }
  } catch (error) {
    hostMissing = true
    hostPanelOpen = showPanelOnMissing
    updateHostInstallUiVisibility()
    console.warn(LOG_PREFIX, 'native host status check failed', error)
  } finally {
    hostCheckInFlight = false
    setRetryBusy(false)
  }
}

function setRetryBusy(busy: boolean) {
  const retry = document.querySelector<HTMLButtonElement>('.lcfo-primary-button')
  if (!retry) return
  retry.disabled = busy
  retry.textContent = busy ? 'Checking...' : 'Retry'
}

function updateHostUiFromRuntimeResponse(response: unknown) {
  const value = response as { status?: string; error?: string }
  if (value?.status === 'failure' && isNativeHostError(value.error)) {
    hostMissing = true
    hostPanelOpen = true
    ensureHostInstallUi()
    updateHostInstallUiVisibility()
  }
}

function isNativeHostError(error: string | undefined): boolean {
  if (!error) return false
  return /native host|native messaging|host has exited|specified native messaging host/i.test(error)
}

function toggleOtherInstallOptions() {
  const options = document.querySelector<HTMLElement>('.lcfo-other-options')
  if (!options) return
  options.hidden = !options.hidden
}

async function copyInstallCommand(button: HTMLButtonElement) {
  try {
    await navigator.clipboard.writeText(INSTALL_COMMAND)
    setCopyButtonLabel(button, 'Copied')
    window.setTimeout(() => {
      setCopyButtonLabel(button, 'Copy')
    }, 1500)
  } catch {
    setCopyButtonLabel(button, 'Select')
    window.setTimeout(() => {
      setCopyButtonLabel(button, 'Copy')
    }, 1500)
  }
}

function setCopyButtonLabel(button: HTMLButtonElement, label: string) {
  const labelElement = document.createElement('span')
  labelElement.textContent = label
  button.replaceChildren(createCopyIcon(), labelElement)
}

function createCopyIcon(): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.classList.add('lcfo-copy-icon')
  svg.setAttribute('viewBox', '0 0 20 20')
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('focusable', 'false')

  const paths = [
    'M7 4.5A2.5 2.5 0 0 1 9.5 2H14a2.5 2.5 0 0 1 2.5 2.5V11A2.5 2.5 0 0 1 14 13.5h-.5v-2H14a.5.5 0 0 0 .5-.5V4.5A.5.5 0 0 0 14 4H9.5a.5.5 0 0 0-.5.5V5H7v-.5Z',
    'M4 7.5A2.5 2.5 0 0 1 6.5 5H11a2.5 2.5 0 0 1 2.5 2.5v6A2.5 2.5 0 0 1 11 16H6.5A2.5 2.5 0 0 1 4 13.5v-6ZM6.5 7a.5.5 0 0 0-.5.5v6a.5.5 0 0 0 .5.5H11a.5.5 0 0 0 .5-.5v-6A.5.5 0 0 0 11 7H6.5Z',
  ]
  for (const pathData of paths) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    path.setAttribute('d', pathData)
    svg.append(path)
  }
  return svg
}

function injectHostInstallStyles() {
  if (document.querySelector('style[data-lcfo-host-styles]')) return
  const style = document.createElement('style')
  style.dataset.lcfoHostStyles = 'true'
  style.textContent = `
.lcfo-host-status {
  position: relative;
  display: inline-flex;
  align-items: center;
  margin-left: 8px;
  z-index: 20;
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
.lcfo-host-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 28px;
  padding: 0 10px;
  border: 1px solid rgba(250, 204, 21, 0.58);
  border-radius: 999px;
  background: rgba(36, 46, 63, 0.96);
  color: #f8fafc;
  font-size: 13px;
  font-weight: 600;
  line-height: 1;
  cursor: pointer;
  white-space: nowrap;
}
.lcfo-host-pill:hover {
  background: rgba(45, 57, 78, 0.98);
}
.lcfo-warning-icon {
  display: inline-flex;
  width: 16px;
  height: 16px;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: #facc15;
  color: #1f2937;
  font-size: 11px;
  font-weight: 800;
}
.lcfo-host-panel {
  position: absolute;
  top: 36px;
  left: 0;
  width: min(430px, calc(100vw - 32px));
  padding: 14px;
  border: 1px solid rgba(148, 163, 184, 0.28);
  border-radius: 8px;
  background: #111827;
  box-shadow: 0 18px 42px rgba(0, 0, 0, 0.36);
  color: #e5e7eb;
}
.lcfo-panel-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.lcfo-panel-title {
  color: #f9fafb;
  font-size: 15px;
  font-weight: 700;
}
.lcfo-icon-button {
  width: 26px;
  height: 26px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: #cbd5e1;
  font-size: 16px;
  cursor: pointer;
}
.lcfo-icon-button:hover {
  background: rgba(148, 163, 184, 0.16);
  color: #fff;
}
.lcfo-panel-description {
  margin: 6px 0 12px;
  color: #cbd5e1;
  font-size: 13px;
  line-height: 1.35;
}
.lcfo-command-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: stretch;
  overflow: hidden;
  border: 1px solid rgba(148, 163, 184, 0.24);
  border-radius: 7px;
  background: #020617;
}
.lcfo-command-row code {
  display: block;
  min-width: 0;
  padding: 10px;
  color: #dbeafe;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  font-size: 12px;
  line-height: 1.35;
  white-space: normal;
  overflow-wrap: anywhere;
  word-break: break-word;
}
.lcfo-copy-button {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: 0;
  border-left: 1px solid rgba(148, 163, 184, 0.24);
  background: #1f2937;
  color: #f8fafc;
  min-width: 78px;
  padding: 10px 12px;
  font-size: 12px;
  font-weight: 700;
  line-height: 1;
  cursor: pointer;
}
.lcfo-copy-button:hover {
  background: #334155;
}
.lcfo-copy-icon {
  width: 18px;
  height: 18px;
  fill: currentColor;
}
.lcfo-panel-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 12px;
}
.lcfo-primary-button {
  min-height: 30px;
  padding: 0 14px;
  border: 0;
  border-radius: 6px;
  background: #16a34a;
  color: #fff;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
}
.lcfo-primary-button:disabled {
  opacity: 0.7;
  cursor: default;
}
.lcfo-link-button {
  min-height: 30px;
  border: 0;
  background: transparent;
  color: #bfdbfe;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.lcfo-link-button:hover {
  color: #dbeafe;
  text-decoration: underline;
}
.lcfo-other-options {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid rgba(148, 163, 184, 0.18);
  color: #cbd5e1;
  font-size: 12px;
  line-height: 1.4;
}
.lcfo-other-options code {
  display: block;
  margin-top: 5px;
  color: #dbeafe;
  word-break: break-word;
}
`
  ;(document.head || document.documentElement).append(style)
}

function devInstallCommand(): string {
  if (extensionOrigin().startsWith('moz-extension://')) {
    return 'python3 -m local_compile_for_overleaf install --browser firefox'
  }
  return `python3 -m local_compile_for_overleaf install --browser chrome --extension-id ${extensionRuntime.id}`
}

function getExtensionRuntime(): typeof chrome.runtime {
  const global = globalThis as typeof globalThis & {
    chrome?: { runtime?: typeof chrome.runtime }
    browser?: { runtime?: typeof chrome.runtime }
  }
  const runtime = global.chrome?.runtime ?? global.browser?.runtime
  if (!runtime) {
    throw new Error('WebExtension runtime API is not available')
  }
  return runtime
}

function extensionOrigin(): string {
  return new URL(extensionRuntime.getURL('')).origin
}
