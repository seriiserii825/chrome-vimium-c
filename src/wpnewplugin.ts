import { showToast } from './toast'
import { wpAdminUrl } from './wpphp'

// Survives the navigation to plugin-install.php.
const STORAGE_KEY = 'bs-wp-new-plugin'
// A stale request (e.g. bounced through the login page) must not fire later.
const MAX_AGE_MS = 30_000

function isPluginInstallPage(): boolean {
  return /\/wp-admin\/plugin-install\.php$/.test(location.pathname)
}

function fileInput(): HTMLInputElement | null {
  return document.querySelector<HTMLInputElement>('.wp-upload-form #pluginzip')
}

// Show the upload form (same as clicking "Upload Plugin") and return its file input.
function showUploadForm(): HTMLInputElement | null {
  if (!document.body.classList.contains('show-upload-view')) {
    document.querySelector<HTMLElement>('.upload-view-toggle')?.click()
  }
  const input = fileInput()
  if (!input) { showToast('Plugin upload form not found', ''); return null }
  if (!input.dataset.bsAutoSubmit) {
    input.dataset.bsAutoSubmit = '1'
    // Install right away once a zip is picked.
    input.addEventListener('change', () => {
      if (!input.files?.length) return
      const submit = input.form?.querySelector<HTMLInputElement>('#install-plugin-submit')
      if (submit) submit.disabled = false
      input.form?.requestSubmit(submit ?? undefined)
    })
  }
  return input
}

export function uploadWpPlugin(): void {
  if (isPluginInstallPage()) {
    // Runs inside the keydown handler, so the user activation lets the file chooser open.
    showUploadForm()?.click()
    return
  }
  sessionStorage.setItem(STORAGE_KEY, String(Date.now()))
  location.href = wpAdminUrl(document, location.href, 'plugin-install.php?tab=upload').href
}

export function resumeWpNewPlugin(): void {
  const at = Number(sessionStorage.getItem(STORAGE_KEY))
  if (!at) return
  sessionStorage.removeItem(STORAGE_KEY)
  if (Date.now() - at >= MAX_AGE_MS || !isPluginInstallPage()) return
  // The file chooser needs a user gesture, which the navigation lost: wait for another keypress.
  // Don't focus the input: a focused input counts as editing and would swallow the hotkey.
  if (!showUploadForm()) return
  showToast('Press wnp again to choose the plugin zip', '')
}
