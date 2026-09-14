import { showToast } from './toast'
import { showImageInfo, getImageNames } from './imageinfo'
import { writeText, readText } from './clipboard'

// Home-row first, then nearby keys for comfortable typing
const CHARS = 'sadfjklewcpghnrtuoibvyxz'

function getCopyable(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('*')).filter(el => {
    if (!isVisible(el)) return false
    for (const child of Array.from(el.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE && child.textContent?.trim()) return true
    }
    return false
  })
}

interface Clickable {
  el: HTMLElement
  clickTarget?: HTMLElement
}

function getClickable(): Clickable[] {
  const selector = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled]):not([type="hidden"])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[onclick]',
    '[role="button"]',
    '[role="link"]',
    '[tabindex]:not([tabindex="-1"])',
  ].join(', ')

  const fromSelector = new Set(Array.from(document.querySelectorAll<HTMLElement>(selector)))
  const added = new Set<HTMLElement>()
  const result: Clickable[] = []

  const add = (el: HTMLElement, clickTarget?: HTMLElement) => {
    if (!added.has(el)) { added.add(el); result.push({ el, clickTarget }) }
  }

  // For hidden interactive elements (e.g. visually-replaced checkboxes/radios),
  // place hint on closest visible ancestor but keep original as clickTarget.
  for (const el of fromSelector) {
    if (!isVisible(el)) {
      let p = el.parentElement
      while (p) {
        if (isVisible(p)) { add(p, el); break }
        p = p.parentElement
      }
    }
  }

  for (const el of Array.from(document.querySelectorAll<HTMLElement>('*'))) {
    if (!isVisible(el)) continue
    if (fromSelector.has(el)) {
      add(el)
    } else if (window.getComputedStyle(el).cursor === 'pointer' && !el.closest('svg')) {
      add(el)
    }
  }
  return result
}

function isVisible(el: HTMLElement): boolean {
  const r = el.getBoundingClientRect()
  if (r.width === 0 || r.height === 0) return false
  if (r.bottom < 0 || r.top > window.innerHeight) return false
  if (r.right < 0 || r.left > window.innerWidth) return false
  const s = window.getComputedStyle(el)
  return s.display !== 'none' && s.visibility !== 'hidden' && parseFloat(s.opacity) > 0
}

export function generateLabels(n: number): string[] {
  const labels: string[] = []
  if (n <= CHARS.length) {
    for (let i = 0; i < n; i++) labels.push(CHARS[i])
  } else {
    outer: for (let i = 0; i < CHARS.length; i++)
      for (let j = 0; j < CHARS.length; j++) {
        labels.push(CHARS[i] + CHARS[j])
        if (labels.length === n) break outer
      }
  }
  return labels
}

export type HintMode = 'f' | 'F' | 'y' | 'yl' | 'yi' | 'ym' | 'ymi' | 'om' | 'ymf' | 'h' | 'di' | 'ci' | 'cs' | 'oI' | 'oV' | 'ii' | 'ip' | 'in' | 'ib' | 'ctc' | 'ctmc' | 'ie' | 'ic' | 'is' | 'pi' | 'c' | 'ygc' | 'ygo'

export interface HintEntry {
  el: HTMLElement
  clickTarget?: HTMLElement
  label: string
  node: HTMLElement
}

export interface HintSession {
  mode: HintMode
  entries: HintEntry[]
  typed: string
  container: HTMLElement
  collected?: string[]
  collectedEntries?: HintEntry[]
  count: number
}

let lastHovered: HTMLElement | null = null
let hoverStyleEl: HTMLStyleElement | null = null

function dispatchMouse(el: HTMLElement, type: string, x: number, y: number, bubbles = true): void {
  el.dispatchEvent(new MouseEvent(type, { bubbles, cancelable: true, view: window, clientX: x, clientY: y }))
}

function ancestorPath(el: HTMLElement): HTMLElement[] {
  const path: HTMLElement[] = []
  let node: HTMLElement | null = el
  while (node && node !== document.documentElement) {
    path.push(node)
    node = node.parentElement
  }
  return path
}

