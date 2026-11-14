import { useLayoutEffect, useState } from 'react'
import { createPortal } from 'react-dom'

/** Locate the resident DSH conversation without depending on generated CSS module names. */
export function findDshConversationRoot(documentRoot: Document = document): HTMLElement | null {
  const scroller = documentRoot.querySelector<HTMLElement>('[data-phase] [data-conversation-scroll]')
  const root = scroller?.closest('[data-phase]')
  return root instanceof HTMLElement && root.dataset.phase !== undefined ? root : null
}

/** Keep the official conversation mounted while presenting it in the workbench's right column. */
export function DshConversationPanel({ visible, width, statusHeight }: { visible: boolean; width: number; statusHeight: number }) {
  useLayoutEffect(() => {
    if (!visible) return
    let attached: HTMLElement | null = null
    const attach = () => {
      const next = findDshConversationRoot()
      if (next === attached) return
      attached?.removeAttribute('data-dvw-conversation-panel')
      attached?.style.removeProperty('--dvw-chat-width')
      attached?.style.removeProperty('--dvw-status-height')
      attached = next
      attached?.setAttribute('data-dvw-conversation-panel', '')
      attached?.style.setProperty('--dvw-chat-width', `${width}px`)
      attached?.style.setProperty('--dvw-status-height', `${statusHeight}px`)
    }
    attach()
    document.body.setAttribute('data-dvw-conversation-active', '')
    // Monaco rebuilds its line DOM on every scroll frame; skip workbench-only
    // mutations and coalesce the rest so the document-wide query runs at most once a frame.
    let frame = 0
    const observer = new MutationObserver(records => {
      if (frame !== 0 || records.every(record => record.target instanceof Element && record.target.closest('.dvw-overlay') !== null)) return
      frame = requestAnimationFrame(() => { frame = 0; attach() })
    })
    observer.observe(document.body, { childList: true, subtree: true })
    return () => {
      observer.disconnect()
      cancelAnimationFrame(frame)
      document.body.removeAttribute('data-dvw-conversation-active')
      attached?.removeAttribute('data-dvw-conversation-panel')
      attached?.style.removeProperty('--dvw-chat-width')
      attached?.style.removeProperty('--dvw-status-height')
    }
  }, [visible, width, statusHeight])
  return null
}

/** Temporarily align the official DSH panel palette with a fixed workbench palette. */
export function DshConversationTheme({ visible, colorScheme, followDsh }: { visible: boolean; colorScheme: 'dark' | 'light' | 'white' | 'eyecare'; followDsh: boolean }) {
  useLayoutEffect(() => {
    if (!visible) return
    const body = document.body
    if (followDsh) {
      body.removeAttribute('data-dvw-palette')
      return
    }
    body.setAttribute('data-dvw-palette', colorScheme)
    return () => body.removeAttribute('data-dvw-palette')
  }, [visible, colorScheme, followDsh])
  return null
}

export interface DshReviewFileSummary {
  path: string
  count: number
}

/**
 * Render Trae's project-level review controls immediately above the DSH input.
 * DSH owns the composer DOM, so attach one controlled portal host beside it and
 * keep every interaction in the workbench's React tree.
 */
export function DshReviewActions(props: {
  visible: boolean
  files: DshReviewFileSummary[]
  count: number
  disabled?: boolean
  onOpen(path: string): void
  onAcceptAll(): void
  onRejectAll(): void
}) {
  const [host, setHost] = useState<HTMLElement>()
  useLayoutEffect(() => {
    if (!props.visible || props.files.length === 0) {
      setHost(undefined)
      return
    }
    const node = document.createElement('div')
    node.className = 'dvw-review-composer-host'
    let bar: HTMLElement | null = null
    const attach = () => {
      const next = document.querySelector<HTMLElement>('[data-slot="conversation.composer.bar"]')
      const stack = next?.parentElement
      if (next === null || stack === null || stack === undefined) return
      if (bar !== next || !node.isConnected) {
        stack.insertBefore(node, next)
        bar = next
        setHost(node)
      }
    }
    attach()
    let frame = 0
    const observer = new MutationObserver(() => {
      if (frame !== 0) return
      frame = requestAnimationFrame(() => { frame = 0; attach() })
    })
    observer.observe(document.body, { childList: true, subtree: true })
    return () => {
      observer.disconnect()
      cancelAnimationFrame(frame)
      node.remove()
      setHost(undefined)
    }
  }, [props.visible, props.files.length])
  if (host === undefined) return null
  return createPortal(
    <section className="dvw-review-composer" aria-label="AI 改动审阅">
      <div className="dvw-review-composer-summary">
        <strong>{props.files.length} 个文件</strong>
        <span>{props.count} 处 AI 改动待审阅</span>
      </div>
      <div className="dvw-review-composer-files">
        {props.files.map(file => <button type="button" key={file.path} title={file.path} onClick={() => props.onOpen(file.path)}>
          <span>{file.path}</span><b>{file.count}</b>
        </button>)}
      </div>
      <div className="dvw-review-composer-actions">
        <button type="button" data-action="reject" disabled={props.disabled} onClick={props.onRejectAll}>全部拒绝</button>
        <button type="button" data-action="accept" disabled={props.disabled} onClick={props.onAcceptAll}>全部接受</button>
      </div>
    </section>,
    host,
  )
}
