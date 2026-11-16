import { writeText } from './clipboard'
import { getImageNames } from './imageinfo'
import { showToast } from './toast'

// Ia — panel listing every <img> on the page with its info, filtered by the input on top.
// The input owns the keyboard (content.ts ignores keys while the panel is open):
// typing filters, Tab/↓/Ctrl+J next, Shift+Tab/↑/Ctrl+K previous, PgDn/PgUp ±5,
// Enter scroll to image, Ctrl+O open in background tab, Ctrl+Y copy path,
// Ctrl+E copy name, Ctrl+B copy basename, Escape close.

interface ImageItem {
  img: HTMLImageElement
  row: HTMLElement
  text: string // lowercase haystack for the filter
}

let backdrop: HTMLElement | null = null
let input: HTMLInputElement | null = null
let counter: HTMLElement | null = null
let items: ImageItem[] = []
let shown: ImageItem[] = [] // items matching the filter, in page order
let selected = 0 // index into `shown`

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

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}

// File size from the Resource Timing entry — no extra request. Cross-origin images
// without Timing-Allow-Origin report 0, and data: URLs have no entry at all.
function fileSize(src: string): number {
  if (src.startsWith('data:')) return Math.round((src.length - src.indexOf(',') - 1) * 0.75)
  const entry = performance.getEntriesByName(src)[0] as PerformanceResourceTiming | undefined
  return entry?.encodedBodySize || entry?.transferSize || 0
}

function fileType(src: string, filename: string): string {
  const dataType = src.match(/^data:image\/([\w+.-]+)/)
  if (dataType) return dataType[1]
  const dot = filename.lastIndexOf('.')
  return dot > 0 ? filename.slice(dot + 1).toLowerCase() : ''
}

function addSpan(parent: HTMLElement, cls: string, text: string): HTMLElement {
  const span = document.createElement('span')
  span.className = cls
  span.textContent = text
  span.title = text
  parent.appendChild(span)
  return span
}

function buildRow(img: HTMLImageElement, index: number): ImageItem {
  const { src, filename } = getImageNames(img)
  const visible = isVisible(img)

  const row = document.createElement('div')
  row.className = visible ? 'bs-imglist-row' : 'bs-imglist-row bs-imglist-hidden'

  const thumb = document.createElement('div')
  thumb.className = 'bs-imglist-thumb'
  const t = document.createElement('img')
  t.src = src
  t.loading = 'lazy'
  t.alt = ''
  thumb.appendChild(t)
  row.appendChild(thumb)

  const info = document.createElement('div')
  info.className = 'bs-imglist-info'

  const name = filename.startsWith('data:') || src.startsWith('data:') ? '(data URL)' : filename
  addSpan(info, 'bs-imglist-name', `${index + 1}. ${name}${visible ? '' : ' — hidden'}`)

  const meta: string[] = []
  const nw = img.naturalWidth
  const nh = img.naturalHeight
  meta.push(nw && nh ? `${nw} × ${nh}` : img.complete ? 'broken' : 'not loaded')
  const rect = img.getBoundingClientRect()
  if (visible) meta.push(`shown ${Math.round(rect.width)} × ${Math.round(rect.height)}`)
  const type = fileType(src, filename)
  if (type) meta.push(type)
  const size = fileSize(src)
  if (size) meta.push(formatBytes(size))
  addSpan(info, 'bs-imglist-meta', meta.join(' · '))

  const alt = img.getAttribute('alt')
  const altText = alt === null ? 'no alt' : alt === '' ? 'alt=""' : `alt: ${alt}`
  addSpan(info, alt ? 'bs-imglist-alt' : 'bs-imglist-alt bs-imglist-noalt', altText)

  if (!src.startsWith('data:')) addSpan(info, 'bs-imglist-path', src)

  row.appendChild(info)

  const item: ImageItem = {
    img,
    row,
    text: [name, meta.join(' '), altText, src.startsWith('data:') ? '' : src, visible ? '' : 'hidden'].join(' ').toLowerCase(),
  }

  row.addEventListener('click', () => {
    select(shown.indexOf(item), false)
    goToSelected()
  })
  row.addEventListener('mousemove', () => {
    const i = shown.indexOf(item)
    if (i !== selected) select(i, false)
  })

  return item
}

// Every space-separated term must appear somewhere in the row (name, size, type, alt, path).
function applyFilter(): void {
  const terms = (input?.value ?? '').toLowerCase().split(/\s+/).filter(Boolean)
  shown = []
  for (const it of items) {
    const match = terms.every((t) => it.text.includes(t))
    it.row.style.display = match ? '' : 'none'
    if (match) shown.push(it)
  }
  if (counter) counter.textContent = `${shown.length}/${items.length}`
  select(0, true)
}