// CSS :hover не активируется синтетическими JS-событиями — Chrome обновляет
// :hover только от реальных OS-событий. Поэтому читаем все CSS-правила страницы,
// заменяем :hover на [data-bs-hover] и инжектируем как отдельный <style> тег.
function extractHoverRules(ruleList: CSSRuleList): string[] {
  const result: string[] = []
  for (const rule of Array.from(ruleList)) {
    if (rule instanceof CSSStyleRule && rule.selectorText.includes(':hover')) {
      const newSel = rule.selectorText.replace(/:hover\b/g, '[data-bs-hover]')
      result.push(`${newSel} { ${rule.style.cssText} }`)
    } else if (rule instanceof CSSMediaRule) {
      const inner = extractHoverRules(rule.cssRules)
      if (inner.length > 0) {
        result.push(`@media ${rule.conditionText} { ${inner.join('\n')} }`)
      }
    }
  }
  return result
}

// Некоторые элементы раскрывают hover-эффект у ДРУГОГО элемента (например,
// ".row:hover .actions { display: block }") и сами не имеют cursor:pointer.
// Извлекаем компонент селектора непосредственно перед ":hover", чтобы находить
// такие элементы-триггеры и предлагать их как цели для наведения.
function extractHoverTriggerSelectors(ruleList: CSSRuleList): string[] {
  const result: string[] = []
  for (const rule of Array.from(ruleList)) {
    if (rule instanceof CSSStyleRule) {
      for (const part of rule.selectorText.split(',')) {
        const matches = part.match(/[^\s>+~]+:hover\b/g)
        if (matches) {
          for (const m of matches) result.push(m.replace(/:hover\b/, ''))
        }
      }
    } else if (rule instanceof CSSMediaRule) {
      result.push(...extractHoverTriggerSelectors(rule.cssRules))
    }
  }
  return result
}

function activateCSSHover(el: HTMLElement): void {
  const path = ancestorPath(el)
  for (const a of path) a.dataset.bsHover = '1'

  const rules: string[] = []
  for (const sheet of Array.from(document.styleSheets)) {
    try { rules.push(...extractHoverRules(sheet.cssRules)) } catch { /* cross-origin */ }
  }
  if (rules.length === 0) return
  hoverStyleEl = document.createElement('style')
  hoverStyleEl.textContent = rules.join('\n')
  document.head.appendChild(hoverStyleEl)
}

function deactivateCSSHover(): void {
  for (const el of Array.from(document.querySelectorAll<HTMLElement>('[data-bs-hover]'))) {
    delete el.dataset.bsHover
  }
  hoverStyleEl?.remove()
  hoverStyleEl = null
}

export function unhoverLast(): void {
  if (!lastHovered) return
  const el = lastHovered
  lastHovered = null

  deactivateCSSHover()

  const r = el.getBoundingClientRect()
  const cx = r.left + r.width / 2
  const cy = r.top + r.height / 2
  dispatchMouse(el, 'mouseout', cx, cy)
  for (const ancestor of ancestorPath(el)) {
    dispatchMouse(ancestor, 'mouseleave', cx, cy, false)
  }
}

function getTableColumns(): HTMLElement[] {
  const result: HTMLElement[] = []
  for (const table of Array.from(document.querySelectorAll<HTMLTableElement>('table'))) {
    if (!isVisible(table)) continue
    const headerRow = table.querySelector('thead tr') ?? table.querySelector('tr')
    if (!headerRow) continue
    for (const cell of Array.from((headerRow as HTMLTableRowElement).cells)) {
      if (isVisible(cell as HTMLElement)) result.push(cell as HTMLElement)
    }
  }
  return result
}

function getColumnText(cell: HTMLTableCellElement): string {
  const table = cell.closest('table')
  if (!table) return cell.innerText.trim()
  const colIndex = cell.cellIndex
  return Array.from(table.querySelectorAll('tr'))
    .map(row => ((row as HTMLTableRowElement).cells[colIndex]?.innerText.trim() ?? ''))
    .filter(t => t)
    .join('\n')
}

function getHoverable(): HTMLElement[] {
  const isCandidate = (el: HTMLElement) => isVisible(el) && !el.closest('svg')

  const result = Array.from(document.querySelectorAll<HTMLElement>('*')).filter(el =>
    isCandidate(el) && window.getComputedStyle(el).cursor === 'pointer'
  )
  const added = new Set<HTMLElement>(result)

  const triggerSelectors = new Set<string>()
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      for (const sel of extractHoverTriggerSelectors(sheet.cssRules)) triggerSelectors.add(sel)
    } catch { /* cross-origin */ }
  }

  for (const sel of triggerSelectors) {
    let matched: HTMLElement[]
    try { matched = Array.from(document.querySelectorAll<HTMLElement>(sel)) } catch { continue }
    for (const el of matched) {
      if (added.has(el) || !isCandidate(el)) continue
      added.add(el)
      result.push(el)
    }
  }
  return result
}

