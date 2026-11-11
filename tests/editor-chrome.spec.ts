import { describe, expect, it } from 'vitest'
import { WORKBENCH_EDITOR_CHROME, isMacDefinitionClick, isMacPlatform } from '../src/client/MonacoEditor.tsx'

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
