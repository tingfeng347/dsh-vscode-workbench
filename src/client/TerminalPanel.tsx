import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import { Icon } from './Icon.tsx'
import type { BottomPanelProps } from './service.ts'
import { isTerminalProtocolReply, TerminalWorkspaceController } from './terminal.ts'

function terminalTheme(colorScheme: 'dark' | 'light') { return colorScheme === 'dark' ? { background: '#131417', foreground: '#f1f3f5', cursor: '#c2c6cc', selectionBackground: '#355d94' } : { background: '#ffffff', foreground: '#1d2025', cursor: '#4b515b', selectionBackground: '#add6ff' } }

function XtermView({ workspace, id, colorScheme }: { workspace: TerminalWorkspaceController; id: string; colorScheme: 'dark' | 'light' }) {
  const root = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal>()
  const replaying = useRef(false)
  const replayGuard = useRef<ReturnType<typeof setTimeout>>()
  const [error, setError] = useState<string>()
  useEffect(() => {
    if (root.current === null) return
    const terminal = new Terminal({ convertEol: false, cursorBlink: true, fontFamily: 'ui-monospace,SFMono-Regular,Menlo,Consolas,monospace', fontSize: 13, theme: terminalTheme(colorScheme) })
    terminalRef.current = terminal
    const fit = new FitAddon()
    terminal.loadAddon(fit)
    terminal.open(root.current)
    const connection = workspace.connect(id)
    const output = connection.subscribe(value => {
      if (value.replay) { replaying.current = true; clearTimeout(replayGuard.current) }
      terminal.write(value.data, () => { if (value.replay) replayGuard.current = setTimeout(() => { replaying.current = false }, 250) })
    })
    const input = terminal.onData(data => { if (!replaying.current || !isTerminalProtocolReply(data)) connection.write(data) })
    const resize = terminal.onResize(({ cols, rows }) => connection.resize(cols, rows))
    const observer = new ResizeObserver(() => { try { fit.fit() } catch { /* The panel can be hidden during layout changes. */ } })
    observer.observe(root.current)
    try { fit.fit(); terminal.focus() } catch (exception) { setError(exception instanceof Error ? exception.message : String(exception)) }
    return () => { terminalRef.current = undefined; clearTimeout(replayGuard.current); observer.disconnect(); input.dispose(); resize.dispose(); output(); connection.close(); terminal.dispose() }
  }, [workspace, id])
  useEffect(() => { if (terminalRef.current !== undefined) terminalRef.current.options.theme = terminalTheme(colorScheme) }, [colorScheme])
  return error === undefined ? <div ref={root} className="dvw-terminal-host" /> : <div className="dvw-terminal-error">{error}</div>
}