function getCheckboxesAndRadios(): Clickable[] {
  const inputs = Array.from(document.querySelectorAll<HTMLElement>(
    'input[type="checkbox"]:not([disabled]), input[type="radio"]:not([disabled])'
  ))
  const added = new Set<HTMLElement>()
  const result: Clickable[] = []
  for (const el of inputs) {
    if (isVisible(el)) {
      if (!added.has(el)) { added.add(el); result.push({ el }) }
    } else {
      let p = el.parentElement
      while (p) {
        if (isVisible(p)) { if (!added.has(p)) { added.add(p); result.push({ el: p, clickTarget: el }) } break }
        p = p.parentElement
      }
    }
  }
  return result
}

function getFormControls(): Clickable[] {
  const checkboxRadio = getCheckboxesAndRadios()
  const selects = Array.from(document.querySelectorAll<HTMLElement>('select:not([disabled])')).filter(isVisible)
  const added = new Set<HTMLElement>(checkboxRadio.map(c => c.el))
  const result: Clickable[] = [...checkboxRadio]
  for (const el of selects) {
    if (!added.has(el)) { added.add(el); result.push({ el }) }
  }
  return result
}

function getLinksAndButtons(): Clickable[] {
  const selector = [
    'a[href]',
    'button:not([disabled])',
    '[onclick]',
    '[role="button"]',
    '[role="link"]',
    '[tabindex]:not([tabindex="-1"])',
  ].join(', ')

  const fromSelector = new Set(Array.from(document.querySelectorAll<HTMLElement>(selector)))
  const isFormControl = (el: HTMLElement) =>
    (el instanceof HTMLInputElement && el.type !== 'submit') ||
    el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement

  const added = new Set<HTMLElement>()
  const result: Clickable[] = []
  const add = (el: HTMLElement, clickTarget?: HTMLElement) => {
    if (!added.has(el)) { added.add(el); result.push({ el, clickTarget }) }
  }

  for (const el of Array.from(document.querySelectorAll<HTMLElement>('*'))) {
    if (!isVisible(el)) continue
    if (isFormControl(el)) continue
    if (fromSelector.has(el)) {
      add(el)
    } else if (window.getComputedStyle(el).cursor === 'pointer' && !el.closest('svg')) {
      add(el)
    }
  }
  return result
}

