import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { TabId } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

export interface BrowserTab { id: string; sessionId: string; title: string }
export interface BrowserSnapshot { available: boolean; tabs: readonly BrowserTab[] }

/** Navigate official browser tabs; their controller, renderer and persistence stay with DSH. */
export class NativeBrowser {
  private snapshot: BrowserSnapshot = { available: false, tabs: [] }
  private readonly listeners = new Set<() => void>()
  private readonly lifetime = new AbortController()
  private readonly disposers: Array<() => void>

  constructor(private readonly ctx: Context) {
    this.disposers = [ctx.sidebarRight.openTabs.subscribe(() => this.update()), ctx.sidebarRightTabs.subscribe(() => this.update())]
    this.update()
  }

  getSnapshot = (): BrowserSnapshot => this.snapshot
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener) }

  async open(sessionId: string, request?: AbortSignal): Promise<string> {
    const signal = request === undefined ? this.lifetime.signal : AbortSignal.any([request, this.lifetime.signal])
    signal.throwIfAborted()
    if (!this.snapshot.available) throw new Error('官方浏览器尚未启用，请重新加载 Harness。')
    // mounted changes before React commits. The Session's DOM seat confirms store adoption too.
    const ready = () => this.ctx.sidebarRight.mounted.getSnapshot() === sessionId
      && [...document.querySelectorAll('[data-sidebar-right-session]')].some(node => node.getAttribute('data-sidebar-right-session') === sessionId)
    if (!ready()) await new Promise<void>((resolve, reject) => {
      const clean = () => { clearTimeout(timer); unsubscribe(); observer.disconnect(); signal.removeEventListener('abort', abort) }
      const abort = () => { clean(); reject(signal.reason) }
      const timer = setTimeout(() => { clean(); reject(new Error('工作区尚未就绪，请稍后重试。')) }, 10000)
      const check = () => { if (ready()) { clean(); resolve() } }
      const unsubscribe = this.ctx.sidebarRight.mounted.subscribe(check)
      const observer = new MutationObserver(check)
      observer.observe(document.body, { childList: true, subtree: true })
      signal.addEventListener('abort', abort, { once: true })
    })
    signal.throwIfAborted()
    const before = new Set(this.ctx.sidebarRight.tabsIn(sessionId as SessionId).map(tab => tab.id))
    this.ctx.sidebarRight.openTabIn(sessionId as SessionId, 'browser', { revealIfOpened: false })
    const tab = this.ctx.sidebarRight.tabsIn(sessionId as SessionId).find(tab => tab.kind === 'browser' && !before.has(tab.id))
    if (tab === undefined) throw new Error('浏览器页面未能打开，请重试。')
    this.update()
    return tab.id
  }

  focus(id: string): void {
    this.ctx.sidebarRight.focus(id as TabId)
    if (!this.ctx.sidebarRight.isExpanded()) this.ctx.sidebarRight.toggleExpanded()
  }

  close(sessionId: string, id: string): void {
    const target = sessionId as SessionId
    this.ctx.sidebarRight.closeIn(target, id as TabId)
    // `closeIn` is a no-op for a Session whose store was never adopted; the public close names the on-screen one.
    if (this.ctx.sidebarRight.mounted.getSnapshot() === target && this.ctx.sidebarRight.tabsIn(target).some(tab => tab.id === id)) this.ctx.sidebarRight.close(id as TabId)
    this.update()
  }
  dispose(): void { this.lifetime.abort(); for (const dispose of this.disposers) dispose(); this.listeners.clear() }

  private update(): void {
    this.snapshot = {
      available: this.ctx.sidebarRightTabs.get('browser') !== undefined,
      tabs: this.ctx.sidebarRight.openTabs.getSnapshot().filter(tab => tab.kind === 'browser').map(tab => ({
        id: tab.tabId, sessionId: tab.sessionId,
        title: this.ctx.sidebarRight.tabsIn(tab.sessionId).find(record => record.id === tab.tabId)?.title ?? '浏览器',
      })),
    }
    for (const listener of this.listeners) listener()
  }
}
