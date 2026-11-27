declare module 'monaco-editor/esm/vs/editor/contrib/find/browser/replacePattern.js' {
  export class ReplacePattern {
    static fromStaticValue(value: string): ReplacePattern
    buildReplaceString(matches: readonly string[], preserveCase: boolean): string
  }
  export function parseReplaceString(value: string): ReplacePattern
}
