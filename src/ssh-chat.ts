import { posix } from 'node:path'
import type { Session } from '@deepseek-ai/dsh-session'
import type { FileEntry, SshConnection } from './types.ts'
import { getLiveSshConnection, remoteRelativePath, sshExecute, sshListFiles, sshReadDocument, sshSaveDocument, sshUploadFile } from './ssh.ts'
import { stringField, WorkbenchError } from './wire.ts'

type Agent = { session: Session }
type Execution = { agent?: Agent; name: string; callId: string; signal: AbortSignal }
type Tool = {
  name: string
  description: string
  parameters: Record<string, unknown>
  output: { schema: Record<string, unknown>; render(args: unknown, value: string): { type: 'text'; text: string }[] }
  execute(args: unknown, execution: Execution): Promise<string>
}

interface ChatServices {
  tools: {
    register(tool: Tool, options: { when(context: { agent: Agent }): boolean }): () => void
    guard(check: (execution: Execution) => string | undefined): () => void
  }
  agents: { get(sessionId: string): { status: string } | undefined }
  sandboxPolicy: {
    resolve(options: { session: Session }): { mode: string } | Promise<{ mode: string }>
  }
  fileReferences: {
    list(agent: Agent, query: string, signal: AbortSignal): Promise<Array<Pick<FileEntry, 'path' | 'kind'>>>
  }
}

const TOOL = 'ssh_workspace'
const REMOTE_TOOLS = new Set([TOOL, 'todo_write', 'run_code'])
const TEXT_LIMIT = 32_000

/** The local DSH session chooses one SSH workspace. The model cannot choose a host. */
export class SshChat {
  private readonly bindings = new Map<string, Pick<SshConnection, 'id' | 'label' | 'root'>>()
  private services?: ChatServices

  status(sessionId: string) {
    const target = this.bindings.get(sessionId)
    let connected = false
    if (target !== undefined) {
      try { getLiveSshConnection(sessionId, target.id); connected = true } catch { /* Keep a disconnected session pinned until the user chooses another target. */ }
    }
    return { available: this.services !== undefined, target, connected }
  }

  select(sessionId: string, connectionId: string | null) {
    if (!this.services) throw new WorkbenchError('ssh-chat-unavailable', '当前 DSH 没有提供 SSH 对话工具所需的接口。', 503)
    if ((this.bindings.get(sessionId)?.id ?? null) === connectionId) return this.status(sessionId)
    if (this.services.agents.get(sessionId)?.status === 'running') {
      throw new WorkbenchError('ssh-chat-busy', '请等待当前回复结束后再切换 DSH 工作区。', 409)
    }
    if (connectionId === null) this.bindings.delete(sessionId)
    else {
      const { id, label, root } = getLiveSshConnection(sessionId, connectionId)
      this.bindings.set(sessionId, { id, label, root })
    }
    return this.status(sessionId)
  }

