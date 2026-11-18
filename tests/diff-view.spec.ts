import { linkedScrollOffset } from '../src/client/GitSplitDiff.ts'
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

  it('uses the classic inline style unless the ribbon preference was saved', () => {
    const workbench = read('src/client/Workbench.tsx')
    expect(workbench).toContain("localStorage.getItem('dvw:git-diff-style') === 'ribbon' ? 'ribbon' : 'classic'")
    expect(workbench).toContain("const defaultDiffMode = gitDiffStyle === 'ribbon' ? 'split' : 'inline'")
    expect(read('src/client/SettingsPanel.tsx')).toContain('Git 对比样式')
  })

  it('keeps explicit split mode stable and re-lays out after switching', () => {
    const editor = read('src/client/MonacoEditor.tsx')
    expect(editor).toContain('useInlineViewWhenSpaceIsLimited:false')
    expect(editor).toContain("value.updateOptions({renderSideBySide:props.mode==='split'})")
    expect(editor).toMatch(/requestAnimationFrame\(\(\)=>\{\s*value.layout\(\)/)
  })
})


describe('linked split scrolling', () => {
  it('leaves the shorter side at its anchor through a long insertion', () => {
    const points: Parameters<typeof linkedScrollOffset>[0] = [
      { at: 0, offsets: [0, 0] },
      { at: 500, offsets: [500, 500] },
      { at: 1500, offsets: [500, 1500] },
      { at: 2000, offsets: [1000, 2000] },
    ]
    expect([0, 1].map(side=>linkedScrollOffset(points,600,400,side))).toEqual([300,600])
    expect([0, 1].map(side=>linkedScrollOffset(points,1000,400,side))).toEqual([300,1000])
    expect([0, 1].map(side=>linkedScrollOffset(points,1500,400,side))).toEqual([500,1500])
  })

  it('keeps both versions at the start and allows the left side to traverse deletions', () => {
    const points: Parameters<typeof linkedScrollOffset>[0] = [
      { at: 0, offsets: [0, 0] },
      { at: 600, offsets: [600, 0] },
      { at: 1000, offsets: [1000, 400] },
    ]
    expect([0, 1].map(side=>linkedScrollOffset(points,0,240,side))).toEqual([0,0])
    expect([0, 1].map(side=>linkedScrollOffset(points,300,240,side))).toEqual([300,0])
  })
})
