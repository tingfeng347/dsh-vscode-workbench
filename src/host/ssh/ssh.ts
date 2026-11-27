import { createHash, randomUUID } from 'node:crypto'
import { isUtf8 } from 'node:buffer'
import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join, posix, win32 } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import type {
  FileDocument,
  FileEntry,
  GitChange,
  GitCommit,
  GitDiff,
  GitStatus,
  SearchFileEdits,
  SearchMatch,
  SearchReplaceResult,
  SearchRequest,
  SshConnectRequest,
  SshConnection,
  SshHost,
} from '../../shared/types.ts'
import { readSshPassword, sshPasswordAccount, storeSshPassword } from './ssh-password.ts'
import { WorkbenchError } from '../wire.ts'

const TEXT_LIMIT = 5 * 1024 * 1024
const PROCESS_TIMEOUT = 30_000
const SEARCH_LIMIT = 2_000
const SEARCH_OUTPUT_LIMIT = 8 * 1024 * 1024
const SSH_BIN = 'ssh'
const REMOTE_PREVIEW_LIMIT = 100 * 1024 * 1024
const GIT_ONLY_SSH_HOSTS = new Set([
  'bitbucket.org',
  'codeberg.org',
  'gitee.com',
  'github.com',
  'gitlab.com',
  'ssh.github.com',
])

interface Target {
  alias?: string
  hostName: string
  user?: string
  password?: string
  port?: number
  identityFile?: string
}

interface LiveConnection extends SshConnection {
  target: Target
}

interface ProcessResult {
  stdout: string
  stderr: string
  code: number
}

interface SshOutputConsumer {
  reset(): void
  /** True once enough complete records have been collected and the process can stop. */
  write(chunk: string): boolean
  end(): void
}

const connections = new Map<string, LiveConnection>()

function keyFor(sessionId: string, connectionId: string): string {
  return `${sessionId}\0${connectionId}`
}

function nonEmpty(value: unknown, name: string, max = 512): string {
  if (typeof value !== 'string' || value.trim() === '' || value.length > max || value.includes('\0')) {
    throw new WorkbenchError('bad-request', `${name} 无效`)
  }
  return value.trim()
}

function optionalText(value: unknown, name: string, max = 4096): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string' || value.length > max || value.includes('\0')) {
    throw new WorkbenchError('bad-request', `${name} 无效`)
  }
  return value
}

function parsePort(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const port = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new WorkbenchError('bad-request', 'SSH 端口必须在 1 到 65535 之间')
  return port
}

/** Quote one value for a POSIX remote shell. */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/** Build the single remote command argument OpenSSH hands to the login shell. */
export function sshRemoteCommand(script: string): string {
  return `sh -c ${shellQuote(script)}`
}

/** Keep the target options separate and append exactly one remote command. */
export function sshRunArguments(targetArguments: string[], script: string): string[] {
  return [...targetArguments, sshRemoteCommand(script)]
}

/** Accept only paths that stay below the connection's canonical remote root. */
export function remoteRelativePath(raw: string): string {
  if (raw === '' || raw === '.') return ''
  if (raw.includes('\0') || raw.startsWith('/') || /^[A-Za-z]:[\\/]/.test(raw)) {
    throw new WorkbenchError('path-invalid', '远程路径必须是工作区内的相对路径')
  }
  const parts = raw.replace(/\\/g, '/').split('/')
  if (parts.some(part => part === '..')) throw new WorkbenchError('path-outside', '远程路径不能越过工作区', 403)
  return posix.normalize(parts.filter(part => part !== '' && part !== '.').join('/'))
}

function remotePathArg(path: string): string {
  const relative = remoteRelativePath(path)
  return relative === '' ? '.' : `./${relative}`
}

function remotePathGuard(path: string): string[] {
  return [
    'root=$(pwd -P)',
    `p=${shellQuote(remotePathArg(path))}`,
    'command -v realpath >/dev/null 2>&1 || { echo "远程主机缺少 realpath" >&2; exit 25; }',
    'real=$(realpath "$p" 2>/dev/null) || { echo "远程路径不存在" >&2; exit 20; }',
    'case "$real" in "$root"|"${root%/}"/*) ;; *) echo "远程路径指向工作区之外" >&2; exit 22 ;; esac',
  ]
}

function labelFor(target: Target, workspace: string): string {
  const destination = target.user === undefined ? target.hostName : `${target.user}@${target.hostName}`
  return `${target.alias ?? destination}:${workspace || '~'}`
}

/** Known Git hosting endpoints accept Git operations but do not provide a login shell. */
export function isRemoteWorkspaceSshHost(hostName: string): boolean {
  return !GIT_ONLY_SSH_HOSTS.has(hostName.trim().toLowerCase().replace(/\.$/, ''))
}

/** Parse exact Host aliases from ~/.ssh/config without expanding wildcard blocks. */
export function parseSshConfig(source: string): SshHost[] {
  const hosts: SshHost[] = []
  let patterns: string[] = []
  let values: Record<string, string> = {}
  const flush = () => {
    const aliases = patterns.filter(pattern => pattern !== '' && !/[*?!]/.test(pattern) && !pattern.startsWith('!'))
    for (const alias of aliases) {
      const port = values.port === undefined ? undefined : Number(values.port)
      const hostName = values.hostname ?? alias
      if (!isRemoteWorkspaceSshHost(hostName)) continue
      hosts.push({
        alias,
        hostName,
        ...(values.user === undefined ? {} : { user: values.user }),
        ...(Number.isInteger(port) && port! >= 1 && port! <= 65535 ? { port } : {}),
        ...(values.identityfile === undefined ? {} : { identityFile: values.identityfile }),
      })
    }
    patterns = []
    values = {}
  }
  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) continue
    const match = /^([^\s=]+)(?:\s*=\s*|\s+)(.*)$/.exec(trimmed)
    if (match === null) continue
    const key = match[1]!.toLowerCase()
    const value = match[2]!.trim()
    if (key === 'host') {
      flush()
      patterns = value.split(/\s+/).filter(Boolean)
    } else if (key === 'match') {
      flush()
    } else if (patterns.length > 0) {
      values[key] = value
    }
  }
  flush()
  return hosts.sort((left, right) => left.alias.localeCompare(right.alias))
}

export async function listSshHosts(): Promise<{ hosts: SshHost[]; configPath: string }> {
  const configPath = posix.join(homedir().replace(/\\/g, '/'), '.ssh', 'config')
  const source = await readFile(configPath, 'utf8').catch(error => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ''
    throw error
  })
  return { hosts: parseSshConfig(source), configPath }
}

function findConfiguredHost(hosts: SshHost[], alias: string): SshHost | undefined {
  return hosts.find(host => host.alias === alias)
}

function targetFromRequest(request: SshConnectRequest, configured?: SshHost): Target {
  const host = nonEmpty(request.host, 'SSH 主机')
  const user = optionalText(request.user, 'SSH 用户名', 255) ?? configured?.user
  const password = optionalText(request.password, 'SSH 密码', 4096)
  const port = parsePort(request.port) ?? configured?.port
  const identityFile = password !== undefined ? undefined : typeof request.identityFile === 'string' && request.identityFile !== ''
    ? expandLocalHome(request.identityFile)
    : configured?.identityFile === undefined ? undefined : expandLocalHome(configured.identityFile)
  const alias = configured?.alias === host ? host : undefined
  const hostName = configured?.hostName ?? host
  if (!isRemoteWorkspaceSshHost(hostName)) {
    throw new WorkbenchError(
      'ssh-not-workspace',
      `${hostName} 是 Git SSH 端点，不提供远程开发所需的登录 shell。请选择可登录的 SSH 服务器。`,
      422,
    )
  }
  return {
    ...(alias === undefined ? {} : { alias }),
    hostName,
    ...(user === undefined ? {} : { user }),
    ...(password === undefined ? {} : { password }),
    ...(port === undefined ? {} : { port }),
    ...(identityFile === undefined ? {} : { identityFile }),
  }
}

