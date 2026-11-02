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
  | { kind: 'choice'; message: string; options: ChoiceOption[] }

interface ChoiceOption {
  key: string
  label: string
  run: () => void | Promise<void>
}

type Row =
  | { kind: 'project'; project: Project; tabs: ProjectTab[] | null }
  | { kind: 'tab'; project: Project; tab: ProjectTab }
  | { kind: 'create'; title: string }

// chrome.storage, not localStorage: projects must be the same on every site.
const STORAGE_KEY = 'bs-projects'
// Every meaningful edit since the last successful backup (create/rename/update/add tab/
// delete/import), e.g. ["rename: A", "delete: B"]; becomes the commit message on the next
// Ctrl+E. Persisted so edits from other tabs/the popup add up. Older versions stored a
// single string — readDirty accepts both.
const DIRTY_KEY = 'bs-projects-dirty'
// Commit body lists at most this many changes.
const MAX_LISTED_CHANGES = 50
// HEAD of the backup repo after this machine's last backup or restore. Ctrl+E asks the
// host whether projects.json changed in git since then (= pushed from another machine).
const SYNCED_KEY = 'bs-projects-synced'

let backdrop: HTMLElement | null = null
let input: HTMLInputElement | null = null
let pill: HTMLElement | null = null
let counter: HTMLElement | null = null
let list: HTMLElement | null = null
let footer: HTMLElement | null = null

let projects: Project[] = []
let dirtyChanges: string[] = []
let syncedHead: string | null = null
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

// Every change goes through here: re-read storage, apply, save. The panel may also be
// open in another tab or the popup — saving this panel's copy as-is would undo what
// was done there. Rows hold stale objects, so `fn` must find projects by id.
async function mutate<T>(fn: (list: Project[]) => T): Promise<T> {
  const fresh = await loadProjects()
  const result = fn(fresh)
  projects = fresh
  await saveProjects()
  return result
}

function byId(list: Project[], id: number): Project | undefined {
  return list.find((p) => p.id === id)
}

function readDirty(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
}

// Re-reads storage first, so changes made from another tab aren't dropped. The same
// change twice ("update: A" after two Ctrl+A) is listed once.
async function markDirty(change: string): Promise<void> {
  const changes = readDirty((await chrome.storage.local.get(DIRTY_KEY))[DIRTY_KEY])
  if (!changes.includes(change)) changes.push(change)
  dirtyChanges = changes
  await chrome.storage.local.set({ [DIRTY_KEY]: changes })
}

async function clearDirty(): Promise<void> {
  dirtyChanges = []
  await chrome.storage.local.remove(DIRTY_KEY)
}

// One change → it is the whole message. Several → "first (+N more)", then every change
// as a list in the commit body.
function commitMessage(changes: string[]): string {
  if (changes.length === 1) return changes[0]
  const listed = changes.slice(0, MAX_LISTED_CHANGES).map((c) => `- ${c}`)
  if (changes.length > MAX_LISTED_CHANGES) listed.push(`- … and ${changes.length - MAX_LISTED_CHANGES} more`)
  return `${changes[0]} (+${changes.length - 1} more)\n\n${listed.join('\n')}`
}

async function setSynced(head: string | undefined): Promise<void> {
  if (!head) return
  syncedHead = head
  await chrome.storage.local.set({ [SYNCED_KEY]: head })
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
  footer.classList.toggle('bs-pj-footer-confirm', mode.kind === 'confirm' || mode.kind === 'choice')
  if (mode.kind === 'confirm') {
    footer.appendChild(el('span', 'bs-pj-confirm-msg', mode.message))
    footer.appendChild(kbd('y', 'yes'))
    footer.appendChild(kbd('n', 'no'))
    return
  }
  if (mode.kind === 'choice') {
    footer.appendChild(el('span', 'bs-pj-confirm-msg', mode.message))
    mode.options.forEach((o) => footer!.appendChild(kbd(o.key, o.label)))
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
  input.readOnly = mode.kind === 'confirm' || mode.kind === 'choice'

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
  // Saved before messaging: in replace mode this very tab may be closed.
  await mutate((list) => {
    const p = byId(list, project.id)
    if (p) p.updated_at = Date.now()
  })
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
  await mutate((list) => list.push(project))
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
    await mutate((list) => {
      const p = byId(list, project.id)
      if (!p) return
      p.items = keepIds(p.items, items)
      p.updated_at = Date.now()
    })
    await markDirty(`update: ${project.title}`)
    showToast(`“${project.title}” updated`, '')
  })
}

