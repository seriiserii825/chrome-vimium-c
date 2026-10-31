import { fuzzyScore } from './historysearch'
import { showToast } from './toast'

// Same shape as the Quick Tabs Project extension export, so JSON files move
// between the two in both directions.
export interface ProjectTab {
  id?: number
  title: string
  url: string
  // The tab that was focused when the project was saved — it gets focus again on open.
  active?: boolean
}

export interface Project {
  id: number
  title: string
  items: ProjectTab[]
  updated_at: number
}

interface WindowTab {
  title: string
  url: string
  active: boolean
  pinned?: boolean
}

export type OpenMode = 'replace' | 'keep' | 'window'

type Mode =
  | { kind: 'search' }
  | { kind: 'name'; query: string }
  | { kind: 'rename'; projectId: number; query: string }
  | { kind: 'confirm'; message: string; run: () => void }

type Row =
  | { kind: 'project'; project: Project; tabs: ProjectTab[] | null }
  | { kind: 'tab'; project: Project; tab: ProjectTab }
  | { kind: 'create'; title: string }

// chrome.storage, not localStorage: projects must be the same on every site.
const STORAGE_KEY = 'bs-projects'
// Set by any meaningful edit (create/rename/update/add tab/delete/import), used as the
// git commit message on the next Ctrl+E. Persisted so it survives across tabs/popup,
// since `projects` itself is reloaded fresh from storage on every showProjects() call.
const DIRTY_KEY = 'bs-projects-dirty'

let backdrop: HTMLElement | null = null
let input: HTMLInputElement | null = null
let pill: HTMLElement | null = null
let counter: HTMLElement | null = null
let list: HTMLElement | null = null
let footer: HTMLElement | null = null

let projects: Project[] = []
let dirtyMessage: string | null = null
let rows: Row[] = []
let selectedIndex = 0
let expanded = new Set<number>()
let mode: Mode = { kind: 'search' }
let onHide: (() => void) | null = null

// --- storage ---

async function loadProjects(): Promise<Project[]> {
  const res = await chrome.storage.local.get(STORAGE_KEY)
  const data = res[STORAGE_KEY]
  return Array.isArray(data) ? (data as Project[]) : []
}

async function saveProjects(): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: projects })
}

async function markDirty(message: string): Promise<void> {
  dirtyMessage = message
  await chrome.storage.local.set({ [DIRTY_KEY]: message })
}

async function clearDirty(): Promise<void> {
  dirtyMessage = null
  await chrome.storage.local.remove(DIRTY_KEY)
}

function getWindowTabs(): Promise<WindowTab[]> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'getTabs' }, (res) => resolve(res?.tabs ?? []))
  })
}

// Empty New Tab pages are noise in a saved project (the popup is often opened from one).
const NEW_TAB_URLS = new Set(['chrome://newtab/', 'chrome://new-tab-page/'])

// Pinned tabs stay open when a project replaces the window, so they are never saved into one.
function savableTabs(tabs: WindowTab[]): ProjectTab[] {
  return tabs
    .filter((t) => !t.pinned && t.url && !t.url.startsWith('chrome-extension://') && !NEW_TAB_URLS.has(t.url))
    .map((t, i) => ({ id: Date.now() + i, title: t.title || t.url, url: t.url, ...(t.active ? { active: true } : {}) }))
}

