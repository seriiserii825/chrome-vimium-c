import { showPrompt } from './prompt'

const STORAGE_KEY = 'bs-timecodes'
const MAX_PER_VIDEO = 30

interface TimecodeEntry {
  videoId: string
  seconds: number
  name: string
}

function getVideoId(): string | null {
  if (!location.hostname.includes('youtube.com')) return null
  return new URLSearchParams(location.search).get('v')
}

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  return [h, m, s].map(n => String(n).padStart(2, '0')).join(':')
}

function loadEntries(): TimecodeEntry[] {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]') } catch { return [] }
}

function saveEntry(videoId: string, seconds: number, name: string): void {
  const all = loadEntries().filter(e => !(e.videoId === videoId && e.seconds === seconds))
  const forVideo = all.filter(e => e.videoId === videoId).slice(0, MAX_PER_VIDEO - 1)
  const others = all.filter(e => e.videoId !== videoId)
  localStorage.setItem(STORAGE_KEY, JSON.stringify([{ videoId, seconds, name }, ...forVideo, ...others]))
}

function deleteEntry(videoId: string, seconds: number): void {
  const all = loadEntries().filter(e => !(e.videoId === videoId && e.seconds === seconds))
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all))
}

function renameEntry(videoId: string, seconds: number, name: string): void {
  const all = loadEntries().map(e =>
    e.videoId === videoId && e.seconds === seconds ? { ...e, name } : e
  )
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all))
}

// ---

let backdrop: HTMLElement | null = null

