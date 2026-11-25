import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { SshConnection } from '../types.ts'
import { api } from './api.ts'
import { Icon } from './Icon.tsx'

export interface SshChatStatus {
  available: boolean
  connected?: boolean
  target?: Pick<SshConnection, 'id' | 'label' | 'root'>
}

/** Execution-target control beside the native DSH composer. */
export function SshChatTarget({ conversationRoot, sessionId, visible, status, localName, onSelect, onOpenSsh }: {
  conversationRoot: HTMLElement | null
  sessionId: string
  visible: boolean
  status?: SshChatStatus
  localName?: string
  onSelect(id: string | null): Promise<void>
  onOpenSsh(): void
}) {
  const [host, setHost] = useState<HTMLElement>()
  const [choices, setChoices] = useState<SshConnection[]>()
  const [menuPosition, setMenuPosition] = useState<Record<string, string | number>>()
  const trigger = useRef<HTMLButtonElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  useEffect(() => {
    if (!visible || !status?.available || conversationRoot === null) return
    const node = document.createElement('div')
    node.className = 'dvw-ssh-chat-host'
    let statusRow: HTMLElement | null = null
    let frame = 0
    const attach = () => {
      const usage = conversationRoot.querySelector<HTMLButtonElement>('button[aria-label*="上下文已用"], button[title*="上下文已用"]')
      const bar = conversationRoot.querySelector<HTMLElement>('[data-slot="conversation.composer.bar"]')
      const nextStatusRow = usage?.parentElement ?? null
      const anchor = nextStatusRow ?? bar?.parentElement
      if (!anchor || (node.parentElement === anchor && statusRow === nextStatusRow)) return
      statusRow?.removeAttribute('data-dvw-ssh-chat-status')
      statusRow = nextStatusRow
      statusRow?.setAttribute('data-dvw-ssh-chat-status', '')
      anchor.insertBefore(node, usage ?? bar?.nextSibling ?? null)
      setHost(node)
    }
    const observer = new MutationObserver(records => {
      if (frame !== 0 || !records.some(({ target }) => target instanceof Element
        && !target.closest('[data-conversation-scroll], .dvw-ssh-chat-host'))) return
      frame = requestAnimationFrame(() => {
        frame = 0
        attach()
      })
    })
    observer.observe(conversationRoot, { childList: true, subtree: true })
    attach()
    return () => {
      observer.disconnect()
      cancelAnimationFrame(frame)
      statusRow?.removeAttribute('data-dvw-ssh-chat-status')
      node.remove()
      setHost(undefined)
    }
  }, [conversationRoot, visible, status?.available])

  useLayoutEffect(() => {
    if (choices === undefined) { setMenuPosition(undefined); return }
    const place = () => {
      const rect = trigger.current?.getBoundingClientRect()
      if (!rect) return
      const root = conversationRoot?.getBoundingClientRect()
      const width = Math.max(240, Math.min(380, (root?.width ?? 440) - 24, innerWidth - 24))
      const position = { left: Math.max(12, Math.min(rect.left, innerWidth - width - 12)), bottom: innerHeight - rect.top + 6, width }
      if (conversationRoot) {
        const styles = getComputedStyle(conversationRoot)
        const variables = [
          '--dsw-alias-bg-layer-1', '--dsw-alias-bg-layer-2', '--dsw-alias-bg-layer-3',
          '--dsw-alias-label-primary', '--dsw-alias-label-secondary', '--dsw-alias-label-tertiary',
          '--dsw-alias-border-l2', '--dsw-alias-border-l3',
          '--dsw-alias-interactive-bg-hover', '--dsw-alias-interactive-bg-active',
          '--dsw-menu-surface-fill', '--dsw-font-family',
        ]
        setMenuPosition({ ...position, ...Object.fromEntries(variables.map(name => [`--dvw-chat${name}`, styles.getPropertyValue(name)])) })
      }
      else setMenuPosition(position)
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [choices, conversationRoot])

  useEffect(() => {
    if (choices === undefined) return
    const close = (event: PointerEvent) => {
      if (!(event.target instanceof Element) || event.target.closest('.dvw-ssh-chat-menu, .dvw-ssh-chat-trigger')) return
      setChoices(undefined)
    }
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [choices])

  if (host === undefined || !visible || !status?.available) return null
  const toggle = async () => {
    if (choices !== undefined) { setChoices(undefined); return }
    setBusy(true)
    setError(undefined)
    try { setChoices(await api<SshConnection[]>('ssh.connections', { sessionId })) }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(false) }
  }
  const choose = async (id: string | null) => {
    setBusy(true)
    setError(undefined)
    try { await onSelect(id); setChoices(undefined) }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(false) }
  }
  return createPortal(<div className="dvw-ssh-chat-target" onKeyDown={event => { if (event.key === 'Escape') setChoices(undefined) }}>
    <button ref={trigger} type="button" className="dvw-ssh-chat-trigger" disabled={busy} aria-expanded={choices !== undefined}
      aria-haspopup="menu" onClick={() => void toggle()} title={status.target?.root ?? '选择 DSH 对话工作区'}>
      <Icon name={status.target ? 'remote' : 'folder'}/>
      <span>选择 SSH</span>
    </button>
    {choices !== undefined && createPortal(<div className="dvw-ssh-chat-menu" role="menu" aria-label="选择 DSH 对话工作区" style={menuPosition}>
      <button type="button" role="menuitem" disabled={busy} onClick={() => void choose(null)}><Icon name="folder"/><span>{localName ?? '本地工作区'}</span><small>本地</small></button>
      {choices.map(choice => <button key={choice.id} type="button" role="menuitem" disabled={busy}
        title={choice.root} onClick={() => void choose(choice.id)}><Icon name="server"/><span>{choice.label}</span><small>{choice.root}</small></button>)}
      <button type="button" role="menuitem" disabled={busy} onClick={() => { setChoices(undefined); onOpenSsh() }}><Icon name="add"/>选择或添加 SSH 主机</button>
    </div>, document.body)}
    {error && <span className="dvw-ssh-chat-error" role="alert">{error}</span>}
  </div>, host)
}
