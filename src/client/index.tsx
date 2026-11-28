import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { ClientTerminals } from '@deepseek-ai/dsh-api-terminal-controller/client'
import type {} from '@deepseek-ai/dsh-api-terminal-controller/remote'
import type {} from '@deepseek-ai/dsh-api-gateway/client'
import { TerminalWorkspaces } from './terminal/terminal.ts'
import { NativeBrowser } from './dsh/browser.ts'
import type { ISidebarRight } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { cloneElement, createContext, isValidElement, useContext, useLayoutEffect, useRef, useSyncExternalStore, type ReactElement, type ReactNode } from 'react'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-working-directory'
import type { PropsRenderFactories, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { PropsStore } from '@deepseek-ai/dsh-client-store'
import type {} from '@deepseek-ai/dsh-client-ui-context-menu/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { VscodeWorkbench } from './workbench/service.ts'
import { WorkbenchController } from './workbench/service.ts'
import { TerminalPanel } from './terminal/TerminalPanel.tsx'
import { SSHRemoteTerminalPanel } from './ssh/SSHRemoteTerminal.tsx'
import { DebugPanel } from './debug/DebugPanel.tsx'
import { debugController, debugShortcut } from './debug/debug.ts'
import { Workbench } from './workbench/Workbench.tsx'
import { WorkbenchSettingsSection } from './settings/SettingsPanel.tsx'
import { SETTINGS_SECTION_ID } from './settings/dshSettings.ts'
import { installStyles } from './workbench/styles.ts'
import { handleBrowserShortcut, handleTerminalShortcut } from './workbench/shortcuts.ts'
import { mainViewSession } from './dsh/session.ts'
import { createDshNavigation } from './dsh/dshNavigation.ts'
import type { DshNavigation } from './dsh/dshNavigation.ts'
import { installDshChangedFilesOpenInterceptor, installGeneratedFileOpenInterceptor } from './dsh/generatedFileLinks.ts'
import { CONVERSATION_CLOSE_ICON, CONVERSATION_OPEN_ICON, CONVERSATION_VIEW_SETTINGS_ICON, NATIVE_SIDEBAR_OPEN_ICON, DshConversationCloseIcon, DshConversationOpenIcon, DshConversationViewsIcon, DshNativeSidebarOpenIcon, type DshConversationMenus } from './dsh/DshConversationPanel.tsx'
import { NativeConversation, NATIVE_CONVERSATION_FACTORY, NATIVE_CONVERSATION_KIND, NATIVE_CONVERSATION_PROVIDER, useNativeConversation } from './dsh/nativeConversation.ts'
import { ConversationViewPins } from './dsh/conversationViewPins.tsx'
import { DshMark } from './ui/DshMark.tsx'
import { SidebarConversationHeader } from './dsh/SidebarConversationHeader.tsx'
import { ConversationActionVisibilitySettings } from './dsh/ConversationActionVisibilitySettings.tsx'
import { getConversationActionVisibility, subscribeConversationActionVisibility, visibleConversationToolbarActions } from './dsh/conversationActionVisibility.ts'
import type { ConversationSessionHeaderInjected, ConversationStore } from '@deepseek-ai/dsh-client-ui-conversation/client'

export type { BottomPanelContribution, BottomPanelProps, VscodeWorkbench, WorkbenchCommand, WorkbenchSnapshot, WorkbenchView } from './workbench/service.ts'

declare module '@deepseek-ai/cordis' { interface Context { vscodeWorkbench: VscodeWorkbench } }
const Overlay = ({ service, browser, rightSidebar, nativeConversation, conversationMenus, useSessions, usePanelInfo, navigation, openDshPanel, restoreConversation, closeDshPanel, openSettings }: PropsRuntime<'shell.overlay'> & { rightSidebar: ISidebarRight; nativeConversation: NativeConversation; conversationMenus?: DshConversationMenus; service: VscodeWorkbench; browser: NativeBrowser; navigation: DshNavigation; openDshPanel(panelId: string): void; restoreConversation(): void; closeDshPanel(): void; openSettings(): void }) => {
  const session = useSessions(mainViewSession)
  const cwd = session?.projectionValues?.workingDirectory ?? session?.cwd
  const activePanelId = usePanelInfo(info => info.activePanelId)
  // DSH's own panel entry is not a page; every other global panel is shown inside the workbench.
  const dshPanelId = activePanelId === null || activePanelId === WORKBENCH_PANEL_ID ? undefined : activePanelId
  return <Workbench key={cwd ?? 'no-workspace'} service={service} browser={browser} rightSidebar={rightSidebar} nativeConversation={nativeConversation} conversationMenus={conversationMenus} sessionId={session?.id} cwd={cwd} navigation={navigation} dshPanelId={dshPanelId} onOpenDshPanel={openDshPanel} onRestoreConversation={restoreConversation} onCloseDshPanel={closeDshPanel} openSettings={openSettings}/>
}

const WORKBENCH_PANEL_ID = 'vscode-workbench' as MainPanelId

interface ConversationToolbarServices {
  service: VscodeWorkbench
  menus?: DshConversationMenus
  nativeConversation: NativeConversation
}

interface ConversationHeaderInjectedProps {
  useConversationViews: <S>(selector: (views: readonly { id: string; label: string }[]) => S) => S
  useEntryPins: <S>(selector: (ids: readonly string[]) => S) => S
  useEntryActions: <S>(selector: (enabled: boolean) => S) => S
  selectView: (view: string) => void
  setPinned: (id: string, pinned: boolean) => void
}

const EmbeddedConversation = createContext<{ sessionId: string; token: symbol } | undefined>(undefined)

/** The official composer owns one Lexical editor per session, with one DOM root and draft writer. */
function ConversationFrame({ children, useSessions, nativeConversation }:
  PropsRuntime<'conversation.hero.frame'> & { children: ReactNode; nativeConversation: NativeConversation }) {
  const embedded = useContext(EmbeddedConversation)
  const mainSession = useSessions(state => mainViewSession(state)?.id)
  const sessionId = embedded?.sessionId ?? mainSession
  const nativeSurface = useNativeConversation(nativeConversation, sessionId)
  const active = embedded === undefined || embedded.token === nativeSurface?.token
  const scrollport = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (embedded !== undefined && active && sessionId !== undefined && scrollport.current !== null) return nativeConversation.trackScroll(sessionId, scrollport.current)
  }, [active, embedded, nativeConversation, sessionId])

  if (!isValidElement(children) || !Object.hasOwn(children.props, 'data-conversation-scroll')) return active ? children : null
  const body = children as ReactElement<{ children?: ReactNode; ref?: typeof scrollport }>
  // Keep the host's scroll element while the session view and composer change owners together.
  return cloneElement(body, { ref: scrollport }, active ? body.props.children : null)
}

