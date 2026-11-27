/** Host-side registry and process bridge for language servers exposed to the workbench editor. */
import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { isUtf8 } from 'node:buffer'
import { constants } from 'node:fs'
import { access, mkdir, mkdtemp, open, readFile, realpath, rm, stat } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { delimiter, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebSocket } from 'ws'
import { WorkbenchError } from './wire.ts'

/** The toolchain a manual language server belongs to, detected separately from the server itself. */
export type LspLanguage = { name: string; commands: readonly string[] }

export type LspInstall =
  | { kind: 'npm'; package: string; bin: string; dependencies?: string[] }
  | { kind: 'system'; command: string; hint: string }

export interface LspDefinition {
  id: string
  name: string
  /** Monaco language ids this server answers for. */
  languages: string[]
  install: LspInstall
  args: string[]
  /** Toolchain checked before the server; servers for pure data formats have nothing to check. */
  language?: LspLanguage
}

/** Language services offered by the workbench. */
export const LSP_SERVERS: readonly LspDefinition[] = [
  // 6.x raises the minimum Node version above the workbench's supported 22.19.
  { id: 'typescript', name: 'TypeScript / JavaScript', languages: ['typescript', 'javascript'], install: { kind: 'npm', package: 'typescript-language-server@^5.3.0', bin: 'typescript-language-server', dependencies: ['typescript@^6.0.3'] }, args: ['--stdio'] },
  { id: 'python', name: 'Python · Pyright', languages: ['python'], install: { kind: 'npm', package: 'pyright', bin: 'pyright-langserver' }, args: ['--stdio'], language: { name: 'Python', commands: ['python3', 'python'] } },
  // Vue 2.x language tools can serve single-file components without a separate tsserver client.
  { id: 'vue', name: 'Vue · Vue Language Server', languages: ['vue'], install: { kind: 'npm', package: '@vue/language-server@2.2.12', bin: 'vue-language-server', dependencies: ['typescript@~5.7.3', '@vue/compiler-dom@3.5.35', '@vue/shared@3.5.35'] }, args: ['--stdio'] },
  { id: 'cpp', name: 'C / C++ · clangd', languages: ['c', 'cpp', 'objective-c'], install: { kind: 'system', command: 'clangd', hint: '安装 LLVM 并将 clangd 加入 PATH。' }, args: [], language: { name: 'C / C++', commands: ['clang', 'gcc', 'cc', 'cl'] } },
  { id: 'go', name: 'Go · gopls', languages: ['go'], install: { kind: 'system', command: 'gopls', hint: '在终端运行：go install golang.org/x/tools/gopls@latest（需要 Go 工具链）' }, args: ['serve'], language: { name: 'Go', commands: ['go'] } },
  { id: 'rust', name: 'Rust · rust-analyzer', languages: ['rust'], install: { kind: 'system', command: 'rust-analyzer', hint: '运行：rustup component add rust-analyzer' }, args: [], language: { name: 'Rust', commands: ['rustc', 'cargo'] } },
  { id: 'java', name: 'Java · Eclipse JDT LS', languages: ['java'], install: { kind: 'system', command: 'jdtls', hint: '下载 eclipse.jdt.ls 并让 jdtls 启动脚本在 PATH 中' }, args: [], language: { name: 'Java', commands: ['java', 'javac'] } },
] as const

export interface LspStatus {
  id: string
  name: string
  languages: string[]
  installable: boolean
  installed: boolean
  hint?: string
  /** Executable name for manual servers, so the UI can name what it looked for. */
  command?: string
  /** Present for manual servers: whether the language toolchain itself is on this machine. */
  language?: { name: string; installed: boolean }
  pythonPath?: string
}

/** Private install root so language servers never touch the user's global npm state. */
export function lspRoot(): string { return join(homedir(), '.dsh', 'dsh-vscode-workbench', 'lsp') }

async function isExecutable(path: string): Promise<boolean> {
  try {
    if (!(await stat(path)).isFile()) return false
    await access(path, constants.X_OK)
    return true
  } catch { return false }
}

/**
 * GUI-launched apps inherit a trimmed PATH: Homebrew, `go install` and `cargo install` targets routinely sit
 * outside it, so detection has to look in the usual per-user bin directories too.
 */
