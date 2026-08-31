import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resizedPanelWidth } from '../src/client/Workbench.tsx'

describe('resizedPanelWidth', () => {
  it('grows the source control panel when its right edge moves right', () => {
    expect(resizedPanelWidth(210, 100, 175, 1, 210, 640)).toBe(285)
  })

  it('grows the DSH panel when its left edge moves left', () => {
    expect(resizedPanelWidth(420, 500, 450, -1, 400, 720)).toBe(470)
  })

  it('holds at either limit while the pointer continues past it', () => {
    expect(resizedPanelWidth(210, 100, 0, 1, 210, 640)).toBe(210)
    expect(resizedPanelWidth(420, 500, -500, -1, 400, 720)).toBe(720)
  })

  it('uses matching narrow visual lines with an accessible drag target', () => {
    const styles = readFileSync(new URL('../src/client/styles.ts', import.meta.url), 'utf8')
    expect(styles).toContain('.dvw-side-resizer,.dvw-chat-resizer{width:10px;cursor:ew-resize;touch-action:none;background:transparent}')
    expect(styles).toContain('.dvw-side{border-right-color:transparent}.dvw-chat,[data-dvw-conversation-panel]{border-left-color:transparent!important}')
    expect(styles).toContain('.dvw-side-resizer::after,.dvw-chat-resizer::after{background:transparent}.dvw-side-resizer::after{left:3px;width:3px}')
    expect(styles).toContain('.dvw-chat-resizer::after{left:1px;width:6px}')
    expect(styles).toContain('.dvw-chat-resizer{position:fixed;top:36px;right:calc(var(--dvw-chat-width) - 5px);z-index:22}')
  })
})
