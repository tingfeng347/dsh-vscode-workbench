import { describe, expect, it, vi } from 'vitest'
import { WorkbenchController } from '../src/client/service.ts'
import { handleTerminalShortcut } from '../src/client/shortcuts.ts'

function keyboard(shiftKey = false): KeyboardEvent {
  return { code: 'Backquote', ctrlKey: true, altKey: false, shiftKey, isComposing: false, preventDefault: vi.fn(), stopImmediatePropagation: vi.fn() } as unknown as KeyboardEvent
}

describe('terminal shortcuts', () => {
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
