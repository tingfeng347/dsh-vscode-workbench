import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import type { DebugController, DebugScope, DebugVariable } from './debug.ts'

/** Bottom-panel debugger: toolbar, call stack, scopes, watch expressions and the debug console. */
export function DebugPanel({ controller, sessionId, activePath, onOpenFrame }: {
  controller: DebugController
  sessionId: string
  activePath?: string
  onOpenFrame?(path: string, line?: number): void
}) {
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [watches, setWatches] = useState<string[]>([])
  const [draft, setDraft] = useState('')
  const [input, setInput] = useState('')
  // The controller needs the session before F5: without it the bridge opens on an empty session.
  useEffect(() => { controller.setSession(sessionId) }, [controller, sessionId])
  const running = snapshot.state === 'running' || snapshot.state === 'starting'
  const active = snapshot.activePath ?? activePath
  const startDebug = () => controller.start(sessionId, active ?? '', '')
  const startRun = () => controller.run(sessionId, active ?? '', '')
  const paused = snapshot.state === 'stopped'
  const conditionTarget = snapshot.conditionTarget
  // Prefill with the selected breakpoint's condition, so clearing it is an obvious edit.
  useEffect(() => {
    if (conditionTarget === undefined) { setDraft(''); return }
    const row = (snapshot.breakpoints[conditionTarget.path] ?? []).find(item => item.line === conditionTarget.line)
    setDraft(row?.condition ?? '')
  }, [conditionTarget?.path, conditionTarget?.line])

  const breakpoints = useMemo(() => activePath === undefined ? [] : controller.breakpointsFor(activePath), [controller, activePath, snapshot.breakpoints])

  const toggle = (reference: string) => {
    setExpanded(current => {
      const next = new Set(current)
      if (next.has(reference)) next.delete(reference)
      else { next.add(reference); controller.expand(reference) }
      return next
    })
  }

  const rows = (reference: string, variables: DebugVariable[], depth: number) => variables.map(variable => (
    <div className="dvw-debug-var" key={`${reference}/${variable.name}`} style={{ paddingLeft: 8 + depth * 12 }}>
      <button className="dvw-debug-expand" data-open={variable.reference !== undefined && expanded.has(variable.reference) || undefined} disabled={variable.reference === undefined} onClick={() => variable.reference !== undefined && toggle(variable.reference)}>{variable.reference === undefined ? '' : '▸'}</button>
      <span className="dvw-debug-var-name">{variable.name}</span>
      <span className="dvw-debug-var-value" title={variable.value}>{variable.value}</span>
      <span className="dvw-debug-var-type">{variable.type}</span>
      {variable.reference !== undefined && expanded.has(variable.reference) && rows(variable.reference, snapshot.variables[variable.reference] ?? [], depth + 1)}
    </div>
  ))

  return (
    <div className="dvw-debug">
      <div className="dvw-debug-toolbar">
        <button className="dvw-debug-primary" title="调试当前文件 (F5)" disabled={active === undefined || running || paused} onClick={startDebug}>▶ 调试</button>
        <button className="dvw-debug-primary" title="直接运行当前文件（不调试）" disabled={active === undefined || running || paused} onClick={startRun}>▷ 运行</button>
        <button className="dvw-icon" title="继续 (F5)" disabled={!paused} onClick={() => controller.resume()}>▶</button>
        <button className="dvw-icon" title="暂停 (F6)" disabled={!running} onClick={() => controller.pause()}>❚❚</button>
        <button className="dvw-icon" title="单步跳过 (F10)" disabled={!paused} onClick={() => controller.step('next')}>⤵</button>
        <button className="dvw-icon" title="单步进入 (F11)" disabled={!paused} onClick={() => controller.step('in')}>↳</button>
        <button className="dvw-icon" title="单步跳出 (Shift+F11)" disabled={!paused} onClick={() => controller.step('out')}>↰</button>
        <button className="dvw-icon" title="停止 (Shift+F5)" disabled={running === false && snapshot.state === 'idle'} onClick={() => controller.stop()}>■</button>
        <span className="dvw-debug-state">
          {snapshot.state === 'idle' ? '未开始' : snapshot.state === 'starting' ? '启动中…' : snapshot.state === 'running' ? '运行中' : snapshot.state === 'stopped' ? `已暂停（${snapshot.reason ?? '断点'}）` : '已结束'}
        </span>
        <select className="dvw-debug-select" title="调试适配器（语言）" value={snapshot.adapterId ?? 'node'} onChange={event => controller.setAdapter(event.target.value)}>
          {(snapshot.adapters.length > 0 ? snapshot.adapters : [{ id: 'node', label: 'Node.js（内置 inspector）', languages: [], available: true }]).map(adapter => (
            <option key={adapter.id} value={adapter.id} disabled={!adapter.available}>{adapter.label}{adapter.available ? '' : '（未安装）'}</option>
          ))}
        </select>
        <select className="dvw-debug-select" title="异常断点" value={snapshot.exceptionMode} onChange={event => controller.setExceptionMode(event.target.value as 'none' | 'uncaught' | 'all')}>
          <option value="none">异常：不中断</option>
          <option value="uncaught">异常：未捕获</option>
          <option value="all">异常：全部</option>
        </select>
        <span className="dvw-debug-spacer" />
        <span className="dvw-debug-hint">{activePath === undefined ? '打开一个 JS 文件后按 F5' : `${breakpoints.length} 个断点`}</span>
      </div>
      <div className="dvw-debug-body">
        <section className="dvw-debug-column" aria-label="调用栈">
          <div className="dvw-debug-head">调用栈</div>
          <div className="dvw-debug-list">
            {snapshot.frames.length === 0 && <div className="dvw-debug-empty">未暂停</div>}
            {snapshot.frames.map(frame => (
              <button key={frame.id} className="dvw-debug-frame" data-active={frame.id === snapshot.frameId || undefined} onClick={() => { controller.selectFrame(frame.id); if (frame.path !== undefined) onOpenFrame?.(frame.path, frame.line) }}>
                <span className="dvw-debug-frame-name">{frame.name}</span>
                <span className="dvw-debug-frame-where">{frame.path === undefined ? '' : `${frame.path.split(/[\\/]/).pop()}:${frame.line ?? 1}`}</span>
              </button>
            ))}
          </div>
        </section>
        <section className="dvw-debug-column dvw-debug-vars" aria-label="变量">
          <div className="dvw-debug-head">变量
            <button className="dvw-icon" title="监视表达式" onClick={() => setWatches(current => [...current, ''])}>＋</button>
          </div>
          <div className="dvw-debug-list">
            {watches.map((watch, index) => (
              <div className="dvw-debug-watch" key={index}>
                <input value={watch} placeholder="监视表达式" onChange={event => { const next = [...watches]; next[index] = event.target.value; setWatches(next) }} onKeyDown={event => { if (event.key === 'Enter') controller.evaluate(watch) }} />
                <button className="dvw-icon" onClick={() => setWatches(current => current.filter((_, at) => at !== index))}>×</button>
              </div>
            ))}
            {snapshot.scopes.map((scope: DebugScope) => (
              <div className="dvw-debug-scope" key={scope.reference}>
                <button className="dvw-debug-scope-head" data-open={expanded.has(scope.reference) || undefined} onClick={() => toggle(scope.reference)}>{scope.name}</button>
                {expanded.has(scope.reference) && rows(scope.reference, snapshot.variables[scope.reference] ?? [], 1)}
              </div>
            ))}
            {snapshot.scopes.length === 0 && <div className="dvw-debug-empty">暂停后显示变量</div>}
          </div>
        </section>
        <section className="dvw-debug-column dvw-debug-console" aria-label="调试控制台">
          <div className="dvw-debug-head">调试控制台
            <button className="dvw-icon" title="清空" onClick={() => controller.clearConsole()}>⌫</button>
          </div>
          <div className="dvw-debug-list dvw-debug-log">
            {snapshot.console.map((row, index) => <div key={index} className="dvw-debug-line" data-kind={row.kind}>{row.kind === 'input' ? '› ' : ''}{row.text}</div>)}
          </div>
          <form className="dvw-debug-prompt" onSubmit={event => { event.preventDefault(); controller.evaluate(input); setInput('') }}>
            <input value={input} placeholder={paused ? '输入表达式后回车求值' : '暂停后可求值'} disabled={!paused} onChange={event => setInput(event.target.value)} />
          </form>
        </section>
      </div>
      {snapshot.state === 'idle' && active !== undefined && <div className="dvw-debug-empty">就绪：点击「调试」或按 F5 启动 {active}；
        需要先在你关心的行号上点一下设断点。</div>}
      <div className="dvw-debug-foot">
        <input value={draft} placeholder={conditionTarget === undefined ? '先在行号上设断点，再填条件表达式' : `条件断点：第 ${conditionTarget.line} 行（留空后应用可清除）`} onChange={event => setDraft(event.target.value)} />
        <button disabled={conditionTarget === undefined} onClick={() => { if (conditionTarget !== undefined) controller.setCondition(conditionTarget.path, conditionTarget.line, draft) }}>应用</button>
        <span className="dvw-debug-hint">{sessionId === '' ? '' : `会话 ${sessionId.slice(0, 8)}`}</span>
      </div>
    </div>
  )
}