import { wpAdminUrl } from './wpphp'

function isPluginInstallPage(): boolean {
  return /\/wp-admin\/plugin-install\.php$/.test(location.pathname)
}

// Opens the "Upload Plugin" form; ?tab=upload makes WordPress show it on load.
export function uploadWpPlugin(): void {
  if (isPluginInstallPage() && !document.body.classList.contains('show-upload-view')) {
    document.querySelector<HTMLElement>('.upload-view-toggle')?.click()
    return
  }
  location.href = wpAdminUrl(document, location.href, 'plugin-install.php?tab=upload').href
}
