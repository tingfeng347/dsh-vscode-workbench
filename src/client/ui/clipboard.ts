/** Copy through the async clipboard, falling back to the selection trick when the page is not focused. */
export async function copyText(text: string): Promise<void> {
  try { await navigator.clipboard.writeText(text); return } catch { /* fall through */ }
  const area = document.createElement('textarea'); area.value = text; area.style.position = 'fixed'; area.style.opacity = '0'
  document.body.append(area); area.select()
  try { document.execCommand('copy') } finally { area.remove() }
}
