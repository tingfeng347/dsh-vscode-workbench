import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import type { SshConnection } from '../../shared/types.ts'
import type { BottomPanelProps } from '../workbench/service.ts'
import { Icon } from '../ui/Icon.tsx'
import { websocketUrl } from '../transport/websocket.ts'

const EVENT = 'dvw-ssh-terminal'
let pendingConnection: SshConnection | undefined

export function requestSshTerminal(connection: SshConnection): void {
  pendingConnection = connection
  window.dispatchEvent(new CustomEvent<SshConnection>(EVENT, { detail: connection }))
}

function terminalTheme(colorScheme: BottomPanelProps['colorScheme']) {
  return colorScheme === 'dark'
    ? { background: '#191a1b', foreground: '#cccccc', cursor: '#cccccc', selectionBackground: '#264f78' }
    : { background: '#ffffff', foreground: '#1d2025', cursor: '#4b515b', selectionBackground: '#add6ff' }
}

export function sshTerminalOpening(label: string): string {
  return `\x1bc\x1b[2m正在连接 ${label}…\x1b[0m\r\n`
}

export function SSHRemoteTerminalPanel({ sessionId, colorScheme, visible }: BottomPanelProps) {
  const [connection, setConnection] = useState<SshConnection | undefined>(pendingConnection)
  const [state, setState] = useState<'idle' | 'connecting' | 'connected' | 'closed'>('idle')
  const [error, setError] = useState<string>()
  const [revision, setRevision] = useState(0)
  const host = useRef<HTMLDivElement>(null)
  const fit = useRef<FitAddon>()
  const terminal = useRef<Terminal>()
  const socket = useRef<WebSocket>()

  useEffect(() => {
    const accept = (event: Event) => {
      setConnection((event as CustomEvent<SshConnection>).detail)
      setRevision(value => value + 1)
      setError(undefined)
    }
    window.addEventListener(EVENT, accept)
    return () => window.removeEventListener(EVENT, accept)
  }, [])

  useLayoutEffect(() => {
    if (host.current === null) return
    const screen = new Terminal({
      cursorBlink: true,
      fontFamily: 'ui-monospace,SFMono-Regular,Menlo,Consolas,monospace',
      fontSize: 13,
      minimumContrastRatio: 4.5,
      scrollback: 5000,
      theme: terminalTheme(colorScheme),
    })
    const addon = new FitAddon()
    screen.loadAddon(addon)
    screen.open(host.current)
    screen.textarea?.setAttribute('aria-label', 'SSH 终端输入')
    terminal.current = screen
    fit.current = addon
    const sendResize = () => {
      if (socket.current?.readyState === WebSocket.OPEN) {
        socket.current.send(JSON.stringify({ type: 'resize', cols: screen.cols, rows: screen.rows }))
      }
    }
    const fitTerminal = () => {
      if (!host.current?.clientWidth || !host.current.clientHeight) return
      addon.fit()
      screen.scrollToBottom()
    }
    let resizeFrame = requestAnimationFrame(fitTerminal)
    const input = screen.onData(data => {
      if (socket.current?.readyState === WebSocket.OPEN) socket.current.send(JSON.stringify({ type: 'input', data }))
    })
    const resized = screen.onResize(sendResize)
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(resizeFrame)
      resizeFrame = requestAnimationFrame(fitTerminal)
    })
    observer.observe(host.current)
    return () => {
      cancelAnimationFrame(resizeFrame)
      observer.disconnect()
      resized.dispose()
      input.dispose()
      socket.current?.close()
      socket.current = undefined
      screen.dispose()
      terminal.current = undefined
      fit.current = undefined
    }
  }, [sessionId, connection?.id, revision])

  useEffect(() => {
    if (!visible || connection === undefined || sessionId === '') {
      if (!visible) setState('idle')
      return
    }
    const screen = terminal.current
    if (screen === undefined) return
    screen.write(sshTerminalOpening(connection.label))
    setState('connecting')
    setError(undefined)
    const dimensions = fit.current?.proposeDimensions()
    const params = new URLSearchParams({
      sessionId,
      connection: connection.id,
      cols: String(dimensions?.cols ?? 80),
      rows: String(dimensions?.rows ?? 24),
    })
    const url = websocketUrl(`/dsh-vscode/ws/ssh?${params.toString()}`)
    if (url === undefined) {
      setState('closed')
      setError('无法确定 SSH 终端地址')
      return
    }
    const ws = new WebSocket(url)
    socket.current = ws
    let opened = false
    let active = true
    ws.onopen = () => {
      if (!active) return
      opened = true
      setState('connected')
      fit.current?.fit()
      screen.scrollToBottom()
      if (socket.current?.readyState === WebSocket.OPEN) {
        socket.current.send(JSON.stringify({ type: 'resize', cols: screen.cols, rows: screen.rows }))
      }
      screen.focus()
    }
    ws.onmessage = event => {
      if (!active) return
      let message: { type?: string; data?: string; message?: string; code?: number }
      try { message = JSON.parse(String(event.data)) } catch { return }
      if (message.type === 'data' && typeof message.data === 'string') {
        screen.write(Uint8Array.from(atob(message.data), char => char.charCodeAt(0)), () => screen.scrollToBottom())
      } else if (message.type === 'error') {
        setError(message.message ?? 'SSH 终端发生错误')
      } else if (message.type === 'exit') {
        screen.write(`\r\n\x1b[2m远程终端已退出（${message.code ?? '—'}）\x1b[0m\r\n`)
        setState('closed')
      }
    }
    ws.onerror = () => { if (active && !opened) setError('SSH 终端连接失败') }
    ws.onclose = () => {
      if (!active) return
      if (socket.current === ws) socket.current = undefined
      if (opened) setState('closed')
    }
    return () => {
      active = false
      if (socket.current === ws) socket.current = undefined
      ws.close()
    }
  }, [visible, sessionId, connection?.id, revision])

  useEffect(() => {
    if (terminal.current !== undefined) terminal.current.options.theme = terminalTheme(colorScheme)
  }, [colorScheme])

  useEffect(() => {
    if (!visible || state !== 'connected') return
    const frame = requestAnimationFrame(() => terminal.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [visible, state])

  if (connection === undefined) {
    return <div className="dvw-ssh-terminal-empty"><Icon name="remote"/><strong>尚未选择 SSH 连接</strong><span>从 SSH 侧栏连接远程主机后打开终端。</span></div>
  }
  return <section className="dvw-ssh-terminal" aria-label={`SSH 终端 ${connection.label}`}>
    <div className="dvw-ssh-terminal-bar">
      <span><Icon name="terminal"/>{connection.label}</span>
      <span>{state === 'connecting' ? '正在连接…' : state === 'connected' ? '已连接' : state === 'closed' ? '已断开' : '等待连接'}</span>
      {(state === 'closed' || error !== undefined) && <button className="dvw-icon" title="重新连接" onClick={() => setRevision(value => value + 1)}><Icon name="refresh"/></button>}
    </div>
    {error && <div className="dvw-terminal-notice"><span>{error}</span><button onClick={() => setRevision(value => value + 1)}>重试</button></div>}
    <div
      ref={host}
      className="dvw-ssh-terminal-host"
      hidden={!visible}
      onPointerDown={() => terminal.current?.focus()}
    />
  </section>
}
