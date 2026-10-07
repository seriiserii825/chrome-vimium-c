import { readText } from './clipboard'
import { showToast } from './toast'

const PROJECTS_URL = 'https://access.bludelego.it/project'
const INPUT_ID = 'search-project-url-input'
// chrome.storage, not sessionStorage: the request has to cross origins.
const STORAGE_KEY = 'bsAccessSearch'
// A stale request (e.g. bounced through the login page) must not fire later.
const MAX_AGE_MS = 30_000
// The input may be rendered by the page's JS after load.
const WAIT_MS = 10_000

function isProjectsPage(): boolean {
  return location.origin + location.pathname.replace(/\/$/, '') === PROJECTS_URL
}

// Paste the clipboard into the search input, then blur it so page hotkeys keep working.
async function pasteIntoSearch(input: HTMLInputElement): Promise<void> {
  input.focus()
  input.select()
  // Native paste fires the page's own input handlers like a real Ctrl+V.
  if (!document.execCommand('paste')) {
    try {
      const text = await readText()
      if (!text) { showToast('Clipboard is empty', ''); return }
      input.value = text
      input.dispatchEvent(new Event('input', { bubbles: true }))
    } catch {
      showToast('Clipboard read failed', '')
      return
    }
  }
  input.dispatchEvent(new Event('change', { bubbles: true }))
  input.blur()
}

function focusSearch(): void {
  const deadline = Date.now() + WAIT_MS
  const tryFocus = (): void => {
    const input = document.getElementById(INPUT_ID) as HTMLInputElement | null
    if (input) { void pasteIntoSearch(input); return }
    if (Date.now() < deadline) setTimeout(tryFocus, 100)
  }
  tryFocus()
}

export function findInAccess(): void {
  if (isProjectsPage()) { focusSearch(); return }
  void chrome.storage.local.set({ [STORAGE_KEY]: Date.now() }).then(() => {
    void chrome.runtime.sendMessage({ type: 'navigateTo', url: PROJECTS_URL })
  })
}

export function resumeAccessSearch(): void {
  if (!isProjectsPage()) return
  chrome.storage.local.get(STORAGE_KEY, (res) => {
    const at = res[STORAGE_KEY] as number | undefined
    if (!at) return
    void chrome.storage.local.remove(STORAGE_KEY)
    if (Date.now() - at < MAX_AGE_MS) focusSearch()
  })
}