function expandLocalHome(path: string): string {
  if (path === '~') return homedir()
  if (path.startsWith('~/')) return posix.join(homedir().replace(/\\/g, '/'), path.slice(2))
  return path
}

function sshArguments(target: Target, interactive = false): string[] {
  return [
    ...(interactive ? ['-tt'] : []),
    ...(target.password === undefined ? ['-o', 'BatchMode=yes'] : [
      '-o', 'BatchMode=no',
      '-o', 'PreferredAuthentications=password,keyboard-interactive',
      '-o', 'PubkeyAuthentication=no',
      '-o', 'NumberOfPasswordPrompts=1',
      '-o', 'ControlPath=none',
    ]),
    '-o', 'ConnectTimeout=15',
    '-o', 'ServerAliveInterval=15',
    '-o', 'ServerAliveCountMax=3',
    ...(target.user === undefined ? [] : ['-l', target.user]),
    ...(target.port === undefined ? [] : ['-p', String(target.port)]),
    ...(target.identityFile === undefined ? [] : ['-i', target.identityFile]),
    '--', target.alias ?? target.hostName,
  ]
}

const REMOTE_PREVIEW_TYPES: Record<string, string> = {
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.odt': 'application/vnd.oasis.opendocument.text',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xlsm': 'application/vnd.ms-excel.sheet.macroEnabled.12',
  '.ods': 'application/vnd.oasis.opendocument.spreadsheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.pptm': 'application/vnd.ms-powerpoint.presentation.macroEnabled.12',
  '.odp': 'application/vnd.oasis.opendocument.presentation',
  '.rtf': 'application/rtf',
}

/** Browser MIME type for formats that can be previewed directly or fetched by a client renderer. */
export function remotePreviewType(path: string): string | undefined {
  return REMOTE_PREVIEW_TYPES[posix.extname(path).toLowerCase()]
}

// Win32 OpenSSH launches askpass as an executable. Compile once per host process.
function createWindowsAskpass(directory: string): string {
  const path = join(directory, 'askpass.exe')
  const powerShell = win32.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  const command = `$ErrorActionPreference = 'Stop'
$source = @'
using System;
using System.Text;

public static class Askpass {
  public static int Main(string[] args) {
    if (Environment.GetEnvironmentVariable("SSH_ASKPASS_PROMPT") == "confirm" ||
        args.Length == 0 || args[0].IndexOf("password", StringComparison.OrdinalIgnoreCase) < 0) return 1;
    string password = Environment.GetEnvironmentVariable("DSH_SSH_PASSWORD");
    if (password == null) return 1;
    Console.OutputEncoding = new UTF8Encoding(false);
    Console.WriteLine(password);
    return 0;
  }
}
'@
Add-Type -TypeDefinition $source -OutputAssembly $env:DSH_ASKPASS_OUTPUT -OutputType ConsoleApplication`
  execFileSync(powerShell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command], {
    env: { ...process.env, DSH_ASKPASS_OUTPUT: path },
    stdio: 'ignore',
    timeout: 10_000,
    windowsHide: true,
  })
  return path
}

let askpassPath: string | undefined

/** Build the child-only environment that lets OpenSSH ask for a one-time password without a TTY. */
export function sshEnvironment(target: Target): NodeJS.ProcessEnv {
  if (target.password === undefined) return {}
  if (askpassPath === undefined) {
    const directory = mkdtempSync(join(tmpdir(), 'dsh-vscode-ssh-'))
    try {
      if (process.platform === 'win32') {
        askpassPath = createWindowsAskpass(directory)
      } else {
        const path = join(directory, 'askpass.sh')
        writeFileSync(path, '#!/bin/sh\n[ "$SSH_ASKPASS_PROMPT" != confirm ] || exit 1\ncase "$1" in *[Pp]assword*) printf \'%s\\n\' "$DSH_SSH_PASSWORD" ;; *) exit 1 ;; esac\n', { encoding: 'utf8', mode: 0o700 })
        askpassPath = path
      }
    } catch {
      rmSync(directory, { recursive: true, force: true })
      throw new WorkbenchError('ssh-askpass', '无法初始化 OpenSSH 密码输入程序。', 500)
    }
  }
  return {
    SSH_ASKPASS: askpassPath,
    SSH_ASKPASS_REQUIRE: 'force',
    DSH_SSH_PASSWORD: target.password,
    ...(process.env.DISPLAY === undefined ? { DISPLAY: ':0' } : {}),
  }
}

/** Recognize a Git service rejecting the shell command used to open a remote workspace. */
export function isGitTransportFailure(detail: string): boolean {
  return /invalid command/i.test(detail)
    && /(?:sh -c|git-upload-pack|git-receive-pack|git:\/\/ URL|gitProxy|GIT_PROXY_COMMAND)/i.test(detail)
}

function sshFailure(result: ProcessResult): WorkbenchError {
  const detail = result.stderr.trim() || result.stdout.trim() || `ssh exited with status ${result.code}`
  if (/remote host identification has changed|host key verification failed/i.test(detail)) {
    return new WorkbenchError('ssh-host-key', `主机密钥校验失败。请先核对并更新 ${homedir()}/.ssh/known_hosts。\n${detail}`, 409)
  }
  if (isGitTransportFailure(detail)) {
    return new WorkbenchError('ssh-not-workspace', '该 SSH 目标只接受 Git 操作，不提供远程开发所需的登录 shell。请选择可登录的 SSH 服务器。', 422)
  }
  if (/permission denied|authentication failed|no supported authentication methods/i.test(detail)) {
    return new WorkbenchError('ssh-auth', `SSH 认证失败。请检查登录用户、密码或私钥，以及服务器允许的认证方式。\n${detail}`, 401)
  }
  if (/could not resolve hostname|name or service not known/i.test(detail)) {
    return new WorkbenchError('ssh-host', `无法解析 SSH 主机。\n${detail}`, 502)
  }
  if (/connection refused|connection timed out|operation timed out|network is unreachable/i.test(detail)) {
    return new WorkbenchError('ssh-network', `SSH 网络连接失败。\n${detail}`, 502)
  }
  return new WorkbenchError('ssh-failed', detail, 502)
}