export function showTimecode(): void {
  if (backdrop) return

  const videoId = getVideoId()
  const history = videoId ? loadEntries().filter(e => e.videoId === videoId) : []

  backdrop = document.createElement('div')
  backdrop.id = 'bs-timecode-backdrop'

  const panel = document.createElement('div')
  panel.id = 'bs-timecode'

  const header = document.createElement('div')
  header.id = 'bs-timecode-header'

  const label = document.createElement('div')
  label.id = 'bs-timecode-label'
  label.textContent = 'Go to time'

  const toggleBtn = document.createElement('button')
  toggleBtn.id = 'bs-timecode-toggle'
  toggleBtn.textContent = '+'
  toggleBtn.title = 'Enter time manually'
  toggleBtn.tabIndex = 0

  const closeBtn = document.createElement('button')
  closeBtn.id = 'bs-timecode-close'
  closeBtn.textContent = '✕'
  closeBtn.title = 'Close'
  closeBtn.tabIndex = 0
  closeBtn.addEventListener('click', () => hideTimecode())
  closeBtn.addEventListener('keydown', (e) => {
    e.stopPropagation()
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); hideTimecode(); return }
    if (e.key === 'q' || e.key === 'Q') { hideTimecode() }
  })

  header.appendChild(label)
  header.appendChild(toggleBtn)
  header.appendChild(closeBtn)

  const row = document.createElement('div')
  row.id = 'bs-timecode-row'
  row.hidden = true

  const inputs: HTMLInputElement[] = []

  function makeInput(): HTMLInputElement {
    const inp = document.createElement('input')
    inp.type = 'text'
    inp.className = 'bs-timecode-inp'
    inp.maxLength = 2
    inp.value = '00'
    inp.spellcheck = false
    inp.inputMode = 'numeric'
    return inp
  }

  function sep(): HTMLSpanElement {
    const s = document.createElement('span')
    s.className = 'bs-timecode-sep'
    s.textContent = ':'
    return s
  }

  const hh = makeInput()
  const mm = makeInput()
  const ss = makeInput()
  inputs.push(hh, mm, ss)

  row.appendChild(hh)
  row.appendChild(sep())
  row.appendChild(mm)
  row.appendChild(sep())
  row.appendChild(ss)

  function toggleRow(): void {
    row.hidden = !row.hidden
    toggleBtn.textContent = row.hidden ? '+' : '−'
    if (!row.hidden) { hh.focus(); hh.select() }
  }

  toggleBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleRow() })
  toggleBtn.addEventListener('keydown', (e) => {
    e.stopPropagation()
    if (e.key === 'q' || e.key === 'Q') { hideTimecode(); return }
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleRow(); return }
  })

  const hintsBar = document.createElement('div')
  hintsBar.id = 'bs-timecode-hints'
  function hint(key: string, label: string): string {
    return `<span>${key}</span> ${label}`
  }
  function hintsRow(title: string, items: string[]): string {
    return `<div><b>${title}</b>${items.join('<i></i>')}</div>`
  }
  hintsBar.innerHTML = hintsRow('popup', [
    hint('↑↓', 'nav'),
    hint('←→', 'name/×'),
    hint('Enter', 'seek'),
    hint('q', 'close'),
  ]) + hintsRow('global', [
    hint('tc', 'open'),
    hint('ts', 'save'),
    hint('te', 'export'),
    hint('ti', 'import'),
    hint('vu', '+spd'),
    hint('vd', '−spd'),
    hint('vq', 'quality'),
    hint('vf', 'fullscr'),
  ])

  panel.appendChild(header)
  panel.appendChild(row)
  panel.appendChild(hintsBar)

  // History items
  const historyItems: HTMLElement[] = []
  let searchInput: HTMLInputElement | null = null
  if (history.length > 0) {
    const histList = document.createElement('div')
    histList.id = 'bs-timecode-history'

    const searchRow = document.createElement('div')
    searchRow.id = 'bs-timecode-search-row'

    const search = document.createElement('input')
    search.type = 'text'
    search.id = 'bs-timecode-search'
    search.placeholder = 'Filter…'
    search.spellcheck = false
    searchInput = search

    const playBtn = document.createElement('button')
    playBtn.id = 'bs-timecode-play'
    playBtn.textContent = '▶'
    playBtn.title = 'Play first match'
    playBtn.type = 'button'
    playBtn.tabIndex = 0

    const editBtn = document.createElement('button')
    editBtn.id = 'bs-timecode-edit'
    editBtn.textContent = '✎'
    editBtn.title = 'Rename first match'
    editBtn.type = 'button'
    editBtn.tabIndex = 0

    searchRow.appendChild(search)
    searchRow.appendChild(playBtn)
    searchRow.appendChild(editBtn)

    ;[...history].sort((a, b) => b.seconds - a.seconds).forEach((entry) => {
      const item = document.createElement('div')
      item.className = 'bs-timecode-hist-item'
      item.tabIndex = 0
      item.dataset.seconds = String(entry.seconds)

      const radio = document.createElement('span')
      radio.className = 'bs-timecode-radio'

      const nameInput = document.createElement('input')
      nameInput.type = 'text'
      nameInput.className = 'bs-timecode-name-input'
      nameInput.value = entry.name
      nameInput.placeholder = '—'
      nameInput.spellcheck = false

      const timeLabel = document.createElement('span')
      timeLabel.className = 'bs-timecode-time'
      timeLabel.textContent = formatTime(entry.seconds)

      const deleteBtn = document.createElement('button')
      deleteBtn.className = 'bs-timecode-delete'
      deleteBtn.textContent = '×'
      deleteBtn.title = 'Delete'
      deleteBtn.tabIndex = 0
      deleteBtn.type = 'button'

      item.appendChild(radio)
      item.appendChild(nameInput)
      item.appendChild(timeLabel)
      item.appendChild(deleteBtn)
      histList.appendChild(item)
      historyItems.push(item)

      function removeItem(): void {
        if (!videoId) return
        deleteEntry(videoId, entry.seconds)
        const currentIdx = historyItems.indexOf(item)
        const focusNext = historyItems[currentIdx + 1] ?? historyItems[currentIdx - 1]
        item.remove()
        historyItems.splice(currentIdx, 1)
        if (historyItems.length === 0) histList.remove()
        if (focusNext) focusNext.focus()
        else { hh.focus(); hh.select() }
      }

      function saveName(): void {
        const newName = nameInput.value.trim()
        if (videoId && newName !== entry.name) {
          renameEntry(videoId, entry.seconds, newName)
          entry.name = newName
        }
      }

      nameInput.addEventListener('keydown', (e) => {
        e.stopPropagation()
        if (e.key === 'q' || e.key === 'Q') { hideTimecode(); return }
        if (e.key === 'Enter') { saveName(); item.focus(); return }
        if (e.key === 'Escape') { nameInput.value = entry.name; item.focus(); return }
        if (e.key === 'ArrowRight' && nameInput.selectionStart === nameInput.value.length) {
          e.preventDefault(); saveName(); deleteBtn.focus(); return
        }
        if (e.key === 'ArrowLeft' && nameInput.selectionStart === 0) {
          e.preventDefault(); saveName(); item.focus(); return
        }
        if (e.key === 'Tab' && !e.shiftKey) {
          e.preventDefault(); saveName()
          deleteBtn.focus()
          return
        }
        if (e.key === 'Tab' && e.shiftKey) {
          e.preventDefault(); saveName()
          item.focus()
          return
        }
      })
      nameInput.addEventListener('blur', () => { saveName() })
      nameInput.addEventListener('focus', () => {
        historyItems.forEach(i => i.classList.remove('focused'))
        item.classList.add('focused')
      })

      item.addEventListener('keydown', (e) => {
        e.stopPropagation()
        if (e.key === 'q' || e.key === 'Q') { hideTimecode(); return }
        if (e.key === 'Delete') { e.preventDefault(); removeItem(); return }
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          hideTimecode()
          seekToTime(entry.seconds)
          return
        }
        if (e.key === 'Tab' && !e.shiftKey) {
          e.preventDefault()
          nameInput.focus()
          return
        }
        if (e.key === 'Tab' && e.shiftKey) {
          e.preventDefault()
          const prev = prevVisible(historyItems.indexOf(item) - 1)
          if (prev) prev.querySelector<HTMLButtonElement>('.bs-timecode-delete')?.focus()
          else editBtn.focus()
          return
        }
        if (e.key === 'ArrowDown') {
          e.preventDefault()
          nextVisible(historyItems.indexOf(item) + 1)?.focus()
          return
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault()
          const prev = prevVisible(historyItems.indexOf(item) - 1)
          if (prev) prev.focus()
          else search.focus()
          return
        }
        if (e.key === 'ArrowRight') {
          e.preventDefault()
          nameInput.focus()
          return
        }
      })

      deleteBtn.addEventListener('keydown', (e) => {
        e.stopPropagation()
        if (e.key === 'q' || e.key === 'Q') { hideTimecode(); return }
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); removeItem(); return }
        if (e.key === 'Escape') { item.focus(); return }
        if (e.key === 'ArrowLeft') { e.preventDefault(); nameInput.focus(); return }
        if (e.key === 'Tab' && !e.shiftKey) {
          e.preventDefault()
          const next = nextVisible(historyItems.indexOf(item) + 1)
          if (next) next.focus()
          else hh.focus()
          return
        }
        if (e.key === 'Tab' && e.shiftKey) {
          e.preventDefault()
          nameInput.focus()
          return
        }
      })

      item.addEventListener('focus', () => {
        historyItems.forEach(i => i.classList.remove('focused'))
        item.classList.add('focused')
      })
      item.addEventListener('blur', (e) => {
        if (!item.contains(e.relatedTarget as Node)) item.classList.remove('focused')
      })
      item.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('.bs-timecode-delete')) { removeItem(); return }
        if ((e.target as HTMLElement).closest('.bs-timecode-name-input')) return
        hideTimecode()
        seekToTime(entry.seconds)
      })

      deleteBtn.addEventListener('click', (e) => { e.stopPropagation(); removeItem() })
    })

    function firstVisible(): HTMLElement | undefined {
      return historyItems.find(i => i.style.display !== 'none')
    }

    function nextVisible(from: number): HTMLElement | undefined {
      let i = from
      while (historyItems[i] && historyItems[i].style.display === 'none') i++
      return historyItems[i]
    }

    function prevVisible(from: number): HTMLElement | undefined {
      let i = from
      while (i >= 0 && historyItems[i].style.display === 'none') i--
      return i >= 0 ? historyItems[i] : undefined
    }

    function playFirstMatch(): void {
      const item = firstVisible()
      if (!item) return
      const seconds = Number(item.dataset.seconds)
      hideTimecode()
      seekToTime(seconds)
    }

    function editFirstMatch(): void {
      const nameInput = firstVisible()?.querySelector<HTMLInputElement>('.bs-timecode-name-input')
      nameInput?.focus()
      nameInput?.select()
    }

    function applyFilter(): void {
      const q = search.value.trim().toLowerCase()
      historyItems.forEach((item) => {
        const name = item.querySelector<HTMLInputElement>('.bs-timecode-name-input')?.value.toLowerCase() ?? ''
        const time = item.querySelector<HTMLElement>('.bs-timecode-time')?.textContent?.toLowerCase() ?? ''
        item.style.display = q && !name.includes(q) && !time.includes(q) ? 'none' : ''
      })
    }

    search.addEventListener('input', applyFilter)
    search.addEventListener('keydown', (e) => {
      e.stopPropagation()
      if (e.key === 'Escape') {
        if (search.value) { search.value = ''; applyFilter() } else hideTimecode()
        return
      }
      if (e.key === 'Enter') { e.preventDefault(); playFirstMatch(); return }
      if (e.key === 'ArrowDown') { e.preventDefault(); firstVisible()?.focus(); return }
      if (e.key === 'Tab' && !e.shiftKey) { e.preventDefault(); playBtn.focus(); return }
      if (e.key === 'Tab' && e.shiftKey) {
        e.preventDefault()
        if (!row.hidden) { ss.focus(); ss.select() } else toggleBtn.focus()
        return
      }
    })

    playBtn.addEventListener('click', () => playFirstMatch())
    playBtn.addEventListener('keydown', (e) => {
      e.stopPropagation()
      if (e.key === 'q' || e.key === 'Q') { hideTimecode(); return }
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); playFirstMatch(); return }
      if (e.key === 'Escape') { search.focus(); return }
      if (e.key === 'Tab' && !e.shiftKey) { e.preventDefault(); editBtn.focus(); return }
      if (e.key === 'Tab' && e.shiftKey) { e.preventDefault(); search.focus(); return }
    })

    editBtn.addEventListener('click', () => editFirstMatch())
    editBtn.addEventListener('keydown', (e) => {
      e.stopPropagation()
      if (e.key === 'q' || e.key === 'Q') { hideTimecode(); return }
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); editFirstMatch(); return }
      if (e.key === 'Escape') { search.focus(); return }
      if (e.key === 'Tab' && !e.shiftKey) { e.preventDefault(); (firstVisible() ?? historyItems[0])?.focus(); return }
      if (e.key === 'Tab' && e.shiftKey) { e.preventDefault(); playBtn.focus(); return }
    })

    panel.appendChild(searchRow)
    panel.appendChild(histList)
  }

  backdrop.appendChild(panel)
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) hideTimecode() })

  inputs.forEach((inp, idx) => {
    inp.addEventListener('keydown', (e) => {
      e.stopPropagation()
      if (e.key === 'q' || e.key === 'Q') { hideTimecode(); return }
      if (e.key === 'Escape') { toggleRow(); return }

      if (e.key === 'Enter') {
        const total = getSeconds()
        hideTimecode()
        seekToTime(total)
        if (videoId) {
          showPrompt('Timecode name', '', (name) => {
            saveEntry(videoId, total, name)
          })
        }
        return
      }

      if (e.key === 'Tab' && !e.shiftKey) {
        e.preventDefault()
        if (inputs[idx + 1]) { inputs[idx + 1].focus(); inputs[idx + 1].select() }
        else if (searchInput) searchInput.focus()
        else if (historyItems[0]) historyItems[0].focus()
        return
      }

      if (e.key === 'Tab' && e.shiftKey) {
        e.preventDefault()
        if (inputs[idx - 1]) { inputs[idx - 1].focus(); inputs[idx - 1].select() }
        else toggleBtn.focus()
        return
      }

      if (e.key === 'ArrowRight' && inp.selectionStart === inp.value.length && idx < inputs.length - 1) {
        e.preventDefault()
        inputs[idx + 1].focus(); inputs[idx + 1].setSelectionRange(0, 0)
        return
      }

      if (e.key === 'ArrowLeft' && inp.selectionStart === 0 && idx > 0) {
        e.preventDefault()
        const prev = inputs[idx - 1]
        prev.focus(); prev.setSelectionRange(prev.value.length, prev.value.length)
        return
      }

      if (e.key === 'Backspace' && inp.value === '' && idx > 0) {
        e.preventDefault()
        inputs[idx - 1].focus(); inputs[idx - 1].select()
        return
      }
    })

    inp.addEventListener('input', () => {
      inp.value = inp.value.replace(/\D/g, '').slice(0, 2)
      if (inp.value.length === 2 && idx < inputs.length - 1) {
        inputs[idx + 1].focus(); inputs[idx + 1].select()
      }
    })

    inp.addEventListener('focus', () => { inp.select() })
  })

  document.documentElement.appendChild(backdrop)
  requestAnimationFrame(() => {
    if (searchInput) searchInput.focus()
    else if (historyItems[0]) historyItems[0].focus()
    else toggleBtn.focus()
  })

  function getSeconds(): number {
    const h = parseInt(hh.value || '0', 10)
    const m = parseInt(mm.value || '0', 10)
    const s = parseInt(ss.value || '0', 10)
    return h * 3600 + m * 60 + s
  }
}

