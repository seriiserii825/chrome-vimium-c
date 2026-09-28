import { writeText } from './clipboard'

let dismiss: (() => void) | null = null

// Prefer the actual admin URL: WordPress may be installed in a subdirectory.
export function siteHealthUrl(doc: Document, currentUrl: string): URL {
  const current = new URL(currentUrl)
  const candidates = [current.href, ...Array.from(doc.querySelectorAll<HTMLAnchorElement>(
    '#wpadminbar a[href], a[href*="/wp-admin/"]',
  ), link => link.href)]
  for (const candidate of candidates) {
    const url = new URL(candidate, current)
    const index = url.pathname.indexOf('/wp-admin/')
    if (url.origin === current.origin && index !== -1) {
      return new URL(`${url.pathname.slice(0, index)}/wp-admin/site-health.php?tab=debug`, current.origin)
    }
  }
  return new URL('/wp-admin/site-health.php?tab=debug', current.origin)
}

export function parsePhpVersion(doc: Document): string | null {
  // WordPress's copy report uses stable field names, regardless of admin language.
  const report = doc.querySelector('.site-health-copy-buttons [data-clipboard-text]')
    ?.getAttribute('data-clipboard-text') ?? ''
  const server = report.split(/^### wp-server[^\r\n]*###[ \t]*\r?$/m)[1]?.split(/^### /m)[0]
  return server?.match(/^php_version:[ \t]*(\d+\.\d+\.\d+[^\s]*)/m)?.[1] ?? null
}

export function isWpPhpVisible(): boolean {
  return dismiss !== null
}

export function hideWpPhp(): void {
  dismiss?.()
}

export function showWpPhp(): void {
  if (dismiss) return
  const url = siteHealthUrl(document, location.href)
  const previousFocus = document.activeElement
  const controller = new AbortController()
  const host = document.createElement('div')
  host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;'
  const root = host.attachShadow({ mode: 'closed' })
  root.innerHTML = `
    <style>
      :host { color-scheme: dark; }
      * { box-sizing: border-box; }
      .backdrop { position:fixed; inset:0; display:grid; place-items:center; padding:20px; background:#0008; }
      .panel { width:420px; max-width:100%; padding:24px; border:1px solid #45475a; border-radius:16px;
        background:#1e1e2e; color:#cdd6f4; box-shadow:0 16px 64px #0008; font:14px/1.5 system-ui,sans-serif; }
      header { display:flex; align-items:center; justify-content:space-between; gap:16px; }
      h2 { margin:0; font-size:16px; color:#cba6f7; }
      button { font:inherit; color:inherit; background:#313244; border:0; border-radius:6px; padding:4px 10px; cursor:pointer; }
      button:focus-visible, a:focus-visible { outline:2px solid #cba6f7; outline-offset:4px; }
      .site { margin-top:8px; color:#a6adc8; overflow-wrap:anywhere; }
      .result { margin:24px 0; overflow-wrap:anywhere; }
      .version { display:block; background:transparent; padding:0; text-align:left; font-size:36px; font-weight:700; color:#a6e3a1; }
      .version:hover { color:#cba6f7; }
      .copy-status { display:block; margin-top:6px; color:#a6adc8; font-size:12px; }
      .error { color:#f38ba8; }
      footer { display:flex; align-items:center; justify-content:space-between; gap:16px; }
      a { color:#89b4fa; }
      small { color:#a6adc8; }
    </style>
    <div class="backdrop">
      <section class="panel" role="dialog" aria-modal="true" aria-labelledby="title">
        <header><h2 id="title">WordPress · PHP</h2><button type="button" aria-label="Close">×</button></header>
        <div class="site"></div>
        <div class="result" role="status" aria-live="polite">Checking Site Health…</div>
        <footer><a target="_blank" rel="noopener noreferrer">Open Site Health ↗</a><small>Esc to close</small></footer>
      </section>
    </div>`
  const result = root.querySelector<HTMLDivElement>('.result')!
  const close = root.querySelector<HTMLButtonElement>('button')!
  const source = root.querySelector<HTMLAnchorElement>('a')!
  root.querySelector('.site')!.textContent = url.host + url.pathname.replace(/\/wp-admin\/.*$/, '')
  source.href = `${url.href}#health-check-section-wp-server`
  let timedOut = false
  const timeout = setTimeout(() => { timedOut = true; controller.abort() }, 15000)
  dismiss = () => {
    dismiss = null
    clearTimeout(timeout)
    controller.abort()
    host.remove()
    if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus()
  }
  close.addEventListener('click', hideWpPhp)
  root.querySelector('.backdrop')!.addEventListener('click', event => {
    if (event.target === event.currentTarget) hideWpPhp()
  })
  root.addEventListener('keydown', event => {
    const key = event as KeyboardEvent
    if (key.key === 'Tab') {
      key.preventDefault()
      const controls = Array.from(root.querySelectorAll<HTMLElement>('button, a[href]'))
      const index = controls.findIndex(control => control === root.activeElement)
      controls[(index + (key.shiftKey ? -1 : 1) + controls.length) % controls.length].focus()
    }
  })
  document.documentElement.appendChild(host)
  close.focus()

  void (async () => {
    try {
      const response = await fetch(url.href, {
        credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
      })
      const doc = new DOMParser().parseFromString(await response.text(), 'text/html')
      if (new URL(response.url).pathname.includes('/wp-login.php') || doc.querySelector('#loginform')) {
        throw new Error('Sign in to WordPress on this site, then run gp again.')
      }
      if (response.status === 401 || response.status === 403) {
        throw new Error('Access denied. Sign in with an account that can view Site Health.')
      }
      if (!response.ok) throw new Error(`Site Health is unavailable (HTTP ${response.status}).`)
      const version = parsePhpVersion(doc)
      if (!version) throw new Error('PHP version was not found. Check that this is a WordPress site and your account can view Site Health.')
      const copy = document.createElement('button')
      copy.type = 'button'
      copy.className = 'version'
      copy.textContent = `PHP ${version}`
      copy.title = 'Copy version number'
      copy.setAttribute('aria-label', `Copy PHP version ${version}`)
      const status = document.createElement('span')
      status.className = 'copy-status'
      status.textContent = 'Click to copy version'
      copy.addEventListener('click', async () => {
        try {
          await writeText(version)
          status.textContent = `Copied: ${version}`
        } catch {
          status.textContent = 'Could not copy. Please try again.'
        } finally {
          if (host.isConnected) copy.focus()
        }
      })
      result.replaceChildren(copy, status)
    } catch (error) {
      if (!host.isConnected) return
      result.classList.add('error')
      result.textContent = timedOut ? 'The request timed out. Run gp to try again.'
        : error instanceof TypeError ? 'Could not load Site Health. Check your connection and access to WordPress.'
        : error instanceof Error ? error.message : 'Could not check the PHP version.'
    } finally {
      clearTimeout(timeout)
    }
  })()
}