function runSshOnce(target: Target, script: string, options: {
  input?: string | Buffer
  signal?: AbortSignal
  timeout?: number
  maxOutput?: number
  output?: SshOutputConsumer
} = {}): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    options.output?.reset()
    const child = spawn(SSH_BIN, sshRunArguments(sshArguments(target), script), {
      cwd: homedir(),
      shell: false,
      windowsHide: true,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...sshEnvironment(target) },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const limit = options.maxOutput ?? 8 * 1024 * 1024
    let stdout = ''
    let stderr = ''
    let settled = false
    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', abort)
      callback()
    }
    const timer = setTimeout(() => {
      child.kill()
      finish(() => reject(new WorkbenchError('ssh-timeout', `SSH 命令超过 ${Math.round((options.timeout ?? PROCESS_TIMEOUT) / 1000)} 秒未完成`, 504)))
    }, options.timeout ?? PROCESS_TIMEOUT)
    const abort = () => {
      child.kill()
      finish(() => reject(new WorkbenchError('cancelled', 'SSH 命令已取消', 499)))
    }
    if (options.signal?.aborted === true) abort()
    else options.signal?.addEventListener('abort', abort, { once: true })
    child.stdin.on('error', () => undefined)
    child.stdin.end(options.input ?? '')
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      if (settled) return
      if (options.output !== undefined) {
        try {
          if (options.output.write(chunk)) {
            child.kill()
            finish(() => resolve({ stdout: '', stderr, code: 0 }))
          }
        } catch (error) {
          child.kill()
          finish(() => reject(error))
        }
        return
      }
      stdout += chunk
      if (stdout.length > limit) {
        child.kill()
        finish(() => reject(new WorkbenchError('ssh-output-limit', `SSH 命令输出超过 ${Math.round(limit / 1024 / 1024)} MiB`, 413)))
      }
    })
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk })
    child.on('error', error => finish(() => reject(error)))
    child.on('close', code => {
      if (settled) return
      try {
        if (code === 0 || code === 1) options.output?.end()
        finish(() => resolve({ stdout, stderr, code: code ?? 1 }))
      } catch (error) { finish(() => reject(error)) }
    })
  })
}

function transientProcessClose(result: ProcessResult): boolean {
  return /connection closed by|connection reset by peer|broken pipe/i.test(`${result.stderr}\n${result.stdout}`)
}

async function runSsh(target: Target, script: string, options: {
  input?: string | Buffer
  signal?: AbortSignal
  timeout?: number
  maxOutput?: number
  retryRead?: boolean
  output?: SshOutputConsumer
} = {}): Promise<ProcessResult> {
  options.signal?.throwIfAborted()
  const first = await runSshOnce(target, script, options)
  // A dropped transport cannot tell us whether a remote write already ran.
  if (!options.retryRead || first.code !== 255 || !transientProcessClose(first)) return first
  await delay(250, undefined, { signal: options.signal })
  return runSshOnce(target, script, options)
}

function throwRemotePathFailure(result: ProcessResult): never {
  if (result.code === 20) throw new WorkbenchError('not-found', '远程路径不存在', 404)
  if (result.code === 22) throw new WorkbenchError('path-outside', '远程符号链接指向工作区之外', 403)
  if (result.code === 25) throw new WorkbenchError('ssh-realpath-missing', '远程主机缺少 realpath，无法安全校验工作区路径', 409)
  throw sshFailure(result)
}

function connectionFor(sessionId: string, connectionId: string): LiveConnection {
  const connection = connections.get(keyFor(sessionId, connectionId))
  if (connection === undefined) throw new WorkbenchError('ssh-disconnected', 'SSH 连接已断开，请重新连接', 409)
  return connection
}

export function liveSshConnections(sessionId: string): SshConnection[] {
  return [...connections.values()].filter(row => connections.get(keyFor(sessionId, row.id)) === row)
    .map(({ target: _target, ...connection }) => connection)
}

export function getLiveSshConnection(sessionId: string, connectionId: string): LiveConnection {
  return connectionFor(sessionId, connectionId)
}

export function sshDestination(connection: Pick<LiveConnection, 'target'>): string {
  return connection.target.alias ?? connection.target.hostName
}

export function sshTargetArguments(connection: Pick<LiveConnection, 'target'>): string[] {
  return sshArguments(connection.target, true)
}

export async function sshExecute(sessionId: string, connectionId: string, command: string, signal: AbortSignal, timeout = 30_000): Promise<ProcessResult> {
  const connection = connectionFor(sessionId, connectionId)
  const script = `cd -- ${shellQuote(connection.root)} || exit $?\n${command}`
  return runSsh(connection.target, script, { signal, timeout, maxOutput: 512 * 1024 })
}

async function resolveRemoteWorkspace(target: Target, workspace: string): Promise<string> {
  const requestedWorkspace = optionalText(workspace, '远程工作区', 8192)?.trim() || '.'
  const cd = requestedWorkspace === '~'
    ? 'cd -- "$HOME"'
    : requestedWorkspace.startsWith('~/')
      ? `cd -- "$HOME"/${shellQuote(requestedWorkspace.slice(2))}`
      : `cd -- ${shellQuote(requestedWorkspace)}`
  const result = await runSsh(target, `set -eu\n${cd}\npwd -P\n`, { timeout: 20_000, maxOutput: 64 * 1024, retryRead: true })
  if (result.code !== 0) {
    const password = target.password
    if (password !== undefined) {
      result.stdout = result.stdout.split(password).join('•••')
      result.stderr = result.stderr.split(password).join('•••')
    }
    throw sshFailure(result)
  }
  const root = result.stdout.trim().split('\n').at(-1) ?? ''
  if (!root.startsWith('/')) throw new WorkbenchError('ssh-workspace', '远程工作区没有返回绝对路径', 502)
  return root
}

function publicSshConnection(connection: LiveConnection): SshConnection {
  const { target: _target, ...publicConnection } = connection
  return publicConnection
}

export async function connectSsh(sessionId: string, request: SshConnectRequest): Promise<SshConnection> {
  const configured = findConfiguredHost((await listSshHosts()).hosts, request.host)
  let target = targetFromRequest(request, configured)
  const account = sshPasswordAccount(request.host.trim(), target.hostName, target.user, target.port)
  const useSavedPassword = request.useSavedPassword === true && target.password === undefined
  if (useSavedPassword) {
    const password = await readSshPassword(account)
    if (password === undefined) throw new WorkbenchError('ssh-password-unavailable', '无法读取已保存的 SSH 密码，请重新输入。', 409)
    target = targetFromRequest({ ...request, password }, configured)
  }
  const requestedWorkspace = optionalText(request.workspace, '远程工作区', 8192)?.trim() || '.'
  const label = optionalText(request.label, '连接名称', 255)?.trim() || labelFor(target, requestedWorkspace)
  const root = await resolveRemoteWorkspace(target, requestedWorkspace)
  const passwordSaved = useSavedPassword || (request.savePassword === true && target.password !== undefined
    && await storeSshPassword(account, target.password))
  const id = randomUUID()
  const connection: LiveConnection = {
    id,
    label,
    host: request.host.trim(),
    hostName: target.hostName,
    ...(target.user === undefined ? {} : { user: target.user }),
    ...(target.port === undefined ? {} : { port: target.port }),
    ...(target.identityFile === undefined ? {} : { identityFile: target.identityFile }),
    root,
    connectedAt: new Date().toISOString(),
    target,
  }
  connections.set(keyFor(sessionId, id), connection)
  return { ...publicSshConnection(connection), passwordSaved }
}

/** Repoint one live SSH target at a narrower workspace without asking for credentials again. */
export async function switchSshWorkspace(
  sessionId: string,
  connectionId: string,
  workspace: string,
  keepCurrent = false,
): Promise<SshConnection> {
  const current = connectionFor(sessionId, connectionId)
  const root = await resolveRemoteWorkspace(current.target, workspace)
  connectionFor(sessionId, connectionId)
  const next: LiveConnection = {
    ...current,
    id: randomUUID(),
    root,
    connectedAt: new Date().toISOString(),
  }
  connections.set(keyFor(sessionId, next.id), next)
  if (!keepCurrent) connections.delete(keyFor(sessionId, connectionId))
  return publicSshConnection(next)
}

export async function sshStatus(sessionId: string, connectionId: string): Promise<SshConnection> {
  const connection = connectionFor(sessionId, connectionId)
  const result = await runSsh(connection.target, 'true\n', { timeout: 10_000, maxOutput: 16 * 1024, retryRead: true })
  if (result.code !== 0) {
    connections.delete(keyFor(sessionId, connectionId))
    throw sshFailure(result)
  }
  const { target: _target, ...value } = connection
  return value
}

