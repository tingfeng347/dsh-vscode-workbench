import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

declare module '@deepseek-ai/dsh-client-ui-sidebar-right/client' {
  interface SidebarRightTabParamsMap {
    /** Optional initial Browser URL; mirrors the official browser package's declaration. */
    browser: { readonly url?: string }
  }
}

/** Open DSH's browser; its tabs, focus, rendering and persistence stay with the official Sidebar. */
export class NativeBrowser {
  private readonly lifetime = new AbortController()

  constructor(private readonly ctx: Context) {}

  /** Wait for the selected Session's seat, then let DSH open its own page. */
  async open(sessionId: string, request?: AbortSignal, url?: string): Promise<void> {
    const signal = request === undefined ? this.lifetime.signal : AbortSignal.any([request, this.lifetime.signal])
    signal.throwIfAborted()
    if (this.ctx.sidebarRightTabs.get('browser') === undefined) throw new Error('官方浏览器尚未启用，请重新加载 Harness。')
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
    if (!ready()) throw new Error('工作区已切换，已取消打开浏览器。')
    this.ctx.sidebarRight.openTabIn(sessionId as SessionId, 'browser', {
      revealIfOpened: false,
      ...(url === undefined ? {} : { params: { url } }),
    })
  }

  dispose(): void { this.lifetime.abort() }
}