function seekToTime(seconds: number): void {
  // Pre-mark so the watcher doesn't fire when playback lands on this timecode
  const videoId = getVideoId()
  if (videoId) {
    lastWatchedVideoId = videoId
    firedSeconds.add(seconds)
  }
  const video = document.querySelector('video')
  if (video) { video.currentTime = seconds; video.play(); return }
  const url = new URL(window.location.href)
  url.searchParams.set('t', `${seconds}s`)
  window.location.href = url.href
}

export function saveCurrentTimecode(): void {
  const videoId = getVideoId()
  if (!videoId) return
  const video = document.querySelector('video')
  if (!video) return
  const seconds = Math.floor(video.currentTime)
  showPrompt('Timecode name', '', (name) => {
    saveEntry(videoId, seconds, name)
    showTimecode()
  })
}

export function hideTimecode(): void {
  backdrop?.remove()
  backdrop = null
  document.querySelector('video')?.focus()
}

export function isTimecodeVisible(): boolean {
  return backdrop !== null
}

export function exportTimecodes(): void {
  const entries = loadEntries()
  if (entries.length === 0) {
    showToastLocal('Nothing to export', '')
    return
  }
  const json = JSON.stringify(entries, null, 2)
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'timecodes.json'
  a.click()
  URL.revokeObjectURL(url)
  showToastLocal(`${entries.length} timecode${entries.length === 1 ? '' : 's'} exported`, '')
}