export function disconnectSsh(sessionId: string, connectionId: string): { ok: true } {
  connections.delete(keyFor(sessionId, connectionId))
  return { ok: true }
}

function metaCommand(path: string): string {
  return [
    ...remotePathGuard(path),
    '[ -f "$p" ] || { echo "文件不存在" >&2; exit 20; }',
    'if command -v sha256sum >/dev/null 2>&1; then h=$(sha256sum -- "$p" | awk \'{print $1}\')',
    'elif command -v shasum >/dev/null 2>&1; then h=$(shasum -a 256 -- "$p" | awk \'{print $1}\')',
    'elif command -v openssl >/dev/null 2>&1; then h=$(openssl dgst -sha256 -- "$p" | sed \'s/^.*= //\')',
    'else echo "远程主机缺少 SHA-256 工具" >&2; exit 21; fi',
    's=$(wc -c < "$p" | tr -d " ")',
    'printf "META\\t%s\\t%s\\n" "$s" "$h"',
  ].join('\n')
}

export async function sshReadDocument(
  sessionId: string,
  connectionId: string,
  path: string,
  signal?: AbortSignal,
): Promise<FileDocument> {
  const connection = connectionFor(sessionId, connectionId)
  const relative = remoteRelativePath(path)
  const script = [
    'set -eu',
    `cd -- ${shellQuote(connection.root)}`,
    metaCommand(relative),
    'if [ "$s" -le ' + TEXT_LIMIT + ' ]; then base64 < "$p"; fi',
  ].join('\n')
  const result = await runSsh(connection.target, script, {
    signal,
    retryRead: true,
    maxOutput: Math.ceil(TEXT_LIMIT * 1.5) + 16 * 1024,
  })
  if (result.code === 20) throw new WorkbenchError('not-found', '远程文件不存在', 404)
  if (result.code !== 0) throwRemotePathFailure(result)
  const newline = result.stdout.indexOf('\n')
  if (newline < 0) throw new WorkbenchError('ssh-response', '远程文件元数据无效', 502)
  const [marker, rawSize, hash] = result.stdout.slice(0, newline).split('\t')
  if (marker !== 'META' || rawSize === undefined || hash === undefined || !/^\d+$/.test(rawSize)) {
    throw new WorkbenchError('ssh-response', '远程文件元数据无效', 502)
  }
  const size = Number(rawSize)
  const tooLarge = size > TEXT_LIMIT
  const encoded = result.stdout.slice(newline + 1).replace(/\s+/g, '')
  const bytes = tooLarge || encoded === '' ? Buffer.alloc(0) : Buffer.from(encoded, 'base64')
  const binary = bytes.includes(0)
  if (!tooLarge && !binary && !isUtf8(bytes)) throw new WorkbenchError('encoding', '文件不是 UTF-8 编码，无法编辑或替换', 409)
  return {
    path: relative,
    content: tooLarge || binary ? '' : bytes.toString('utf8'),
    revision: hash,
    size,
    binary,
    tooLarge,
  }
}

export interface SshFilePreview {
  child: ChildProcessWithoutNullStreams
  name: string
  size: number
  type: string
}

async function sshFileMetadata(
  sessionId: string,
  connectionId: string,
  path: string,
  signal?: AbortSignal,
  download = false,
): Promise<{ connection: LiveConnection; relative: string; name: string; size: number; type: string }> {
  const connection = connectionFor(sessionId, connectionId)
  const relative = remoteRelativePath(path)
  const type = download ? 'application/octet-stream' : remotePreviewType(relative)
  if (type === undefined) throw new WorkbenchError('unsupported-media', '远程文件不是支持的预览格式', 415)
  const script = [
    'set -eu',
    `cd -- ${shellQuote(connection.root)}`,
    ...remotePathGuard(relative),
    '[ -f "$p" ] || { echo "文件不存在" >&2; exit 20; }',
    's=$(stat -c %s -- "$p" 2>/dev/null) || s=$(stat -f %z -- "$p" 2>/dev/null) || s=$(wc -c < "$p" | tr -d " ")',
    'printf "PREVIEW\\t%s\\n" "$s"',
  ].join('\n')
  const result = await runSsh(connection.target, script, { signal, maxOutput: 16 * 1024, retryRead: true })
  if (result.code === 20) throw new WorkbenchError('not-found', '远程文件不存在', 404)
  if (result.code !== 0) throwRemotePathFailure(result)
  const [marker, rawSize] = result.stdout.trim().split('\t')
  const size = Number(rawSize)
  if (marker !== 'PREVIEW' || !Number.isSafeInteger(size) || size < 0) {
    throw new WorkbenchError('ssh-response', '远程文件元数据无效', 502)
  }
  if (!download && size > REMOTE_PREVIEW_LIMIT) {
    throw new WorkbenchError('too-large', `远程文件超过 ${REMOTE_PREVIEW_LIMIT / 1024 / 1024} MiB，无法预览`, 413)
  }
  return { connection, relative, name: posix.basename(relative), size, type }
}

/** Start one binary-safe SSH stream after validating the remote path and preview size. */
async function sshOpenFile(
  sessionId: string,
  connectionId: string,
  path: string,
  signal?: AbortSignal,
  download = false,
): Promise<SshFilePreview> {
  const file = await sshFileMetadata(sessionId, connectionId, path, signal, download)
  const script = [
    'set -eu',
    `cd -- ${shellQuote(file.connection.root)}`,
    ...remotePathGuard(file.relative),
    '[ -f "$p" ] || { echo "文件不存在" >&2; exit 20; }',
    'exec cat -- "$p"',
  ].join('\n')
  const child = spawn(SSH_BIN, sshRunArguments(sshArguments(file.connection.target), script), {
    cwd: homedir(),
    shell: false,
    windowsHide: true,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...sshEnvironment(file.connection.target) },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  const abort = () => child.kill()
  if (signal?.aborted === true) abort()
  else signal?.addEventListener('abort', abort, { once: true })
  child.once('close', () => signal?.removeEventListener('abort', abort))
  child.stdin.on('error', () => undefined)
  child.stdin.end()
  return { child, name: file.name, size: file.size, type: file.type }
}

export function sshOpenFilePreview(sessionId: string, connectionId: string, path: string, signal?: AbortSignal): Promise<SshFilePreview> {
  return sshOpenFile(sessionId, connectionId, path, signal)
}

export function sshOpenFileDownload(sessionId: string, connectionId: string, path: string, signal?: AbortSignal): Promise<SshFilePreview> {
  return sshOpenFile(sessionId, connectionId, path, signal, true)
}

/** Read one remote preview file into memory for a converter such as LibreOffice. */
export async function sshReadPreviewFile(
  sessionId: string,
  connectionId: string,
  path: string,
  signal?: AbortSignal,
): Promise<{ data: Buffer; name: string; size: number; type: string }> {
  const opened = await sshOpenFilePreview(sessionId, connectionId, path, signal)
  return await new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let received = 0
    opened.child.stdout.on('data', chunk => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      received += bytes.length
      if (received > REMOTE_PREVIEW_LIMIT) {
        opened.child.kill()
        reject(new WorkbenchError('too-large', `远程文件超过 ${REMOTE_PREVIEW_LIMIT / 1024 / 1024} MiB，无法预览`, 413))
        return
      }
      chunks.push(bytes)
    })
    opened.child.once('error', reject)
    opened.child.once('close', code => {
      if (received > REMOTE_PREVIEW_LIMIT) return
      if (code !== 0) {
        reject(new WorkbenchError('ssh-failed', '读取远程预览文件失败', 502))
        return
      }
      const data = Buffer.concat(chunks)
      resolve({ data, name: opened.name, size: data.length, type: opened.type })
    })
  })
}

