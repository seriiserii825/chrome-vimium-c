export interface HistoryEntry {
  title: string
  url: string
}

let backdrop: HTMLElement | null = null
let input: HTMLInputElement | null = null
let list: HTMLElement | null = null
let allEntries: HistoryEntry[] = []
let entries: HistoryEntry[] = []
let selectedIndex = 0
let onSelectCb: ((url: string, sameTab: boolean) => void) | null = null

// Subsequence fuzzy match: every char of query must appear in target, in order,
// possibly with gaps (e.g. "sicuges" matches "sicurezza gestione"). Consecutive
// runs score higher so tighter matches rank first.
function fuzzyScore(query: string, target: string): number | null {
  if (!query) return 0
  let qi = 0
  let score = 0
  let consecutive = 0
  for (let ti = 0; ti < target.length && qi < query.length; ti++) {
    if (target[ti] === query[qi]) {
      qi++
      consecutive++
      score += consecutive
    } else {
      consecutive = 0
    }
  }
  return qi === query.length ? score : null
}

// Fewer path segments = more general URL (e.g. bare domain before domain/wp-admin
// before domain/wp-admin/admin.php), so it's used as the primary sort key.
function pathSegmentCount(urlStr: string): number {
  try {
    return new URL(urlStr).pathname.split('/').filter(Boolean).length
  } catch {
    return 0
  }
}

function getOrigin(urlStr: string): string | null {
  try {
    return new URL(urlStr).origin
  } catch {
    return null
  }
}

function filterEntries(query: string): HistoryEntry[] {
  const q = query.toLowerCase().trim()
  if (!q) {
    return [...allEntries]
      .sort((a, b) => pathSegmentCount(a.url) - pathSegmentCount(b.url))
      .slice(0, 30)
  }

  const scored: { entry: HistoryEntry; score: number }[] = []
  // Best score seen for each origin, so a domain's overall relevance is judged by
  // its strongest-matching page, not diluted or overridden by shorter paths.
  const bestScoreByOrigin = new Map<string, number>()
  const originsWithRoot = new Set<string>()
  for (const entry of allEntries) {
    const haystack = `${entry.title} ${entry.url}`.toLowerCase()
    const score = fuzzyScore(q, haystack)
    if (score === null) continue
    scored.push({ entry, score })
    const origin = getOrigin(entry.url)
    if (!origin) continue
    bestScoreByOrigin.set(origin, Math.max(bestScoreByOrigin.get(origin) ?? -Infinity, score))
    if (pathSegmentCount(entry.url) === 0) originsWithRoot.add(origin)
  }

  // No visit to the bare domain itself exists among the matches — synthesize one
  // so the shortest URL for a matched domain always surfaces first within it.
  for (const [origin, bestScore] of bestScoreByOrigin) {
    if (originsWithRoot.has(origin)) continue
    scored.push({
      entry: { title: origin.replace(/^https?:\/\//, ''), url: `${origin}/` },
      score: bestScore,
    })
  }

  scored.sort((a, b) => {
    const originA = getOrigin(a.entry.url)
    const originB = getOrigin(b.entry.url)
    const bestA = originA ? bestScoreByOrigin.get(originA)! : a.score
    const bestB = originB ? bestScoreByOrigin.get(originB)! : b.score
    if (bestA !== bestB) return bestB - bestA
    const segDiff = pathSegmentCount(a.entry.url) - pathSegmentCount(b.entry.url)
    return segDiff !== 0 ? segDiff : b.score - a.score
  })
  return scored.slice(0, 30).map((s) => s.entry)
}

function renderList(): void {
  if (!list) return
  list.innerHTML = ''

  if (entries.length === 0) {
    const empty = document.createElement('div')
    empty.id = 'bs-hist-empty'
    empty.textContent = 'No matching history'
    list.appendChild(empty)
    return
  }

  entries.forEach((entry, i) => {
    const row = document.createElement('div')
    row.className = 'bs-hist-row' + (i === selectedIndex ? ' bs-hist-selected' : '')

    const title = document.createElement('div')
    title.className = 'bs-hist-title'
    title.textContent = entry.title || entry.url

    const url = document.createElement('div')
    url.className = 'bs-hist-url'
    url.textContent = entry.url

    row.appendChild(title)
    row.appendChild(url)

    row.addEventListener('click', (e) => {
      onSelectCb?.(entry.url, e.ctrlKey || e.metaKey)
      hideHistorySearch()
    })

    list!.appendChild(row)
  })
}

function setSelected(index: number): void {
  if (entries.length === 0) return
  selectedIndex = Math.max(0, Math.min(entries.length - 1, index))
  const rows = list?.querySelectorAll<HTMLElement>('.bs-hist-row')
  rows?.forEach((r, i) => r.classList.toggle('bs-hist-selected', i === selectedIndex))
  rows?.[selectedIndex]?.scrollIntoView({ block: 'nearest' })
}

function runFilter(query: string): void {
  entries = filterEntries(query)
  selectedIndex = 0
  renderList()
}

export function showHistorySearch(
  historyEntries: HistoryEntry[],
  onSelect: (url: string, sameTab: boolean) => void,
): void {
  if (backdrop) return

  allEntries = historyEntries
  onSelectCb = onSelect
  entries = []
  selectedIndex = 0

  backdrop = document.createElement('div')
  backdrop.id = 'bs-hist-backdrop'

  const panel = document.createElement('div')
  panel.id = 'bs-hist-panel'

  input = document.createElement('input')
  input.id = 'bs-hist-input'
  input.type = 'text'
  input.placeholder = 'Search history...'
  input.spellcheck = false

  input.addEventListener('input', () => {
    runFilter(input!.value)
  })

  input.addEventListener('keydown', (e) => {
    e.stopPropagation()
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelected(selectedIndex + 1)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelected(selectedIndex - 1)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const entry = entries[selectedIndex]
      if (entry) {
        onSelectCb?.(entry.url, e.ctrlKey || e.metaKey)
        hideHistorySearch()
      }
    }
  })

  list = document.createElement('div')
  list.id = 'bs-hist-list'

  panel.appendChild(input)
  panel.appendChild(list)
  backdrop.appendChild(panel)

  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) hideHistorySearch()
  })

  document.documentElement.appendChild(backdrop)

  requestAnimationFrame(() => input?.focus())

  runFilter('')
}

export function hideHistorySearch(): void {
  backdrop?.remove()
  backdrop = null
  input = null
  list = null
  allEntries = []
  entries = []
  onSelectCb = null
}

export function isHistorySearchVisible(): boolean {
  return backdrop !== null
}
