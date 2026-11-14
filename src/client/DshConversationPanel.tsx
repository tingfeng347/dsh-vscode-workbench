import { useCallback, useLayoutEffect, useRef, useState } from 'react'
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
  const fileList = useRef<HTMLDivElement>(null)
  const [fileScroll, setFileScroll] = useState({ left: false, right: false })
  const updateFileScroll = useCallback(() => {
    const list = fileList.current
    if (list === null) return
    const remaining = Math.max(0, list.scrollWidth - list.clientWidth - list.scrollLeft)
    const next = { left: list.scrollLeft > 1, right: remaining > 1 }
    setFileScroll(current => current.left === next.left && current.right === next.right ? current : next)
  }, [])
  const scrollFiles = (direction: -1 | 1) => {
    const list = fileList.current
    if (list === null) return
    const distance = Math.max(120, Math.round(list.clientWidth * 0.75))
    list.scrollLeft = Math.max(0, Math.min(list.scrollWidth - list.clientWidth, list.scrollLeft + direction * distance))
    updateFileScroll()
  }
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
  useLayoutEffect(() => {
    const list = fileList.current
    if (list === null) return
    updateFileScroll()
    list.addEventListener('scroll', updateFileScroll, { passive: true })
    const wheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaX) >= Math.abs(event.deltaY) || list.scrollWidth <= list.clientWidth) return
      event.preventDefault()
      list.scrollLeft += event.deltaY
    }
    list.addEventListener('wheel', wheel, { passive: false })
    const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(updateFileScroll) : undefined
    resize?.observe(list)
    window.addEventListener('resize', updateFileScroll)
    return () => {
      list.removeEventListener('scroll', updateFileScroll)
      list.removeEventListener('wheel', wheel)
      resize?.disconnect()
      window.removeEventListener('resize', updateFileScroll)
    }
  }, [host, props.files, updateFileScroll])
  if (host === undefined) return null
  return createPortal(
    <section className="dvw-review-composer" aria-label="AI 改动审阅" aria-busy={props.disabled}>
      <div className="dvw-review-composer-summary">
        <span className="dvw-review-composer-status" aria-hidden="true"/>
        <div className="dvw-review-composer-heading">
          <strong>AI 改动待审阅</strong>
          <span>{props.files.length} 个文件 · {props.count} 处改动</span>
        </div>
        <div className="dvw-review-composer-actions">
          <button type="button" data-action="reject" disabled={props.disabled} onClick={props.onRejectAll}>全部拒绝</button>
          <button type="button" data-action="accept" disabled={props.disabled} onClick={props.onAcceptAll}>全部接受</button>
        </div>
      </div>
      <div className="dvw-review-composer-file-strip" data-scroll-left={fileScroll.left || undefined} data-scroll-right={fileScroll.right || undefined}>
        {fileScroll.left && <button type="button" className="dvw-review-composer-scroll" data-direction="previous" aria-label="查看前面的待审阅文件" onClick={() => scrollFiles(-1)}>‹</button>}
        <div
          ref={fileList}
          className="dvw-review-composer-files"
          aria-label="待审阅文件"
          tabIndex={fileScroll.left || fileScroll.right ? 0 : undefined}
          onKeyDown={event => {
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
            event.preventDefault()
            scrollFiles(event.key === 'ArrowLeft' ? -1 : 1)
          }}
        >
          {props.files.map(file => <button type="button" key={file.path} title={file.path} onClick={() => props.onOpen(file.path)}>
            <span>{file.path}</span><b>{file.count}</b>
          </button>)}
        </div>
        {fileScroll.right && <button type="button" className="dvw-review-composer-scroll" data-direction="next" aria-label="查看后面的待审阅文件" onClick={() => scrollFiles(1)}>›</button>}
      </div>
    </section>,
    host,
  )
}
