export const extensionRuntime = getExtensionRuntime()

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

export function extensionOrigin(): string {
  return new URL(extensionRuntime.getURL('')).origin
}
