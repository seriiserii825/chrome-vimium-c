import { showToast } from './toast'
import { wpAdminUrl } from './wpphp'

function isPluginInstallPage(): boolean {
  return /\/wp-admin\/plugin-install\.php$/.test(location.pathname)
}

// Opens the "Upload Plugin" form (?tab=upload makes WordPress show it on load), then the zip chooser.
export function uploadWpPlugin(): void {
  const input = document.querySelector<HTMLInputElement>('.wp-upload-form #pluginzip')
  if (!isPluginInstallPage() || !input) {
    location.href = wpAdminUrl(document, location.href, 'plugin-install.php?tab=upload').href
    return
  }
  // On ?tab=upload the form is already shown and the toggle is a "Browse plugins" link away from it.
  if (!input.checkVisibility()) {
    document.querySelector<HTMLElement>('.upload-view-toggle')?.click()
  }
  // Runs inside the keydown handler: the file chooser needs that user activation.
  input.click()
}

export function resumeWpNewPlugin(): void {
  if (!isPluginInstallPage() || new URLSearchParams(location.search).get('tab') !== 'upload') return
  // The navigation lost the user activation, so the chooser can't open by itself.
  showToast('Press wnp again to choose the plugin zip', '')
}