export function importTimecodes(): void {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.json,application/json'
  input.addEventListener('change', () => {
    const file = input.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result as string)
        if (!Array.isArray(data)) throw new Error('expected array')
        const incoming: TimecodeEntry[] = data
          .filter((e): e is Record<string, unknown> =>
            typeof e === 'object' && e !== null &&
            typeof (e as Record<string, unknown>).videoId === 'string' &&
            typeof (e as Record<string, unknown>).seconds === 'number'
          )
          .map(e => ({
            videoId: e.videoId as string,
            seconds: e.seconds as number,
            name: typeof e.name === 'string' ? e.name : '',
          }))
        if (incoming.length === 0) { showToastLocal('No valid entries found', ''); return }
        localStorage.setItem(STORAGE_KEY, JSON.stringify(incoming))
        showToastLocal(`${incoming.length} timecode${incoming.length === 1 ? '' : 's'} imported`, '')
      } catch {
        showToastLocal('Invalid JSON file', '')
      }
    }
    reader.readAsText(file)
  })
  input.click()
}

// --- Timecode watcher ---

let watchInterval: ReturnType<typeof setInterval> | null = null
let lastWatchedVideoId: string | null = null
const firedSeconds = new Set<number>()
let lastCurrentTime = 0
let reachedPopup: HTMLElement | null = null

