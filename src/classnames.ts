import { writeText } from './clipboard'
import { showToast } from './toast'

// One word or kebab-case, optionally BEM: block, block__elem, block--mod, block__elem--mod
const CLASS_RE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?:__[a-z0-9]+(?:-[a-z0-9]+)*)?(?:--[a-z0-9]+(?:-[a-z0-9]+)*)?$/
const MAX_ELEMENTS = 1500
const SAME_POS_PX = 3

let overlay: HTMLElement | null = null
let tooltip: HTMLElement | null = null
let highlight: HTMLElement | null = null

interface Item {
  el: Element
  classes: string[]
  top: number
  left: number
}

function pageClasses(el: Element): string[] {
  const raw = el.getAttribute('class')
  if (!raw) return []
  return raw.split(/\s+/).filter(c => c && !c.startsWith('bs-') && CLASS_RE.test(c))
}

function isOwnUi(el: Element): boolean {
  return el.closest('[id^="bs-"]') !== null
}

function collect(): Item[] {
  const items: Item[] = []
  for (const el of Array.from(document.body?.querySelectorAll('[class]') ?? [])) {
    if (el instanceof SVGElement && !(el instanceof SVGSVGElement)) continue
    const classes = pageClasses(el)
    if (classes.length === 0) continue
    if (isOwnUi(el)) continue
    const rect = el.getBoundingClientRect()
    if (rect.width < 1 || rect.height < 1) continue
    if (!el.checkVisibility({ visibilityProperty: true })) continue
    items.push({ el, classes, top: rect.top + scrollY, left: rect.left + scrollX })
    if (items.length >= MAX_ELEMENTS) break
  }
  return items
}

function classSpan(cls: string): HTMLElement {
  const span = document.createElement('span')
  span.textContent = cls
  span.className = cls.includes('--') ? 'bs-cls-mod' : cls.includes('__') ? 'bs-cls-elem' : 'bs-cls-block'
  return span
}

function describe(el: Element): string {
  const rect = el.getBoundingClientRect()
  const id = el.id ? `#${el.id}` : ''
  const cls = (el.getAttribute('class') ?? '').trim().split(/\s+/).filter(Boolean).map(c => `.${c}`).join('')
  return `<${el.tagName.toLowerCase()}>${id}${cls}\n${Math.round(rect.width)} × ${Math.round(rect.height)}\nclick to copy`
}

function showFor(el: Element, line: HTMLElement): void {
  if (!tooltip || !highlight) return
  const rect = el.getBoundingClientRect()
  highlight.style.top = `${rect.top}px`
  highlight.style.left = `${rect.left}px`
  highlight.style.width = `${rect.width}px`
  highlight.style.height = `${rect.height}px`
  highlight.style.display = 'block'

  tooltip.textContent = describe(el)
  tooltip.style.display = 'block'
  const lr = line.getBoundingClientRect()
  const tr = tooltip.getBoundingClientRect()
  let top = lr.bottom + 4
  if (top + tr.height > innerHeight) top = Math.max(0, lr.top - tr.height - 4)
  const left = Math.min(Math.max(0, lr.left), Math.max(0, innerWidth - tr.width - 4))
  tooltip.style.top = `${top}px`
  tooltip.style.left = `${left}px`
}

function hideTip(): void {
  if (tooltip) tooltip.style.display = 'none'
  if (highlight) highlight.style.display = 'none'
}

function makeLine(item: Item): HTMLElement {
  const line = document.createElement('div')
  line.className = 'bs-cls-line'
  item.classes.forEach((c, i) => {
    if (i) line.appendChild(document.createTextNode(' '))
    line.appendChild(classSpan(c))
  })
  line.addEventListener('mouseenter', () => showFor(item.el, line))
  line.addEventListener('mouseleave', hideTip)
  line.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation() })
  line.addEventListener('click', (e) => {
    e.preventDefault()
    e.stopPropagation()
    const text = item.classes.join(' ')
    writeText(text)
    showToast(text)
  })
  return line
}

// Push badges down until they don't overlap already placed ones (sorted by top, then left).
function resolveOverlaps(badges: HTMLElement[]): void {
  const placed: { top: number; left: number; right: number; bottom: number }[] = []
  for (const b of badges) {
    let top = parseFloat(b.style.top)
    const left = parseFloat(b.style.left)
    const w = b.offsetWidth
    const h = b.offsetHeight
    for (let guard = 0; guard < 50; guard++) {
      const hit = placed.find(p => left < p.right && left + w > p.left && top < p.bottom && top + h > p.top)
      if (!hit) break
      top = hit.bottom + 1
    }
    b.style.top = `${top}px`
    placed.push({ top, left, right: left + w, bottom: top + h })
  }
}

export function showClassNames(): void {
  if (overlay) { hideClassNames(); return }

  const items = collect()
  if (items.length === 0) { showToast('No BEM / kebab-case classes found', ''); return }

  overlay = document.createElement('div')
  overlay.id = 'bs-cls-overlay'

  // Elements sharing the same top-left (wrapper + inner block) go into one badge, outer first
  const groups: Item[][] = []
  const byPos = new Map<string, Item[]>()
  for (const it of items) {
    const key = `${Math.round(it.top / SAME_POS_PX)}:${Math.round(it.left / SAME_POS_PX)}`
    let g = byPos.get(key)
    if (!g) { g = []; byPos.set(key, g); groups.push(g) }
    g.push(it)
  }
  groups.sort((a, b) => a[0].top - b[0].top || a[0].left - b[0].left)

  const badges: HTMLElement[] = []
  for (const g of groups) {
    const badge = document.createElement('div')
    badge.className = 'bs-cls-badge'
    badge.style.top = `${Math.round(g[0].top)}px`
    badge.style.left = `${Math.round(g[0].left)}px`
    for (const it of g) badge.appendChild(makeLine(it))
    overlay.appendChild(badge)
    badges.push(badge)
  }

  highlight = document.createElement('div')
  highlight.id = 'bs-cls-highlight'
  tooltip = document.createElement('div')
  tooltip.id = 'bs-cls-tooltip'

  document.documentElement.appendChild(overlay)
  document.documentElement.appendChild(highlight)
  document.documentElement.appendChild(tooltip)
  resolveOverlaps(badges)

  addEventListener('scroll', hideTip, true)
  const capped = items.length >= MAX_ELEMENTS ? ` (first ${MAX_ELEMENTS})` : ''
  showToast(`${items.length} blocks with classes${capped} — Esc / q to close`, '')
}

export function hideClassNames(): void {
  removeEventListener('scroll', hideTip, true)
  overlay?.remove()
  overlay = null
  tooltip?.remove()
  tooltip = null
  highlight?.remove()
  highlight = null
}

export function isClassNamesVisible(): boolean {
  return overlay !== null
}