async function addCurrentTab(project: Project): Promise<void> {
  const active = (await getWindowTabs()).find((t) => t.active)
  if (!active?.url) return
  const added = await mutate((list) => {
    const p = byId(list, project.id)
    if (!p || p.items.some((t) => t.url === active.url)) return false
    p.items.push({ id: Date.now(), title: active.title || active.url, url: active.url })
    p.updated_at = Date.now()
    return true
  })
  if (!added) {
    showToast(`Already in “${project.title}”`, '')
    return
  }
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
      const { tab } = row
      await mutate((list) => {
        const p = byId(list, project.id)
        if (p) p.items = p.items.filter((t) => t.id !== tab.id || t.url !== tab.url)
      })
      await markDirty(`update: ${project.title}`)
    })
    return
  }
  askConfirm(`Delete project “${project.title}” (${plural(project.items.length, 'tab')})?`, async () => {
    await mutate((list) => {
      const i = list.findIndex((p) => p.id === project.id)
      if (i !== -1) list.splice(i, 1)
    })
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
  const renamed = await mutate((list) => {
    const p = byId(list, projectId)
    if (p) p.title = title
    return !!p
  })
  if (renamed) await markDirty(`rename: ${title}`)
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

// Ctrl+E: first `backupCheck` — the host pulls and tells whether projects.json changed in
// git since this machine last synced (i.e. another machine pushed). If not, a plain y/n
// overwrite; if so, a choice: merge their changes in first, or overwrite them. Then the
// host overwrites projects.json, commits (message from markDirty/commitMessage) and pushes.
// Without the host installed, falls back to a download.
function backupProjects(): void {
  if (dirtyChanges.length === 0) {
    showToast('Nothing to back up', '')
    return
  }
  const changes = dirtyChanges
  const message = commitMessage(changes)
  showToast('Checking backup…', '')
  chrome.runtime.sendMessage({ type: 'backupCheck', since: syncedHead }, (res) => {
    if (res?.noHost) {
      downloadProjects()
      void clearDirty()
      return
    }
    if (!res?.ok) {
      showToast(res?.error ?? 'unknown error', 'Backup failed: ')
      return
    }
    const pullNote = res.pullError ? ` (pull failed: ${res.pullError})` : ''
    if (!res.remoteChanged) {
      // Asks first: the backup file is overwritten, so a wrong state could replace a good one.
      askConfirm(`Overwrite backup with ${plural(projects.length, 'project')} and push?${pullNote}`, () => sendBackup(message))
      return
    }
    let remote: Project[]
    try {
      remote = parseProjects(res.projects)
    } catch {
      showToast('Invalid projects.json in backup', '')
      return
    }
    askChoice(`Backup in git has changes from another machine (${plural(countDiffering(remote), 'project')} differ)`, [
      { key: 'm', label: 'merge — import them, then backup', run: async () => {
        await mutate((list) => mergeNewer(list, remote))
        sendBackup(commitMessage(['merge: changes from another machine', ...changes]))
      } },
      { key: 'o', label: 'overwrite — keep only this machine', run: () => sendBackup(message) },
      { key: 'n', label: 'cancel', run: () => {} },
    ])
  })
}

function askChoice(message: string, options: ChoiceOption[]): void {
  setMode({ kind: 'choice', message, options })
}

function sendBackup(message: string): void {
  showToast('Saving backup…', '')
  chrome.runtime.sendMessage({ type: 'backupProjects', message }, onBackupResult)
}

// updated_at changes on every open, so it doesn't count as a difference.
function contentKey(p: Project): string {
  return JSON.stringify({ ...p, updated_at: 0 })
}

// Projects present on only one side, or with different content on both.
function countDiffering(remote: Project[]): number {
  const local = new Map(projects.map((p) => [p.id, contentKey(p)]))
  const remoteIds = new Set(remote.map((p) => p.id))
  const changed = remote.filter((p) => local.get(p.id) !== contentKey(p)).length
  return changed + projects.filter((p) => !remoteIds.has(p.id)).length
}

// Merge for Ctrl+E `m` and Ctrl+I: projects only in git are added; for a project on both
// sides the newer updated_at wins. A project deleted here but still in git comes back.
// Changes `list` in place (call it inside mutate); returns how many were taken from git.
function mergeNewer(list: Project[], remote: Project[]): number {
  let taken = 0
  for (const p of remote) {
    const i = list.findIndex((mine) => mine.id === p.id)
    if (i === -1) list.push(p)
    else if (p.updated_at > list[i].updated_at) list[i] = p
    else continue
    taken++
  }
  return taken
}

function onBackupResult(res: { ok?: boolean; noHost?: boolean; error?: string; pushError?: string; pullError?: string; changed?: boolean; pushed?: boolean; head?: string } | undefined): void {
  if (res?.noHost) {
    downloadProjects()
    void clearDirty()
  } else if (!res?.ok) {
    showToast(res?.error ?? 'unknown error', 'Backup failed: ')
  } else {
    void setSynced(res.head)
    const pullNote = res.pullError ? ` (pull failed: ${res.pullError})` : ''
    // Stays dirty when the push failed, so the next Ctrl+E retries it.
    if (res.pushError) {
      showToast(`${res.pushError}${pullNote}`, 'Committed, push failed: ')
      return
    }
    void clearDirty()
    showToast(`${plural(projects.length, 'project')}${res.changed ? '' : ' (no changes)'}${res.pushed ? ' · pushed' : ''}${pullNote}`, 'Backup: ')
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
  await mutate((list) => {
    for (const p of incoming) {
      const i = list.findIndex((mine) => mine.id === p.id)
      if (i === -1) list.push(p)
      else list[i] = p
    }
  })
  await markDirty(`import: ${plural(incoming.length, 'project')}`)
  showToast(`${plural(incoming.length, 'project')} imported`, '')
  render()
  input?.focus()
}

// Ctrl+I: import from the backup repo (native host pulls it first). Merged like `m` in
// Ctrl+E — the newer updated_at wins — so it can't wipe edits not backed up yet.
function restoreProjects(): void {
  showToast('Loading backup…', '')
  chrome.runtime.sendMessage({ type: 'restoreProjects' }, (res) => {
    if (!res?.ok) {
      showToast(res?.error ?? 'unknown error', 'Import failed: ')
      return
    }
    if (res.upToDate) {
      void setSynced(res.head)
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
    askConfirm(`Import from backup${pullNote}: ${plural(countDiffering(incoming), 'project')} differ, the newer version of each wins. Continue?`, async () => {
      const remoteById = new Map(incoming.map((p) => [p.id, p]))
      const { taken, localAhead } = await mutate((list) => ({
        // Something here that git doesn't have yet → the next Ctrl+E has work to do.
        localAhead: list.some((p) => {
          const r = remoteById.get(p.id)
          return !r || p.updated_at > r.updated_at
        }),
        taken: mergeNewer(list, incoming),
      }))
      await setSynced(res.head)
      if (!localAhead) await clearDirty()
      else if (dirtyChanges.length === 0) await markDirty(`merge: ${plural(taken, 'project')} from backup`)
      showToast(`${plural(taken, 'project')} from backup`, 'Imported ')
      render()
    })
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

  if (mode.kind === 'choice') {
    e.preventDefault()
    const option = isEscape ? mode.options.find((o) => o.key === 'n') : mode.options.find((o) => o.key === e.key)
    if (!option) return
    backToSearch(input!.value)
    void Promise.resolve(option.run()).then(() => render())
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
  } else if (ctrl && e.code === 'KeyE') {
    // By physical key + Shift, not e.key: CapsLock (or a non-Latin layout) would turn
    // a plain Ctrl+E backup into the export.
    e.preventDefault()
    if (e.shiftKey) downloadProjects()
    else backupProjects()
  } else if (ctrl && e.key === 'o') {
    e.preventDefault()
    importProjects()
  } else if (ctrl && e.key === 'i') {
    e.preventDefault()
    restoreProjects()
  }
}

// --- lifecycle ---

// Keeps an open panel in sync with changes made from another tab or the popup.
function onStorageChanged(changes: Record<string, chrome.storage.StorageChange>, area: string): void {
  if (area !== 'local' || !backdrop) return
  if (changes[DIRTY_KEY]) dirtyChanges = readDirty(changes[DIRTY_KEY].newValue)
  if (changes[SYNCED_KEY]) syncedHead = (changes[SYNCED_KEY].newValue as string | undefined) ?? null
  const next = changes[STORAGE_KEY]?.newValue
  if (!Array.isArray(next) || JSON.stringify(next) === JSON.stringify(projects)) return
  projects = next as Project[]
  render()
}

// onHideCb: the popup passes window.close, so closing the panel closes the popup.
export async function showProjects(startNaming = false, onHideCb: (() => void) | null = null): Promise<void> {
  if (backdrop) return
  onHide = onHideCb
  projects = await loadProjects()
  const stored = await chrome.storage.local.get([DIRTY_KEY, SYNCED_KEY])
  dirtyChanges = readDirty(stored[DIRTY_KEY])
  syncedHead = (stored[SYNCED_KEY] as string | undefined) ?? null
  mode = startNaming ? { kind: 'name', query: '' } : { kind: 'search' }
  selectedIndex = 0
  expanded = new Set()
  chrome.storage.onChanged.addListener(onStorageChanged)

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
  chrome.storage.onChanged.removeListener(onStorageChanged)
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
