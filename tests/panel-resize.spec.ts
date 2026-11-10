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
    expect(styles).toContain('.dvw-chat{border-left-color:transparent!important}')
    expect(styles).toContain('.dvw-side-resizer::after,.dvw-chat-resizer::after{background:transparent;left:3px;width:4px}')
    expect(styles).not.toContain('.dvw-chat-resizer::after{left:1px;width:6px}')
    const workbench = readFileSync(new URL('../src/client/Workbench.tsx', import.meta.url), 'utf8')
    expect(workbench).toContain('if (hideBelow !== undefined && nextWidth < hideBelow) { onHide?.(); return }')
    expect(workbench).toContain('hideBelow={200} onHide={()=>setChatVisible(false)}')
    expect(workbench).toContain('hideBelow={105} onHide={()=>setPrimarySideVisible(false)}')
    expect(styles).toContain('.dvw-chat-resizer{position:fixed;top:var(--dvw-titlebar-height);right:calc(var(--dvw-chat-width) - 5px);z-index:22}')
    expect(styles).toContain('html[data-platform=darwin] .dvw-titlebar{')
    expect(styles).toContain('html[data-windows-titlebar]{--dvw-titlebar-height:var(--dsh-frame-top-clearance,40px)}')
    expect(styles).toContain('html[data-windows-titlebar] .dvw-overlay{top:var(--dvw-titlebar-height);padding-top:0}')
    expect(styles).toContain('-webkit-app-region:drag')
    expect(styles).toContain('padding-top:var(--dvw-titlebar-height)')
    expect(styles).toContain('[data-dvw-conversation-panel]{position:fixed!important;top:var(--dvw-titlebar-height)!important')
    expect(styles).toContain('body[data-dvw-conversation-active] [data-sidebar-right-expand]{display:none!important}')
    expect(styles).toContain('body[data-dvw-workbench-active] [data-shell-leading]{display:none!important}')
    expect(styles).toContain('body[data-dvw-workbench-active] [data-sidebar-toggle]{display:none!important}')
  })
})