export async function sshSaveDocument(
  sessionId: string,
  connectionId: string,
  path: string,
  content: string,
  expectedRevision: string,
  signal?: AbortSignal,
): Promise<FileDocument> {
  const connection = connectionFor(sessionId, connectionId)
  const relative = remoteRelativePath(path)
  const script = [
    'set -eu',
    `cd -- ${shellQuote(connection.root)}`,
    metaCommand(relative),
    `[ "$h" = ${shellQuote(expectedRevision)} ] || { echo "REVISION:$h" >&2; exit 23; }`,
    'destination=$real',
    'd=$(dirname -- "$destination")',
    'tmp=$(mktemp "$d/.dsh-vscode.XXXXXX")',
    'trap \'rm -f "$tmp"\' EXIT HUP INT TERM',
    'if base64 --decode </dev/null >/dev/null 2>&1; then base64 --decode > "$tmp"; else base64 -D > "$tmp"; fi',
    'if m=$(stat -c %a -- "$destination" 2>/dev/null); then chmod "$m" "$tmp"; elif m=$(stat -f %Lp "$destination" 2>/dev/null); then chmod "$m" "$tmp"; fi',
    metaCommand(relative),
    '[ "$real" = "$destination" ] && [ "$h" = ' + shellQuote(expectedRevision) + ' ] || { echo "REVISION:$h" >&2; exit 23; }',
    'mv -f -- "$tmp" "$destination"',
    'trap - EXIT HUP INT TERM',
  ].join('\n')
  const result = await runSsh(connection.target, script, {
    input: Buffer.from(content).toString('base64'),
    signal,
    maxOutput: 64 * 1024,
  })
  if (result.code === 23) throw new WorkbenchError('revision-conflict', '远程文件已在其他位置更改，请重新打开后再保存', 409)
  if (result.code !== 0) throwRemotePathFailure(result)
  return sshReadDocument(sessionId, connectionId, relative, signal)
}

function newRemotePath(directory: string, name: string): string {
  if (name === '' || name === '.' || name === '..' || /[\\/\0]/.test(name)) {
    throw new WorkbenchError('filename-invalid', '远程文件名无效')
  }
  const parent = remoteRelativePath(directory)
  return parent === '' ? name : `${parent}/${name}`
}

function remoteEntryTarget(path: string): string[] {
  const parent = posix.dirname(path)
  return [
    ...remotePathGuard(parent),
    '[ -d "$real" ] || { echo "远程目录不存在" >&2; exit 20; }',
    `dest="$real"/${shellQuote(posix.basename(path))}`,
    'if [ -e "$dest" ] || [ -L "$dest" ]; then echo "目标已存在" >&2; exit 24; fi',
  ]
}

async function changeRemoteEntry(
  sessionId: string, connectionId: string, lines: string[], signal?: AbortSignal, input?: Buffer,
): Promise<void> {
  const connection = connectionFor(sessionId, connectionId)
  const script = ['set -eu', `cd -- ${shellQuote(connection.root)}`, ...lines].join('\n')
  const result = await runSsh(connection.target, script, { signal, input, maxOutput: 16 * 1024 })
  if (result.code === 24) throw new WorkbenchError('target-exists', '远程目标已存在', 409)
  if (result.code !== 0) throwRemotePathFailure(result)
}

export async function sshUploadFile(
  sessionId: string, connectionId: string, directory: string, name: string, content: Buffer, signal?: AbortSignal,
): Promise<FileEntry> {
  const path = newRemotePath(directory, name)
  await changeRemoteEntry(sessionId, connectionId, [
    ...remoteEntryTarget(path),
    'cd -- "$real"',
    'tmp=$(mktemp ./.dvw-upload.XXXXXX)',
    "trap 'rm -f -- \"$tmp\"' EXIT HUP INT TERM",
    'cat > "$tmp"',
    // Linking the complete file ensures that concurrent uploads cannot overwrite each other.
    'if ln --help 2>/dev/null | grep -q -- --no-target-directory; then',
    '  ln -T -- "$tmp" "$dest" 2>/dev/null || { if [ -e "$dest" ] || [ -L "$dest" ]; then exit 24; fi; exit 1; }',
    'else',
    '  ln -h -- "$tmp" "$dest" 2>/dev/null || { if [ -e "$dest" ] || [ -L "$dest" ]; then exit 24; fi; exit 1; }',
    '  if ! [ "$tmp" -ef "$dest" ]; then',
    `    nested="$dest"/${'${tmp##*/}'}`,
    '    if [ "$tmp" -ef "$nested" ]; then rm -- "$nested"; fi',
    '    exit 24',
    '  fi',
    'fi',
  ], signal, content)
  return { name, path, kind: 'file', size: content.length }
}

export async function sshCreateEntry(
  sessionId: string, connectionId: string, path: string, kind: 'file' | 'directory', signal?: AbortSignal,
): Promise<void> {
  const relative = remoteRelativePath(path)
  if (relative === '') throw new WorkbenchError('filename-invalid', '远程文件名无效')
  await changeRemoteEntry(sessionId, connectionId, [
    ...remoteEntryTarget(relative),
    kind === 'directory' ? 'mkdir -- "$dest"' : '(set -C; : > "$dest")',
  ], signal)
}

export async function sshRenameEntry(
  sessionId: string, connectionId: string, path: string, nextPath: string, signal?: AbortSignal,
): Promise<void> {
  const source = remoteRelativePath(path)
  const destination = remoteRelativePath(nextPath)
  if (source === '' || destination === '' || destination.startsWith(`${source}/`)) {
    throw new WorkbenchError('path-invalid', '无法移动远程工作区根目录或把文件夹移到自身内部')
  }
  await changeRemoteEntry(sessionId, connectionId, [
    ...remotePathGuard(source),
    'src="$p"',
    ...remoteEntryTarget(destination),
    'if mv --help 2>/dev/null | grep -q -- --no-target-directory; then mv -nT -- "$src" "$dest"; else mv -nh -- "$src" "$dest"; fi',
    'if [ -e "$src" ] || [ -L "$src" ]; then exit 24; fi',
  ], signal)
}

export async function sshDeleteEntry(sessionId: string, connectionId: string, path: string, signal?: AbortSignal): Promise<void> {
  const relative = remoteRelativePath(path)
  if (relative === '') throw new WorkbenchError('root-delete', '无法删除远程工作区根目录', 403)
  await changeRemoteEntry(sessionId, connectionId, [...remotePathGuard(relative), 'rm -r -- "$p"'], signal)
}

