import { showToast } from './toast'
import { wpAdminUrl } from './wpphp'

const PLUGIN = 'all-in-one-wp-migration'
const PLUGIN_NAME = 'All-in-One WP Migration'
// Survives the navigation to plugins.php and the reload after (de)activation.
const STORAGE_KEY = 'bs-wp-migration'
// A stale request (e.g. bounced through the login page) must not fire later.
const MAX_AGE_MS = 30_000

type Pending = { step: 'toggle' } | { step: 'done', message: string }

function save(pending: Pending): void {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ ...pending, at: Date.now() }))
}

function take(): Pending | null {
  const raw = sessionStorage.getItem(STORAGE_KEY)
  if (!raw) return null
  sessionStorage.removeItem(STORAGE_KEY)
  try {
    const data = JSON.parse(raw) as Pending & { at: number }
    return Date.now() - data.at < MAX_AGE_MS ? data : null
  } catch {
    return null
  }
}

function isPluginsPage(): boolean {
  return /\/wp-admin\/plugins\.php$/.test(location.pathname)
}

function toggle(): void {
  const deactivate = document.getElementById(`deactivate-${PLUGIN}`)
  const activate = document.getElementById(`activate-${PLUGIN}`)
  const link = deactivate ?? activate
  if (!link) { showToast(`${PLUGIN_NAME} not installed`, ''); return }
  save({ step: 'done', message: `${PLUGIN_NAME} ${deactivate ? 'deactivated' : 'activated'}` })
  link.click()
}

export function toggleWpMigration(): void {
  if (isPluginsPage()) { toggle(); return }
  save({ step: 'toggle' })
  location.href = wpAdminUrl(document, location.href, 'plugins.php').href
}

export function resumeWpMigration(): void {
  const pending = take()
  if (!pending) return
  if (pending.step === 'done') showToast(pending.message, '')
  else if (isPluginsPage()) toggle()
}
