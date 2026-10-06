import { showToast } from './toast'
import { wpAdminUrl } from './wpphp'

const PLUGIN_NAME = 'All-in-One WP Migration'
// Survives the navigation to the export page.
const STORAGE_KEY = 'bs-wp-backup'
// A stale request (e.g. bounced through the login page) must not fire later.
const MAX_AGE_MS = 30_000

function isExportPage(): boolean {
  return /\/wp-admin\/admin\.php$/.test(location.pathname)
    && new URLSearchParams(location.search).get('page') === 'ai1wm_export'
}

// "Esporta su" → "File": starts the export to a downloadable file.
function exportToFile(): void {
  const file = document.getElementById('ai1wm-export-file')
  if (!file) { showToast(`${PLUGIN_NAME} export not found`, ''); return }
  document.querySelector<HTMLElement>('.ai1wm-button-export .ai1wm-button-main')?.click()
  file.click()
}

export function makeWpBackup(): void {
  if (isExportPage()) { exportToFile(); return }
  sessionStorage.setItem(STORAGE_KEY, String(Date.now()))
  location.href = wpAdminUrl(document, location.href, 'admin.php?page=ai1wm_export').href
}

export function resumeWpBackup(): void {
  const at = Number(sessionStorage.getItem(STORAGE_KEY))
  if (!at) return
  sessionStorage.removeItem(STORAGE_KEY)
  if (Date.now() - at < MAX_AGE_MS && isExportPage()) exportToFile()
}