/** Render interactive terminal tabs in the workbench bottom panel. */
export function TerminalPanel({ sessionId, colorScheme }: BottomPanelProps) {
  const workspaceRef = useRef<{ sessionId: string; value: TerminalWorkspaceController }>()
  if (workspaceRef.current?.sessionId !== sessionId) workspaceRef.current = { sessionId, value: new TerminalWorkspaceController(sessionId) }
  const workspace = workspaceRef.current.value
  const snapshot = useSyncExternalStore(workspace.subscribe.bind(workspace), workspace.getSnapshot.bind(workspace))
  const [active, setActive] = useState<string>()
  const [context, setContext] = useState<{ id: string; x: number; y: number }>()
  const [renaming, setRenaming] = useState<{ id: string; value: string }>()
  const [split, setSplit] = useState<readonly string[]>()
  const [sideWidth, setSideWidth] = useState(220)
  useEffect(() => {
    let cancelled = false
    void workspace.refresh().then(() => { if (!cancelled && workspace.getSnapshot().terminals.length === 0) void workspace.create().then(value => { if (!cancelled) setActive(value.id) }) })
    return () => { cancelled = true }
  }, [workspace])
  useEffect(() => { if (snapshot.terminals.length > 0 && (!active || !snapshot.terminals.some(value => value.id === active))) setActive(snapshot.terminals[0]?.id) }, [snapshot.terminals, active])
  useEffect(() => { const create = () => { void workspace.create().then(value => setActive(value.id)) }; window.addEventListener('dvw-terminal-new', create); return () => window.removeEventListener('dvw-terminal-new', create) }, [workspace])
  useEffect(() => {
    if (context === undefined) return
    const close = () => setContext(undefined)
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') close() }
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', escape)
    return () => { window.removeEventListener('pointerdown', close); window.removeEventListener('keydown', escape) }
  }, [context])
  const closeTerminal = (id: string) => { setContext(undefined); setSplit(current => current?.filter(value => value !== id)); void workspace.close(id) }
  const saveRename = (id: string) => { const title = renaming?.id === id ? renaming.value.trim() : ''; setRenaming(undefined); if (title) void workspace.rename(id, title) }
  const splitTerminal = (first = active) => { if (first === undefined) return; void workspace.create().then(value => { setSplit(current => [...(current?.includes(first) ? current : [first]), value.id]); setActive(value.id) }) }
  const shown = (split ?? (active === undefined ? [] : [active])).filter(id => snapshot.terminals.some(value => value.id === id))
  const selectTerminal = (id: string) => { setActive(id); setSplit(current => current?.includes(id) ? current : [id]) }
  return <div className="dvw-terminal-root">
    <div className="dvw-terminal-main">
      {snapshot.error !== undefined && <div className="dvw-terminal-error">{snapshot.error}</div>}
      <div className="dvw-terminal-panes" data-split={shown.length > 1 || undefined}>{shown.map(id => <XtermView key={id} workspace={workspace} id={id} colorScheme={colorScheme} />)}</div>
    </div>
    <div className="dvw-terminal-resizer" role="separator" aria-label="终端列表宽度" aria-orientation="vertical" onPointerDown={event => {
      if (event.button !== 0) return
      event.preventDefault()
      const startX = event.clientX
      const startWidth = sideWidth
      const move = (next: PointerEvent) => setSideWidth(Math.max(160, Math.min(420, Math.round(startWidth + startX - next.clientX))))
      const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
    }}/>
    <aside className="dvw-terminal-tabs" style={{ width: sideWidth }} aria-label="终端会话">
      <div className="dvw-terminal-list">{snapshot.terminals.map(value => renaming?.id === value.id ? <div key={value.id} className="dvw-terminal-entry" data-active><div className="dvw-terminal-tab"><Icon name="terminal"/><input className="dvw-terminal-rename" value={renaming.value} autoFocus aria-label="终端名称" onChange={event => setRenaming({ id: value.id, value: event.target.value })} onKeyDown={event => { if (event.key === 'Enter') saveRename(value.id); if (event.key === 'Escape') setRenaming(undefined) }} onBlur={() => saveRename(value.id)}/></div></div> : <div key={value.id} className="dvw-terminal-entry" data-active={active === value.id} data-split-member={shown.includes(value.id) || undefined}><button className="dvw-terminal-tab" onClick={() => selectTerminal(value.id)} onContextMenu={event => { event.preventDefault(); selectTerminal(value.id); setContext({ id: value.id, x: event.clientX, y: event.clientY }) }}><Icon name="terminal"/>{value.title}</button><div className="dvw-terminal-entry-actions"><button title="拆分终端" onClick={() => splitTerminal(value.id)}><Icon name="split-horizontal"/></button><button title="终止终端" onClick={() => closeTerminal(value.id)}><Icon name="trash"/></button></div></div>)}</div>
      {context !== undefined && <div className="dvw-terminal-menu" role="menu" style={{ left: context.x, top: context.y }} onPointerDown={event => event.stopPropagation()}><button role="menuitem" onClick={() => { const terminal = snapshot.terminals.find(value => value.id === context.id); setContext(undefined); if (terminal !== undefined) setRenaming({ id: terminal.id, value: terminal.title }) }}>重命名</button><button className="dvw-terminal-menu-danger" role="menuitem" onClick={() => closeTerminal(context.id)}>终止终端</button></div>}
    </aside>
  </div>
}
