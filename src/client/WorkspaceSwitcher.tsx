import { useEffect, useState } from 'react'
import { Icon } from './Icon.tsx'
import type { WorkspaceChoice } from './dshNavigation.ts'

/** Centered switcher: existing workspaces, their sessions, and a new-workspace action. */
export function WorkspaceSwitcher({ choices, activeSessionId, unavailable, busy, error, onCreate, onSwitch, onOpenWorkspace, onClose }: {
  choices: WorkspaceChoice[]
  activeSessionId?: string
  unavailable: boolean
  busy: boolean
  error?: string
  onCreate(): void
  onSwitch(sessionId: string): void
  onOpenWorkspace(workspaceId: string): void
  onClose(): void
}) {
  const current = choices.find(workspace => workspace.sessions.some(session => session.id === activeSessionId))?.id
  const [expanded, setExpanded] = useState<string | undefined>(current ?? choices[0]?.id)
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', escape)
    return () => window.removeEventListener('keydown', escape)
  }, [onClose])
  return <div className="dvw-confirm-backdrop" role="presentation" onMouseDown={onClose}>
    <section className="dvw-workspace-switcher" role="dialog" aria-modal="true" aria-label="打开工作区" onMouseDown={event => event.stopPropagation()}>
      <header><h2>打开工作区</h2><button className="dvw-icon" title="关闭" onClick={onClose}><Icon name="close"/></button></header>
      <div className="dvw-workspace-list">
        {unavailable ? <p className="dvw-workspace-empty">无法读取 DSH 的工作区列表，请重启 DSH 后再试。</p>
          : choices.length === 0 ? <p className="dvw-workspace-empty">还没有工作区，先新建一个。</p>
          : choices.map(workspace => <div className="dvw-workspace-group" key={workspace.id}>
            <div className="dvw-workspace-row" data-expanded={expanded === workspace.id}>
              <button className="dvw-workspace-toggle" aria-expanded={expanded === workspace.id} onClick={() => setExpanded(value => value === workspace.id ? undefined : workspace.id)}>
                <Icon name="folder-opened"/>
                <span className="dvw-workspace-title">{workspace.title}</span>
                <span className="dvw-workspace-path">{workspace.path}</span>
                <Icon name={expanded === workspace.id ? 'chevron-down' : 'chevron-right'}/>
              </button>
              <button className="dvw-icon dvw-workspace-enter" title="进入此工作区" onClick={() => onOpenWorkspace(workspace.id)}><Icon name="arrow-right"/></button>
            </div>
            {expanded === workspace.id && <div className="dvw-workspace-sessions">
              {workspace.sessions.length === 0 ? <p className="dvw-workspace-empty">此工作区还没有会话</p> : workspace.sessions.map(session => <button key={session.id} className="dvw-workspace-session" data-active={session.id === activeSessionId} onClick={() => onSwitch(session.id)}>
                <Icon name="comment-discussion"/>
                <span className="dvw-workspace-session-title">{session.title}</span>
                {session.id === activeSessionId && <span className="dvw-workspace-current">当前</span>}
              </button>)}
            </div>}
          </div>)}
      </div>
      {error !== undefined && <p className="dvw-workspace-error">{error}</p>}
      <footer><button className="dvw-primary-button" disabled={busy} onClick={onCreate}>{busy ? '正在打开…' : '新建工作区…'}</button><button onClick={onClose}>取消</button></footer>
    </section>
  </div>
}
