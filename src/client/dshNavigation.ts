/** Access to DSH's client-side workspace and session stores for the in-workbench switcher. */
export interface WorkspaceChoice {
  id: string
  title: string
  path: string
  sessions: SessionChoice[]
}
export interface SessionChoice {
  id: string
  title: string
  blank: boolean
  active: boolean
}
interface SessionSummary {
  title?: string
  blank?: boolean
  projectionValues?: { title?: string }
}
interface WorkspacesSnapshot {
  items?: readonly { workspaceId: string; title: string; path: string; sessionIds: readonly string[] }[]
  phase?: string
}
interface SessionsSnapshot {
  ids: readonly string[]
  byId: Record<string, SessionSummary>
  phase?: string
}
interface SnapshotStore<T> { getSnapshot(): T }
interface UiWorkspace {
  openSession(id: string): void
  openWorkspace?(id: string, beforeOpen: (nextId: string | undefined) => void, options?: Record<string, unknown>): unknown
}

/** The slice of DSH's client context the switcher needs, read through `ctx.get` like ui-conversation does. */
export interface DshNavigation {
  available: boolean
  choices(activeSessionId?: string): WorkspaceChoice[]
  openSession(id: string): boolean
  openWorkspace(id: string): boolean
}

/** Build display rows from the two snapshot stores, keeping DSH's own workspace and session order. */
export function buildWorkspaceChoices(workspaces: WorkspacesSnapshot | undefined, sessions: SessionsSnapshot | undefined, activeSessionId?: string): WorkspaceChoice[] {
  if (workspaces?.items === undefined || sessions === undefined) return []
  return workspaces.items.map(workspace => ({
    id: workspace.workspaceId,
    title: workspace.title,
    path: workspace.path,
    sessions: workspace.sessionIds.flatMap(id => {
      const summary = sessions.byId[id]
      if (summary === undefined) return []
      return [{ id, title: summary.title ?? summary.projectionValues?.title ?? '未命名会话', blank: summary.blank === true, active: id === activeSessionId }]
    }),
  }))
}

/** Resolve the DSH client services; `get` returns undefined outside the web/desktop client. */
export function createDshNavigation(get: ((name: string) => unknown) | undefined): DshNavigation {
  const look = (name: string): unknown => { try { return get?.(name) } catch { return undefined } }
  const workspaces = () => look('workspaces') as { list?: SnapshotStore<WorkspacesSnapshot> } | undefined
  const sessions = () => look('sessions') as { list?: SnapshotStore<SessionsSnapshot> } | undefined
  const uiWorkspace = () => look('uiWorkspace') as UiWorkspace | undefined
  return {
    get available() { return workspaces()?.list !== undefined && sessions()?.list !== undefined },
    choices(activeSessionId) {
      return buildWorkspaceChoices(workspaces()?.list?.getSnapshot(), sessions()?.list?.getSnapshot(), activeSessionId)
    },
    openSession(id) {
      const navigation = uiWorkspace()
      if (navigation === undefined) return false
      navigation.openSession(id)
      return true
    },
    openWorkspace(id) {
      const navigation = uiWorkspace()
      if (navigation?.openWorkspace === undefined) return false
      void navigation.openWorkspace(id, () => undefined)
      return true
    },
  }
}