export function lspSearchDirs(env: NodeJS.ProcessEnv = process.env, home = homedir()): string[] {
  const fromPath = (env.PATH ?? env.Path ?? '').split(delimiter).filter(Boolean)
  const extras = process.platform === 'win32'
    ? [
      join(home, 'go', 'bin'),
      join(home, '.cargo', 'bin'),
      join(home, '.dotnet', 'tools'),
      join(home, 'bin'),
      ...(env.ProgramFiles ? [join(env.ProgramFiles, 'Go', 'bin'), join(env.ProgramFiles, 'LLVM', 'bin')] : []),
    ]
    : [
      join(home, 'go', 'bin'),
      join(home, '.cargo', 'bin'),
      join(home, '.dotnet', 'tools'),
      join(home, '.local', 'bin'),
      join(home, 'bin'),
      '/opt/homebrew/bin',
      '/usr/local/bin',
      '/usr/local/go/bin',
      '/usr/bin',
      '/bin',
      '/usr/sbin',
      '/sbin',
    ]
  const toolchains = [
    env.GOBIN,
    ...(env.GOPATH ?? '').split(delimiter).filter(Boolean).map(path => join(path, 'bin')),
    env.JAVA_HOME ? join(env.JAVA_HOME, 'bin') : undefined,
    env.GOROOT ? join(env.GOROOT, 'bin') : undefined,
    env.CARGO_HOME ? join(env.CARGO_HOME, 'bin') : undefined,
  ].filter((path): path is string => path !== undefined && isAbsolute(path))
  return [...new Set([...fromPath, ...toolchains, ...extras])]
}

async function executableIn(directory: string, command: string): Promise<string | undefined> {
  // Windows has no executable bit: access(X_OK) accepts any file, so only accept real command extensions.
  const names = process.platform === 'win32'
    ? [`${command}.exe`, `${command}.cmd`, `${command}.bat`, `${command}.com`]
    : [command]
  for (const name of names) {
    const file = join(directory, name)
    if (await isExecutable(file)) return file
  }
  return undefined
}

/** First executable named `command` found in `dirs`; exposed for tests and for toolchain probing. */
export async function findExecutable(command: string, dirs: readonly string[]): Promise<string | undefined> {
  for (const directory of dirs) {
    const found = await executableIn(directory, command)
    if (found !== undefined) return found
  }
  return undefined
}

function processEnvironment(dirs: string[]): NodeJS.ProcessEnv {
  const env = { ...process.env }
  // Windows treats Path and PATH as the same key, so pass only one spelling.
  for (const key of Object.keys(env)) if (key.toLowerCase() === 'path') delete env[key]
  return { ...env, PATH: dirs.join(delimiter) }
}

async function rustAnalyzerCommand(dirs: string[], workspace?: string): Promise<string | undefined> {
  const candidate = await findExecutable('rust-analyzer', dirs)
  const rustup = await findExecutable('rustup', dirs)
  if (rustup === undefined || (candidate !== undefined && dirname(candidate) !== dirname(rustup))) return candidate
  if (candidate !== undefined) {
    const [serverFile, rustupFile] = await Promise.all([stat(candidate), stat(rustup)]).catch(() => [])
    // Independently installed binaries must still work next to rustup.
    if (serverFile !== undefined && rustupFile !== undefined && serverFile.ino !== rustupFile.ino && serverFile.size !== rustupFile.size) return candidate
  }

  // A rustup shim can exist without the component and can resolve differently for each project.
  const actual = await new Promise<string | undefined>(done => {
    execFile(rustup, ['which', 'rust-analyzer'], {
      cwd: workspace, env: { ...processEnvironment(dirs), RUSTUP_AUTO_INSTALL: '0' }, timeout: 2500, windowsHide: true,
    }, (error, stdout) => done(error === null ? stdout.trim() : undefined))
  })
  return actual !== undefined && isAbsolute(actual) && await isExecutable(actual) ? actual : undefined
}

function definition(id: string): LspDefinition {
  const found = LSP_SERVERS.find(server => server.id === id)
  if (found === undefined) throw new WorkbenchError('lsp-unknown', `unknown language server: ${id}`, 404)
  return found
}

interface LspCommand { command: string; args: string[]; shell: boolean }

