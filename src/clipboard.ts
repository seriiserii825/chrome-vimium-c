export function writeText(text: string): void {
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text)
    return
  }
  const el = document.createElement('textarea')
  el.value = text
  el.style.cssText = 'position:fixed;opacity:0;pointer-events:none'
  document.body.appendChild(el)
  el.focus()
  el.select()
  document.execCommand('copy')
  el.remove()
}

export async function readText(): Promise<string> {
  if (navigator.clipboard?.readText) {
    return navigator.clipboard.readText()
  }
  return ''
}