export function beginHints(mode: HintMode, count = 1): HintSession | null {
  const rawElements: HTMLElement[] | Clickable[] =
    (mode === 'y' || mode === 'ym') ? getCopyable()
    : mode === 'yl' ? Array.from(document.querySelectorAll<HTMLElement>('a[href]')).filter(isVisible)
    : (mode === 'yi' || mode === 'ymi' || mode === 'ie' || mode === 'ic' || mode === 'is' || mode === 'pi' || mode === 'ygc' || mode === 'ygo') ? Array.from(document.querySelectorAll<HTMLElement>(
        'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="checkbox"]):not([type="radio"]):not([type="file"]):not([disabled]), textarea:not([disabled])'
      )).filter(isVisible)
    : mode === 'cs' ? Array.from(document.querySelectorAll<HTMLElement>('svg')).filter(el => isVisible(el) && !el.parentElement?.closest('svg'))
    : (mode === 'di' || mode === 'ci' || mode === 'oI' || mode === 'ii' || mode === 'ip' || mode === 'in' || mode === 'ib') ? Array.from(document.querySelectorAll<HTMLElement>('img[src]')).filter(isVisible)
    : mode === 'oV' ? Array.from(document.querySelectorAll<HTMLElement>('video')).filter(isVisible)
    : mode === 'h' ? getHoverable()
    : (mode === 'ctc' || mode === 'ctmc') ? getTableColumns()
    : mode === 'ymf' ? getCheckboxesAndRadios()
    : mode === 'c' ? getFormControls()
    : (mode === 'f' || mode === 'F') ? getLinksAndButtons()
    : getClickable()
  if (rawElements.length === 0) return null

  const clickables: Clickable[] = (rawElements as Array<HTMLElement | Clickable>).map(
    item => (item instanceof HTMLElement ? { el: item } : item)
  )

  const labels = generateLabels(clickables.length)

  const container = document.createElement('div')
  container.id = 'bs-vimium-hints'
  document.documentElement.appendChild(container)

  // Nested elements (e.g. <strong> as the first child of <p>) can share the exact
  // same top-left point, so their hints would paint on top of each other and only the
  // topmost (last-appended) one would ever be clickable. Detect real ancestor/descendant
  // pairs whose rects nearly coincide (exact rounded-pixel matching is too fragile — sub-pixel
  // layout differences make ancestor and descendant round to different integers) and push the
  // nested (descendant) element's hint diagonally out of the way, once per matching ancestor.
  // The outermost element (e.g. the <p>) keeps its natural position at the visible text start,
  // since that's the one users expect to find there — it also copies the full text including
  // nested children via innerText.
  const EPS = 3
  const rects = clickables.map(({ el }) => el.getBoundingClientRect())
  const offsetLevels = clickables.map(({ el }, i) => {
    let level = 0
    for (let j = 0; j < clickables.length; j++) {
      if (i === j) continue
      const otherEl = clickables[j].el
      if (!otherEl.contains(el)) continue // otherEl is an ancestor of el
      const a = rects[i], b = rects[j]
      if (Math.abs(a.left - b.left) <= EPS && Math.abs(a.top - b.top) <= EPS) level++
    }
    return level
  })

  const entries: HintEntry[] = clickables.map(({ el, clickTarget }, i) => {
    const r = rects[i]
    const level = offsetLevels[i]
    // A colliding nested element starts at the exact same point as its ancestor, so there's
    // no usable spot "at its start" that isn't already taken — and its right edge sits right
    // where the NEXT sibling's text begins, which visually reads as belonging to that sibling
    // instead. Move it straight up, clear of the line's own text entirely, so it can't be
    // mistaken for any of the surrounding content.
    const left = Math.round(r.left) + (level > 0 ? (level - 1) * 14 : 0)
    const top = Math.round(r.top) - level * 16

    const node = document.createElement('div')
    node.className = 'bs-vimium-hint'
    node.textContent = labels[i]
    // Container is position:fixed at (0,0), so these are viewport coords
    node.style.left = `${left}px`
    node.style.top = `${top}px`
    container.appendChild(node)
    return { el, clickTarget, label: labels[i], node }
  })

  return { mode, entries, typed: '', container, count: Math.max(1, count) }
}

export function typeHint(session: HintSession, key: string): 'continue' | 'done' | 'cancel' {
  if (key === 'Escape') return 'cancel'

  // Enter завершает multi-yank и копирует накопленный текст
  if (key === 'Enter' && (session.mode === 'ym' || session.mode === 'ymi' || session.mode === 'ctmc')) {
    const collected = session.collected
    if (collected && collected.length > 0) {
      writeText(collected.join('\n'))
      showToast(`Copied ${collected.length} items`)
    }
    return 'done'
  }

  // Enter завершает open-multi-links и открывает все накопленные ссылки в новых вкладках
  if (key === 'Enter' && session.mode === 'om') {
    const entries = session.collectedEntries
    if (entries && entries.length > 0) {
      for (const entry of entries) {
        const anchor = entry.el instanceof HTMLAnchorElement ? entry.el : entry.el.closest('a[href]')
        if (anchor instanceof HTMLAnchorElement && anchor.href) {
          chrome.runtime.sendMessage({ type: 'openTab', url: anchor.href })
        } else {
          const clickEl = entry.clickTarget ?? entry.el
          clickEl.focus()
          clickEl.click()
        }
      }
      showToast(`Opened ${entries.length} links`)
    }
    return 'done'
  }

  // Enter завершает multi-follow и кликает все накопленные элементы
  if (key === 'Enter' && session.mode === 'ymf') {
    const entries = session.collectedEntries
    if (entries && entries.length > 0) {
      for (const entry of entries) {
        const clickEl = entry.clickTarget ?? entry.el
        clickEl.focus()
        clickEl.click()
      }
      showToast(`Clicked ${entries.length} elements`)
    }
    return 'done'
  }

  if (key === 'Backspace') {
    session.typed = session.typed.slice(0, -1)
  } else if (/^[a-zA-Z]$/.test(key)) {
    session.typed += key.toLowerCase()
  } else {
    return 'continue'
  }

  const typed = session.typed

  const match = session.entries.find(e => e.label === typed)
  if (match) {
    if (session.mode === 'ym') {
      const text = match.el.innerText?.trim() || ''
      if (text) {
        session.collected = session.collected ?? []
        session.collected.push(text)
        match.node.classList.add('selected')
      }
      session.typed = ''
      for (const entry of session.entries) entry.node.classList.remove('dim')
      return 'continue'
    }
    if (session.mode === 'ymi') {
      const el = match.el as HTMLInputElement | HTMLTextAreaElement
      const text = el.value.trim() || (el as HTMLInputElement).placeholder?.trim() || ''
      if (text) {
        session.collected = session.collected ?? []
        session.collected.push(text)
        match.node.classList.add('selected')
      }
      session.typed = ''
      for (const entry of session.entries) entry.node.classList.remove('dim')
      return 'continue'
    }
    if (session.mode === 'ctmc') {
      const text = getColumnText(match.el as HTMLTableCellElement)
      if (text) {
        session.collected = session.collected ?? []
        session.collected.push(text)
        match.node.classList.add('selected')
      }
      session.typed = ''
      for (const entry of session.entries) entry.node.classList.remove('dim')
      return 'continue'
    }
    if (session.mode === 'om') {
      session.collectedEntries = session.collectedEntries ?? []
      session.collectedEntries.push(match)
      match.node.classList.add('selected')
      session.typed = ''
      for (const entry of session.entries) entry.node.classList.remove('dim')
      return 'continue'
    }
    if (session.mode === 'ymf') {
      session.collectedEntries = session.collectedEntries ?? []
      session.collectedEntries.push(match)
      match.node.classList.add('selected')
      session.typed = ''
      for (const entry of session.entries) entry.node.classList.remove('dim')
      return 'continue'
    }
    activate(match, session.mode, session.count)
    return 'done'
  }

  let visible = 0
  for (const entry of session.entries) {
    const ok = entry.label.startsWith(typed)
    entry.node.classList.toggle('dim', !ok)
    if (ok) visible++
  }

  return visible > 0 ? 'continue' : 'cancel'
}