export function startTimecodeWatcher(): void {
  if (watchInterval !== null) return
  watchInterval = setInterval(tickWatcher, 500)
}

function tickWatcher(): void {
  const videoId = getVideoId()
  if (!videoId) return
  const video = document.querySelector('video')
  if (!video || video.paused) return

  const now = video.currentTime

  if (videoId !== lastWatchedVideoId) {
    lastWatchedVideoId = videoId
    firedSeconds.clear()
    lastCurrentTime = now
  }

  // Re-arm timecodes the user seeked back past
  if (now < lastCurrentTime - 3) {
    for (const s of firedSeconds) {
      if (s >= now) firedSeconds.delete(s)
    }
  }
  lastCurrentTime = now

  const entries = loadEntries().filter(e => e.videoId === videoId)
  for (const entry of entries) {
    if (firedSeconds.has(entry.seconds)) continue
    if (now >= entry.seconds && now < entry.seconds + 1) {
      firedSeconds.add(entry.seconds)
      video.pause()
      showReachedPopup(entry, video)
      break
    }
  }
}

function showReachedPopup(entry: TimecodeEntry, video: HTMLVideoElement): void {
  reachedPopup?.remove()

  const el = document.createElement('div')
  el.id = 'bs-tcr'

  const info = document.createElement('div')
  info.id = 'bs-tcr-info'

  const nameEl = document.createElement('span')
  nameEl.id = 'bs-tcr-name'
  nameEl.textContent = entry.name || formatTime(entry.seconds)

  info.appendChild(nameEl)

  if (entry.name) {
    const timeEl = document.createElement('span')
    timeEl.id = 'bs-tcr-time'
    timeEl.textContent = formatTime(entry.seconds)
    info.appendChild(timeEl)
  }

  const btns = document.createElement('div')
  btns.id = 'bs-tcr-btns'

  const continueBtn = document.createElement('button')
  continueBtn.className = 'bs-tcr-btn bs-tcr-continue'
  continueBtn.textContent = 'Continue ▶'

  const stayBtn = document.createElement('button')
  stayBtn.className = 'bs-tcr-btn bs-tcr-stay'
  stayBtn.textContent = 'Stay'

  btns.appendChild(continueBtn)
  btns.appendChild(stayBtn)
  el.appendChild(info)
  el.appendChild(btns)
  reachedPopup = el
  document.documentElement.appendChild(el)

  function dismiss(resume: boolean): void {
    if (!reachedPopup) return
    el.remove()
    reachedPopup = null
    document.removeEventListener('keydown', onKey, true)
    if (resume) void video.play()
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') { e.stopPropagation(); dismiss(false) }
  }

  continueBtn.addEventListener('click', () => dismiss(true))
  stayBtn.addEventListener('click', () => dismiss(false))
  document.addEventListener('keydown', onKey, true)
  requestAnimationFrame(() => continueBtn.focus())
}

// ---

function showToastLocal(message: string, prefix: string): void {
  const existing = document.getElementById('bs-vimium-toast')
  if (existing) existing.remove()
  const toast = document.createElement('div')
  toast.id = 'bs-vimium-toast'
  toast.textContent = prefix + message
  document.documentElement.appendChild(toast)
  requestAnimationFrame(() => { toast.classList.add('bs-vimium-toast-visible') })
  setTimeout(() => {
    toast.classList.remove('bs-vimium-toast-visible')
    toast.addEventListener('transitionend', () => toast.remove(), { once: true })
  }, 2500)
}
