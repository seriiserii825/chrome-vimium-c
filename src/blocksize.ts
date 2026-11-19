import { writeText } from './clipboard'

let panel: HTMLElement | null = null
let outline: HTMLElement | null = null

const BLOCK_DISPLAYS = new Set([
  'block', 'flex', 'grid', 'inline-block', 'inline-flex', 'inline-grid',
  'table', 'list-item', 'flow-root', 'table-cell',
])
const MAX_BLOCKS = 196 // two-char hint labels: 14 × 14

// Visible block-level elements in the viewport. A wrapper with the same box as its nearest
// kept ancestor is skipped (it would only stack a second hint on the same spot). With too many
// blocks, the largest ones are kept.
export function getBlocks(): HTMLElement[] {
  const vw = window.innerWidth, vh = window.innerHeight
  const kept: Array<{ el: HTMLElement; r: DOMRect }> = []
  const keptSet = new Map<HTMLElement, DOMRect>()
  for (const el of Array.from(document.body?.querySelectorAll<HTMLElement>('*') ?? [])) {
    if (el.closest('#bs-vimium-hints, #bs-blocksize, #bs-blocksize-outline')) continue
    const r = el.getBoundingClientRect()
    if (r.width < 24 || r.height < 16) continue
    if (r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw) continue
    const s = getComputedStyle(el)
    if (!BLOCK_DISPLAYS.has(s.display) || s.visibility === 'hidden' || parseFloat(s.opacity) === 0) continue
    let anc = el.parentElement
    while (anc && !keptSet.has(anc)) anc = anc.parentElement
    const ar = anc ? keptSet.get(anc) : undefined
    if (ar && Math.abs(ar.left - r.left) < 1 && Math.abs(ar.top - r.top) < 1 &&
        Math.abs(ar.width - r.width) < 1 && Math.abs(ar.height - r.height) < 1) continue
    kept.push({ el, r })
    keptSet.set(el, r)
  }
  if (kept.length <= MAX_BLOCKS) return kept.map(k => k.el)
  const big = new Set(
    [...kept].sort((a, b) => b.r.width * b.r.height - a.r.width * a.r.height).slice(0, MAX_BLOCKS).map(k => k.el)
  )
  return kept.filter(k => big.has(k.el)).map(k => k.el)
}

const fmt = (n: number) => String(Math.round(n * 100) / 100)
const px = (v: string) => parseFloat(v) || 0
const sides = (s: CSSStyleDeclaration, prop: 'padding' | 'margin' | 'border') => {
  const get = (side: string) => px(s.getPropertyValue(prop === 'border' ? `border-${side}-width` : `${prop}-${side}`))
  const [t, r, b, l] = ['top', 'right', 'bottom', 'left'].map(get)
  return t === r && r === b && b === l ? fmt(t) : `${fmt(t)} ${fmt(r)} ${fmt(b)} ${fmt(l)}`
}

function describe(el: HTMLElement): string {
  let d = el.tagName.toLowerCase()
  if (el.id) d += `#${el.id}`
  const cls = Array.from(el.classList).filter(c => !c.startsWith('bs-')).slice(0, 3)
  if (cls.length) d += '.' + cls.join('.')
  return d
}

export function showBlockSize(el: HTMLElement): void {
  hideBlockSize()

  const r = el.getBoundingClientRect()
  const s = getComputedStyle(el)
  const padX = px(s.paddingLeft) + px(s.paddingRight), padY = px(s.paddingTop) + px(s.paddingBottom)
  const bdX = px(s.borderLeftWidth) + px(s.borderRightWidth), bdY = px(s.borderTopWidth) + px(s.borderBottomWidth)
  const size = `${fmt(r.width)} × ${fmt(r.height)}`
  const content = `${fmt(el.offsetWidth - padX - bdX)} × ${fmt(el.offsetHeight - padY - bdY)}`

  outline = document.createElement('div')
  outline.id = 'bs-blocksize-outline'
  Object.assign(outline.style, {
    left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`,
  })
  document.documentElement.appendChild(outline)

  panel = document.createElement('div')
  panel.id = 'bs-blocksize'

  const header = document.createElement('div')
  header.id = 'bs-blocksize-header'
  const title = document.createElement('span')
  title.textContent = describe(el)
  title.title = title.textContent
  const closeBtn = document.createElement('button')
  closeBtn.id = 'bs-blocksize-close'
  closeBtn.textContent = '×'
  closeBtn.addEventListener('click', hideBlockSize)
  header.append(title, closeBtn)

  const body = document.createElement('div')
  body.id = 'bs-blocksize-body'
  const rows: Array<[string, string]> = [
    ['Size', size],
    ['Content', content],
    ['Padding', sides(s, 'padding')],
    ['Border', sides(s, 'border')],
    ['Margin', sides(s, 'margin')],
    ['Box', s.boxSizing],
    ['Scroll', `${el.scrollWidth} × ${el.scrollHeight}`],
  ]
  for (const [label, value] of rows) {
    const row = document.createElement('div')
    row.className = 'bs-imginfo-row'
    const lbl = document.createElement('span')
    lbl.className = 'bs-imginfo-label bs-blocksize-label'
    lbl.textContent = label
    const val = document.createElement('span')
    val.className = 'bs-imginfo-val'
    val.textContent = value
    row.append(lbl, val)
    body.appendChild(row)
  }

  const footer = document.createElement('div')
  footer.id = 'bs-blocksize-footer'
  const btn = document.createElement('button')
  btn.className = 'bs-imginfo-btn'
  btn.textContent = 'Copy size'
  btn.addEventListener('click', () => {
    writeText(size.replace(' × ', 'x'))
    btn.textContent = 'Copied!'
    setTimeout(() => { btn.textContent = 'Copy size' }, 1500)
  })
  footer.appendChild(btn)

  panel.append(header, body, footer)
  document.documentElement.appendChild(panel)

  const pw = panel.offsetWidth, ph = panel.offsetHeight
  const vw = window.innerWidth, vh = window.innerHeight
  let top = r.bottom + 8
  let left = r.left
  if (top + ph > vh - 8) top = r.top - ph - 8
  if (top < 8) { top = vh - ph - 8; left = vw - pw - 8 } // no room above/below: bottom-right corner
  if (left + pw > vw - 8) left = vw - pw - 8
  if (left < 8) left = 8
  panel.style.top = `${Math.round(Math.max(8, top))}px`
  panel.style.left = `${Math.round(left)}px`
}

export function hideBlockSize(): void {
  panel?.remove()
  outline?.remove()
  panel = null
  outline = null
}

export function isBlockSizeVisible(): boolean {
  return panel !== null
}
