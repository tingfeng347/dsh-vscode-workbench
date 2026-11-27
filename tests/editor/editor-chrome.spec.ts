import { describe, expect, it } from 'vitest'
import { readSource } from '../support/readSource.ts'
import { WORKBENCH_EDITOR_CHROME, WORKBENCH_MINIMAP_OPTIONS, isMacDefinitionClick, isMacPlatform, minimapOptions } from '../../src/client/editor/MonacoEditor.tsx'

describe('workbench editor chrome', () => {
  it('keeps a narrow scrollbar without a minimap or overview ruler', () => {
    expect(WORKBENCH_EDITOR_CHROME).toMatchObject({
      minimap: { enabled: false },
      renderOverviewRuler: false,
      overviewRulerLanes: 0,
      scrollbar: { verticalScrollbarSize: 10 },
    })
  })
})

describe('code minimap', () => {
  it('matches VS Code defaults with a capped width and a hover slider', () => {
    expect(WORKBENCH_MINIMAP_OPTIONS).toEqual({
      side: 'right',
      size: 'proportional',
      showSlider: 'mouseover',
      renderCharacters: true,
      maxColumn: 120,
      scale: 1,
    })
  })

  it('turns the shared chrome into an explicit on or off choice', () => {
    expect(minimapOptions(true)).toMatchObject({ enabled: true, maxColumn: 120, side: 'right' })
    expect(minimapOptions(false)).toMatchObject({ enabled: false, maxColumn: 120, side: 'right' })
    // The shared constant stays off, so diff editors that spread the chrome never inherit a minimap.
    expect('enabled' in WORKBENCH_MINIMAP_OPTIONS).toBe(false)
  })

  it('paints the minimap with both workbench palettes', () => {
    const source = readSource('src/client/editor/MonacoEditor.tsx')
    expect(source).toContain("'minimap.background': '#121314'")
    expect(source).toContain("'minimap.background': '#f7ebc8'")
    expect(source.match(/'minimapSlider\.background'/g)).toHaveLength(2)
  })

  it('leaves the diff editor on the narrow chrome', () => {
    const source = readSource('src/client/editor/MonacoEditor.tsx')
    const diff = source.slice(source.indexOf('export function MonacoDiffEditor'), source.indexOf('let diffModelSequence'))
    // Guard against an empty slice, which would make the assertion below pass for the wrong reason.
    expect(diff).toContain('WORKBENCH_EDITOR_CHROME')
    expect(diff.length).toBeGreaterThan(2_000)
    expect(diff).not.toContain('minimap:')
  })
})

describe('macOS definition click', () => {
  it('detects the desktop platform from the user agent', () => {
    expect(isMacPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')).toBe(true)
    expect(isMacPlatform('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe(false)
  })

  it('treats a plain Control-click as go-to-definition', () => {
    expect(isMacDefinitionClick({ button: 0, ctrlKey: true, metaKey: false })).toBe(true)
    expect(isMacDefinitionClick({ button: 0, ctrlKey: false, metaKey: true })).toBe(false)
    expect(isMacDefinitionClick({ button: 0, ctrlKey: true, metaKey: true })).toBe(false)
    // macOS may report Control-click as a right-button press while Ctrl is still held.
    expect(isMacDefinitionClick({ button: 2, ctrlKey: true, metaKey: false })).toBe(true)
    expect(isMacDefinitionClick({ button: 2, ctrlKey: false, metaKey: false })).toBe(false)
  })
})