async function commandFor(server: LspDefinition, dirs: string[], workspace?: string): Promise<LspCommand | undefined> {
  if (server.install.kind === 'npm') {
    const specifier = server.install.package
    const version = specifier.lastIndexOf('@')
    const packageName = version > 0 ? specifier.slice(0, version) : specifier
    const directory = join(lspRoot(), server.id, 'node_modules', packageName)
    try {
      const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8')) as { bin?: string | Record<string, string> }
      const entry = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.[server.install.bin]
      if (typeof entry !== 'string') return undefined
      const script = resolve(directory, entry)
      const within = relative(directory, script)
      if (within === '' || isAbsolute(within) || within.split(/[\\/]/)[0] === '..' || !(await stat(script)).isFile()) return undefined
      return { command: process.execPath, args: [script, ...server.args], shell: false }
    } catch { return undefined }
  }
  const command = server.id === 'rust'
    ? await rustAnalyzerCommand(dirs, workspace)
    : await findExecutable(server.install.command, dirs)
  return command === undefined ? undefined : { command, args: server.args, shell: process.platform === 'win32' && /\.(?:bat|cmd)$/i.test(command) }
}

export async function lspStatuses(workspace?: string): Promise<LspStatus[]> {
  const dirs = lspSearchDirs()
  const candidates = workspace === undefined ? [] : ['.venv', 'venv', 'env']
    .map(name => join(workspace, name, process.platform === 'win32' ? 'Scripts' : 'bin'))
  const pythonPath = candidates.length === 0 ? undefined
    : await findExecutable('python', candidates) ?? await findExecutable('python3', candidates)
  return Promise.all(LSP_SERVERS.map(async server => {
    const resolved = await commandFor(server, dirs, workspace)
    const language = server.language === undefined
      ? undefined
      : { name: server.language.name, installed: (server.id === 'python' && pythonPath !== undefined) || (await Promise.all(server.language.commands.map(command => findExecutable(command, dirs)))).some(Boolean) }
    return {
      id: server.id,
      name: server.name,
      languages: server.languages,
      installable: server.install.kind === 'npm',
      installed: resolved !== undefined,
      ...(server.install.kind === 'system' ? { hint: server.install.hint, command: server.install.command } : {}),
      ...(language === undefined ? {} : { language }),
      ...(server.id === 'python' && pythonPath !== undefined ? { pythonPath } : {}),
    }
  }))
}

/** Install an npm-distributed server into the plugin's private directory. */
export async function installLsp(id: string, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted()
  const { install } = definition(id)
  if (install.kind !== 'npm') throw new WorkbenchError('lsp-manual', install.hint, 409)
  const directory = join(lspRoot(), id)
  await mkdir(directory, { recursive: true })
  await new Promise<void>((resolve, reject) => {
    const child = spawn('npm', ['install', '--prefix', directory, '--no-save', '--no-audit', '--no-fund', '--loglevel=error', install.package, ...(install.dependencies ?? [])], {
      cwd: directory, env: processEnvironment(lspSearchDirs()), shell: process.platform === 'win32', windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe'],
    })
    let error = ''
    let settled = false
    child.stderr.on('data', chunk => { error = (error + String(chunk)).slice(-4000) })
    const finish = (action: () => void) => { if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); action() }
    const timer = setTimeout(() => { child.kill(); finish(() => reject(new WorkbenchError('lsp-timeout', '语言服务器安装超时', 504))) }, 10 * 60 * 1000)
    // Cancelling the request has to stop npm; otherwise the UI gives up while the install continues.
    const abort = () => { child.kill(); finish(() => reject(new WorkbenchError('lsp-cancel', '语言服务器安装已取消', 499))) }
    signal?.addEventListener('abort', abort, { once: true })
    child.on('error', cause => finish(() => reject(new WorkbenchError('lsp-install', String(cause), 500))))
    child.on('close', code => finish(() => {
      if (code === 0) resolve()
      else reject(new WorkbenchError('lsp-install', error.trim() || `npm exited with ${code}`, 500))
    }))
  })
}

export async function uninstallLsp(id: string): Promise<void> {
  const server = definition(id)
  if (server.install.kind !== 'npm') return
  await rm(join(lspRoot(), id), { recursive: true, force: true })
}

/** Resolve the spawn command for a running server, or explain what the user must install. */
export async function resolveLsp(id: string, workspace?: string): Promise<LspCommand & { env: NodeJS.ProcessEnv }> {
  const server = definition(id)
  const dirs = lspSearchDirs()
  const resolved = await commandFor(server, dirs, workspace)
  if (resolved === undefined) {
    throw new WorkbenchError('lsp-missing', server.install.kind === 'system' ? server.install.hint : '语言服务器尚未安装', 409)
  }
  return { ...resolved, env: processEnvironment(dirs) }
}

/** Serialize a JSON-RPC message using the Language Server Protocol base framing. */
export function frameLsp(message: unknown): string {
  const body = JSON.stringify(message)
  return `Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`
}

