import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import type { GitChange } from '../types.ts'
import { Icon } from './Icon.tsx'

export interface ScmCommand {
  label: string
  run?: () => void
  children?: ScmCommand[]
  disabled?: boolean
  divider?: boolean
}

export function ScmMenu({ commands }: { commands: ScmCommand[] }) {
  const [open, setOpen] = useState(false)
  const [group, setGroup] = useState('')
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const sub = useRef<HTMLDivElement>(null)
  const parent = useRef<HTMLButtonElement | null>(null)
  const activeGroup = commands.find(item => item.label === group)
  function close() {
    setOpen(false)
    trigger.current?.focus()
  }
  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [open])
  useLayoutEffect(() => {
    const list = group ? sub.current : menu.current
    const anchor = group ? parent.current : trigger.current
    if (!open || !list || !anchor) return
    list.setAttribute('popover', 'manual')
    list.showPopover?.()
    const place = () => {
      const rect = anchor.getBoundingClientRect()
      const x = rect.right + list.offsetWidth <= innerWidth ? rect.right : rect.left - list.offsetWidth
      list.style.left = Math.max(4, Math.min(x, innerWidth - list.offsetWidth - 4)) + 'px'
      list.style.top = Math.max(4, Math.min(group ? rect.top : rect.bottom, innerHeight - list.offsetHeight - 4)) + 'px'
    }
    place()
    if (!group) list.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [open, group])
  function keys(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape' || (event.key === 'ArrowLeft' && group)) {
      event.stopPropagation()
      if (group) { setGroup(''); parent.current?.focus() } else close()
      return
    }
    if (event.key === 'ArrowRight' && (event.target as HTMLElement).getAttribute('aria-haspopup') === 'menu') {
      const button = event.target as HTMLButtonElement
      button.click()
      return
    }
    if (!['ArrowDown','ArrowUp','Home','End'].includes(event.key)) return
    event.preventDefault()
    const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'))
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement)
    buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (i + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus()
  }
  const rows = (items: ScmCommand[]) => items.map(item => <button key={item.label} role="menuitem"
    data-divider={item.divider || undefined} disabled={item.disabled} aria-haspopup={item.children ? 'menu' : undefined}
    aria-expanded={item.children ? group === item.label : undefined}
    onMouseEnter={event => { if (items === commands) { parent.current = event.currentTarget; setGroup(item.children ? item.label : '') } }}
    onClick={event => {
      if (item.children) {
        parent.current = event.currentTarget
        setGroup(item.label)
        requestAnimationFrame(() => sub.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus())
      } else { close(); item.run?.() }
    }}>{item.label}{item.children && <Icon name="chevron-right"/>}</button>)
  return <div className="dvw-scm-menu-anchor" ref={root} onBlur={event => {
    if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) setOpen(false)
  }}>
    <button ref={trigger} className="dvw-icon" title="更多操作" aria-label="更多操作" aria-haspopup="menu" aria-expanded={open} onClick={() => { setGroup(''); setOpen(!open) }}>•••</button>
    {open && <div className="dvw-scm-menu" ref={menu} role="menu" aria-label="更多操作" onKeyDown={keys}>{rows(commands)}</div>}
    {open && activeGroup?.children && <div key={group} className="dvw-scm-menu" ref={sub} role="menu" aria-label={group} onKeyDown={keys}>{rows(activeGroup.children)}</div>}
  </div>
}

interface ChangeFolder { folders: Map<string, ChangeFolder>; files: GitChange[] }

export function ChangeList({ files, tree, sort, renderFile }: { files: GitChange[]; tree: boolean; sort: 'path' | 'name' | 'status'; renderFile(file: GitChange): ReactNode }) {
  const ordered = [...files].sort((a, b) => {
    const key = (file: GitChange) => sort === 'name' ? file.path.split('/').at(-1)! : sort === 'status' ? file.worktree + file.index : file.path
    return key(a).localeCompare(key(b)) || a.path.localeCompare(b.path)
  })
  if (!tree) return <>{ordered.map(renderFile)}</>
  const root: ChangeFolder = { folders: new Map(), files: [] }
  for (const file of ordered) {
    let parent = root
    for (const name of file.path.split('/').slice(0, -1)) {
      if (!parent.folders.has(name)) parent.folders.set(name, { folders: new Map(), files: [] })
      parent = parent.folders.get(name)!
    }
    parent.files.push(file)
  }
  function render(folder: ChangeFolder): ReactNode {
    return <>{Array.from(folder.folders, ([name, child]) =>
      <details className="dvw-change-folder" open key={name}><summary><Icon name="folder"/> {name}</summary>{render(child)}</details>)}{folder.files.map(renderFile)}</>
  }
  return <>{render(root)}</>
}
