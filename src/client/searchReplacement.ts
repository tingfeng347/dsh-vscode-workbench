import { parseReplaceString, ReplacePattern } from 'monaco-editor/esm/vs/editor/contrib/find/browser/replacePattern.js'
import type { SearchMatch, SearchRequest } from '../types.ts'

/** Use Monaco's replacement syntax for both the inline preview and the edit sent to disk. */
export function replacementFor(request: SearchRequest, value: string, preserveCase: boolean) {
  const pattern = request.regex ? parseReplaceString(value) : ReplacePattern.fromStaticValue(value)
  return (row: SearchMatch): string => pattern.buildReplaceString(row.captures ?? [row.match], preserveCase)
}

/** Only request groups referenced by the replacement. A doubled dollar is literal. */
export function referencedGroups(value: string): number[] {
  const groups = new Set<number>()
  for (const token of value.matchAll(/\$\$|\$([1-9]\d?)/g)) {
    if (token[1]) groups.add(Number(token[1]))
  }
  return [...groups].sort((a, b) => a - b)
}
