import { describe, expect, it, vi } from 'vitest'
import { WorkbenchController } from '../src/client/service.ts'
import { handleTerminalShortcut, openTerminal, toggleTerminal } from '../src/client/shortcuts.ts'
import { readFileSync } from 'node:fs'

function keyboard(shiftKey = false): KeyboardEvent {
  return { code: 'Backquote', ctrlKey: true, altKey: false, shiftKey, isComposing: false, preventDefault: vi.fn(), stopImmediatePropagation: vi.fn() } as unknown as KeyboardEvent
}

describe('terminal shortcuts', () => {
  it('renders the activity-bar terminal glyph', () => {
    const styles = readFileSync(new URL('../src/client/styles.ts', import.meta.url), 'utf8')
    expect(styles).toContain('.codicon-terminal:before{content:"\\ea85"}')
  })

  it('does nothing without a contributed terminal panel', () => {
    expect(handleTerminalShortcut(keyboard(), new WorkbenchController(undefined))).toBe(false)
  })

  it('toggles the contributed terminal panel', () => {
    const service = new WorkbenchController(undefined)
    service.registerBottomPanel({ id: 'terminal', title: 'Terminal', component: () => null })
    const event = keyboard()
    expect(handleTerminalShortcut(event, service)).toBe(true)
    expect(service.getSnapshot()).toMatchObject({ visible: true, bottomPanel: 'terminal' })
    expect(event.preventDefault).toHaveBeenCalled()
  })

  it('reveals the contributed terminal panel without closing an open one', () => {
    const service = new WorkbenchController(undefined)
    service.registerBottomPanel({ id: 'terminal', title: 'Terminal', component: () => null })
    expect(openTerminal(service)).toBe(true)
    expect(service.getSnapshot()).toMatchObject({ visible: true, bottomPanel: 'terminal' })
    expect(openTerminal(service)).toBe(true)
    expect(service.getSnapshot().bottomPanel).toBe('terminal')
  })

  it('toggles the terminal from the activity bar', () => {
    const service = new WorkbenchController(undefined)
    service.registerBottomPanel({ id: 'terminal', title: 'Terminal', component: () => null })
    expect(toggleTerminal(service)).toBe(true)
    expect(service.getSnapshot().bottomPanel).toBe('terminal')
    expect(toggleTerminal(service)).toBe(true)
    expect(service.getSnapshot().bottomPanel).toBeUndefined()
  })

  it('opens the panel and runs the new-terminal command', async () => {
    const service = new WorkbenchController(undefined)
    const run = vi.fn()
    service.registerBottomPanel({ id: 'terminal', title: 'Terminal', component: () => null })
    service.registerCommand({ id: 'terminal.new', run })
    expect(handleTerminalShortcut(keyboard(true), service)).toBe(true)
    await Promise.resolve()
    expect(run).toHaveBeenCalledOnce()
  })
})
