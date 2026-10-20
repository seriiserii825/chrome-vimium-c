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
  // still lets execCommand('paste') work in the content script.
  const active = document.activeElement as HTMLElement | null
  const el = document.createElement('textarea')
  el.style.cssText = 'position:fixed;opacity:0;pointer-events:none'
  document.body.appendChild(el)
  el.focus()
  try {
    return document.execCommand('paste') ? el.value : ''
  } finally {
    el.remove()
    active?.focus()
  }
}