function ConversationHeaderUtilities({ sessionId, service, nativeConversation }: ConversationToolbarServices & Partial<ConversationHeaderInjectedProps> & { sessionId: string }) {
  const { visible } = useSyncExternalStore(service.subscribe.bind(service), service.getSnapshot.bind(service))
  const actionVisibility = useSyncExternalStore(subscribeConversationActionVisibility, getConversationActionVisibility)
  const embedded = useContext(EmbeddedConversation)
  const sidebarSurface = useNativeConversation(nativeConversation, sessionId)
  const inSidebar = embedded !== undefined || sidebarSurface !== undefined
  const toolbarActions = visibleConversationToolbarActions(inSidebar, actionVisibility)
  const send = (action: 'open-editor' | 'return-sidebar' | 'close' | 'open-sidebar') => {
    window.dispatchEvent(new CustomEvent('dvw-workbench-conversation-action', { detail: { sessionId, action } }))
  }
  return <>
    <ConversationActionVisibilitySettings sessionId={sessionId}/>
    {visible && <>
      {toolbarActions.includes('conversation-placement') && <button type="button" className="dvw-official-conversation-action" aria-label={inSidebar ? '在编辑区打开对话' : '在工作台打开对话'} title={inSidebar ? '在编辑区打开对话' : '在工作台打开对话'}
        onClick={() => send('open-editor')}><DshConversationOpenIcon/></button>}
      {toolbarActions.includes('open-native-sidebar') && <button type="button" className="dvw-official-conversation-action" aria-label="打开侧边栏" title="打开侧边栏" onClick={() => send('open-sidebar')}><DshNativeSidebarOpenIcon/></button>}
      {toolbarActions.includes('close-conversation-bar') && <button type="button" className="dvw-official-conversation-action" aria-label="关闭对话栏" title="关闭对话栏" onClick={() => send('close')}><DshConversationCloseIcon/></button>}
    </>}
  </>
}