export async function sshListFiles(
  sessionId: string,
  connectionId: string,
  path: string,
  signal?: AbortSignal,
): Promise<FileEntry[]> {
  const connection = connectionFor(sessionId, connectionId)
  const relative = remoteRelativePath(path)
  const script = [
    'set -eu',
    `cd -- ${shellQuote(connection.root)}`,
    ...remotePathGuard(relative),
    'd="$real"',
    '[ -d "$d" ] || { echo "目录不存在" >&2; exit 20; }',
    // GNU find reads directory entry metadata in a single traversal. BSD find
    // has no -printf, so use shell builtins and stat for files there.
    String.raw`if find "$d" -maxdepth 0 -printf '' >/dev/null 2>&1; then
  exec find "$d" -mindepth 1 -maxdepth 1 ! -name .git \( -type d -printf 'd\0\0%f\0' -o -type f -printf 'f\0%s\0%f\0' \)
fi
[ -r "$d" ] && [ -x "$d" ] || { echo "无法读取远程目录" >&2; exit 1; }
for p in "$d"/* "$d"/.[!.]* "$d"/..?*; do
  n=${'${p##*/}'}
  [ "$n" = ".git" ] && continue
  [ -L "$p" ] && continue
  if [ -d "$p" ]; then
    printf 'd\000\000%s\000' "$n"
  elif [ -f "$p" ]; then
    z=$(stat -f %z -- "$p" 2>/dev/null) || z=$(stat -c %s -- "$p" 2>/dev/null) || z=
    printf 'f\000%s\000%s\000' "$z" "$n"
  fi
done`,
  ].join('\n')
  const result = await runSsh(connection.target, script, { signal, maxOutput: 2 * 1024 * 1024, retryRead: true })
  if (result.code === 20) throw new WorkbenchError('not-found', '远程目录不存在', 404)
  if (result.code !== 0) throwRemotePathFailure(result)
  if (result.stdout === '') return []

  const records = result.stdout.split('\0')
  if (records.pop() !== '' || records.length % 3 !== 0) {
    throw new WorkbenchError('ssh-response', '远程目录列表格式无效', 502)
  }
  const entries: FileEntry[] = []
  for (let i = 0; i < records.length; i += 3) {
    const kind = records[i]!
    const size = records[i + 1]!
    const name = records[i + 2]!
    if ((kind !== 'd' && kind !== 'f') || name === '' || (size !== '' && !/^\d+$/.test(size))) {
      throw new WorkbenchError('ssh-response', '远程目录列表格式无效', 502)
    }
    entries.push({
      name,
      path: relative === '' ? name : `${relative}/${name}`,
      kind: kind === 'd' ? 'directory' : 'file',
      ...(size === '' ? {} : { size: Number(size) }),
    })
  }
  return entries.sort((left, right) => left.kind === right.kind ? left.name.localeCompare(right.name) : left.kind === 'directory' ? -1 : 1)
}