/** Incremental decoder for LSP frames arriving in arbitrary chunks. */
export function lspFrameParser(onMessage: (message: unknown) => void): (chunk: Buffer) => void {
  let buffer = Buffer.alloc(0)
  return chunk => {
    buffer = Buffer.concat([buffer, chunk])
    for (;;) {
      const headerEnd = buffer.indexOf('\r\n\r\n')
      if (headerEnd < 0) return
      const header = buffer.subarray(0, headerEnd).toString('ascii')
      const length = /content-length:\s*(\d+)/i.exec(header)?.[1]
      if (length === undefined) { buffer = buffer.subarray(headerEnd + 4); continue }
      const size = Number(length)
      if (buffer.length < headerEnd + 4 + size) return
      const body = buffer.subarray(headerEnd + 4, headerEnd + 4 + size).toString('utf8')
      buffer = buffer.subarray(headerEnd + 4 + size)
      try { onMessage(JSON.parse(body)) } catch { /* ignore malformed frames from a misbehaving server */ }
    }
  }
}

/** Wire a spawned language server's stdio to JSON-RPC frames in both directions. */
export function pipeLanguageServer(child: ChildProcess, handlers: { onMessage(message: unknown): void; onStderr?(text: string): void; onExit?(code: number | null): void }): { write(text: string): void; kill(): void } {
  const parse = lspFrameParser(message => handlers.onMessage(message))
  child.stdout?.on('data', chunk => parse(chunk as Buffer))
  child.stderr?.on('data', chunk => handlers.onStderr?.(String(chunk)))
  child.stdin?.on('error', () => undefined)
  child.on('exit', code => handlers.onExit?.(code))
  return {
    write(text) { try { child.stdin?.write(frameLsp(JSON.parse(text))) } catch { /* ignore incomplete client frames */ } },
    kill() { child.stdin?.end(); child.kill() },
  }
}

const NAVIGATION_METHODS = new Set([
  'textDocument/definition', 'textDocument/declaration', 'textDocument/typeDefinition',
  'textDocument/implementation', 'textDocument/references',
])
const SOURCE_FILE = /\.(?:[cm]?[jt]sx?|py[iw]?|rpy|cpy|gypi?|go|rs|[chm]|mm|cc|cpp|cxx|hpp|hh|hxx|inc|inl|ipp|java|jav|cs|lua|php[45]?|phtml|ctp|sh|bash|zsh|ksh|command|jsonc?|ya?ml|s?css|less|html?)$/i
const CPP_HEADER = /(?:^|[\\/])include[\\/]c\+\+[\\/].+[\\/][a-z_][a-z_0-9]*$/i

function isSourceFile(path: string): boolean { return SOURCE_FILE.test(path) || CPP_HEADER.test(path) }
const REFERENCE_BYTE_LIMIT = 2 * 1024 * 1024

function sourcePath(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  try {
    const url = new URL(value)
    if (url.search || url.hash || url.protocol !== 'file:') return undefined
    const path = fileURLToPath(url)
    return isSourceFile(path) ? path : undefined
  } catch { return undefined }
}

async function readReference(path: string): Promise<string> {
  const canonical = await realpath(path)
  if (!isSourceFile(canonical)) throw new Error('不是可预览的源码文件')
  const file = await open(canonical, constants.O_RDONLY | constants.O_NONBLOCK)
  try {
    const info = await file.stat()
    if (!info.isFile() || info.size > REFERENCE_BYTE_LIMIT) throw new Error('源码文件超过预览范围')
    const buffer = Buffer.allocUnsafe(info.size + 1)
    let length = 0
    while (length < buffer.length) {
      const { bytesRead } = await file.read(buffer, length, buffer.length - length, length)
      if (bytesRead === 0) break
      length += bytesRead
    }
    const bytes = buffer.subarray(0, length)
    if (bytes.length !== info.size || bytes.includes(0) || !isUtf8(bytes)) throw new Error('源码文件无法作为 UTF-8 文本预览')
    return bytes.toString('utf8')
  } finally { await file.close() }
}

