import {
  isOfficialOverleafOrigin,
  isProjectUrl,
  isSupportedCustomOriginUrl,
  normalizeOrigin,
  permissionPatternForOrigin,
} from './custom-origins'

type CustomOriginStatus = {
  enabled: boolean
  canRegisterContentScripts: boolean
}

type HostStatus = {
  connected?: boolean
  version?: string
  error?: string
}

const browserApi = getBrowserApi()
const state = {
  tabId: undefined as number | undefined,
  tabUrl: undefined as URL | undefined,
  origin: undefined as string | undefined,
  pattern: undefined as string | undefined,
  customEnabled: false,
}

const subtitle = requiredElement('[data-lcfo-subtitle]')
const status = requiredElement('[data-lcfo-status]')
const helper = requiredElement('[data-lcfo-helper]')
const enableButton = requiredButton('[data-lcfo-enable]')
const injectButton = requiredButton('[data-lcfo-inject]')
const removeButton = requiredButton('[data-lcfo-remove]')

injectPopupStyles()
enableButton.addEventListener('click', () => enableCurrentOrigin())
injectButton.addEventListener('click', () => injectCurrentTab())
removeButton.addEventListener('click', () => removeCurrentOrigin())

void refresh()

async function refresh() {
  setStatus('Checking current tab...')
  setButtons({ enable: false, inject: false, remove: false })
  const tab = await activeTab()
  state.tabId = tab?.id
  state.tabUrl = tab?.url ? new URL(tab.url) : undefined

  const host = (await sendMessage({ type: 'host-status' })) as HostStatus
  renderHelperStatus(host)

  if (!state.tabUrl) {
    subtitle.textContent = 'Open an Overleaf project tab'
    setStatus('The current tab URL is not available.')
    return
  }

  if (!isSupportedCustomOriginUrl(state.tabUrl.href)) {
    subtitle.textContent = 'Unsupported page'
    setStatus('Only http and https Overleaf instances can be enabled.')
    return
  }

  state.origin = normalizeOrigin(state.tabUrl.href)
  state.pattern = permissionPatternForOrigin(state.origin)

  if (!isProjectUrl(state.tabUrl.href)) {
    subtitle.textContent = state.origin
    setStatus('Open a project page on this Overleaf instance before enabling local compile.')
    return
  }

  if (isOfficialOverleafOrigin(state.origin)) {
    subtitle.textContent = state.origin
    setStatus('Official Overleaf support is enabled by default.')
    setButtons({ enable: false, inject: true, remove: false })
    return
  }

  const custom = (await sendMessage({
    type: 'custom-origin-status',
    origin: state.origin,
  })) as CustomOriginStatus
  state.customEnabled = custom.enabled

  subtitle.textContent = state.origin
  if (custom.enabled) {
    setStatus('Local compile is enabled on this Overleaf Community Edition instance.')
    setButtons({ enable: false, inject: true, remove: true })
  } else {
    setStatus('Enable this Overleaf Community Edition instance to compile it locally.')
    setButtons({ enable: true, inject: false, remove: false })
  }
}

async function enableCurrentOrigin() {
  if (!state.origin || !state.pattern) return
  setStatus('Requesting browser permission...')
  setButtons({ enable: false, inject: false, remove: false })
  const granted = await requestOrigins([state.pattern])
  if (!granted) {
    setStatus('Permission was not granted.')
    setButtons({ enable: true, inject: false, remove: false })
    return
  }
  await sendMessage({
    type: 'custom-origin-add',
    origin: state.origin,
    pattern: state.pattern,
  })
  await injectCurrentTab()
  state.customEnabled = true
  setStatus('Enabled on this Overleaf Community Edition instance.')
  setButtons({ enable: false, inject: true, remove: true })
}

async function removeCurrentOrigin() {
  if (!state.origin) return
  setStatus('Disabling this instance...')
  setButtons({ enable: false, inject: false, remove: false })
  await sendMessage({ type: 'custom-origin-remove', origin: state.origin })
  state.customEnabled = false
  setStatus('Disabled. Refresh the Overleaf tab to remove the current injected session.')
  setButtons({ enable: true, inject: false, remove: false })
}

