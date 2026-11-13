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
import { WorkbenchSettingsSection } from './SettingsPanel.tsx'
import { SETTINGS_SECTION_ID } from './dshSettings.ts'
import { installStyles } from './styles.ts'
import { handleBrowserShortcut, handleTerminalShortcut } from './shortcuts.ts'
import { mainViewSession } from './session.ts'
import { createDshNavigation } from './dshNavigation.ts'
import type { DshNavigation } from './dshNavigation.ts'

export type { BottomPanelContribution, BottomPanelProps, VscodeWorkbench, WorkbenchCommand, WorkbenchSnapshot, WorkbenchView } from './service.ts'

declare module '@deepseek-ai/cordis' { interface Context { vscodeWorkbench: VscodeWorkbench } }

const Overlay = ({ service, browser, useSessions, usePanelInfo, navigation, openDshPanel, restoreConversation, closeDshPanel, openSettings }: PropsRuntime<'shell.overlay'> & { service: VscodeWorkbench; browser: NativeBrowser; navigation: DshNavigation; openDshPanel(panelId: string): void; restoreConversation(): void; closeDshPanel(): void; openSettings(): void }) => {
  const session = useSessions(mainViewSession)
  const cwd = session?.projectionValues?.workingDirectory ?? session?.cwd
  const activePanelId = usePanelInfo(info => info.activePanelId)
  // DSH's own panel entry is not a page; every other global panel is shown inside the workbench.
  const dshPanelId = activePanelId === null || activePanelId === WORKBENCH_PANEL_ID ? undefined : activePanelId
  return <Workbench key={cwd ?? 'no-workspace'} service={service} browser={browser} sessionId={session?.id} cwd={cwd} navigation={navigation} dshPanelId={dshPanelId} onOpenDshPanel={openDshPanel} onRestoreConversation={restoreConversation} onCloseDshPanel={closeDshPanel} openSettings={openSettings}/>
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

/** Settings navigation glyph: a workbench window with an explorer rail. */
function WorkbenchSettingsIcon({ size }: { size: number }) {
  return <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="1.9" y="2.6" width="12.2" height="10.8" rx="1.6"/>
    <path d="M6.1 2.6v10.8M2.4 5.4h3.7"/>
  </svg>
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
  // DSH owns the settings dialog; the shell keeps its open state and selected section in the
  // `sidebar.settings` store handle, so opening our page means asking that store to select it.
  const openSettings = () => {
    const select = (): boolean => {
      const entry = ctx.slots.entries('sidebar.settings')[0]
      const store = entry?.store as { create?: () => { actions?: { openSection?: (id: string) => void } } } | undefined
      try {
        const actions = store?.create?.().actions
        if (typeof actions?.openSection !== 'function') return false
        actions.openSection(SETTINGS_SECTION_ID)
        return true
      } catch { return false }
    }
    if (select()) return
    // The settings shell mounts lazily; retry once before reporting the miss.
    window.setTimeout(() => { if (!select()) console.warn('dsh-vscode-workbench: DSH settings shell is unavailable') }, 300)
  }
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
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: 'dsh-vscode-workbench-overlay', inject: () => ({ service, browser, navigation, openDshPanel, restoreConversation, closeDshPanel, openSettings }) }, Overlay))
  ctx.slots.inject('settings.section', () => ctx.slots.register({ name: 'settings.section', id: SETTINGS_SECTION_ID, order: 40, label: 'Workbench' }, WorkbenchSettingsSection))
  ctx.slots.inject('settings.section.icon', () => ctx.slots.register({ name: 'settings.section.icon', id: SETTINGS_SECTION_ID }, WorkbenchSettingsIcon))
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
