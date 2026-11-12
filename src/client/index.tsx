import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { ClientTerminals } from '@deepseek-ai/dsh-api-terminal-controller/client'
import type {} from '@deepseek-ai/dsh-api-terminal-controller/remote'
import type {} from '@deepseek-ai/dsh-api-gateway/client'
import { TerminalWorkspaces } from './terminal.ts'
import { NativeBrowser } from './browser.ts'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { useLayoutEffect } from 'react'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-working-directory'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { VscodeWorkbench } from './service.ts'
import { WorkbenchController } from './service.ts'
import { TerminalPanel } from './TerminalPanel.tsx'
import { Workbench } from './Workbench.tsx'
import { installStyles } from './styles.ts'
import { handleBrowserShortcut, handleTerminalShortcut } from './shortcuts.ts'
import { mainViewSession } from './session.ts'
import { createDshNavigation } from './dshNavigation.ts'
import type { DshNavigation } from './dshNavigation.ts'

export type { BottomPanelContribution, BottomPanelProps, VscodeWorkbench, WorkbenchCommand, WorkbenchSnapshot, WorkbenchView } from './service.ts'

declare module '@deepseek-ai/cordis' { interface Context { vscodeWorkbench: VscodeWorkbench } }

const Overlay = ({ service, browser, useSessions, usePanelInfo, navigation, openDshPanel, restoreConversation, closeDshPanel }: PropsRuntime<'shell.overlay'> & { service: VscodeWorkbench; browser: NativeBrowser; navigation: DshNavigation; openDshPanel(panelId: string): void; restoreConversation(): void; closeDshPanel(): void }) => {
  const session = useSessions(mainViewSession)
  const cwd = session?.projectionValues?.workingDirectory ?? session?.cwd
  const activePanelId = usePanelInfo(info => info.activePanelId)
  // DSH's own panel entry is not a page; every other global panel is shown inside the workbench.
  const dshPanelId = activePanelId === null || activePanelId === WORKBENCH_PANEL_ID ? undefined : activePanelId
  return <Workbench key={cwd ?? 'no-workspace'} service={service} browser={browser} sessionId={session?.id} cwd={cwd} navigation={navigation} dshPanelId={dshPanelId} onOpenDshPanel={openDshPanel} onRestoreConversation={restoreConversation} onCloseDshPanel={closeDshPanel}/>
}

const WORKBENCH_PANEL_ID = 'vscode-workbench' as MainPanelId

/** Panel-list icon; the panel itself opens the overlay and hands the centre back to the conversation. */
function WorkbenchPanelIcon({ size }: { size: number }) {
  return <span className="codicon codicon-code" aria-hidden="true" style={{ fontSize: size, lineHeight: 1 }}/>
}

function WorkbenchPanel({ service, restoreConversation }: { service: VscodeWorkbench; restoreConversation(): void }) {
  useLayoutEffect(() => { service.show(); restoreConversation() }, [service, restoreConversation])
  return null
}

export const inject = ['slots', 'layout', 'remote', 'remote.terminal', 'sidebarRight', 'sidebarRightTabs']
export function apply(ctx: ClientContext): void {
  const service = new WorkbenchController()
  const browser = new NativeBrowser(ctx)
  ctx.effect(() => () => browser.dispose(), 'dsh-vscode-workbench: browser')
  const terminals = new TerminalWorkspaces(new ClientTerminals(ctx.isolate('webTerminals'), ctx.remote.terminal))
  ctx.effect(() => () => terminals.dispose(), 'dsh-vscode-workbench: terminal membership')
  // Optional access to DSH's own workspace/session stores, used by the centered workspace switcher.
  const navigation = createDshNavigation((name) => (ctx as unknown as { get?: (name: string) => unknown }).get?.(name))
  ctx.effect(() => installStyles(), 'dsh-vscode-workbench: styles')
  ctx.effect(() => { const dispose = ctx.reflect.provide('vscodeWorkbench', service); return () => { void dispose() } }, 'dsh-vscode-workbench: service')
  ctx.effect(() => service.registerBottomPanel({ id: 'terminal', title: '终端', component: props => <TerminalPanel key={props.sessionId} {...props} workspace={terminals.get(props.sessionId)}/> }), 'dsh-vscode-workbench: terminal panel')
  ctx.effect(() => service.registerCommand({ id: 'terminal.new', run() { window.dispatchEvent(new Event('dvw-terminal-new')) } }), 'dsh-vscode-workbench: terminal command')
  const restoreConversation = () => { ctx.layout?.selectPanel(null) }
  // Re-open a panel that the workbench kept as a tab after handing the centre back.
  const openDshPanel = (panelId: string) => {
    try { ctx.layout?.selectPanel(panelId as MainPanelId) } catch { /* panel no longer registered */ }
  }
  const closeDshPanel = () => { ctx.layout?.selectPanel(null) }
  ctx.slots.inject('main', () => ctx.slots.inject('sidebar.panellist', () => {
    const disposeMain = ctx.slots.register({ name: 'main', key: WORKBENCH_PANEL_ID, inject: () => ({ service, restoreConversation }) }, WorkbenchPanel)
    const disposeIcon = ctx.slots.register({ name: 'sidebar.panellist', id: WORKBENCH_PANEL_ID, order: 60, label: () => 'VS Code 工作台' }, WorkbenchPanelIcon)
    return () => { disposeIcon(); disposeMain() }
  }))
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: 'dsh-vscode-workbench-overlay', inject: () => ({ service, browser, navigation, openDshPanel, restoreConversation, closeDshPanel }) }, Overlay))
  ctx.effect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (handleTerminalShortcut(event, service)) return
      if (handleBrowserShortcut(event, service)) return
      if (event.isComposing || !event.ctrlKey || event.altKey) return
      const view = event.shiftKey && event.code === 'KeyE' ? 'explorer' : event.shiftKey && event.code === 'KeyF' ? 'search' : event.shiftKey && event.code === 'KeyG' ? 'git' : undefined
      if (view !== undefined) { event.preventDefault(); service.show(view) }
    }
    window.addEventListener('keydown', onKey, true); return () => window.removeEventListener('keydown', onKey, true)
  }, 'dsh-vscode-workbench: navigation shortcuts')
}
