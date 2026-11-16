import { writeText } from './clipboard'
import { getImageNames } from './imageinfo'
import { showToast } from './toast'

// Ia — panel listing every <img> on the page with its info.
// Keys: j/k (↓/↑) select, Enter scroll to image, o open in new tab,
// y copy path, n copy name, b copy basename, q/Escape close.

interface ImageItem {
  img: HTMLImageElement
  row: HTMLElement
}

let backdrop: HTMLElement | null = null
let items: ImageItem[] = []
let selected = 0

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

function buildRow(img: HTMLImageElement, index: number): HTMLElement {
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
  addSpan(info, alt ? 'bs-imglist-alt' : 'bs-imglist-alt bs-imglist-noalt', alt === null ? 'no alt' : alt === '' ? 'alt=""' : `alt: ${alt}`)

  if (!src.startsWith('data:')) addSpan(info, 'bs-imglist-path', src)

  row.appendChild(info)

  row.addEventListener('click', () => {
    selected = index
    goToSelected()
  })
  row.addEventListener('mousemove', () => {
    if (selected !== index) select(index, false)
  })

  return row
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
  const hidden = imgs.filter((img) => !isVisible(img)).length
  title.textContent = `Images (${imgs.length}${hidden ? `, ${hidden} hidden` : ''})`
  const closeBtn = document.createElement('button')
  closeBtn.id = 'bs-imglist-close'
  closeBtn.textContent = '×'
  closeBtn.addEventListener('click', hideImageList)
  header.appendChild(title)
  header.appendChild(closeBtn)
  panel.appendChild(header)

  const body = document.createElement('div')
  body.id = 'bs-imglist-body'
  items = imgs.map((img, i) => {
    const row = buildRow(img, i)
    body.appendChild(row)
    return { img, row }
  })
  panel.appendChild(body)

  const footer = document.createElement('div')
  footer.id = 'bs-imglist-footer'
  footer.textContent = 'j/k select · Enter go to · o open · y path · n name · b basename · q close'
  panel.appendChild(footer)

  backdrop.appendChild(panel)
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) hideImageList()
  })

  document.documentElement.appendChild(backdrop)
  select(0, true)
}

function select(index: number, scroll: boolean): void {
  if (!items.length) return
  selected = Math.max(0, Math.min(items.length - 1, index))
  items.forEach((it, i) => it.row.classList.toggle('bs-imglist-selected', i === selected))
  if (scroll) items[selected].row.scrollIntoView({ block: 'nearest' })
}

function goToSelected(): void {
  const img = items[selected]?.img
  hideImageList()
  if (!img) return
  img.scrollIntoView({ behavior: 'smooth', block: 'center' })
  if (isVisible(img)) flash(img)
}

function copy(kind: 'src' | 'filename' | 'basename'): void {
  const img = items[selected]?.img
  if (!img) return
  const value = getImageNames(img)[kind]
  writeText(value)
  showToast(value)
}

// Called by content.ts for every keydown while the panel is open.
export function handleImageListKey(e: KeyboardEvent, key: string): void {
  e.preventDefault()
  e.stopPropagation()
  const page = 5
  switch (key) {
    case 'Escape':
    case 'q': hideImageList(); break
    case 'j':
    case 'ArrowDown': select(selected + 1, true); break
    case 'k':
    case 'ArrowUp': select(selected - 1, true); break
    case 'd':
    case 'PageDown': select(selected + page, true); break
    case 'u':
    case 'PageUp': select(selected - page, true); break
    case 'g':
    case 'Home': select(0, true); break
    case 'G':
    case 'End': select(items.length - 1, true); break
    case 'Enter': goToSelected(); break
    case 'o': {
      const src = items[selected]?.img.currentSrc || items[selected]?.img.src
      if (src) chrome.runtime.sendMessage({ type: 'openTab', url: src })
      break
    }
    case 'y': copy('src'); break
    case 'n': copy('filename'); break
    case 'b': copy('basename'); break
  }
}

export function hideImageList(): void {
  backdrop?.remove()
  backdrop = null
  items = []
  selected = 0
}

export function isImageListVisible(): boolean {
  return backdrop !== null
}
