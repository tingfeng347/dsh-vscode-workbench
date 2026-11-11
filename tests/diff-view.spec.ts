import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

describe('split diff layout', () => {
  it('lets Monaco own scrolling instead of wrapping it in the text diff scroller', () => {
    const styles = read('src/client/styles.ts')
    expect(styles).toContain('.dvw-monaco-diff{height:auto;min-width:0;min-height:0;margin:0;padding:0;overflow:hidden;white-space:normal}')
    expect(styles).toContain('.dvw-editor{min-width:0;overflow:hidden}')
    expect(styles).toContain('.dvw-editor-body{min-width:0;overflow:hidden}')
  })

  it('keeps explicit split mode stable and re-lays out after switching', () => {
    const editor = read('src/client/MonacoEditor.tsx')
    expect(editor).toContain('useInlineViewWhenSpaceIsLimited:false')
    expect(editor).toContain("value.updateOptions({renderSideBySide:props.mode==='split'})")
    expect(editor).toContain('requestAnimationFrame(()=>value.layout())')
  })
})
