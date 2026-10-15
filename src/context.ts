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
export type HostContext = CordisContext & {
  webServer: WorkbenchWebServer
  sessions: WorkbenchSessions
  connection: WorkbenchConnection
  workingDirectory: { get(session: Session): string }
  effect(callback: () => void | (() => void), label?: string): void
}