function hashSearchLine(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

function searchLineMatches(preview: string, request: SearchRequest): SearchMatch[] {
  const source = request.regex
    ? request.query
    : request.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  let expression: RegExp
  try {
    expression = new RegExp(request.wholeWord ? `(?<!\\w)(?:${source})(?!\\w)` : source, request.caseSensitive ? 'g' : 'gi')
  } catch {
    return []
  }
  const matches: SearchMatch[] = []
  for (let hit = expression.exec(preview); hit !== null; hit = expression.exec(preview)) {
    if (hit[0] === '') {
      if (expression.lastIndex === hit.index) expression.lastIndex++
      if (hit.index >= preview.length) break
    }
    matches.push({ path: '', line: 0, column: hit.index + 1, preview, match: hit[0], lineHash: '' })
    if (matches.length > SEARCH_LIMIT) break
    if (hit[0] === '') continue
  }
  return matches
}

const GREP_FALLBACK_EXCLUDED_DIRS = [
  '.git',
  '.cache',
  '.codex',
  '.local',
  '.npm',
  '.opencode',
  '.vscode-server',
  'autodl-fs',
  'autodl-tmp',
  'miniconda3',
  'miniforge3',
  'anaconda3',
  'node_modules',
  'venv',
  '.venv',
  '__pycache__',
]

function grepFallbackCommand(request: SearchRequest): string {
  // BSD grep uses -Z for decompression; --null is shared with GNU grep.
  const flags = ['-r', '-I', '-n', '-H', '--null']
  if (!request.caseSensitive) flags.push('-i')
  if (request.wholeWord) flags.push('-w')
  flags.push(request.regex ? '-E' : '-F')
  for (const directory of GREP_FALLBACK_EXCLUDED_DIRS) flags.push('--exclude-dir', directory)
  for (const glob of splitGlobs(request.include)) flags.push('--include', glob)
  for (const glob of splitGlobs(request.exclude)) flags.push('--exclude', glob)
  flags.push('-e', request.query, '.')
  const command = ['grep', ...flags].map(shellQuote).join(' ')
  return command
}

/** Keep complete search records, rather than buffering an unbounded workspace scan. */
function searchOutput(request: SearchRequest, format: 'ripgrep' | 'grep') {
  let matches: SearchMatch[] = []
  let limited = false
  let pending = ''
  let retainedBytes = 0
  const append = (path: string, line: number, preview: string, hits: Array<{ column: number; match: string }>) => {
    const lineHash = hashSearchLine(preview)
    const lineBytes = Buffer.byteLength(path) + Buffer.byteLength(preview)
    for (const hit of hits) {
      // Bound the response as well as the record buffer, even for very long matching lines.
      const bytes = lineBytes + Buffer.byteLength(hit.match)
      if (matches.length === SEARCH_LIMIT || retainedBytes + bytes > SEARCH_OUTPUT_LIMIT) {
        limited = true
        return
      }
      retainedBytes += bytes
      matches.push({ path, line, column: hit.column, preview, match: hit.match, lineHash })
    }
  }
  const record = (text: string) => {
    if (format === 'grep') {
      const nul = text.indexOf('\0')
      if (nul < 0) return
      const path = text.slice(0, nul).replace(/^\.\//, '')
      const separator = text.indexOf(':', nul + 1)
      const line = Number(text.slice(nul + 1, separator))
      if (path === '' || separator < 0 || !Number.isSafeInteger(line) || line < 1) return
      const preview = text.slice(separator + 1).replace(/\r$/, '')
      const hits = searchLineMatches(preview, request)
      append(path, line, preview, hits.length === 0 ? [{ column: 1, match: '' }] : hits)
      return
    }
    if (text === '') return
    const event = JSON.parse(text) as {
      type?: string
      data?: {
        path?: { text?: string }
        lines?: { text?: string }
        line_number?: number
        submatches?: Array<{ start: number; end: number; match?: { text?: string } }>
      }
    }
    if (event.type !== 'match' || event.data?.path?.text === undefined || event.data.lines?.text === undefined) return
    const preview = event.data.lines.text.replace(/\r?\n$/, '')
    const bytes = Buffer.from(preview)
    let byteOffset = 0
    let column = 1
    const hits: Array<{ column: number; match: string }> = []
    for (const hit of event.data.submatches ?? []) {
      if (hit.start < bytes.length && (bytes[hit.start]! & 0xc0) === 0x80) continue
      column += bytes.toString('utf8', byteOffset, hit.start).length
      const match = hit.match?.text ?? ''
      hits.push({ column, match })
      if (hits.length > SEARCH_LIMIT) break
      byteOffset = hit.end
      column += match.length
    }
    append(event.data.path.text.replace(/^\.\//, ''), event.data.line_number ?? 1, preview, hits)
  }
  return {
    reset() { matches = []; limited = false; pending = ''; retainedBytes = 0 },
    write(chunk: string) {
      pending += chunk
      while (!limited) {
        // A grep path may itself contain newlines, so find its NUL before the record terminator.
        const start = format === 'grep' ? pending.indexOf('\0') : 0
        if (start < 0) break
        const newline = pending.indexOf('\n', start)
        if (newline < 0) break
        record(pending.slice(0, newline))
        pending = pending.slice(newline + 1)
      }
      if (limited) pending = ''
      if (Buffer.byteLength(pending) > SEARCH_OUTPUT_LIMIT) {
        throw new WorkbenchError('ssh-output-limit', '远程搜索的单条记录超过 8 MiB', 413)
      }
      return limited
    },
    end() {
      if (!limited && pending !== '') record(pending)
      pending = ''
    },
    result() { return { matches, limited } },
  }
}

/** Parse NUL-delimited grep records used when a remote host has no ripgrep. */
export function parseGrepSearchOutput(stdout: string, request: SearchRequest): { matches: SearchMatch[]; limited: boolean } {
  const output = searchOutput(request, 'grep')
  output.write(stdout)
  output.end()
  return output.result()
}

export async function sshSearchWorkspace(
  sessionId: string,
  connectionId: string,
  request: SearchRequest,
  signal?: AbortSignal,
): Promise<{ matches: SearchMatch[]; limited: boolean }> {
  if (request.query === '') return { matches: [], limited: false }
  const connection = connectionFor(sessionId, connectionId)
  if (request.query.length > 64 * 1024 || request.query.includes('\0')) throw new WorkbenchError('bad-request', '搜索表达式无效')
  const flags = ['--crlf']
  if (!request.regex) flags.push('--fixed-strings')
  if (!request.caseSensitive) flags.push('--ignore-case')
  if (request.wholeWord) flags.push('--word-regexp')
  const args = [...flags, '--json', '--hidden', '--max-count', String(SEARCH_LIMIT + 1)]
  for (const glob of splitGlobs(request.include)) args.push('--glob', glob)
  for (const glob of splitGlobs(request.exclude)) args.push('--glob', `!${glob}`)
  args.push('--glob', '!**/.git', '--glob', '!**/.git/**', '--', request.query, '.')
  const command = ['rg', ...args].map(shellQuote).join(' ')
  const script = [
    'set -eu',
    `cd -- ${shellQuote(connection.root)} || exit 20`,
    'command -v rg >/dev/null 2>&1 || { echo "远程主机缺少 ripgrep（rg）" >&2; exit 127; }',
    `exec ${command}`,
  ].join('\n')
  const output = searchOutput(request, 'ripgrep')
  const result = await runSsh(connection.target, script, { signal, output, retryRead: true })
  if (result.code === 127) {
    const grepCommand = grepFallbackCommand(request)
    const fallbackScript = [
      'set -eu',
      `cd -- ${shellQuote(connection.root)} || exit 20`,
      'command -v grep >/dev/null 2>&1 || { echo "远程主机缺少 grep" >&2; exit 127; }',
      `exec sh -c ${shellQuote(grepCommand)}`,
    ].join('\n')
    const fallbackOutput = searchOutput(request, 'grep')
    const fallback = await runSsh(connection.target, fallbackScript, { signal, output: fallbackOutput, retryRead: true })
    if (fallback.code === 127) throw new WorkbenchError('ssh-search-unavailable', '远程主机缺少 ripgrep 和 grep，无法搜索文件', 409)
    if (fallback.code > 1) throw sshFailure(fallback)
    return fallbackOutput.result()
  }
  if (result.code > 1) throw sshFailure(result)
  return output.result()
}

function validSearchEdit(edit: SearchFileEdits['edits'][number]): boolean {
  return edit != null && Number.isSafeInteger(edit.line) && edit.line > 0
    && Number.isSafeInteger(edit.column) && edit.column > 0 && Number.isSafeInteger(edit.length) && edit.length >= 0
    && typeof edit.text === 'string' && typeof edit.lineHash === 'string'
}

export async function sshReplaceSearchResults(
  sessionId: string,
  connectionId: string,
  files: SearchFileEdits[],
  signal?: AbortSignal,
): Promise<SearchReplaceResult> {
  if (!Array.isArray(files) || files.length > 2000 || !files.every(file => file && typeof file.path === 'string'
    && Array.isArray(file.edits) && file.edits.length > 0 && file.edits.every(validSearchEdit))
    || files.reduce((total, file) => total + file.edits.length, 0) > SEARCH_LIMIT
    || new Set(files.map(file => file.path)).size !== files.length) {
    throw new WorkbenchError('bad-request', '替换范围无效')
  }
  const result: SearchReplaceResult = { changed: [], failures: [] }
  for (const file of files) {
    try {
      const document = await sshReadDocument(sessionId, connectionId, file.path, signal)
      if (document.binary || document.tooLarge) throw new Error('只能替换 5 MiB 以内的文本文件')
      const bom = document.content.startsWith('\uFEFF') ? '\uFEFF' : ''
      const lines = document.content.slice(bom.length).split('\n')
      const defaultEol = document.content.match(/\r?\n/)?.[0] ?? '\n'
      const ordered = [...file.edits].sort((left, right) => left.line - right.line || left.column - right.column)
      let currentLine = 0
      let original = ''
      let hash = ''
      let cursor = 0
      let pieces: string[] = []
      const finishLine = () => {
        if (currentLine) lines[currentLine - 1] = pieces.join('') + original.slice(cursor)
      }
      for (const edit of ordered) {
        if (edit.line !== currentLine) {
          finishLine()
          currentLine = edit.line
          const line = lines[currentLine - 1]
          if (line === undefined) throw new Error('匹配行已更改，请重新搜索')
          original = line
          hash = hashSearchLine(currentLine < lines.length ? line.replace(/\r$/, '') : line)
          cursor = 0
          pieces = []
        }
        const start = edit.column - 1
        if (hash !== edit.lineHash || start < cursor || start + edit.length > original.length) {
          throw new Error('匹配行已更改，请重新搜索')
        }
        const eol = currentLine === lines.length ? defaultEol : original.endsWith('\r') ? '\r\n' : '\n'
        pieces.push(original.slice(cursor, start), edit.text.replace(/\r?\n/g, eol))
        cursor = start + edit.length
      }
      finishLine()
      const content = bom + lines.join('\n')
      if (Buffer.byteLength(content) > TEXT_LIMIT) throw new Error('替换后的文件超过 5 MiB')
      if (content !== document.content) {
        await sshSaveDocument(sessionId, connectionId, file.path, content, document.revision, signal)
      }
      result.changed.push(file.path)
    } catch (error) {
      result.failures.push({ path: file.path, message: error instanceof Error ? error.message : String(error) })
    }
  }
  return result
}

async function gitOnSsh(connection: LiveConnection, args: string[], signal?: AbortSignal, input?: string): Promise<ProcessResult> {
  const script = [
    'set -eu',
    `cd -- ${shellQuote(connection.root)}`,
    'git rev-parse --show-toplevel >/dev/null 2>&1 || { echo "当前远程工作区不在 Git 仓库中" >&2; exit 20; }',
    ...(args[0] === 'commit' ? [
      'prefix=$(git rev-parse --show-prefix)',
      'if [ -n "$prefix" ]; then',
      '  git diff --cached --quiet -- ":/" ":(top,exclude,literal)$prefix" || { echo "工作区之外还有已暂存的文件，请从仓库根目录提交" >&2; exit 24; }',
      'fi',
    ] : []),
    `exec git --literal-pathspecs ${args.map(shellQuote).join(' ')}`,
  ].join('\n')
  return runSsh(connection.target, script, { signal, input, retryRead: ['diff', 'show', 'for-each-ref', 'log'].includes(args[0]!), maxOutput: 8 * 1024 * 1024 })
}

function parseGitStatus(output: string, repository: string, prefix: string): GitStatus {
  let branch = 'HEAD'
  let ahead = 0
  let behind = 0
  const changes: GitChange[] = []
  const records = output.split('\0')
  for (let index = 0; index < records.length; index++) {
    const record = records[index]!
    if (record.startsWith('# branch.head ')) branch = record.slice(14)
    else if (record.startsWith('# branch.ab ')) {
      const match = /\+(\d+) -(\d+)/.exec(record)
      ahead = Number(match?.[1] ?? 0)
      behind = Number(match?.[2] ?? 0)
    } else if (record.startsWith('? ')) {
      const path = record.slice(2)
      if (path.startsWith(prefix)) changes.push({ path: path.slice(prefix.length), index: '?', worktree: '?', staged: false, untracked: true })
    } else if (record.startsWith('1 ') || record.startsWith('2 ') || record.startsWith('u ')) {
      const renamed = record.startsWith('2 ')
      const parts = record.split(' ')
      const xy = parts[1] ?? '..'
      const path = parts.slice(renamed ? 9 : record.startsWith('u ') ? 10 : 8).join(' ')
      const original = renamed ? records[++index] : undefined
      if (!path.startsWith(prefix)) continue
      const originalPath = original?.startsWith(prefix) ? original.slice(prefix.length) : undefined
      changes.push({
        path: path.slice(prefix.length),
        ...(originalPath === undefined ? {} : { originalPath }),
        index: xy[0] ?? '.',
        worktree: xy[1] ?? '.',
        staged: xy[0] !== '.',
        untracked: false,
        ...(record.startsWith('u ') ? { conflicted: true } : {}),
      })
    }
  }
  return { repository, branch, ahead, behind, changes }
}

function validGitPath(path: string | undefined): string | undefined {
  if (path === undefined || path === '') return undefined
  if (path.startsWith('/') || path.split('/').includes('..') || path.includes('\0')) {
    throw new WorkbenchError('path-invalid', 'Git 路径必须是工作区内的相对路径')
  }
  return path
}

/** The two Git blob revisions shown by an SSH diff. */
export function sshGitDiffSources(value: string | undefined, path: string): { original: string; modified?: string } {
  return value === 'staged'
    ? { original: `HEAD:${path}`, modified: `:${path}` }
    : { original: `:${path}` }
}

export async function sshGit(
  sessionId: string,
  connectionId: string,
  action: string,
  path?: string,
  value?: string,
  signal?: AbortSignal,
): Promise<unknown> {
  const connection = connectionFor(sessionId, connectionId)
  if (action === 'status') {
    const script = [
      'set -eu',
      `cd -- ${shellQuote(connection.root)}`,
      'repo=$(git rev-parse --show-toplevel 2>/dev/null) || exit 20',
      'prefix=$(git rev-parse --show-prefix)',
      'printf "%s\\0%s\\0" "$repo" "$prefix"',
      'exec git status --porcelain=v2 -z --branch --untracked-files=all -- .',
    ].join('\n')
    const result = await runSsh(connection.target, script, { signal, retryRead: true })
    if (result.code === 20) throw new WorkbenchError('not-repository', '当前远程工作区不在 Git 仓库中', 404)
    if (result.code !== 0) throw sshFailure(result)
    const repoEnd = result.stdout.indexOf('\0')
    const prefixEnd = result.stdout.indexOf('\0', repoEnd + 1)
    if (repoEnd < 0 || prefixEnd < 0) throw new WorkbenchError('ssh-response', '远程 Git 状态格式无效', 502)
    return parseGitStatus(result.stdout.slice(prefixEnd + 1), result.stdout.slice(0, repoEnd), result.stdout.slice(repoEnd + 1, prefixEnd))
  }
  const target = validGitPath(path)
  let args: string[]
  switch (action) {
    case 'diff': {
      if (target === undefined) throw new WorkbenchError('bad-request', '请选择要比较的远程文件')
      if (value === 'untracked') {
        const file = await sshReadDocument(sessionId, connectionId, target, signal)
        if (file.binary || file.tooLarge) return { diff: 'Binary file', original: '', modified: '' } satisfies GitDiff
        const patch = await gitOnSsh(connection, ['diff', '--no-index', '--no-color', '--', '/dev/null', target], signal)
        return { diff: patch.stdout, original: '', modified: file.content } satisfies GitDiff
      }
      const patch = await gitOnSsh(connection, ['diff', '--no-ext-diff', '--no-textconv', '--no-color', ...(value === 'staged' ? ['--cached'] : []), '--', target], signal)
      const sources = sshGitDiffSources(value, `./${target}`)
      const [originalResult, modifiedResult] = await Promise.all([
        gitOnSsh(connection, ['show', sources.original], signal),
        sources.modified === undefined ? Promise.resolve(undefined) : gitOnSsh(connection, ['show', sources.modified], signal),
      ])
      const modified = value === 'staged'
        ? modifiedResult?.code === 0 ? modifiedResult.stdout : ''
        : await sshReadDocument(sessionId, connectionId, target, signal)
          .then(file => file.binary || file.tooLarge ? '' : file.content)
          .catch(error => {
            if (error instanceof WorkbenchError && error.code === 'not-found') return ''
            throw error
          })
      return {
        diff: patch.stdout,
        original: originalResult.code === 0 ? originalResult.stdout : '',
        modified,
      } satisfies GitDiff
    }
    case 'stage': args = ['add', '--', target ?? '']; break
    case 'stage.all': args = ['add', '-A', '--', '.']; break
    case 'unstage': args = ['restore', '--staged', '--', target ?? '']; break
    case 'unstage.all': args = ['restore', '--staged', '--', '.']; break
    case 'discard': args = value === 'untracked' ? ['clean', '-f', '--', target ?? ''] : ['restore', '--worktree', '--', target ?? '']; break
    case 'discard.all': args = ['restore', '--source=HEAD', '--staged', '--worktree', '--', '.']; break
    case 'commit':
      if (value === undefined || value.trim() === '') throw new WorkbenchError('bad-request', '提交消息不能为空')
      args = ['commit', '-m', value]
      break
    case 'push': args = ['push']; break
    case 'pull': args = ['pull', '--ff-only']; break
    case 'fetch': args = ['fetch', '--all']; break
    case 'branch.switch': args = ['switch', '--', value ?? '']; break
    case 'branch.create': args = ['switch', '-c', value ?? '']; break
    case 'branches': args = ['for-each-ref', '--format=%(refname:short)', 'refs/heads']; break
    case 'log': args = ['log', '--topo-order', '--decorate=short', '--format=%H%x1f%P%x1f%an%x1f%aI%x1f%s%x1f%D%x00', '-n', '100']; break
    default: throw new WorkbenchError('bad-request', `不支持远程 Git 操作 ${action}`)
  }
  const result = await gitOnSsh(connection, args, signal)
  if (result.code === 20) throw new WorkbenchError('not-repository', '当前远程工作区不在 Git 仓库中', 404)
  if (result.code !== 0) throw sshFailure(result)
  if (action === 'branches') return result.stdout.split('\n').filter(Boolean)
  if (action === 'log') {
    return result.stdout.split('\0').filter(Boolean).map(record => {
      const [hash = '', parents = '', author = '', date = '', subject = '', refs = ''] = record.split('\x1f')
      return { hash, parents: parents.split(' ').filter(Boolean), author, date, subject, refs: refs.split(',').map(item => item.trim()).filter(Boolean) } satisfies GitCommit
    })
  }
  return sshGit(sessionId, connectionId, 'status', undefined, undefined, signal)
}

function splitGlobs(value = ''): string[] {
  const patterns: string[] = []
  let start = 0
  let depth = 0
  for (let index = 0; index < value.length; index++) {
    const char = value[index]
    if (char === '\\') index++
    else if (char === '{' || char === '[') depth++
    else if (char === '}' || char === ']') depth = Math.max(0, depth - 1)
    else if (char === ',' && depth === 0) {
      patterns.push(value.slice(start, index))
      start = index + 1
    }
  }
  patterns.push(value.slice(start))
  return patterns.map(pattern => pattern.trim()).filter(Boolean)
}
