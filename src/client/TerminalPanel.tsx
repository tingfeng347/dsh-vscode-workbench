import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import { Icon } from './Icon.tsx'
import type { BottomPanelProps } from './service.ts'
import { terminalIssue, type TerminalWorkspaceController } from './terminal.ts'

// VS Code Light+ ANSI palette: the default xterm colors (e.g. yellow #e5e510) vanish on a light background.
const LIGHT_ANSI = { black: '#000000', red: '#cd3131', green: '#107c10', yellow: '#949800', blue: '#0451a5', magenta: '#bc05bc', cyan: '#0598bc', white: '#555555', brightBlack: '#666666', brightRed: '#cd3131', brightGreen: '#14ce14', brightYellow: '#b5ba00', brightBlue: '#0451a5', brightMagenta: '#bc05bc', brightCyan: '#0598bc', brightWhite: '#a5a5a5' }
function terminalTheme(colorScheme: 'dark' | 'light' | 'white' | 'eyecare') { return colorScheme === 'dark' ? { background: '#191a1b', foreground: '#bfbfbf', cursor: '#bfbfbf', selectionBackground: '#264f78' } : { background: '#ffffff', foreground: '#1d2025', cursor: '#4b515b', selectionBackground: '#add6ff', ...LIGHT_ANSI } }

function XtermView({ workspace, id, colorScheme }: { workspace: TerminalWorkspaceController; id: string; colorScheme: BottomPanelProps['colorScheme'] }) {
  const model = workspace.view(id)
  const state = useSyncExternalStore(model.state.subscribe, model.state.getSnapshot)
  const root = useRef<HTMLDivElement>(null)
  const screen = useRef<Terminal>()
  const fit = useRef<FitAddon>()
  const revision = useRef(0)
  const current = useRef(state)
  current.current = state
  const measure = () => {
    const node = root.current
    const dimensions = fit.current?.proposeDimensions()
    if (!node?.clientWidth || !node.clientHeight || !current.current.writable || dimensions === undefined) return
    const cols = Math.min(dimensions.cols, current.current.environment?.maxCols ?? 500)
    const rows = Math.min(dimensions.rows, current.current.environment?.maxRows ?? 200)
    if (cols < 2 || rows < 1) return
    screen.current?.resize(cols, rows)
    model.resize(cols, rows)
  }
  useLayoutEffect(() => {
    if (root.current === null) return
    const terminal = new Terminal({ cursorBlink: true, fontFamily: 'ui-monospace,SFMono-Regular,Menlo,Consolas,monospace', fontSize: 13, minimumContrastRatio: 4.5, theme: { ...terminalTheme(colorScheme), background: getComputedStyle(root.current).backgroundColor }, scrollback: 1000 })
    const addon = new FitAddon()
    terminal.loadAddon(addon)
    terminal.open(root.current)
    terminal.textarea?.setAttribute('aria-label', '终端输入')
    screen.current = terminal; fit.current = addon; revision.current = 0
    const input = terminal.onData(data => model.write(data))
    const observer = new ResizeObserver(measure)
    observer.observe(root.current)
    return () => { observer.disconnect(); input.dispose(); terminal.dispose(); screen.current = undefined; fit.current = undefined }
  }, [model])
  useEffect(() => model.mount(), [model])
  useLayoutEffect(() => {
    const terminal = screen.current
    const render = state.render
    if (terminal === undefined || render === undefined || render.revision <= revision.current) return
    revision.current = render.revision
    if (render.frame.type === 'snapshot') { terminal.reset(); terminal.resize(render.frame.info.cols, render.frame.info.rows) }
    terminal.write(render.frame.type === 'snapshot' ? render.frame.screen : render.frame.data, () => model.acknowledge(render.revision))
  }, [state.render, model])
  useLayoutEffect(() => {
    if (screen.current === undefined) return
    screen.current.options.disableStdin = !state.writable
    if (state.writable) { measure(); screen.current.focus() }
    else if (state.info !== undefined) screen.current.resize(state.info.cols, state.info.rows)
  }, [state.writable, state.info?.cols, state.info?.rows, model])
  useEffect(() => { if (screen.current !== undefined) screen.current.options.theme = { ...terminalTheme(colorScheme), ...(root.current === null ? {} : { background: getComputedStyle(root.current).backgroundColor }) } }, [colorScheme])
  const error = terminalIssue(state)
  const retry = state.phase === 'failed' || state.phase === 'disconnected'
  const readOnly = state.phase === 'connected' && state.info?.state === 'running' && !state.writable
  const ended = state.info?.state === 'exited'
  return <section className="dvw-terminal-pane">
    {(error || retry || readOnly || ended || state.info === undefined) && <div className="dvw-terminal-notice" role="status">
      <span>{error ?? (ended ? `进程已退出（${state.info?.exitCode ?? '—'}）` : readOnly ? '其他页面正在控制此终端' : retry ? '终端连接已断开' : '正在启动终端…')}</span>
      {(retry || readOnly) && <button onClick={() => state.info === undefined ? void model.refresh() : model.connect()}>{readOnly ? '接管输入' : '重新连接'}</button>}
    </div>}
    <div ref={root} className="dvw-terminal-host"/>
  </section>
}

