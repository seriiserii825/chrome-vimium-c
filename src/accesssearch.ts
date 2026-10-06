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

function focusSearch(): void {
  const deadline = Date.now() + WAIT_MS
  const tryFocus = (): void => {
    const input = document.getElementById(INPUT_ID) as HTMLInputElement | null
    if (input) { input.focus(); input.select(); return }
    if (Date.now() < deadline) setTimeout(tryFocus, 100)
  }
  tryFocus()
}

export function findInAccess(): void {
  if (isProjectsPage()) { focusSearch(); return }
  void chrome.storage.local.set({ [STORAGE_KEY]: Date.now() }).then(() => {
    location.href = PROJECTS_URL
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
