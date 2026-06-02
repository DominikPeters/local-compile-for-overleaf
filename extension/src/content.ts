import {
  type PageBridgeRequest,
  type PageBridgeResponse,
  type RuntimeRequest,
} from './types'

const BYPASS_NEXT_COMPILE = 'LCFO_BYPASS_NEXT_COMPILE'
const EXTENSION_RESPONSE = 'LCFO_EXTENSION_RESPONSE'
const PAGE_REQUEST = 'LCFO_PAGE_REQUEST'
const LOG_PREFIX = '[LCFO]'
import { ProjectSnapshotLoader } from './project-snapshot'

const snapshotLoaders = new Map<string, ProjectSnapshotLoader>()

injectPageShim()
installBridge()
installCompileOnWebButton()

function injectPageShim() {
  const script = document.createElement('script')
  script.src = chrome.runtime.getURL('page-shim.js')
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

  const response = await chrome.runtime.sendMessage(runtimeRequest)
  if (response == null) {
    throw new Error('Extension background returned no response')
  }
  console.info(LOG_PREFIX, 'background response', response)
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
  const observer = new MutationObserver(() => ensureCompileOnWebButton())
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  })
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ensureCompileOnWebButton)
  } else {
    ensureCompileOnWebButton()
  }
}

function ensureCompileOnWebButton() {
  if (document.querySelector('[data-lcfo-compile-on-web]')) return

  const group = document.querySelector<HTMLElement>('.compile-button-group')
  const compileButton = group?.querySelector<HTMLButtonElement>('.compile-button')
  if (!group || !compileButton) return

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
    compileButton.click()
  })

  group.insertAdjacentElement('afterend', button)
}
