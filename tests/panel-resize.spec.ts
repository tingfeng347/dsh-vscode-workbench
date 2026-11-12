import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { DSH_CHAT_DEFAULT_WIDTH, DSH_CHAT_MAX_WIDTH, DSH_CHAT_MIN_WIDTH, clampChatWidth, resizedPanelWidth } from '../src/client/Workbench.tsx'

describe('resizedPanelWidth', () => {
  it('grows the source control panel when its right edge moves right', () => {
    expect(resizedPanelWidth(210, 100, 175, 1, 210, 640)).toBe(285)
  })

  it('grows the DSH panel when its left edge moves left', () => {
    expect(resizedPanelWidth(440, 500, 450, -1, 440, 720)).toBe(490)
  })

  it('holds at either limit while the pointer continues past it', () => {
    expect(resizedPanelWidth(210, 100, 0, 1, 210, 640)).toBe(210)
    expect(resizedPanelWidth(440, 500, -500, -1, 440, 720)).toBe(720)
  })

  it('keeps the DSH panel wide enough for the official composer toolbar', () => {
    expect(DSH_CHAT_MIN_WIDTH).toBe(440)
    expect(DSH_CHAT_DEFAULT_WIDTH).toBe(DSH_CHAT_MIN_WIDTH)
    expect(clampChatWidth(400)).toBe(DSH_CHAT_MIN_WIDTH)
    expect(clampChatWidth(510.6)).toBe(511)
    expect(clampChatWidth(900)).toBe(DSH_CHAT_MAX_WIDTH)
    expect(clampChatWidth(Number.NaN)).toBe(DSH_CHAT_DEFAULT_WIDTH)
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
    expect(workbench).toContain('min={DSH_CHAT_MIN_WIDTH} max={DSH_CHAT_MAX_WIDTH} defaultWidth={DSH_CHAT_DEFAULT_WIDTH}')
    expect(workbench).toContain('<input type="range" min={DSH_CHAT_MIN_WIDTH} max={DSH_CHAT_MAX_WIDTH}')
    expect(styles).toContain('.dvw-chat-resizer{position:fixed;top:var(--dvw-titlebar-height);right:calc(var(--dvw-chat-width) - 5px);z-index:22}')
    expect(styles).toContain('--dvw-chat-effective:max(440px,min(var(--dvw-chat-width),calc(100vw - 254px)))')
    expect(styles).toContain('grid-template-columns:44px min(210px,var(--dvw-side-width),max(0px,calc(100vw - 164px - var(--dvw-chat-effective)))) minmax(0,1fr) var(--dvw-chat-effective)')
    expect(styles).toContain('.dvw-overlay[data-dvw-chat=true] .dvw-status{padding-right:calc(var(--dvw-chat-effective) + 6px)}')
    expect(styles).toContain('.dvw-chat-resizer{right:calc(var(--dvw-chat-effective) - 5px)}')
    expect(styles).toContain('[data-dvw-conversation-panel]{width:calc(max(440px,min(var(--dvw-chat-width),calc(100vw - 254px))) - 6px)!important}')
    expect(styles).toContain('[data-dvw-conversation-panel]{position:fixed!important;top:calc(var(--dvw-titlebar-height) + 6px)!important;right:3px!important;bottom:var(--dvw-status-height,30px)!important;left:auto!important;width:calc(var(--dvw-chat-width) - 6px)!important;')
    expect(styles).not.toContain('min(400px,var(--dvw-chat-width))')
    expect(styles).toContain('html[data-platform=darwin] .dvw-titlebar{')
    expect(styles).toContain('html[data-windows-titlebar]{--dvw-titlebar-height:var(--dsh-frame-top-clearance,40px)}')
    expect(styles).toContain('html[data-windows-titlebar] .dvw-overlay{top:var(--dvw-titlebar-height);padding-top:6px}')
    expect(styles).toContain('html[data-platform=darwin] .dvw-overlay{padding-top:var(--dvw-titlebar-height)}')
    expect(styles).toContain('-webkit-app-region:drag')
    expect(styles).toContain('padding-top:calc(var(--dvw-titlebar-height) + 6px)')
    expect(styles).toContain('[data-dvw-conversation-panel]{position:fixed!important;top:calc(var(--dvw-titlebar-height) + 6px)!important')
    expect(styles).toContain('html[data-platform=darwin] [data-dvw-conversation-panel]{top:var(--dvw-titlebar-height)!important}')
    expect(styles).toContain('body[data-dvw-conversation-active] [data-sidebar-right-expand]{display:none!important}')
    expect(styles).toContain('body[data-dvw-workbench-active] [data-shell-leading]{display:none!important}')
    expect(styles).toContain('body[data-dvw-workbench-active] [data-sidebar-toggle]{display:none!important}')
  })
})