function ConversationSidebarTab({ sessionId, useTabInfo, useSession, useSessions, useConversation, useStore, renderFactorySlot, useConversationViews, useEntryPins, useEntryActions, selectView, setPinned, ...services }:
  PropsRuntime<'sidebar.right.pane.tab'> & PropsRenderFactories & PropsStore<ConversationStore> & ConversationToolbarServices & ConversationHeaderInjectedProps) {
  const { tab, panel } = useTabInfo()
  const root = useRef<HTMLDivElement>(null)
  const owner = useRef({ sessionId, token: Symbol() })
  owner.current.sessionId = sessionId
  useLayoutEffect(() => {
    if (tab.visible && root.current !== null) {
      return services.nativeConversation.attach(sessionId, root.current, panel.isFloating, owner.current.token, tab.id)
    }
  }, [sessionId, tab.id, tab.visible, panel.isFloating, services.nativeConversation])

  // Same phase inputs as the official main conversation shell.
  const openState = useSession(session => session.openState)
  const sessionStarted = useSession(session => session.promptAttempted || session.running || (!session.blank && !session.awaitingFirstTurn))
  const responding = useConversation(conversation => conversation.activeTargets.size > 0)
  const summaryBlank = useSessions(sessions => sessions.byId[sessionId]?.blank)
  const title = useSessions(sessions => sessions.byId[sessionId]?.displayTitle ?? sessionId)
  const activeView = useStore(state => state.view)
  const blank = !sessionStarted && !responding
  const hero = blank && (openState === 'open' || summaryBlank === true)
  const phase = hero ? 'hero' : blank && openState === 'loading' ? 'settling' : 'active'

  return <div ref={root} className="dvw-native-conversation" data-dvw-native-conversation={tab.visible ? 'visible' : 'hidden'}>
    <EmbeddedConversation.Provider value={owner.current}>
      {!hero && <SidebarConversationHeader sessionId={sessionId} title={title} activeView={activeView} useConversationViews={useConversationViews} useEntryPins={useEntryPins} useEntryActions={useEntryActions} selectView={selectView} setPinned={setPinned}/>}
      {renderFactorySlot(NATIVE_CONVERSATION_FACTORY, { variant: 'embedded', phase, hero }, {
        fallback: <div className="dvw-message">当前 Harness 版本无法加载对话正文。</div>,
      })}
    </EmbeddedConversation.Provider>
  </div>
}

/** Panel-list icon; its main entry only launches the workbench overlay. */
function WorkbenchPanelIcon({ size }: { size: number }) {
  return <span className="codicon codicon-code" aria-hidden="true" style={{ fontSize: size, lineHeight: 1 }}/>
}

