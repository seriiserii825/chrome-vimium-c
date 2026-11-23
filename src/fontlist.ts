let backdrop: HTMLElement | null = null

const GENERIC = new Set([
  'serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui',
  'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded', 'emoji', 'math', 'fangsong',
  '-apple-system', 'blinkmacsystemfont',
])

interface FontUse {
  stack: string
  rendered: string
  count: number
  weights: Set<string>
  sizes: Set<string>
  styles: Set<string>
  elements: HTMLElement[]
  sample: string
}

function splitStack(stack: string): string[] {
  return stack.split(',').map((f) => f.trim().replace(/^["']|["']$/g, '')).filter(Boolean)
}

let canvasCtx: CanvasRenderingContext2D | null = null
const availCache = new Map<string, boolean>()

// Classic width test: if the text width differs from every fallback, the font exists locally.
function isLocallyAvailable(family: string): boolean {
  const cached = availCache.get(family)
  if (cached !== undefined) return cached
  canvasCtx ??= document.createElement('canvas').getContext('2d')
  if (!canvasCtx) return false
  const text = 'mmmmmmmmmmlliWW@#0'
  let found = false
  for (const base of ['monospace', 'serif', 'sans-serif']) {
    canvasCtx.font = `72px ${base}`
    const baseWidth = canvasCtx.measureText(text).width
    canvasCtx.font = `72px "${family}", ${base}`
    if (canvasCtx.measureText(text).width !== baseWidth) { found = true; break }
  }
  availCache.set(family, found)
  return found
}

function loadedFaceFamilies(): Set<string> {
  const set = new Set<string>()
  document.fonts.forEach((f) => {
    if (f.status === 'loaded') set.add(f.family.replace(/^["']|["']$/g, '').toLowerCase())
  })
  return set
}

function resolveRendered(stack: string, loaded: Set<string>): string {
  for (const fam of splitStack(stack)) {
    const lower = fam.toLowerCase()
    if (GENERIC.has(lower)) return fam
    if (loaded.has(lower) || isLocallyAvailable(fam)) return fam
  }
  return '(browser default)'
}

function isOwnUi(el: Element): boolean {
  return !!el.closest('[id^="bs-"], [class^="bs-"]')
}

function collectFonts(): FontUse[] {
  const map = new Map<string, FontUse>()
  const loaded = loadedFaceFamilies()
  const seen = new Set<Element>()
  const walker = document.createTreeWalker(document.body ?? document.documentElement, NodeFilter.SHOW_TEXT)

  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.nodeValue?.trim()
    if (!text) continue
    const el = node.parentElement
    if (!el || seen.has(el)) continue
    seen.add(el)
    const tag = el.tagName
    if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT' || tag === 'TEMPLATE') continue
    if (isOwnUi(el)) continue
    if (el.checkVisibility && !el.checkVisibility({ visibilityProperty: true, opacityProperty: true })) continue

    const cs = getComputedStyle(el)
    const stack = cs.fontFamily
    let use = map.get(stack)
    if (!use) {
      use = {
        stack,
        rendered: resolveRendered(stack, loaded),
        count: 0,
        weights: new Set(),
        sizes: new Set(),
        styles: new Set(),
        elements: [],
        sample: text.slice(0, 60),
      }
      map.set(stack, use)
    }
    use.count++
    use.weights.add(cs.fontWeight)
    use.sizes.add(cs.fontSize)
    if (cs.fontStyle !== 'normal') use.styles.add(cs.fontStyle)
    use.elements.push(el)
  }

  return [...map.values()].sort((a, b) => b.count - a.count)
}

function sortNum(values: Set<string>): string[] {
  return [...values].sort((a, b) => parseFloat(a) - parseFloat(b))
}

function flashAll(els: HTMLElement[]): void {
  const prev = els.map((el) => [el.style.outline, el.style.outlineOffset] as const)
  for (const el of els) {
    el.style.outline = '2px solid #f9e2af'
    el.style.outlineOffset = '1px'
  }
  setTimeout(() => {
    els.forEach((el, i) => {
      el.style.outline = prev[i][0]
      el.style.outlineOffset = prev[i][1]
    })
  }, 2000)
}

function addMeta(parent: HTMLElement, label: string, value: string): void {
  if (!value) return
  const line = document.createElement('div')
  line.className = 'bs-fonts-meta'
  const l = document.createElement('span')
  l.className = 'bs-fonts-meta-label'
  l.textContent = label
  const v = document.createElement('span')
  v.textContent = value
  line.append(l, v)
  parent.appendChild(line)
}

export function showFontList(): void {
  if (backdrop) return

  const fonts = collectFonts()
  const faces: FontFace[] = []
  document.fonts.forEach((f) => faces.push(f))

  backdrop = document.createElement('div')
  backdrop.id = 'bs-fonts-backdrop'

  const panel = document.createElement('div')
  panel.id = 'bs-fonts-panel'

  const header = document.createElement('div')
  header.id = 'bs-fonts-header'
  const title = document.createElement('span')
  title.textContent = `Fonts used (${fonts.length})`
  const closeBtn = document.createElement('button')
  closeBtn.id = 'bs-fonts-close'
  closeBtn.textContent = '×'
  closeBtn.addEventListener('click', hideFontList)
  header.append(title, closeBtn)
  panel.appendChild(header)

  const body = document.createElement('div')
  body.id = 'bs-fonts-body'

  if (fonts.length === 0) {
    const empty = document.createElement('div')
    empty.className = 'bs-fonts-empty'
    empty.textContent = 'No visible text found'
    body.appendChild(empty)
  }

  for (const f of fonts) {
    const row = document.createElement('div')
    row.className = 'bs-fonts-row'

    const top = document.createElement('div')
    top.className = 'bs-fonts-top'
    const name = document.createElement('span')
    name.className = 'bs-fonts-name'
    name.textContent = f.rendered
    const count = document.createElement('span')
    count.className = 'bs-fonts-count'
    count.textContent = `${f.count} el`
    top.append(name, count)

    const sample = document.createElement('div')
    sample.className = 'bs-fonts-sample'
    sample.style.fontFamily = f.stack
    sample.textContent = f.sample

    row.append(top, sample)
    addMeta(row, 'stack', f.stack)
    addMeta(row, 'weights', sortNum(f.weights).join(', '))
    addMeta(row, 'sizes', sortNum(f.sizes).join(', '))
    addMeta(row, 'styles', [...f.styles].join(', '))

    row.title = 'Click: scroll to first use and highlight all'
    row.addEventListener('click', () => {
      hideFontList()
      f.elements[0]?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      flashAll(f.elements)
    })
    body.appendChild(row)
  }

  if (faces.length > 0) {
    const section = document.createElement('div')
    section.className = 'bs-fonts-section'
    section.textContent = `Web fonts (@font-face: ${faces.length})`
    body.appendChild(section)

    for (const face of faces) {
      const line = document.createElement('div')
      line.className = `bs-fonts-face bs-fonts-face-${face.status}`
      const fam = document.createElement('span')
      fam.className = 'bs-fonts-face-name'
      fam.textContent = face.family.replace(/^["']|["']$/g, '')
      const info = document.createElement('span')
      info.className = 'bs-fonts-face-info'
      info.textContent = [face.weight, face.style !== 'normal' ? face.style : '', face.status]
        .filter(Boolean).join(' · ')
      line.append(fam, info)
      body.appendChild(line)
    }
  }

  panel.appendChild(body)
  backdrop.appendChild(panel)
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) hideFontList()
  })
  document.documentElement.appendChild(backdrop)
}

export function hideFontList(): void {
  backdrop?.remove()
  backdrop = null
}

export function isFontListVisible(): boolean {
  return backdrop !== null
}
