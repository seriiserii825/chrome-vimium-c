import { showToast } from './toast'
import { showImageInfo, getImageNames } from './imageinfo'
import { writeText, readText } from './clipboard'
import { getScrollableBlocks, setScrollTarget } from './scroll'
import { getBlocks, showBlockSize } from './blocksize'

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
  // Only form controls: a hidden link/button (e.g. a hover-only "remove" icon) would
  // otherwise hijack its ancestor's hint and fire instead of the ancestor itself.
  for (const el of fromSelector) {
    if (!(el instanceof HTMLInputElement || el instanceof HTMLSelectElement)) continue
    if (!isVisible(el)) {
      let p = el.parentElement
      while (p) {
        if (isVisible(p)) { add(p, el); break }
        p = p.parentElement
      }
    }
  }

  // `cursor` is inherited, so plain wrappers around a real control (e.g. ACF gallery's
  // `div.actions` around `a.acf-gallery-remove`) also look clickable. When such a wrapper
  // starts at the same point as the control inside it, its hint would take that spot and
  // the control's hint would be pushed away — so clicking "the X" hits the wrapper instead.
  // Skip pointer-only ancestors that share their top-left with a real clickable descendant.
  const EPS = 3
  const shadowed = new Set<HTMLElement>()
  for (const el of fromSelector) {
    if (!isVisible(el)) continue
    const r = el.getBoundingClientRect()
    let p = el.parentElement
    while (p && p !== document.body) {
      const pr = p.getBoundingClientRect()
      if (Math.abs(pr.left - r.left) > EPS || Math.abs(pr.top - r.top) > EPS) break
      shadowed.add(p)
      p = p.parentElement
    }
  }

  for (const el of Array.from(document.querySelectorAll<HTMLElement>('*'))) {
    if (!isVisible(el)) continue
    if (fromSelector.has(el)) {
      add(el)
    } else if (!shadowed.has(el) && window.getComputedStyle(el).cursor === 'pointer' && !el.closest('svg')) {
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

export type HintMode = 'f' | 'F' | 'y' | 'yl' | 'yi' | 'ym' | 'ymi' | 'yml' | 'ydv' | 'ydl' | 'om' | 'ymf' | 'h' | 'di' | 'ci' | 'cs' | 'oI' | 'oV' | 'ii' | 'ip' | 'in' | 'ib' | 'ctc' | 'ctmc' | 'ie' | 'ic' | 'is' | 'pi' | 'ptc' | 'c' | 'ygc' | 'ygo' | 'hci' | 'hco' | 'sb' | 'bs'

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
  rangeStart?: number
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

type TextField = HTMLInputElement | HTMLTextAreaElement

// Inputs in the same "column" as `field`, top to bottom (from the first row, not from `field`). ACF repeaters lay fields out as
// divs inside one <td>, so a column there is the same data-key across the repeater's rows;
// otherwise it's the same cellIndex across a plain table's rows.
function getColumnInputs(field: TextField): TextField[] {
  const inputSel = 'input:not([type="hidden"]), textarea'
  const acfField = field.closest<HTMLElement>('.acf-field[data-key]')
  const acfRow = acfField?.closest('tr.acf-row')
  if (acfField && acfRow?.parentElement) {
    const key = acfField.dataset.key
    return Array.from(acfRow.parentElement.children)
      .filter(row => row.matches('tr.acf-row:not(.acf-clone)'))
      .map(row => row.querySelector(`:scope > td > .acf-field[data-key="${key}"]`)?.querySelector<TextField>(inputSel) ?? null)
      .filter((el): el is TextField => el !== null)
  }
  const cell = field.closest('td, th') as HTMLTableCellElement | null
  const table = cell?.closest('table')
  if (cell && table) {
    return Array.from(table.rows)
      .map(row => row.cells[cell.cellIndex]?.querySelector<TextField>(inputSel) ?? null)
      .filter((el): el is TextField => el !== null)
  }
  return [field]
}

function setFieldValue(el: TextField, value: string): void {
  el.value = value
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
}

async function pasteIntoColumn(field: TextField): Promise<void> {
  let text: string
  try { text = await readText() } catch { showToast('Clipboard read failed', ''); return }
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l)
  if (lines.length === 0) { showToast('Clipboard is empty', ''); return }
  // Start from the picked row so a partial column (e.g. rows 4..N) can be filled
  const column = getColumnInputs(field)
  const inputs = column.slice(Math.max(0, column.indexOf(field)))
  if (lines.length !== inputs.length) {
    showToast(`Mismatch: ${lines.length} lines in clipboard, ${inputs.length} rows in column`, '')
    return
  }
  inputs.forEach((el, i) => setFieldValue(el, lines[i]))
  showToast(`Pasted ${lines.length} rows`, '')
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

// Candidate shifts in hint-size units, nearest first. Ties prefer right, then down, then up,
// then left — right/down keep the hint over its own element instead of over a neighbour above.
const HINT_SHIFTS: Array<[number, number]> = (() => {
  const out: Array<[number, number, number]> = []
  const pref = (dx: number, dy: number) => (dx > 0 ? 0 : dy > 0 ? 1 : dy < 0 ? 2 : 3)
  for (let dy = -3; dy <= 3; dy++) {
    for (let dx = -2; dx <= 4; dx++) {
      // a hint is ~1.5× wider than tall, so weigh steps by that ratio
      out.push([dx, dy, (dx * 1.5) ** 2 + dy ** 2 + pref(dx, dy) * 0.01])
    }
  }
  return out.sort((a, b) => a[2] - b[2]).map(([dx, dy]) => [dx, dy])
})()

// Place each hint at its element's top-left; if that overlaps an already placed hint, take the
// nearest free spot from HINT_SHIFTS. Hints are placed in document order, so an ancestor keeps
// its natural spot and the nested elements that start at the same point move aside.
function layoutHints(rects: DOMRect[], sizes: Array<{ w: number; h: number }>): Array<{ left: number; top: number }> {
  const GAP = 1
  const CELL = 32
  const grid = new Map<string, Array<{ l: number; t: number; r: number; b: number }>>()
  const cellsOf = (l: number, t: number, r: number, b: number) => {
    const keys: string[] = []
    for (let cx = Math.floor(l / CELL); cx <= Math.floor(r / CELL); cx++) {
      for (let cy = Math.floor(t / CELL); cy <= Math.floor(b / CELL); cy++) keys.push(`${cx},${cy}`)
    }
    return keys
  }
  const isFree = (l: number, t: number, r: number, b: number) => {
    for (const k of cellsOf(l, t, r, b)) {
      for (const o of grid.get(k) ?? []) {
        if (l < o.r && r > o.l && t < o.b && b > o.t) return false
      }
    }
    return true
  }
  const maxL = window.innerWidth, maxT = window.innerHeight

  return rects.map((rect, i) => {
    const { w, h } = sizes[i]
    const baseL = Math.max(0, Math.min(Math.round(rect.left), maxL - w))
    const baseT = Math.max(0, Math.min(Math.round(rect.top), maxT - h))
    let left = baseL, top = baseT
    for (const [dx, dy] of HINT_SHIFTS) {
      const l = baseL + dx * (w + GAP), t = baseT + dy * (h + GAP)
      if (l < 0 || t < 0 || l + w > maxL || t + h > maxT) continue
      if (isFree(l, t, l + w, t + h)) { left = l; top = t; break }
    }
    const box = { l: left, t: top, r: left + w + GAP, b: top + h + GAP }
    for (const k of cellsOf(box.l, box.t, box.r, box.b)) {
      const list = grid.get(k)
      if (list) list.push(box); else grid.set(k, [box])
    }
    return { left, top }
  })
}

export function beginHints(mode: HintMode, count = 1): HintSession | null {
  const rawElements: HTMLElement[] | Clickable[] =
    (mode === 'y' || mode === 'ym' || mode === 'ydv' || mode === 'hci' || mode === 'hco') ? getCopyable()
    : (mode === 'yl' || mode === 'yml' || mode === 'ydl') ? Array.from(document.querySelectorAll<HTMLElement>('a[href]')).filter(isVisible)
    : (mode === 'yi' || mode === 'ymi' || mode === 'ie' || mode === 'ic' || mode === 'is' || mode === 'pi' || mode === 'ptc' || mode === 'ygc' || mode === 'ygo') ? Array.from(document.querySelectorAll<HTMLElement>(
        'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="checkbox"]):not([type="radio"]):not([type="file"]):not([disabled]), textarea:not([disabled])'
      )).filter(isVisible)
    : mode === 'cs' ? Array.from(document.querySelectorAll<HTMLElement>('svg')).filter(el => isVisible(el) && !el.parentElement?.closest('svg'))
    : (mode === 'di' || mode === 'ci' || mode === 'oI' || mode === 'ii' || mode === 'ip' || mode === 'in' || mode === 'ib') ? Array.from(document.querySelectorAll<HTMLElement>('img[src]')).filter(isVisible)
    : mode === 'oV' ? Array.from(document.querySelectorAll<HTMLElement>('video')).filter(isVisible)
    : mode === 'h' ? getHoverable()
    : mode === 'sb' ? getScrollableBlocks().filter(isVisible)
    : mode === 'bs' ? getBlocks()
    : (mode === 'ctc' || mode === 'ctmc') ? getTableColumns()
    : mode === 'ymf' ? getCheckboxesAndRadios()
    : mode === 'c' ? getFormControls()
    : (mode === 'f' || mode === 'F') ? getLinksAndButtons()
    : getClickable()
  if (rawElements.length === 0) return null

  const clickables: Clickable[] = (rawElements as Array<HTMLElement | Clickable>).map(
    item => (item instanceof Element ? { el: item as HTMLElement } : item)
  )

  const labels = generateLabels(clickables.length)

  const container = document.createElement('div')
  container.id = 'bs-vimium-hints'
  document.documentElement.appendChild(container)

  // Create every node first, then measure them all in one layout pass.
  const rects = clickables.map(({ el }) => el.getBoundingClientRect())
  const entries: HintEntry[] = clickables.map(({ el, clickTarget }, i) => {
    const node = document.createElement('div')
    node.className = 'bs-vimium-hint'
    node.textContent = labels[i]
    container.appendChild(node)
    return { el, clickTarget, label: labels[i], node }
  })
  const sizes = entries.map(({ node }) => ({ w: node.offsetWidth, h: node.offsetHeight }))

  // Container is position:fixed at (0,0), so positions are viewport coords.
  const positions = layoutHints(rects, sizes)
  entries.forEach(({ node }, i) => {
    node.style.left = `${positions[i].left}px`
    node.style.top = `${positions[i].top}px`
  })

  return { mode, entries, typed: '', container, count: Math.max(1, count) }
}

// Entries are in document order, so a range is a slice of them. For text, drop elements
// nested inside another element of the range — their text is already in the ancestor's.
function copyRange(session: HintSession, a: number, b: number): void {
  const range = session.entries.slice(Math.min(a, b), Math.max(a, b) + 1).map(e => e.el)
  const els = session.mode === 'ydv'
    ? range.filter(el => !range.some(other => other !== el && other.contains(el)))
    : range
  const texts = els
    .map(el => session.mode === 'ydl' ? (el as HTMLAnchorElement).href : el.innerText?.trim() || '')
    .filter(t => t)
  if (texts.length === 0) { showToast('Nothing to copy'); return }
  writeText(texts.join('\n'))
  showToast(`Copied ${texts.length} items`)
}

export function typeHint(session: HintSession, key: string): 'continue' | 'done' | 'cancel' {
  if (key === 'Escape') return 'cancel'

  // Enter завершает multi-yank и копирует накопленный текст
  if (key === 'Enter' && (session.mode === 'ym' || session.mode === 'ymi' || session.mode === 'yml' || session.mode === 'ctmc')) {
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
        markClickedLink(entry.el)
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
    if (session.mode === 'ydv' || session.mode === 'ydl') {
      const index = session.entries.indexOf(match)
      if (session.rangeStart === undefined) {
        session.rangeStart = index
        match.node.classList.add('selected')
        session.typed = ''
        for (const entry of session.entries) entry.node.classList.remove('dim')
        return 'continue'
      }
      copyRange(session, session.rangeStart, index)
      return 'done'
    }
    if (session.mode === 'yml') {
      const text = (match.el as HTMLAnchorElement).href
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

// Links followed via hints turn green (persists until reload) so it's visible what was clicked.
function markClickedLink(el: HTMLElement): void {
  const anchor = el.closest('a[href]')
  if (anchor) anchor.classList.add('bs-clicked-link')
}

function activate(entry: HintEntry, mode: HintMode, count = 1): void {
  if (mode === 'f') {
    markClickedLink(entry.el)
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
  } else if (mode === 'ptc') {
    pasteIntoColumn(entry.el as HTMLInputElement | HTMLTextAreaElement)
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
  } else if (mode === 'hci' || mode === 'hco') {
    const html = mode === 'hci' ? entry.el.innerHTML : entry.el.outerHTML
    writeText(html)
    showToast(mode === 'hci' ? 'Inner HTML copied' : 'Outer HTML copied')
  } else if (mode === 'F') {
    markClickedLink(entry.el)
    const anchor = entry.el instanceof HTMLAnchorElement ? entry.el : entry.el.closest('a[href]')
    if (anchor instanceof HTMLAnchorElement && anchor.href) {
      window.open(anchor.href, '_blank')
    } else {
      const clickEl = entry.clickTarget ?? entry.el
      clickEl.focus()
      clickEl.click()
    }
  } else if (mode === 'sb') {
    setScrollTarget(entry.el)
  } else if (mode === 'bs') {
    showBlockSize(entry.el)
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
    markClickedLink(entry.el)
    const clickEl = entry.clickTarget ?? entry.el
    clickEl.focus()
    clickEl.click()
  }
}

export function endHints(session: HintSession): void {
  session.container.remove()
}