  install(services: ChatServices): () => void {
    const originalList = services.fileReferences.list
    const list: ChatServices['fileReferences']['list'] = async (agent, query, signal) => {
      const target = this.bindings.get(agent.session.id)
      if (target === undefined) return originalList.call(services.fileReferences, agent, query, signal)
      const path = this.relativePath(target.root, query)
      const directory = query.endsWith('/') ? path : posix.dirname(path)
      const fragment = query.endsWith('/') || path === '' ? '' : posix.basename(path).toLowerCase()
      const entries = await sshListFiles(agent.session.id, target.id, directory === '.' ? '' : directory, signal)
      return entries.filter(entry => entry.name.toLowerCase().startsWith(fragment)).slice(0, 100)
        .map(({ path, kind }) => ({ path, kind }))
    }
    const removeTool = services.tools.register({
      name: TOOL,
      description: 'Operate on the SSH server explicitly selected by the user for this DSH session. Use list, read, create and save for workspace files. Use exec for remote shell commands such as system inspection, tests, builds and development tools. Commands start in the SSH workspace and follow the DSH session permission mode. Call where to see the current host and root. Read existing files to obtain a revision before saving.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          action: { type: 'string', enum: ['where', 'list', 'read', 'create', 'save', 'exec'] },
          path: { type: 'string', description: 'Remote workspace-relative path. Use an empty path to list the root.' },
          startLine: { type: 'integer', minimum: 1 },
          endLine: { type: 'integer', minimum: 1 },
          content: { type: 'string', description: 'Complete UTF-8 file contents for create or save.' },
          revision: { type: 'string', description: 'Revision returned by read. Required when saving an existing file.' },
          command: { type: 'string', description: 'Remote shell command for exec. Runs from the selected SSH workspace.' },
          timeoutSeconds: { type: 'integer', minimum: 1, maximum: 120, description: 'Optional command timeout, up to 120 seconds.' },
        },
        required: ['action'],
      },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      execute: (args, execution) => this.execute(args, execution, services),
    }, { when: ({ agent }) => this.bindings.has(agent.session.id) })
    const removeGuard = services.tools.guard(execution => {
      if (execution.agent && this.bindings.has(execution.agent.session.id) && !REMOTE_TOOLS.has(execution.name)) {
        return 'This session targets SSH. Use ssh_workspace for remote files and exec for remote commands, or disconnect the SSH chat target to use local tools.'
      }
      return undefined
    })
    services.fileReferences.list = list
    this.services = services
    return () => {
      this.services = undefined
      this.bindings.clear()
      if (services.fileReferences.list === list) services.fileReferences.list = originalList
      removeGuard()
      removeTool()
    }
  }

  private relativePath(root: string, path: string): string {
    const prefix = root.replace(/\/$/, '') + '/'
    if (path === root) return ''
    return remoteRelativePath(path.startsWith(prefix) ? path.slice(prefix.length) : path)
  }

  private async execute(input: unknown, execution: Execution, services: ChatServices): Promise<string> {
    const agent = execution.agent
    if (!agent) throw new WorkbenchError('ssh-chat-session', 'SSH tools require a DSH session.')
    const sessionId = agent.session.id
    const target = this.bindings.get(sessionId)
    if (!target) throw new WorkbenchError('ssh-chat-target', 'Select an SSH workspace for this DSH session first.')
    const { signal } = execution
    getLiveSshConnection(sessionId, target.id)
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new WorkbenchError('bad-request', 'Expected tool arguments.')
    const args = input as Record<string, unknown>
    const action = stringField(args, 'action')
    const path = this.relativePath(target.root, args.path === undefined && ['list', 'where', 'exec'].includes(action) ? '' : stringField(args, 'path'))
    if (action === 'where') return `SSH workspace: ${target.label}\nRoot: ${target.root}`
    if (action === 'exec') {
      const command = stringField(args, 'command')
      if (Buffer.byteLength(command) > 16_000) throw new WorkbenchError('bad-request', 'The remote command is too long.')
      const timeoutSeconds = args.timeoutSeconds ?? 30
      if (typeof timeoutSeconds !== 'number' || !Number.isInteger(timeoutSeconds) || timeoutSeconds < 1 || timeoutSeconds > 120) {
        throw new WorkbenchError('bad-request', 'The command timeout must be between 1 and 120 seconds.')
      }
      const { mode } = await services.sandboxPolicy.resolve({ session: agent.session })
      if (mode !== 'workspace-write' && mode !== 'danger-full-access') {
        throw new WorkbenchError('ssh-chat-read-only', 'Remote command execution requires workspace-write or full access. Read-only mode can still list and read workspace files.')
      }
      const result = await sshExecute(sessionId, target.id, command, signal, timeoutSeconds * 1000)
      const output = [`Command: ${command}`, `Exit code: ${result.code}`, result.stdout.trim(), result.stderr.trim() ? `stderr:\n${result.stderr.trim()}` : ''].filter(Boolean).join('\n')
      return output.length > TEXT_LIMIT ? output.slice(0, TEXT_LIMIT) + '\n[Output truncated.]' : output
    }
    if (action === 'list') {
      const entries = await sshListFiles(sessionId, target.id, path, signal)
      const result = entries.map(entry => entry.path + (entry.kind === 'directory' ? '/' : '')).join('\n')
      return result.length > TEXT_LIMIT ? result.slice(0, TEXT_LIMIT) + '\n[Output truncated.]' : result || '(empty directory)'
    }
    if (action === 'read') {
      const file = await sshReadDocument(sessionId, target.id, path, signal)
      if (file.binary || file.tooLarge) throw new WorkbenchError('ssh-chat-text', 'The file is binary or exceeds the text editor limit.')
      const start = args.startLine ?? 1
      const end = args.endLine ?? Number.MAX_SAFE_INTEGER
      if (typeof start !== 'number' || typeof end !== 'number' || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end < start) {
        throw new WorkbenchError('bad-request', 'Invalid line range.')
      }
      const lines = file.content.split('\n')
      const content = lines.slice(start - 1, end).join('\n')
      return `${path}\nRevision: ${file.revision}\nLines: ${start}–${Math.min(end, lines.length)} of ${lines.length}\n${content.slice(0, TEXT_LIMIT)}${content.length > TEXT_LIMIT ? '\n[Output truncated. Request a smaller line range.]' : ''}`
    }
    if (action !== 'create' && action !== 'save') throw new WorkbenchError('bad-request', 'Unknown SSH workspace action.')
    if (path === '') throw new WorkbenchError('bad-request', 'A file path is required.')
    const content = stringField(args, 'content')
    const revision = action === 'save' ? stringField(args, 'revision') : ''
    if (Buffer.byteLength(content) > 5 * 1024 * 1024) throw new WorkbenchError('too-large', 'The file exceeds the text editor limit.')
    const { mode } = await services.sandboxPolicy.resolve({ session: agent.session })
    signal.throwIfAborted()
    if (mode !== 'workspace-write' && mode !== 'danger-full-access') {
      throw new WorkbenchError('ssh-chat-read-only', 'This DSH session does not allow writes.')
    }
    if (this.bindings.get(sessionId) !== target) throw new WorkbenchError('ssh-chat-target', 'The SSH target changed before this write.')
    if (action === 'create') {
      await sshUploadFile(sessionId, target.id, posix.dirname(path), posix.basename(path), Buffer.from(content), signal)
    } else {
      await sshSaveDocument(sessionId, target.id, path, content, revision, signal)
    }
    return `Saved ${path} on ${target.label}`
  }
}

export type { ChatServices }
