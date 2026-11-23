import { writeText } from './clipboard'

let panel: HTMLElement | null = null

export function getImageNames(img: HTMLImageElement): { src: string; filename: string; basename: string } {
  const src = img.currentSrc || img.src
  const filename = decodeURIComponent(src.split('/').pop()?.split('?')[0] ?? 'image')
  const basename = filename.includes('.') ? filename.slice(0, filename.lastIndexOf('.')) : filename
  return { src, filename, basename }
}

// File size from the Resource Timing entry — no extra request. Cross-origin images
// without Timing-Allow-Origin report 0, and data: URLs have no entry at all.
export function fileSize(src: string): number {
  if (src.startsWith('data:')) return Math.round((src.length - src.indexOf(',') - 1) * 0.75)
  const entry = performance.getEntriesByName(src)[0] as PerformanceResourceTiming | undefined
  return entry?.encodedBodySize || entry?.transferSize || 0
}

function formatKB(n: number): string {
  return `${(n / 1024).toFixed(1)} KB`
}

// Fallback when Resource Timing has no size: HEAD request for Content-Length.
async function fetchSize(src: string): Promise<number> {
  try {
    const res = await fetch(src, { method: 'HEAD', cache: 'force-cache' })
    return Number(res.headers.get('content-length')) || 0
  } catch {
    return 0
  }
}

export function showImageInfo(img: HTMLImageElement): void {
  hideImageInfo()

  const { src, filename, basename } = getImageNames(img)
  const width = img.naturalWidth || img.width
  const height = img.naturalHeight || img.height
  const rect = img.getBoundingClientRect()

  panel = document.createElement('div')
  panel.id = 'bs-imginfo'

  // Header
  const header = document.createElement('div')
  header.id = 'bs-imginfo-header'
  const title = document.createElement('span')
  title.textContent = filename
  const closeBtn = document.createElement('button')
  closeBtn.id = 'bs-imginfo-close'
  closeBtn.textContent = '×'
  closeBtn.addEventListener('click', hideImageInfo)
  header.appendChild(title)
  header.appendChild(closeBtn)
  panel.appendChild(header)

  // Body
  const body = document.createElement('div')
  body.id = 'bs-imginfo-body'

  addRow(body, 'Size', width && height ? `${width} × ${height}` : '? × ?', '')
  const knownSize = fileSize(src)
  const weightEl = addRow(body, 'Weight', knownSize ? formatKB(knownSize) : '…', '')
  if (!knownSize) {
    const current = panel
    void fetchSize(src).then((n) => {
      if (panel !== current) return
      weightEl.textContent = n ? formatKB(n) : '?'
      weightEl.title = weightEl.textContent
    })
  }
  addRow(body, 'Name', filename, '')
  addRow(body, 'Path', src, 'bs-imginfo-path')

  panel.appendChild(body)

  // Footer
  const footer = document.createElement('div')
  footer.id = 'bs-imginfo-footer'

  footer.appendChild(makeBtn('Copy path', () => writeText(src)))
  footer.appendChild(makeBtn('Copy name', () => writeText(filename)))
  footer.appendChild(makeBtn('Copy basename', () => writeText(basename)))

  panel.appendChild(footer)

  document.documentElement.appendChild(panel)

  // Position near image after layout
  const pw = panel.offsetWidth
  const ph = panel.offsetHeight
  const vw = window.innerWidth
  const vh = window.innerHeight

  let top = rect.bottom + 8
  if (top + ph > vh - 8) top = rect.top - ph - 8
  if (top < 8) top = 8

  let left = rect.left
  if (left + pw > vw - 8) left = vw - pw - 8
  if (left < 8) left = 8

  panel.style.top = `${Math.round(top)}px`
  panel.style.left = `${Math.round(left)}px`
}

function addRow(parent: HTMLElement, label: string, value: string, extraClass: string): HTMLElement {
  const row = document.createElement('div')
  row.className = 'bs-imginfo-row'

  const lbl = document.createElement('span')
  lbl.className = 'bs-imginfo-label'
  lbl.textContent = label

  const val = document.createElement('span')
  val.className = 'bs-imginfo-val' + (extraClass ? ` ${extraClass}` : '')
  val.textContent = value
  val.title = value

  row.appendChild(lbl)
  row.appendChild(val)
  parent.appendChild(row)
  return val
}

function makeBtn(text: string, action: () => void): HTMLButtonElement {
  const btn = document.createElement('button')
  btn.className = 'bs-imginfo-btn'
  btn.textContent = text
  btn.addEventListener('click', () => {
    action()
    btn.textContent = 'Copied!'
    setTimeout(() => { btn.textContent = text }, 1500)
  })
  return btn
}

export function hideImageInfo(): void {
  panel?.remove()
  panel = null
}

export function isImageInfoVisible(): boolean {
  return panel !== null
}
