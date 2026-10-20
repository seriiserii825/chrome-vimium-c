export async function writeText(text: string): Promise<void> {
  if (navigator.clipboard) {
    await navigator.clipboard.writeText(text)
    return
  }
  const el = document.createElement('textarea')
  el.value = text
  el.style.cssText = 'position:fixed;opacity:0;pointer-events:none'
  document.body.appendChild(el)
  el.focus()
  el.select()
  try {
    if (!document.execCommand('copy')) throw new Error('Could not copy text')
  } finally {
    el.remove()
  }
}

export async function readText(): Promise<string> {
  if (navigator.clipboard?.readText) {
    try { return await navigator.clipboard.readText() } catch { /* fall through to execCommand */ }
  }
  // HTTP pages have no navigator.clipboard; the extension's clipboardRead permission
  // still lets execCommand('paste') work in the content script. Read the text from the
  // paste event itself — page paste handlers (e.g. WP admin) may cancel the insertion.
  let pasted = ''
  const onPaste = (e: ClipboardEvent) => { pasted = e.clipboardData?.getData('text/plain') ?? '' }
  window.addEventListener('paste', onPaste, true)
  const active = document.activeElement as HTMLElement | null
  const el = document.createElement('textarea')
  el.style.cssText = 'position:fixed;top:0;left:0;opacity:0'
  document.documentElement.appendChild(el)
  el.focus()
  try {
    document.execCommand('paste')
    return pasted || el.value
  } finally {
    window.removeEventListener('paste', onPaste, true)
    el.remove()
    active?.focus()
  }
}
