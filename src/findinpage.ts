let bar: HTMLElement | null = null
let input: HTMLInputElement | null = null
let counter: HTMLElement | null = null
let marks: HTMLElement[] = []
let currentIndex = -1
let lastQuery = ''

// Field mode (`if`): searches values of input/textarea/select instead of page text.
// Fields can't contain <mark>, so matches are outlined and the current one gets
// focus + selection when the bar closes.
type FieldMatch = { el: HTMLElement; start: number; end: number }
let mode: 'page' | 'fields' = 'page'
let fieldMatches: FieldMatch[] = []
let lastFieldQuery = ''

const SKIP_INPUT_TYPES = new Set(['hidden', 'checkbox', 'radio', 'file', 'image', 'submit', 'button', 'reset', 'color', 'range'])

function collectFields(): HTMLElement[] {
  const all = document.querySelectorAll<HTMLElement>('input, textarea, select')
  return Array.from(all).filter((el) => {
    if (el.closest('#bs-find-bar')) return false
    if (el instanceof HTMLInputElement && SKIP_INPUT_TYPES.has(el.type)) return false
    return el.getClientRects().length > 0 && isVisible(el)
  })
}

function clearFieldMatches(): void {
  for (const m of fieldMatches) m.el.classList.remove('bs-find-field', 'bs-find-field-current')
  fieldMatches = []
  currentIndex = -1
}

function highlightFields(query: string): void {
  clearFieldMatches()
  if (!query) { updateCounter(); return }
  const q = query.toLowerCase()

  for (const el of collectFields()) {
    if (el instanceof HTMLSelectElement) {
      // One match per matching option; selecting it would change form data, so only focus the select
      for (const opt of Array.from(el.options)) {
        if (opt.text.toLowerCase().includes(q)) fieldMatches.push({ el, start: 0, end: 0 })
      }
      continue
    }
    const lower = (el as HTMLInputElement | HTMLTextAreaElement).value.toLowerCase()
    let idx = lower.indexOf(q)
    while (idx !== -1) {
      fieldMatches.push({ el, start: idx, end: idx + q.length })
      idx = lower.indexOf(q, idx + q.length)
    }
  }

  for (const m of fieldMatches) m.el.classList.add('bs-find-field')
  if (fieldMatches.length > 0) {
    currentIndex = 0
    focusFieldMatch(0)
  }
  updateCounter()
}

function focusFieldMatch(index: number): void {
  const cur = fieldMatches[index]
  for (const m of fieldMatches) m.el.classList.toggle('bs-find-field-current', m.el === cur?.el)
  cur?.el.scrollIntoView({ block: 'center', inline: 'nearest' })
}

function matchCount(): number {
  return mode === 'fields' ? fieldMatches.length : marks.length
}

function isVisible(el: Element): boolean {
  const style = getComputedStyle(el)
  return style.display !== 'none' && style.visibility !== 'hidden'
}

function clearMarks(): void {
  for (const mark of marks) {
    const parent = mark.parentNode
    if (!parent) continue
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark)
    parent.removeChild(mark)
  }
  marks = []
  currentIndex = -1
  document.body?.normalize()
}

function collectTextNodes(): Text[] {
  const nodes: Text[] = []
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = (node as Text).parentElement
      if (!parent) return NodeFilter.FILTER_REJECT
      const tag = parent.tagName
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT' || tag === 'TEXTAREA') return NodeFilter.FILTER_REJECT
      if (parent.closest('#bs-find-bar')) return NodeFilter.FILTER_REJECT
      if (!(node as Text).nodeValue?.trim()) return NodeFilter.FILTER_REJECT
      if (!isVisible(parent)) return NodeFilter.FILTER_REJECT
      return NodeFilter.FILTER_ACCEPT
    },
  })
  let n: Node | null
  while ((n = walker.nextNode())) nodes.push(n as Text)
  return nodes
}

function updateCounter(): void {
  if (!counter) return
  const total = matchCount()
  counter.textContent = total === 0 ? '0/0' : `${currentIndex + 1}/${total}`
}

function focusMark(index: number): void {
  marks.forEach((m, i) => m.classList.toggle('bs-find-current', i === index))
  marks[index]?.scrollIntoView({ block: 'center', inline: 'nearest' })
}

function highlight(query: string): void {
  clearMarks()
  if (!query) { updateCounter(); return }

  const q = query.toLowerCase()
  const textNodes = collectTextNodes()

  for (const node of textNodes) {
    const text = node.nodeValue ?? ''
    const lower = text.toLowerCase()
    let idx = lower.indexOf(q)
    if (idx === -1) continue

    const frag = document.createDocumentFragment()
    let cursor = 0
    while (idx !== -1) {
      if (idx > cursor) frag.appendChild(document.createTextNode(text.slice(cursor, idx)))
      const mark = document.createElement('mark')
      mark.className = 'bs-find-mark'
      mark.textContent = text.slice(idx, idx + q.length)
      frag.appendChild(mark)
      marks.push(mark)
      cursor = idx + q.length
      idx = lower.indexOf(q, cursor)
    }
    if (cursor < text.length) frag.appendChild(document.createTextNode(text.slice(cursor)))

    node.parentNode?.replaceChild(frag, node)
  }

  if (marks.length > 0) {
    currentIndex = 0
    focusMark(0)
  }
  updateCounter()
}

function step(delta: 1 | -1): void {
  const total = matchCount()
  if (total === 0) return
  currentIndex = (currentIndex + delta + total) % total
  if (mode === 'fields') focusFieldMatch(currentIndex)
  else focusMark(currentIndex)
  updateCounter()
}

function runSearch(query: string): void {
  if (mode === 'fields') highlightFields(query)
  else highlight(query)
}

export function showFind(newMode: 'page' | 'fields' = 'page'): void {
  if (bar && mode !== newMode) hideFind(false)
  mode = newMode
  if (bar) {
    input?.focus()
    input?.select()
    return
  }

  bar = document.createElement('div')
  bar.id = 'bs-find-bar'

  input = document.createElement('input')
  input.id = 'bs-find-input'
  input.type = 'text'
  input.spellcheck = false
  input.placeholder = mode === 'fields' ? 'Find in inputs...' : 'Find in page...'
  input.value = mode === 'fields' ? lastFieldQuery : lastQuery

  counter = document.createElement('span')
  counter.id = 'bs-find-counter'

  input.addEventListener('input', () => {
    if (mode === 'fields') lastFieldQuery = input!.value
    else lastQuery = input!.value
    runSearch(input!.value)
  })

  input.addEventListener('keydown', (e) => {
    e.stopPropagation()
    if (e.key === 'Enter') {
      e.preventDefault()
      step(e.shiftKey ? -1 : 1)
    }
  })

  bar.appendChild(input)
  bar.appendChild(counter)
  document.documentElement.appendChild(bar)

  requestAnimationFrame(() => {
    input?.focus()
    input?.select()
  })

  if (input.value) runSearch(input.value)
  else updateCounter()
}

// In field mode, closing the bar jumps into the current matched field
export function hideFind(focusField = true): void {
  const cur = mode === 'fields' ? fieldMatches[currentIndex] : undefined
  bar?.remove()
  bar = null
  input = null
  counter = null
  clearMarks()
  clearFieldMatches()
  if (focusField && cur) {
    cur.el.focus()
    if (!(cur.el instanceof HTMLSelectElement)) {
      try { (cur.el as HTMLInputElement).setSelectionRange(cur.start, cur.end) } catch { /* email/number inputs */ }
    }
  }
}

export function isFindVisible(): boolean {
  return bar !== null
}