/** Attach the receiver before resolving the executable so initialize cannot overtake process startup. */
export async function attachLanguageServerSocket(ws: WebSocket, workspace: string, serverId: string): Promise<void> {
  let bridge: ReturnType<typeof pipeLanguageServer> | undefined
  const buffered: string[] = []
  let bufferedBytes = 0
  const navigations = new Set<number>()
  const referencePaths = new Set<string>()
  const send = (message: unknown) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message)) }
  const forward = (text: string) => {
    let message
    try { message = JSON.parse(text) } catch { return }
    if (message === null || typeof message !== 'object') return
    if (message.method === 'dvw/readFile' && typeof message.id === 'number') {
      const path = sourcePath(message.params?.uri)
      const read = path === undefined || !referencePaths.has(path)
        ? Promise.reject(new Error('此文件未出现在当前语言服务器的导航结果中'))
        : readReference(path)
      void read.then(
        result => send({ jsonrpc: '2.0', id: message.id, result }),
        error => send({ jsonrpc: '2.0', id: message.id, error: { code: -32603, message: String(error) } }),
      )
      return
    }
    if (typeof message.id === 'number' && NAVIGATION_METHODS.has(message.method)) {
      if (navigations.size >= 256) navigations.delete(navigations.values().next().value!)
      navigations.add(message.id)
    } else if (message.method === '$/cancelRequest') {
      navigations.delete(message.params?.id)
    } else if (message.method === 'initialize' && message.params && typeof message.params === 'object' && serverId === 'typescript') {
      // The language server first resolves TypeScript in workspaceFolders. This copy is its fallback.
      message.params.initializationOptions = {
        ...message.params.initializationOptions,
        tsserver: { fallbackPath: join(lspRoot(), 'typescript', 'node_modules', 'typescript', 'lib', 'tsserver.js') },
      }
      text = JSON.stringify(message)
    } else if (message.method === 'initialize' && message.params && typeof message.params === 'object' && serverId === 'vue') {
      message.params.initializationOptions = {
        typescript: { tsdk: join(lspRoot(), 'vue', 'node_modules', 'typescript', 'lib') },
        vue: { hybridMode: false },
      }
      text = JSON.stringify(message)
    }
    bridge?.write(text)
  }
  ws.on('message', data => {
    const text = String(data)
    if (bridge !== undefined) { forward(text); return }
    bufferedBytes += Buffer.byteLength(text)
    if (bufferedBytes > 1024 * 1024 || buffered.length >= 32) {
      ws.close(1009, 'language server starting')
      return
    }
    buffered.push(text)
  })
  ws.on('close', () => bridge?.kill())
  ws.on('error', () => bridge?.kill())
  try {
    const server = await resolveLsp(serverId, workspace)
    if (ws.readyState !== WebSocket.OPEN) return
    const javaData = serverId === 'java' ? await mkdtemp(join(tmpdir(), 'dvw-jdtls-')) : undefined
    const cleanup = () => javaData === undefined ? undefined : rm(javaData, { recursive: true, force: true }).catch(() => {})
    if (ws.readyState !== WebSocket.OPEN) { await cleanup(); return }
    const args = javaData === undefined ? server.args : [...server.args, '-data', javaData]
    let child: ChildProcess
    try {
      child = spawn(server.shell ? `"${server.command}"` : server.command,
        server.shell ? args.map(value => /[\s&()]/.test(value) ? `"${value}"` : value) : args,
        { cwd: workspace, env: server.env, stdio: ['pipe', 'pipe', 'pipe'], shell: server.shell, windowsHide: true })
    } catch (error) {
      await cleanup()
      throw error
    }
    child.once('close', () => { void cleanup() })
    bridge = pipeLanguageServer(child, {
      onMessage: raw => {
        const message = raw as { id?: number; result?: unknown; method?: string } | null
        if (typeof message?.id === 'number' && message.method === undefined && navigations.delete(message.id)) {
          const results = Array.isArray(message.result) ? message.result : [message.result]
          for (const result of results) {
            const path = sourcePath(result?.uri ?? result?.targetUri)
            if (path === undefined) continue
            if (referencePaths.size >= 1024) referencePaths.delete(referencePaths.values().next().value!)
            referencePaths.add(path)
          }
        }
        send(raw)
      },
      onStderr: text => console.warn('[dsh-vscode-workbench] lsp:', text.trim().slice(0, 500)),
      onExit: code => { if (ws.readyState === WebSocket.OPEN) ws.close(1011, `server exited ${code ?? ''}`.trim()) },
    })
    child.on('error', error => { if (ws.readyState === WebSocket.OPEN) ws.close(1011, String(error).slice(0, 120)) })
    for (const text of buffered.splice(0)) forward(text)
  } catch (error) {
    if (ws.readyState === WebSocket.OPEN) ws.close(1008, (error instanceof Error ? error.message : 'language server unavailable').slice(0, 120))
  }
}
