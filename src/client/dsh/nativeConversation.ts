import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { useSyncExternalStore } from 'react'

export const NATIVE_CONVERSATION_KIND = 'dvw-conversation'
export const NATIVE_CONVERSATION_PROVIDER = 'dsh-vscode-workbench/conversation'
export const NATIVE_CONVERSATION_FACTORY = 'conversation.content'

type TabId = Parameters<Context['sidebarRight']['focus']>[0]

interface ConversationSurface {
  readonly root: HTMLElement
  readonly floating: boolean
  readonly token: symbol
  readonly tabId: TabId
}

interface ConversationScroll { top: number; atEnd: boolean }

/** Workbench access to the official tab and to the body currently on screen. */
export class NativeConversation {
  private readonly surfaces = new Map<string, Set<ConversationSurface>>()
  private readonly listeners = new Set<() => void>()
  private readonly scrollPositions = new Map<string, ConversationScroll>()
  private available: boolean | undefined

  constructor(private readonly sidebar: Context['sidebarRight'], private readonly slots: Context['slots']) {}

  isAvailable = () => this.available ??= this.sidebar.openTabs !== undefined
    && (this.slots.snapshot?.(`factory:${NATIVE_CONVERSATION_FACTORY}`).length ?? 0) > 0

  subscribeAvailability = (listener: () => void) => {
    this.available = undefined
    return this.slots.subscribe('conversation.composer.bar', () => {
      this.available = undefined
      listener()
    })
  }

  private tabs(sessionId: string) {
    return this.sidebar.openTabs.getSnapshot().filter(tab =>
      tab.sessionId === sessionId && tab.kind === NATIVE_CONVERSATION_KIND)
  }

  open(sessionId: string): void {
    if (this.sidebar.mounted.getSnapshot() !== sessionId) return
    const tabs = this.tabs(sessionId)
    const activeId = this.sidebar.active()?.id
    const existing = tabs.find(tab => tab.tabId === activeId) ?? tabs[0]
    if (existing === undefined) {
      this.sidebar.openTab(NATIVE_CONVERSATION_KIND)
      return
    }
    this.sidebar.focus(existing.tabId)
    if (!this.sidebar.isExpanded() && !this.getSurface(sessionId)?.floating) this.sidebar.toggleExpanded()
  }

  close(sessionId: string): void {
    for (const tab of this.tabs(sessionId)) this.sidebar.closeIn(tab.sessionId, tab.tabId)
  }

  getSurface(sessionId: string | undefined): ConversationSurface | undefined {
    if (sessionId === undefined) return
    const surfaces = this.surfaces.get(sessionId)
    if (surfaces === undefined) return
    const first = surfaces.values().next().value
    if (surfaces.size === 1) return first
    const activeId = this.sidebar.active()?.id
    return Array.from(surfaces).find(surface => surface.tabId === activeId) ?? first
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  attach(sessionId: SessionId, root: HTMLElement, floating: boolean, token: symbol, tabId: TabId): () => void {
    const surfaces = this.surfaces.get(sessionId) ?? new Set<ConversationSurface>()
    const surface = { root, floating, token, tabId }
    surfaces.add(surface)
    this.surfaces.set(sessionId, surfaces)
    for (const listener of this.listeners) listener()
    // Guide pages deduplicate inside a pane. A second pane selecting the same
    // session transfers the conversation there so the shared editor has one tab.
    queueMicrotask(() => {
      if (!surfaces.has(surface) || this.sidebar.mounted.getSnapshot() !== sessionId || this.sidebar.active()?.id !== tabId) return
      for (const duplicate of this.tabs(sessionId)) {
        if (duplicate.tabId !== tabId) this.sidebar.closeIn(sessionId, duplicate.tabId)
      }
    })
    return () => {
      surfaces.delete(surface)
      if (surfaces.size === 0) this.surfaces.delete(sessionId)
      for (const listener of this.listeners) listener()
    }
  }

  trackScroll(sessionId: string, scrollport: HTMLElement): () => void {
    const saved = this.scrollPositions.get(sessionId)
    const restore = requestAnimationFrame(() => {
      if (saved === undefined || scrollport.clientHeight === 0) return
      scrollport.scrollTop = saved.atEnd ? scrollport.scrollHeight : saved.top
    })
    const save = () => {
      if (scrollport.clientHeight === 0) return
      this.scrollPositions.set(sessionId, {
        top: scrollport.scrollTop,
        atEnd: scrollport.scrollHeight - scrollport.clientHeight - scrollport.scrollTop < 4,
      })
    }
    scrollport.addEventListener('scroll', save, { passive: true })
    return () => {
      cancelAnimationFrame(restore)
      scrollport.removeEventListener('scroll', save)
    }
  }
}

const ignoreChanges = () => () => {}

export function useNativeConversation(conversation: NativeConversation | undefined, sessionId: string | undefined) {
  return useSyncExternalStore(
    conversation?.subscribe ?? ignoreChanges,
    () => conversation?.getSurface(sessionId),
  )
}

const unavailable = () => false

export function useNativeConversationAvailable(conversation: NativeConversation | undefined) {
  return useSyncExternalStore(conversation?.subscribeAvailability ?? ignoreChanges, conversation?.isAvailable ?? unavailable)
}
