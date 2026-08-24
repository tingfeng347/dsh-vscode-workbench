import type { VscodeWorkbench } from './service.ts'

/** Handle terminal shortcuts through contributions registered by a terminal adapter. */
export function handleTerminalShortcut(event: KeyboardEvent, workbench: VscodeWorkbench): boolean {
  if (event.isComposing || !event.ctrlKey || event.altKey || event.code !== 'Backquote') return false
  if (!workbench.getPanels().some(panel => panel.id === 'terminal')) return false
  event.preventDefault()
  event.stopImmediatePropagation()
  workbench.show()
  if (event.shiftKey) {
    if (workbench.getSnapshot().bottomPanel !== 'terminal') workbench.toggleBottomPanel('terminal')
    queueMicrotask(() => workbench.runCommand('terminal.new'))
  } else {
    workbench.toggleBottomPanel('terminal')
  }
  return true
}
