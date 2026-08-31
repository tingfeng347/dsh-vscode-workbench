import type { VscodeWorkbench } from './service.ts'

/** Reveal the terminal panel supplied by a terminal adapter without toggling it closed. */
export function openTerminal(workbench: VscodeWorkbench): boolean {
  if (!workbench.getPanels().some(panel => panel.id === 'terminal')) return false
  workbench.show()
  if (workbench.getSnapshot().bottomPanel !== 'terminal') workbench.toggleBottomPanel('terminal')
  return true
}

/** Toggle the terminal panel from the activity bar. */
export function toggleTerminal(workbench: VscodeWorkbench): boolean {
  if (!workbench.getPanels().some(panel => panel.id === 'terminal')) return false
  workbench.show()
  workbench.toggleBottomPanel('terminal')
  return true
}

/** Handle terminal shortcuts through contributions registered by a terminal adapter. */
export function handleTerminalShortcut(event: KeyboardEvent, workbench: VscodeWorkbench): boolean {
  if (event.isComposing || !event.ctrlKey || event.altKey || event.code !== 'Backquote') return false
  if (!workbench.getPanels().some(panel => panel.id === 'terminal')) return false
  event.preventDefault()
  event.stopImmediatePropagation()
  workbench.show()
  if (event.shiftKey) {
    openTerminal(workbench)
    queueMicrotask(() => workbench.runCommand('terminal.new'))
  } else {
    workbench.toggleBottomPanel('terminal')
  }
  return true
}