function copyImageViaExecCommand(imgEl: HTMLImageElement): boolean {
  const selection = window.getSelection()
  if (!selection) return false
  const range = document.createRange()
  range.selectNode(imgEl)
  selection.removeAllRanges()
  selection.addRange(range)
  let ok = false
  try { ok = document.execCommand('copy') } catch { ok = false }
  selection.removeAllRanges()
  return ok
}

async function copyImageToClipboard(imgEl: HTMLImageElement): Promise<void> {
  if (!navigator.clipboard?.write) {
    showToast(copyImageViaExecCommand(imgEl) ? 'Image copied' : 'Copy failed')
    return
  }
  try {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject()
      img.src = imgEl.src
    })
    const canvas = document.createElement('canvas')
    canvas.width = img.naturalWidth
    canvas.height = img.naturalHeight
    canvas.getContext('2d')!.drawImage(img, 0, 0)
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(b => b ? resolve(b) : reject(), 'image/png')
    )
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
    showToast('Image copied')
  } catch {
    showToast(copyImageViaExecCommand(imgEl) ? 'Image copied' : 'Copy failed (CORS)')
  }
}

function activate(entry: HintEntry, mode: HintMode, count = 1): void {
  if (mode === 'f') {
    const clickEl = entry.clickTarget ?? entry.el
    clickEl.focus()
    for (let i = 0; i < count; i++) clickEl.click()
    if (count > 1) showToast(`Clicked ${count}×`)
  } else if (mode === 'ctc') {
    const text = getColumnText(entry.el as HTMLTableCellElement)
    writeText(text)
    showToast(`Copied ${text.split('\n').length} cells`)
  } else if (mode === 'ii') {
    showImageInfo(entry.el as HTMLImageElement)
  } else if (mode === 'ip') {
    const { src } = getImageNames(entry.el as HTMLImageElement)
    writeText(src)
    showToast(src)
  } else if (mode === 'in') {
    const { filename } = getImageNames(entry.el as HTMLImageElement)
    writeText(filename)
    showToast(filename)
  } else if (mode === 'ib') {
    const { basename } = getImageNames(entry.el as HTMLImageElement)
    writeText(basename)
    showToast(basename)
  } else if (mode === 'di') {
    const src = (entry.el as HTMLImageElement).src
    if (src) chrome.runtime.sendMessage({ type: 'downloadImage', url: src })
  } else if (mode === 'oI') {
    const src = (entry.el as HTMLImageElement).src
    if (src) chrome.runtime.sendMessage({ type: 'navigateTo', url: src })
  } else if (mode === 'oV') {
    const video = entry.el as HTMLVideoElement
    const src = video.currentSrc || video.src
    if (!src || src.startsWith('blob:')) { showToast('No direct video source') }
    else chrome.runtime.sendMessage({ type: 'navigateTo', url: src })
  } else if (mode === 'ci') {
    const el = entry.el as HTMLImageElement
    if (el.src) copyImageToClipboard(el)
  } else if (mode === 'cs') {
    const svg = entry.el as unknown as SVGElement
    const code = new XMLSerializer().serializeToString(svg)
    writeText(code)
    showToast('SVG copied')
  } else if (mode === 'yl') {
    const url = (entry.el as HTMLAnchorElement).href
    writeText(url)
    showToast(url)
  } else if (mode === 'yi') {
    const el = entry.el as HTMLInputElement | HTMLTextAreaElement
    const text = el.value.trim() || (el as HTMLInputElement).placeholder?.trim() || ''
    writeText(text)
    showToast(text)
  } else if (mode === 'ygc' || mode === 'ygo') {
    const el = entry.el as HTMLInputElement | HTMLTextAreaElement
    const address = el.value.trim() || (el as HTMLInputElement).placeholder?.trim() || ''
    if (!address) { showToast('Input is empty', ''); return }
    const url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`
    if (mode === 'ygc') {
      writeText(url)
      showToast(url)
    } else {
      chrome.runtime.sendMessage({ type: 'navigateTo', url })
    }
  } else if (mode === 'ie') {
    const el = entry.el as HTMLInputElement | HTMLTextAreaElement
    el.focus()
    try { el.setSelectionRange(el.value.length, el.value.length) } catch { /* unsupported input type */ }
  } else if (mode === 'is') {
    const el = entry.el as HTMLInputElement | HTMLTextAreaElement
    el.focus()
    try { el.setSelectionRange(0, 0) } catch { /* unsupported input type */ }
  } else if (mode === 'ic') {
    const el = entry.el as HTMLInputElement | HTMLTextAreaElement
    el.value = ''
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.focus()
  } else if (mode === 'pi') {
    const el = entry.el as HTMLInputElement | HTMLTextAreaElement
    el.focus()
    // Native execCommand('paste') mirrors a real Ctrl+V and works where the async
    // Clipboard API gets silently blocked (page permissions policy, focus timing).
    if (document.execCommand('paste')) {
      try { el.setSelectionRange(el.value.length, el.value.length) } catch { /* unsupported input type */ }
    } else {
      readText()
        .then(text => {
          if (!text) { showToast('Clipboard is empty'); return }
          el.value = text
          el.dispatchEvent(new Event('input', { bubbles: true }))
          try { el.setSelectionRange(el.value.length, el.value.length) } catch { /* unsupported input type */ }
        })
        .catch(() => showToast('Clipboard read failed'))
    }
  } else if (mode === 'y') {
    const text = entry.el.innerText?.trim() || ''
    writeText(text)
    showToast(text)
  } else if (mode === 'F') {
    const anchor = entry.el instanceof HTMLAnchorElement ? entry.el : entry.el.closest('a[href]')
    if (anchor instanceof HTMLAnchorElement && anchor.href) {
      window.open(anchor.href, '_blank')
    } else {
      const clickEl = entry.clickTarget ?? entry.el
      clickEl.focus()
      clickEl.click()
    }
  } else if (mode === 'h') {
    unhoverLast()
    lastHovered = entry.el
    const r = entry.el.getBoundingClientRect()
    const cx = r.left + r.width / 2
    const cy = r.top + r.height / 2
    // CSS :hover: инжектируем переписанные правила с [data-bs-hover]
    activateCSSHover(entry.el)
    // JS-события: mouseenter не всплывает, поэтому диспатчим от корня до цели
    const path = ancestorPath(entry.el).reverse()
    for (const ancestor of path) {
      dispatchMouse(ancestor, 'mouseenter', cx, cy, false)
    }
    dispatchMouse(entry.el, 'mouseover', cx, cy)
    dispatchMouse(entry.el, 'mousemove', cx, cy)
  } else {
    const clickEl = entry.clickTarget ?? entry.el
    clickEl.focus()
    clickEl.click()
  }
}

export function endHints(session: HintSession): void {
  session.container.remove()
}