/** Keep the incumbent terminal layout while using the official process and stream models. */
export function TerminalPanel({ workspace, colorScheme }: BottomPanelProps & { workspace: TerminalWorkspaceController }) {
  const snapshot = useSyncExternalStore(workspace.subscribe, workspace.getSnapshot)
  const closeFailures = useSyncExternalStore(workspace.closeFailures.subscribe, workspace.closeFailures.getSnapshot)
  const [active, setActive] = useState<string>()
  const [context, setContext] = useState<{ id: string; x: number; y: number }>()
  const [renaming, setRenaming] = useState<{ id: string; value: string }>()
  const [split, setSplit] = useState<readonly string[]>()
  const [sideWidth, setSideWidth] = useState(220)
  useEffect(() => {
    let cancelled = false
    void workspace.refresh().then(ready => { if (!cancelled && ready && workspace.getSnapshot().terminals.length === 0) void workspace.create().then(value => { if (!cancelled) setActive(value.id) }).catch(() => undefined) })
    return () => { cancelled = true }
  }, [workspace])
  useEffect(() => { if (snapshot.terminals.length > 0 && (!active || !snapshot.terminals.some(value => value.id === active))) setActive(snapshot.terminals[0]?.id) }, [snapshot.terminals, active])
  useEffect(() => { const create = () => { void workspace.create().then(value => setActive(value.id)).catch(() => undefined) }; window.addEventListener('dvw-terminal-new', create); return () => window.removeEventListener('dvw-terminal-new', create) }, [workspace])
  useEffect(() => {
    if (context === undefined) return
    const close = () => setContext(undefined)
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') close() }
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', escape)
    return () => { window.removeEventListener('pointerdown', close); window.removeEventListener('keydown', escape) }
  }, [context])
  const closeTerminal = (id: string) => { setContext(undefined); setSplit(current => current?.filter(value => value !== id)); workspace.close(id) }
  const saveRename = (id: string) => { const title = renaming?.id === id ? renaming.value.trim() : ''; setRenaming(undefined); if (title) void workspace.rename(id, title) }
  const splitTerminal = (first = active) => { if (first === undefined) return; void workspace.create().then(value => { setSplit(current => [...(current?.includes(first) ? current : [first]), value.id]); setActive(value.id) }).catch(() => undefined) }
  const shown = (split ?? (active === undefined ? [] : [active])).filter(id => snapshot.terminals.some(value => value.id === id))
  const selectTerminal = (id: string) => { setActive(id); setSplit(current => current?.includes(id) ? current : [id]) }
  return <div className="dvw-terminal-root">
    <div className="dvw-terminal-main">
      {snapshot.error !== undefined && <div className="dvw-terminal-error">{snapshot.error}</div>}
      {closeFailures.map(failure => <div className="dvw-terminal-notice" role="alert" key={failure.id}><span>终端“{failure.title}”未能关闭：{failure.message}</span><button onClick={() => workspace.retryClose(failure.id)}>重试关闭</button></div>)}
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