async function injectCurrentTab() {
  if (!state.tabId) return
  await executeContentScript(state.tabId)
  setStatus('Local compile script injected into the current tab.')
}

function renderHelperStatus(host: HostStatus) {
  helper.textContent = host.connected
    ? `Native helper connected${host.version ? `, version ${host.version}` : ''}.`
    : `Native helper not connected${host.error ? `: ${host.error}` : '.'}`
}

function setButtons({
  enable,
  inject,
  remove,
}: {
  enable: boolean
  inject: boolean
  remove: boolean
}) {
  enableButton.hidden = !enable
  injectButton.hidden = !inject
  removeButton.hidden = !remove
}

function setStatus(message: string) {
  status.textContent = message
}

async function activeTab(): Promise<chrome.tabs.Tab | undefined> {
  const tabs = await callChromeApi<chrome.tabs.Tab[]>(callback => {
    browserApi.tabs.query({ active: true, currentWindow: true }, callback)
  })
  return tabs[0]
}

async function requestOrigins(origins: string[]): Promise<boolean> {
  return await callChromeApi<boolean>(callback => {
    browserApi.permissions.request({ origins }, callback)
  })
}

async function executeContentScript(tabId: number): Promise<void> {
  await callChromeApi<unknown>(callback => {
    browserApi.scripting.executeScript({ target: { tabId }, files: ['content.js'] }, callback)
  })
}

async function sendMessage(message: Record<string, unknown>): Promise<unknown> {
  return await callChromeApi<unknown>(callback => {
    browserApi.runtime.sendMessage(message, callback)
  })
}

async function callChromeApi<T>(invoke: (callback: (value: T) => void) => void): Promise<T> {
  return await new Promise<T>((resolve, reject) => {
    invoke(value => {
      const error = browserApi.runtime.lastError
      if (error) {
        reject(new Error(error.message))
      } else {
        resolve(value)
      }
    })
  })
}

function requiredElement(selector: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(selector)
  if (!element) throw new Error(`Missing popup element: ${selector}`)
  return element
}

function requiredButton(selector: string): HTMLButtonElement {
  const element = document.querySelector<HTMLButtonElement>(selector)
  if (!element) throw new Error(`Missing popup button: ${selector}`)
  return element
}

function getBrowserApi(): typeof chrome {
  const global = globalThis as typeof globalThis & {
    chrome?: typeof chrome
    browser?: typeof chrome
  }
  const api = global.chrome ?? global.browser
  if (!api) throw new Error('WebExtension API is not available')
  return api
}

function injectPopupStyles() {
  const style = document.createElement('style')
  style.textContent = `
body {
  margin: 0;
  min-width: 330px;
  background: #111827;
  color: #e5e7eb;
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
.lcfo-popup {
  padding: 14px;
}
.lcfo-header {
  display: flex;
  align-items: center;
  gap: 10px;
}
.lcfo-header h1 {
  margin: 0;
  color: #f9fafb;
  font-size: 15px;
  line-height: 1.2;
}
.lcfo-header p {
  margin: 3px 0 0;
  color: #cbd5e1;
  font-size: 12px;
  line-height: 1.3;
  overflow-wrap: anywhere;
}
.lcfo-status,
.lcfo-helper {
  margin-top: 12px;
  color: #d1d5db;
  font-size: 13px;
  line-height: 1.35;
}
.lcfo-helper {
  padding-top: 10px;
  border-top: 1px solid rgba(148, 163, 184, 0.2);
  color: #cbd5e1;
  font-size: 12px;
}
.lcfo-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
}
button {
  min-height: 32px;
  border-radius: 6px;
  padding: 0 12px;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
}
.lcfo-primary {
  border: 0;
  background: #16a34a;
  color: #fff;
}
.lcfo-primary:hover {
  background: #15803d;
}
.lcfo-secondary {
  border: 1px solid rgba(203, 213, 225, 0.38);
  background: transparent;
  color: #f8fafc;
}
.lcfo-secondary:hover {
  background: rgba(148, 163, 184, 0.14);
}
`
  document.head.append(style)
}
