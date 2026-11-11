import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Duplex } from 'node:stream'
import type { Context as CordisContext } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'

export interface WorkbenchWebServer {
  register(route: { kind: 'exact' | 'prefix'; path: string; handler(req: IncomingMessage, res: ServerResponse): void | Promise<void> }): () => void
  registerUpgrade(route: { path: string; handler(req: IncomingMessage, socket: Duplex, head: Buffer): void | Promise<void> }): () => void
}
export interface WorkbenchSessions { get(id: string): Session | undefined }
export interface WorkbenchConnection { requestRejection(req: IncomingMessage): 401 | 403 | undefined }
/** Minimal shape of DSH's host directory chooser; only the native capability is usable here. */
export interface DirectoryPickerLike {
  capability(): { kind: string; pick?(signal: AbortSignal): Promise<string | null> }
}
/** Minimal shape of DSH's durable workspace registry. */
export interface WorkspaceRegistryLike {
  create(path: string, title?: string): Promise<{ id: string; path: string; title: string }>
}
export type HostContext = CordisContext & {
  webServer: WorkbenchWebServer
  sessions: WorkbenchSessions
  connection: WorkbenchConnection
  workingDirectory: { get(session: Session): string }
  effect(callback: () => void | (() => void), label?: string): void
}