export function WorkbenchPanel({ service, restoreConversation }: { service: VscodeWorkbench; restoreConversation(): void }) {
  useLayoutEffect(() => {
    service.show()
    // DSH's official sidebar is only mounted for the conversation main panel.
    // The overlay owns its lifetime after this launcher yields the main slot.
    restoreConversation()
  }, [service, restoreConversation])
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
  const rightSidebar = ctx.sidebarRight
  const service = new WorkbenchController()
  const browser = new NativeBrowser(ctx)
  const nativeConversation = new NativeConversation(rightSidebar, ctx.slots)
  const toolbarServices = (): ConversationToolbarServices => ({
    service,
    nativeConversation,
    menus: (ctx as unknown as { get?(name: string): unknown }).get?.('contextMenus') as DshConversationMenus | undefined,
  })
  if (rightSidebar.openTabs !== undefined) {
    ctx.effect(() => ctx.sidebarRightTabs.register({
      id: NATIVE_CONVERSATION_PROVIDER,
      kind: NATIVE_CONVERSATION_KIND,
      keepMounted: true,
      title: () => 'DSH 对话',
      guide: [{
        id: NATIVE_CONVERSATION_KIND, order: 50,
        title: () => 'DSH 对话', description: () => '在侧栏继续当前会话',
        icon: ({ size }) => <DshMark size={size}/>,
      }],
    }), 'dsh-vscode-workbench: conversation tab type')
    ctx.slots.inject('sidebar.right.pane.tab', () => {
      const officialHeader = ctx.slots.entries('conversation.session.header')[0]
      if (officialHeader === undefined) return () => {}
      return ctx.slots.register({
        name: 'sidebar.right.pane.tab', key: NATIVE_CONVERSATION_PROVIDER,
        store: officialHeader.store as ConversationStore,
        locale: 'conversation',
        inject: (sessionId: string, boundActions: unknown) => ({
          ...(officialHeader.inject as unknown as (id: string, actions: unknown) => ConversationSessionHeaderInjected)(sessionId, boundActions),
          ...toolbarServices(),
        }),
      }, ConversationSidebarTab)
    })
    ctx.slots.inject('conversation.hero.frame', () => ctx.slots.register({
      name: 'conversation.hero.frame', id: NATIVE_CONVERSATION_PROVIDER, order: 0,
      inject: () => ({ nativeConversation }),
    }, ConversationFrame))
  }
  ctx.slots.inject('conversation.session.header.views.actions', () => ctx.slots.register({
    name: 'conversation.session.header.views.actions', id: 'dsh-vscode-workbench-view-pin-persistence', order: 999,
  }, ConversationViewPins))
  ctx.effect(() => () => browser.dispose(), 'dsh-vscode-workbench: browser')
  const terminals = new TerminalWorkspaces(new ClientTerminals(ctx.isolate('webTerminals'), ctx.remote.terminal))
  ctx.effect(() => () => terminals.dispose(), 'dsh-vscode-workbench: terminal membership')
  // Optional access to DSH's own workspace/session stores, used by the centered workspace switcher.
  const navigation = createDshNavigation((name) => (ctx as unknown as { get?: (name: string) => unknown }).get?.(name))
  ctx.effect(() => installStyles(), 'dsh-vscode-workbench: styles')
  ctx.effect(() => installGeneratedFileOpenInterceptor(ctx.sidebarRight, () => service.getSnapshot().visible), 'dsh-vscode-workbench: generated file links')
  ctx.effect(() => installDshChangedFilesOpenInterceptor(ctx.sidebarRight, () => service.getSnapshot().visible, () => service.show('explorer')), 'dsh-vscode-workbench: changed file links')
  ctx.effect(() => { const dispose = ctx.reflect.provide('vscodeWorkbench', service); return () => { void dispose() } }, 'dsh-vscode-workbench: service')
  ctx.effect(() => service.registerBottomPanel({ id: 'terminal', title: '终端', component: props => <TerminalPanel key={props.sessionId} {...props} workspace={terminals.get(props.sessionId)}/> }), 'dsh-vscode-workbench: terminal panel')
  ctx.effect(() => service.registerBottomPanel({ id: 'ssh-terminal', title: 'SSH 终端', component: props => <SSHRemoteTerminalPanel key={`${props.sessionId}:ssh`} {...props}/> }), 'dsh-vscode-workbench: SSH terminal panel')
  ctx.effect(() => service.registerBottomPanel({ id: 'debug', title: '调试', component: props => <DebugPanel controller={debugController} sessionId={props.sessionId ?? ''} onOpenFrame={(path, line) => window.dispatchEvent(new CustomEvent('dvw-open-workspace-path', { detail: { path, line } }))}/> }), 'dsh-vscode-workbench: debug panel')
  // F5/F10/F11 belong to the debugger only while it can act on them; otherwise the host keeps its
  // own bindings, so F11 still toggles fullscreen when nothing is paused.
  ctx.effect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return
      if (!service.getSnapshot().visible) return
      const snapshot = debugController.getSnapshot()
      const action = debugShortcut(event.code, event.shiftKey, snapshot)
      if (action === undefined) return
      event.preventDefault(); event.stopImmediatePropagation()
      switch (action.kind) {
        case 'resume': debugController.resume(); return
        case 'stop': debugController.stop(); return
        case 'start': debugController.start(snapshot.sessionId ?? '', snapshot.activePath ?? '', '', snapshot.adapterId); return
        case 'step': debugController.step(action.step); return
        // A second F5 while running is swallowed so neither the debugger nor the host restarts it.
        case 'swallow': return
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, 'dsh-vscode-workbench: debug shortcuts')
  ctx.effect(() => service.registerCommand({ id: 'terminal.new', run() { window.dispatchEvent(new Event('dvw-terminal-new')) } }), 'dsh-vscode-workbench: terminal command')
  const restoreConversation = () => { ctx.layout?.selectPanel(null) }
  // Hiding the overlay must also leave our null-rendering main panel; otherwise
  // DSH keeps it selected and never mounts the conversation underneath. Only
  // release our own selection so unmounting for another panel preserves it.
  ctx.effect(() => service.subscribe(() => {
    if (!service.getSnapshot().visible && ctx.layout?.panelInfo?.getSnapshot().activePanelId === WORKBENCH_PANEL_ID) {
      restoreConversation()
    }
  }), 'dsh-vscode-workbench: return to conversation')
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
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay', id: 'dsh-vscode-workbench-overlay',
    inject: () => ({
      service, browser, rightSidebar, nativeConversation, navigation, openDshPanel, restoreConversation, closeDshPanel, openSettings,
      conversationMenus: toolbarServices().menus,
    }),
  }, Overlay))
  ctx.slots.inject('contextMenu.icon', () => ctx.slots.register({ name: 'contextMenu.icon', key: CONVERSATION_OPEN_ICON }, DshConversationOpenIcon))
  ctx.slots.inject('contextMenu.icon', () => ctx.slots.register({ name: 'contextMenu.icon', key: CONVERSATION_CLOSE_ICON }, DshConversationCloseIcon))
  ctx.slots.inject('contextMenu.icon', () => ctx.slots.register({ name: 'contextMenu.icon', key: NATIVE_SIDEBAR_OPEN_ICON }, DshNativeSidebarOpenIcon))
  ctx.slots.inject('contextMenu.icon', () => ctx.slots.register({ name: 'contextMenu.icon', key: CONVERSATION_VIEW_SETTINGS_ICON }, DshConversationViewsIcon))
  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
    name: 'conversation.session.header.utilities', id: 'dsh-vscode-workbench-conversation-actions', order: 60,
    inject: (sessionId: string) => {
      const officialHeader = ctx.slots.entries('conversation.session.header')[0]
      if (officialHeader?.inject === undefined || officialHeader.store === undefined) return toolbarServices()
      const actions = (officialHeader.store as ConversationStore).create(sessionId).actions
      return {
        ...toolbarServices(),
        ...(officialHeader.inject as unknown as (id: string, actions: unknown) => ConversationSessionHeaderInjected)(sessionId, actions),
      }
    },
  }, ConversationHeaderUtilities))
  ctx.slots.inject('settings.section', () => ctx.slots.register({ name: 'settings.section', id: SETTINGS_SECTION_ID, order: 40, label: '工作台' }, WorkbenchSettingsSection))
  ctx.slots.inject('settings.section.icon', () => ctx.slots.register({ name: 'settings.section.icon', id: SETTINGS_SECTION_ID }, WorkbenchSettingsIcon))
  ctx.effect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (handleTerminalShortcut(event, service)) return
      if (handleBrowserShortcut(event, service)) return
      if (!event.isComposing && (event.ctrlKey || event.metaKey) && event.shiftKey && !event.altKey && (event.code === 'KeyF' || event.code === 'KeyH')) {
        event.preventDefault()
        service.show('search')
        window.dispatchEvent(new CustomEvent('dvw-focus-search', { detail: event.code === 'KeyH' }))
        return
      }
      if (event.isComposing || !event.ctrlKey || event.altKey) return
      const view = event.shiftKey && event.code === 'KeyE' ? 'explorer' : event.shiftKey && event.code === 'KeyG' ? 'git' : undefined
      if (view !== undefined) { event.preventDefault(); service.show(view) }
    }
    window.addEventListener('keydown', onKey, true); return () => window.removeEventListener('keydown', onKey, true)
  }, 'dsh-vscode-workbench: navigation shortcuts')
}