// Tabs already in the project (matched by url) keep their ids, so the exported JSON diff
// only shows real changes — same as Quick Tabs.
function keepIds(oldItems: ProjectTab[], newItems: ProjectTab[]): ProjectTab[] {
  const pool = [...oldItems]
  const used = new Set(oldItems.map((t) => t.id))
  return newItems.map((t) => {
    const i = pool.findIndex((o) => o.url === t.url)
    if (i !== -1) return { ...t, id: pool.splice(i, 1)[0].id }
    let id = t.id ?? Date.now()
    while (used.has(id)) id++
    used.add(id)
    return { ...t, id }
  })
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

// --- filtering ---

function buildRows(): Row[] {
  const q = input?.value.toLowerCase().trim() ?? ''
  const sorted = [...projects].sort((a, b) => b.updated_at - a.updated_at)

  if (mode.kind !== 'search' || !q) {
    const out: Row[] = []
    for (const project of sorted) {
      const open = expanded.has(project.id)
      out.push({ kind: 'project', project, tabs: open ? project.items : null })
      if (open) project.items.forEach((tab) => out.push({ kind: 'tab', project, tab }))
    }
    return out
  }

  // Only project titles are searched — tab titles/URLs inside are ignored.
  const scored: { project: Project; score: number }[] = []
  for (const project of sorted) {
    const score = fuzzyScore(q, project.title.toLowerCase())
    if (score !== null) scored.push({ project, score })
  }
  scored.sort((a, b) => b.score - a.score)

  const out: Row[] = []
  for (const { project } of scored) {
    const open = expanded.has(project.id)
    out.push({ kind: 'project', project, tabs: open ? project.items : null })
    if (open) project.items.forEach((tab) => out.push({ kind: 'tab', project, tab }))
  }
  const title = input!.value.trim()
  if (!projects.some((p) => p.title.toLowerCase() === title.toLowerCase())) {
    out.push({ kind: 'create', title })
  }
  return out
}

// --- rendering ---

function faviconUrl(pageUrl: string): string {
  return chrome.runtime.getURL(`/_favicon/?pageUrl=${encodeURIComponent(pageUrl)}&size=32`)
}

function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

function favicon(url: string): HTMLElement {
  const img = document.createElement('img')
  img.className = 'bs-pj-favicon'
  img.src = faviconUrl(url)
  img.alt = ''
  // Some pages' CSP blocks extension images — fall back to the host's first letter.
  img.addEventListener('error', () => {
    const letter = document.createElement('span')
    letter.className = 'bs-pj-favicon bs-pj-favicon-letter'
    letter.textContent = (hostname(url)[0] ?? '?').toUpperCase()
    img.replaceWith(letter)
  }, { once: true })
  return img
}

function timeAgo(ts: number): string {
  const s = Math.max(0, (Date.now() - ts) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`
  return new Date(ts).toLocaleDateString()
}

function el(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag)
  node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

function renderRow(row: Row, i: number): HTMLElement {
  const node = el('div', `bs-pj-row bs-pj-${row.kind}` + (i === selectedIndex ? ' bs-pj-selected' : ''))

  if (row.kind === 'project') {
    const { project } = row
    if (row.tabs) node.classList.add('bs-pj-expanded')
    node.appendChild(el('span', 'bs-pj-chevron', '›'))
    const main = el('div', 'bs-pj-main')
    main.appendChild(el('div', 'bs-pj-title', project.title))
    const meta = el('div', 'bs-pj-meta')
    const icons = el('span', 'bs-pj-icons')
    const seen = new Set<string>()
    for (const tab of project.items) {
      const host = hostname(tab.url)
      if (seen.has(host)) continue
      seen.add(host)
      icons.appendChild(favicon(tab.url))
      if (seen.size === 8) break
    }
    meta.appendChild(icons)
    meta.appendChild(el('span', 'bs-pj-time', timeAgo(project.updated_at)))
    main.appendChild(meta)
    node.appendChild(main)
    node.appendChild(el('span', 'bs-pj-count', String(project.items.length)))
  } else if (row.kind === 'tab') {
    node.appendChild(favicon(row.tab.url))
    const main = el('div', 'bs-pj-main')
    main.appendChild(el('div', 'bs-pj-title', row.tab.title || row.tab.url))
    main.appendChild(el('div', 'bs-pj-url', row.tab.url))
    node.appendChild(main)
  } else {
    node.appendChild(el('span', 'bs-pj-plus', '+'))
    const main = el('div', 'bs-pj-main')
    main.appendChild(el('div', 'bs-pj-title', `Save current window as “${row.title}”`))
    node.appendChild(main)
  }

  node.addEventListener('mousemove', () => {
    if (selectedIndex !== i) setSelected(i, false)
  })
  node.addEventListener('click', (e) => {
    selectedIndex = i
    if (row.kind === 'project' && (e.target as HTMLElement).classList.contains('bs-pj-chevron')) toggleExpand()
    else activate(e.shiftKey ? 'keep' : e.ctrlKey || e.metaKey ? 'window' : 'replace')
    input?.focus()
  })
  return node
}

function kbd(keys: string, label: string): HTMLElement {
  const item = el('span', 'bs-pj-hint')
  item.appendChild(el('kbd', 'bs-pj-kbd', keys))
  item.appendChild(document.createTextNode(label))
  return item
}

function renderFooter(): void {
  if (!footer) return
  footer.innerHTML = ''
  footer.classList.toggle('bs-pj-footer-confirm', mode.kind === 'confirm')
  if (mode.kind === 'confirm') {
    footer.appendChild(el('span', 'bs-pj-confirm-msg', mode.message))
    footer.appendChild(kbd('y', 'yes'))
    footer.appendChild(kbd('n', 'no'))
    return
  }
  if (mode.kind !== 'search') {
    footer.appendChild(kbd('↵', 'save'))
    footer.appendChild(kbd('Esc', 'cancel'))
    return
  }
  const row = rows[selectedIndex]
  if (row?.kind === 'tab') {
    footer.appendChild(kbd('↵', 'open tab'))
    footer.appendChild(kbd('Del', 'remove from project'))
    footer.appendChild(kbd('⇧⇥', 'collapse'))
  } else {
    footer.appendChild(kbd('↵', 'open'))
    footer.appendChild(kbd('⇧↵', 'add to window'))
    footer.appendChild(kbd('^↵', 'new window'))
    footer.appendChild(kbd('⇥', 'tabs'))
    footer.appendChild(kbd('F2', 'rename'))
    footer.appendChild(kbd('^U', 'update'))
    footer.appendChild(kbd('^A', 'add tab'))
    footer.appendChild(kbd('Del', 'delete'))
  }
  footer.appendChild(kbd('^S', 'save new'))
  footer.appendChild(kbd('^E', 'backup'))
  footer.appendChild(kbd('^⇧E', 'export'))
  footer.appendChild(kbd('^I', 'import backup'))
  footer.appendChild(kbd('^O', 'import file'))
}

function render(): void {
  if (!list || !input || !pill || !counter) return

  if (mode.kind === 'name' || mode.kind === 'rename') {
    pill.textContent = mode.kind === 'name' ? 'New project' : 'Rename'
    pill.style.display = ''
    input.placeholder = 'Project name…'
  } else {
    pill.style.display = 'none'
    input.placeholder = 'Search projects…'
  }
  input.readOnly = mode.kind === 'confirm'

  rows = buildRows()
  selectedIndex = Math.max(0, Math.min(rows.length - 1, selectedIndex))
  const shown = rows.filter((r) => r.kind === 'project').length
  counter.textContent = `${shown}/${projects.length}`

  list.innerHTML = ''
  if (projects.length === 0 && rows.length === 0) {
    const empty = el('div', 'bs-pj-empty')
    empty.appendChild(el('div', 'bs-pj-empty-title', 'No projects yet'))
    empty.appendChild(el('div', 'bs-pj-empty-text', 'Type a name and press Enter (or Ctrl+S) to save the tabs of this window. Ctrl+O imports a Quick Tabs JSON export.'))
    list.appendChild(empty)
  } else {
    rows.forEach((row, i) => list!.appendChild(renderRow(row, i)))
  }
  list.querySelector('.bs-pj-selected')?.scrollIntoView({ block: 'nearest' })
  renderFooter()
}

function setSelected(index: number, scroll = true): void {
  if (rows.length === 0) return
  selectedIndex = Math.max(0, Math.min(rows.length - 1, index))
  const nodes = list?.querySelectorAll<HTMLElement>('.bs-pj-row')
  nodes?.forEach((n, i) => n.classList.toggle('bs-pj-selected', i === selectedIndex))
  if (scroll) nodes?.[selectedIndex]?.scrollIntoView({ block: 'nearest' })
  renderFooter()
}

function selectProject(id: number): void {
  const i = rows.findIndex((r) => r.kind === 'project' && r.project.id === id)
  if (i !== -1) setSelected(i)
}

// --- actions ---

function selectedProject(): Project | null {
  const row = rows[selectedIndex]
  return row && row.kind !== 'create' ? row.project : null
}

function setMode(next: Mode): void {
  mode = next
  render()
}

function askConfirm(message: string, run: () => void): void {
  setMode({ kind: 'confirm', message, run })
}

function backToSearch(query: string): void {
  mode = { kind: 'search' }
  if (input) input.value = query
  render()
}

function toggleExpand(force?: boolean): void {
  const row = rows[selectedIndex]
  if (!row || row.kind === 'create') return
  const id = row.project.id
  const open = force ?? !expanded.has(id)
  if (open) expanded.add(id)
  else expanded.delete(id)
  render()
  selectProject(id)
}

async function openProject(project: Project, openMode: OpenMode): Promise<void> {
  if (project.items.length === 0) {
    showToast(`“${project.title}” is empty`, '')
    return
  }
  project.updated_at = Date.now()
  // Saved before messaging: in replace mode this very tab may be closed.
  await saveProjects()
  // Message first: in the popup, hiding closes the window.
  // No saved focus (e.g. Quick Tabs imports): last tab, which is where Quick Tabs ended up too.
  const marked = project.items.findIndex((t) => t.active)
  const activeIndex = marked !== -1 ? marked : project.items.length - 1
  chrome.runtime.sendMessage({ type: 'openProject', urls: project.items.map((t) => t.url), activeIndex, mode: openMode })
  hideProjects()
}

async function createProject(title: string): Promise<void> {
  const items = savableTabs(await getWindowTabs())
  if (items.length === 0) {
    showToast('No tabs to save in this window', '')
    return
  }
  const project: Project = { id: Date.now(), title, items, updated_at: Date.now() }
  projects.push(project)
  await saveProjects()
  await markDirty(`save: ${title}`)
  showToast(`${plural(items.length, 'tab')} → “${title}”`, 'Saved ')
  backToSearch('')
  selectProject(project.id)
}

async function updateProject(project: Project): Promise<void> {
  const items = savableTabs(await getWindowTabs())
  if (items.length === 0) {
    showToast('No tabs to save in this window', '')
    return
  }
  askConfirm(`Replace ${plural(project.items.length, 'tab')} of “${project.title}” with ${plural(items.length, 'current tab')}?`, async () => {
    project.items = keepIds(project.items, items)
    project.updated_at = Date.now()
    await saveProjects()
    await markDirty(`update: ${project.title}`)
    showToast(`“${project.title}” updated`, '')
  })
}

async function addCurrentTab(project: Project): Promise<void> {
  const active = (await getWindowTabs()).find((t) => t.active)
  if (!active?.url) return
  if (project.items.some((t) => t.url === active.url)) {
    showToast(`Already in “${project.title}”`, '')
    return
  }
  project.items.push({ id: Date.now(), title: active.title || active.url, url: active.url })
  project.updated_at = Date.now()
  await saveProjects()
  await markDirty(`update: ${project.title}`)
  showToast(`${active.title} → “${project.title}”`, 'Added ')
  render()
  selectProject(project.id)
}

function deleteSelected(): void {
  const row = rows[selectedIndex]
  if (!row || row.kind === 'create') return
  const { project } = row
  if (row.kind === 'tab') {
    askConfirm(`Remove “${row.tab.title}” from “${project.title}”?`, async () => {
      project.items = project.items.filter((t) => t !== row.tab)
      await saveProjects()
      await markDirty(`update: ${project.title}`)
    })
    return
  }
  askConfirm(`Delete project “${project.title}” (${plural(project.items.length, 'tab')})?`, async () => {
    projects = projects.filter((p) => p !== project)
    await saveProjects()
    await markDirty(`delete: ${project.title}`)
    showToast(`“${project.title}” deleted`, '')
  })
}

async function commitName(): Promise<void> {
  if (mode.kind !== 'name' && mode.kind !== 'rename') return
  const title = input!.value.trim()
  if (!title) return
  if (mode.kind === 'name') {
    await createProject(title)
    return
  }
  const { projectId, query } = mode
  const project = projects.find((p) => p.id === projectId)
  if (project) {
    project.title = title
    await saveProjects()
    await markDirty(`rename: ${title}`)
  }
  backToSearch(query)
  selectProject(projectId)
}

function activate(openMode: OpenMode): void {
  const row = rows[selectedIndex]
  if (!row) return
  if (row.kind === 'create') {
    if (row.title) void createProject(row.title)
    else setMode({ kind: 'name', query: '' })
  } else if (row.kind === 'project') {
    void openProject(row.project, openMode)
  } else {
    chrome.runtime.sendMessage({ type: 'navigateTo', url: row.tab.url })
    hideProjects()
  }
}

// Ctrl+E: the native host (native/projects_backup.py) overwrites projects.json in the
// backup repo, commits (using the last edit's project name as the message, via
// markDirty/dirtyMessage) and pushes. Without the host installed, falls back to a download.
function backupProjects(): void {
  if (!dirtyMessage) {
    showToast('Nothing to export', '')
    return
  }
  // Asks first: the backup file is overwritten, so a wrong state could replace a good one.
  askConfirm(`Overwrite backup with ${plural(projects.length, 'project')} and push?`, () => {
    showToast('Saving backup…', '')
    chrome.runtime.sendMessage({ type: 'backupProjects', message: dirtyMessage }, onBackupResult)
  })
}

function onBackupResult(res: { ok?: boolean; noHost?: boolean; error?: string; pushError?: string; pullError?: string; changed?: boolean; pushed?: boolean } | undefined): void {
  if (res?.noHost) {
    downloadProjects()
    void clearDirty()
  } else if (!res?.ok) {
    showToast(res?.error ?? 'unknown error', 'Backup failed: ')
  } else {
    void clearDirty()
    const pullNote = res.pullError ? ` (pull failed: ${res.pullError})` : ''
    if (res.pushError) showToast(`${res.pushError}${pullNote}`, 'Committed, push failed: ')
    else showToast(`${plural(projects.length, 'project')}${res.changed ? '' : ' (no changes)'}${res.pushed ? ' · pushed' : ''}${pullNote}`, 'Backup: ')
  }
}

// Ctrl+Shift+E: plain JSON download, independent of the backup repo.
function downloadProjects(): void {
  if (projects.length === 0) {
    showToast('Nothing to export', '')
    return
  }
  const blob = new Blob([JSON.stringify(projects, null, 2) + '\n'], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `projects-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(url)
  showToast(`${plural(projects.length, 'project')} exported`, '')
}

function parseProjects(data: unknown): Project[] {
  if (!Array.isArray(data)) throw new Error('expected array')
  return data
    .filter((p): p is Record<string, unknown> => typeof p === 'object' && p !== null && typeof p.title === 'string' && Array.isArray(p.items))
    .map((p, i) => ({
      id: typeof p.id === 'number' ? p.id : Date.now() + i,
      title: p.title as string,
      updated_at: typeof p.updated_at === 'number' ? p.updated_at : Date.now(),
      items: (p.items as unknown[])
        .filter((t): t is Record<string, unknown> => typeof t === 'object' && t !== null && typeof (t as Record<string, unknown>).url === 'string')
        .map((t) => ({ id: typeof t.id === 'number' ? t.id : undefined, title: typeof t.title === 'string' ? t.title : (t.url as string), url: t.url as string, ...(t.active === true ? { active: true } : {}) })),
    }))
}

// Merges by id: re-importing the same file updates projects instead of duplicating them.
function importProjects(): void {
  const file = document.createElement('input')
  file.type = 'file'
  file.accept = '.json,application/json'
  file.addEventListener('change', () => {
    const f = file.files?.[0]
    if (!f) return
    const reader = new FileReader()
    reader.onload = async () => {
      let incoming: Project[]
      try {
        incoming = parseProjects(JSON.parse(reader.result as string))
      } catch {
        showToast('Invalid JSON file', '')
        return
      }
      if (incoming.length === 0) {
        showToast('No projects found in file', '')
        return
      }
      await mergeProjects(incoming)
    }
    reader.readAsText(f)
  })
  file.click()
}

async function mergeProjects(incoming: Project[]): Promise<void> {
  const byId = new Map(projects.map((p) => [p.id, p]))
  incoming.forEach((p) => byId.set(p.id, p))
  projects = [...byId.values()]
  await saveProjects()
  await markDirty(`import: ${plural(incoming.length, 'project')}`)
  showToast(`${plural(incoming.length, 'project')} imported`, '')
  render()
  input?.focus()
}

// Ctrl+I: import from the backup repo (native host pulls it first), merged like Ctrl+O.
function restoreProjects(): void {
  showToast('Loading backup…', '')
  chrome.runtime.sendMessage({ type: 'restoreProjects' }, (res) => {
    if (!res?.ok) {
      showToast(res?.error ?? 'unknown error', 'Import failed: ')
      return
    }
    if (res.upToDate) {
      showToast('Already up to date', '')
      return
    }
    let incoming: Project[]
    try {
      incoming = parseProjects(res.projects)
    } catch {
      showToast('Invalid projects.json in backup', '')
      return
    }
    if (incoming.length === 0) {
      showToast('No projects in backup', '')
      return
    }
    const pullNote = res.pullError ? ` (pull failed: ${res.pullError}, using local copy)` : ''
    askConfirm(`Import ${plural(incoming.length, 'project')} from backup${pullNote}? Same ids are replaced, others kept.`, () => mergeProjects(incoming))
  })
}

// --- keyboard ---

function onKeydown(e: KeyboardEvent): void {
  e.stopPropagation()
  const ctrl = e.ctrlKey || e.metaKey
  const isEscape = e.key === 'Escape' || (e.ctrlKey && e.code === 'BracketLeft')

  if (mode.kind === 'confirm') {
    e.preventDefault()
    if (e.key === 'y' || e.key === 'Enter') {
      const { run } = mode
      backToSearch(input!.value)
      void Promise.resolve(run()).then(() => render())
    } else if (e.key === 'n' || isEscape) {
      backToSearch(input!.value)
    }
    return
  }

  if (mode.kind === 'name' || mode.kind === 'rename') {
    if (e.key === 'Enter') {
      e.preventDefault()
      void commitName()
    } else if (isEscape) {
      e.preventDefault()
      const { query } = mode
      const id = mode.kind === 'rename' ? mode.projectId : null
      backToSearch(query)
      if (id !== null) selectProject(id)
    }
    return
  }

  const atEnd = input!.selectionStart === input!.value.length

  if (isEscape) {
    e.preventDefault()
    if (input!.value) backToSearch('')
    else hideProjects()
  } else if (e.key === 'ArrowDown' || (ctrl && (e.key === 'j' || e.key === 'n'))) {
    e.preventDefault()
    setSelected(selectedIndex + 1)
  } else if (e.key === 'ArrowUp' || (ctrl && (e.key === 'k' || e.key === 'p'))) {
    e.preventDefault()
    setSelected(selectedIndex - 1)
  } else if (e.key === 'Enter') {
    e.preventDefault()
    activate(e.shiftKey ? 'keep' : ctrl ? 'window' : 'replace')
  } else if (e.key === 'Tab' || (e.key === 'ArrowRight' && atEnd) || (e.key === 'ArrowLeft' && atEnd && !input!.value)) {
    const row = rows[selectedIndex]
    if (!row || row.kind === 'create') return
    e.preventDefault()
    const collapse = e.shiftKey || e.key === 'ArrowLeft'
    if (row.kind === 'tab') {
      if (collapse || e.key === 'Tab') {
        selectProject(row.project.id)
        toggleExpand(false)
      }
    } else {
      toggleExpand(collapse ? false : e.key === 'Tab' ? undefined : true)
    }
  } else if (e.key === 'F2') {
    e.preventDefault()
    const project = selectedProject()
    if (!project) return
    mode = { kind: 'rename', projectId: project.id, query: input!.value }
    input!.value = project.title
    render()
    input!.select()
  } else if (e.key === 'Delete') {
    e.preventDefault()
    deleteSelected()
  } else if (ctrl && e.key === 's') {
    e.preventDefault()
    setMode({ kind: 'name', query: input!.value })
    input!.select()
  } else if (ctrl && e.key === 'u') {
    e.preventDefault()
    const project = selectedProject()
    if (project) void updateProject(project)
  } else if (ctrl && e.key === 'a') {
    e.preventDefault()
    const project = selectedProject()
    if (project) void addCurrentTab(project)
  } else if (ctrl && e.key === 'E') {
    e.preventDefault()
    downloadProjects()
  } else if (ctrl && e.key === 'e') {
    e.preventDefault()
    backupProjects()
  } else if (ctrl && e.key === 'o') {
    e.preventDefault()
    importProjects()
  } else if (ctrl && e.key === 'i') {
    e.preventDefault()
    restoreProjects()
  }
}

// --- lifecycle ---

// onHideCb: the popup passes window.close, so closing the panel closes the popup.
export async function showProjects(startNaming = false, onHideCb: (() => void) | null = null): Promise<void> {
  if (backdrop) return
  onHide = onHideCb
  projects = await loadProjects()
  dirtyMessage = ((await chrome.storage.local.get(DIRTY_KEY))[DIRTY_KEY] as string | undefined) ?? null
  mode = startNaming ? { kind: 'name', query: '' } : { kind: 'search' }
  selectedIndex = 0
  expanded = new Set()

  backdrop = el('div', '')
  backdrop.id = 'bs-pj-backdrop'
  const panel = el('div', '')
  panel.id = 'bs-pj-panel'

  const header = el('div', 'bs-pj-header')
  pill = el('span', 'bs-pj-pill')
  input = document.createElement('input')
  input.className = 'bs-pj-input'
  input.type = 'text'
  input.spellcheck = false
  input.addEventListener('input', () => {
    if (mode.kind !== 'search') return
    selectedIndex = 0
    render()
  })
  input.addEventListener('keydown', onKeydown)
  counter = el('span', 'bs-pj-counter')
  header.appendChild(pill)
  header.appendChild(input)
  header.appendChild(counter)

  list = el('div', 'bs-pj-list')
  footer = el('div', 'bs-pj-footer')

  panel.appendChild(header)
  panel.appendChild(list)
  panel.appendChild(footer)
  backdrop.appendChild(panel)
  backdrop.addEventListener('mousedown', (e) => {
    if (e.target === backdrop) hideProjects()
  })
  document.documentElement.appendChild(backdrop)

  render()
  requestAnimationFrame(() => {
    input?.focus()
    backdrop?.classList.add('bs-pj-visible')
  })
}

export function hideProjects(): void {
  backdrop?.remove()
  backdrop = null
  input = null
  pill = null
  counter = null
  list = null
  footer = null
  rows = []
  const cb = onHide
  onHide = null
  cb?.()
}

export function isProjectsVisible(): boolean {
  return backdrop !== null
}