export function showImageList(): void {
  if (backdrop) return

  const imgs = Array.from(document.querySelectorAll<HTMLImageElement>('img'))
    .filter((img) => img.currentSrc || img.getAttribute('src'))

  if (imgs.length === 0) {
    showToast('No images on this page', '')
    return
  }

  backdrop = document.createElement('div')
  backdrop.id = 'bs-imglist-backdrop'

  const panel = document.createElement('div')
  panel.id = 'bs-imglist-panel'

  const header = document.createElement('div')
  header.id = 'bs-imglist-header'
  const title = document.createElement('span')
  title.id = 'bs-imglist-title'
  const hidden = imgs.filter((img) => !isVisible(img)).length
  title.textContent = hidden ? `Images · ${hidden} hidden` : 'Images'
  input = document.createElement('input')
  input.id = 'bs-imglist-input'
  input.type = 'text'
  input.spellcheck = false
  input.autocomplete = 'off'
  input.placeholder = 'Filter by name, alt, path, type, size…'
  input.addEventListener('input', applyFilter)
  input.addEventListener('keydown', onKeydown)
  counter = document.createElement('span')
  counter.id = 'bs-imglist-counter'
  const closeBtn = document.createElement('button')
  closeBtn.id = 'bs-imglist-close'
  closeBtn.textContent = '×'
  closeBtn.addEventListener('click', hideImageList)
  header.appendChild(title)
  header.appendChild(input)
  header.appendChild(counter)
  header.appendChild(closeBtn)
  panel.appendChild(header)

  const body = document.createElement('div')
  body.id = 'bs-imglist-body'
  items = imgs.map((img, i) => {
    const item = buildRow(img, i)
    body.appendChild(item.row)
    return item
  })
  panel.appendChild(body)

  const footer = document.createElement('div')
  footer.id = 'bs-imglist-footer'
  footer.textContent = 'Tab/↓ next · Shift+Tab/↑ prev · Enter go to · Ctrl+O open · Ctrl+Y path · Ctrl+E name · Ctrl+B basename · Esc close'
  panel.appendChild(footer)

  // Keep keyboard focus in the input: clicks elsewhere in the panel must not steal it,
  // since content.ts ignores keys while the panel is open.
  panel.addEventListener('mousedown', (e) => {
    if (e.target !== input) e.preventDefault()
  })

  backdrop.appendChild(panel)
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) hideImageList()
  })

  document.documentElement.appendChild(backdrop)
  applyFilter()
  input.focus()
}

function select(index: number, scroll: boolean): void {
  if (index < 0) return
  items.forEach((it) => it.row.classList.remove('bs-imglist-selected'))
  if (!shown.length) return
  selected = Math.max(0, Math.min(shown.length - 1, index))
  shown[selected].row.classList.add('bs-imglist-selected')
  if (scroll) shown[selected].row.scrollIntoView({ block: 'nearest' })
}

// Tab/arrows wrap around; page jumps clamp.
function move(delta: number, wrap: boolean): void {
  if (!shown.length) return
  const n = shown.length
  select(wrap ? (((selected + delta) % n) + n) % n : selected + delta, true)
}

function goToSelected(): void {
  const img = shown[selected]?.img
  hideImageList()
  if (!img) return
  img.scrollIntoView({ behavior: 'smooth', block: 'center' })
  if (isVisible(img)) flash(img)
}

function copy(kind: 'src' | 'filename' | 'basename'): void {
  const img = shown[selected]?.img
  if (!img) return
  const value = getImageNames(img)[kind]
  writeText(value)
  showToast(value)
}

function onKeydown(e: KeyboardEvent): void {
  e.stopPropagation()
  const ctrl = (e.ctrlKey || e.metaKey) && !e.altKey
  const handled = (): void => e.preventDefault()

  if (e.key === 'Escape' || (e.ctrlKey && e.code === 'BracketLeft')) { handled(); hideImageList(); return }
  if (e.key === 'Enter') { handled(); goToSelected(); return }
  if (e.key === 'Tab') { handled(); move(e.shiftKey ? -1 : 1, true); return }
  if (e.key === 'ArrowDown' || (ctrl && e.code === 'KeyJ')) { handled(); move(1, true); return }
  if (e.key === 'ArrowUp' || (ctrl && e.code === 'KeyK')) { handled(); move(-1, true); return }
  if (e.key === 'PageDown') { handled(); move(5, false); return }
  if (e.key === 'PageUp') { handled(); move(-5, false); return }
  if (!ctrl) return // plain keys type into the filter

  switch (e.code) {
    case 'KeyO': {
      handled()
      const img = shown[selected]?.img
      const src = img?.currentSrc || img?.src
      if (src) chrome.runtime.sendMessage({ type: 'openTab', url: src })
      break
    }
    case 'KeyY': handled(); copy('src'); break
    case 'KeyE': handled(); copy('filename'); break
    case 'KeyB': handled(); copy('basename'); break
  }
}

export function hideImageList(): void {
  backdrop?.remove()
  backdrop = null
  input = null
  counter = null
  items = []
  shown = []
  selected = 0
}

export function isImageListVisible(): boolean {
  return backdrop !== null
}
