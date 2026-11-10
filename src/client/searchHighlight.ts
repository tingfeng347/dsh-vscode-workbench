/** Selection range for a search hit on one line, falling back to the reported column. */
export function searchHighlightRange(lineText: string, needle: string, column: number): { startColumn: number; endColumn: number } {
  const index = needle === '' ? -1 : lineText.indexOf(needle)
  const startColumn = index >= 0 ? index + 1 : Math.max(1, Math.min(Math.round(column), lineText.length + 1))
  return { startColumn, endColumn: startColumn + Math.max(needle.length, 1) }
}
