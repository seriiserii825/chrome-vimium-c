let overlay: HTMLElement | null = null
let backdrop: HTMLElement | null = null

function isVisible(el: HTMLElement): boolean {
  const rect = el.getBoundingClientRect()
  return rect.width > 0 || rect.height > 0
}

function flash(el: HTMLElement): void {
  const prevOutline = el.style.outline
  const prevOffset = el.style.outlineOffset
  el.style.outline = '3px solid #f9e2af'
  el.style.outlineOffset = '2px'
  setTimeout(() => {
    el.style.outline = prevOutline
    el.style.outlineOffset = prevOffset
  }, 1500)
}

interface LinkPanelConfig {
  selector: string
  title: string
  empty: string
  badge: (el: HTMLElement) => string
}

export function showSeoRelLinks(): void {
  showLinkPanel({
    selector: 'a[rel], area[rel]',
    title: 'Links with rel',
    empty: 'No links with rel attribute found',
    badge: (el) => el.getAttribute('rel') ?? '',
  })
}

export function showSeoBlankLinks(): void {
  showLinkPanel({
    selector: 'a[target="_blank" i], area[target="_blank" i]',
    title: 'Links with target="_blank"',
    empty: 'No links with target="_blank" found',
    badge: (el) => {
      const rel = el.getAttribute('rel')
      return rel ? `_blank · ${rel}` : '_blank'
    },
  })
}

function showLinkPanel(cfg: LinkPanelConfig): void {
  if (backdrop) return

  const links = Array.from(document.querySelectorAll<HTMLElement>(cfg.selector))

  // Page overlays — absolute so they scroll with content
  overlay = document.createElement('div')
  overlay.id = 'bs-seor-overlay'

  for (const el of links) {
    if (!isVisible(el)) continue
    const rect = el.getBoundingClientRect()
    const badge = document.createElement('span')
    badge.className = 'bs-seor-badge'
    badge.textContent = cfg.badge(el)
    badge.style.top = `${Math.round(rect.top + scrollY)}px`
    badge.style.left = `${Math.round(rect.left + scrollX)}px`
    overlay.appendChild(badge)
  }

  document.documentElement.appendChild(overlay)

  // Popup
  backdrop = document.createElement('div')
  backdrop.id = 'bs-seor-backdrop'

  const panel = document.createElement('div')
  panel.id = 'bs-seor-panel'

  const header = document.createElement('div')
  header.id = 'bs-seor-header'
  const title = document.createElement('span')
  title.textContent = `${cfg.title} (${links.length})`
  const closeBtn = document.createElement('button')
  closeBtn.id = 'bs-seor-close'
  closeBtn.textContent = '×'
  closeBtn.addEventListener('click', hideSeoRelLinks)
  header.appendChild(title)
  header.appendChild(closeBtn)
  panel.appendChild(header)

  const body = document.createElement('div')
  body.id = 'bs-seor-body'

  if (links.length === 0) {
    const empty = document.createElement('div')
    empty.id = 'bs-seor-empty'
    empty.textContent = cfg.empty
    body.appendChild(empty)
  } else {
    for (const el of links) {
      const visible = isVisible(el)
      const row = document.createElement('div')
      row.className = visible ? 'bs-seor-row' : 'bs-seor-row bs-seor-hidden'

      const badge = document.createElement('span')
      badge.className = 'bs-seor-badge'
      badge.textContent = cfg.badge(el)

      const info = document.createElement('div')
      info.className = 'bs-seor-info'

      const text = document.createElement('span')
      text.className = 'bs-seor-text'
      const label = el.textContent?.trim()
        || el.getAttribute('aria-label')
        || el.querySelector('img')?.getAttribute('alt')
        || '(no text)'
      text.textContent = visible ? label : `${label} — hidden`

      const href = document.createElement('span')
      href.className = 'bs-seor-href'
      href.textContent = el.getAttribute('href') ?? ''

      info.appendChild(text)
      info.appendChild(href)
      row.appendChild(badge)
      row.appendChild(info)

      row.addEventListener('click', () => {
        hideSeoRelLinks()
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        if (visible) flash(el)
      })

      body.appendChild(row)
    }
  }

  panel.appendChild(body)
  backdrop.appendChild(panel)

  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) hideSeoRelLinks()
  })

  document.documentElement.appendChild(backdrop)
}

export function hideSeoRelLinks(): void {
  overlay?.remove()
  overlay = null
  backdrop?.remove()
  backdrop = null
}

export function isSeoRelLinksVisible(): boolean {
  return backdrop !== null
}
