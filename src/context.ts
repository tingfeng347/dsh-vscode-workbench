import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Duplex } from 'node:stream'
import type { Context as CordisContext } from '@deepseek-ai/cordis'

export interface WorkbenchWebServer {
  register(route: { kind: 'exact' | 'prefix'; path: string; handler(req: IncomingMessage, res: ServerResponse): void | Promise<void> }): () => void
  registerUpgrade(route: { path: string; handler(req: IncomingMessage, socket: Duplex, head: Buffer): void | Promise<void> }): () => void
}
export interface WorkbenchSessions { get(id: string): { header: { cwd?: string } } | undefined }
export interface WorkbenchWebRuntime { trustedHosts: readonly string[] }
export type HostContext = CordisContext & {
  webServer: WorkbenchWebServer
  sessions: WorkbenchSessions
  webRuntime: WorkbenchWebRuntime
  effect(callback: () => void | (() => void), label?: string): void
}
