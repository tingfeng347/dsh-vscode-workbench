/** Host-side registry and process bridge for language servers exposed to the workbench editor. */
import { spawn, type ChildProcess } from 'node:child_process'
import { constants } from 'node:fs'
import { access, mkdir, readdir, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'
import { WorkbenchError } from './wire.ts'

/** The toolchain a manual language server belongs to, detected separately from the server itself. */
export type LspLanguage = { name: string; commands: readonly string[] }

export type LspInstall =
  | { kind: 'npm'; package: string; bin: string }
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

/** The strongest maintained server for each language, installable where the ecosystem allows it. */
export const LSP_SERVERS: readonly LspDefinition[] = [
  { id: 'python', name: 'Python · Pyright', languages: ['python'], install: { kind: 'npm', package: 'pyright', bin: 'pyright-langserver' }, args: ['--stdio'], language: { name: 'Python', commands: ['python3', 'python'] } },
  { id: 'php', name: 'PHP · Intelephense', languages: ['php'], install: { kind: 'npm', package: 'intelephense', bin: 'intelephense' }, args: ['--stdio'], language: { name: 'PHP', commands: ['php'] } },
  { id: 'shell', name: 'Shell · Bash Language Server', languages: ['shell'], install: { kind: 'npm', package: 'bash-language-server', bin: 'bash-language-server' }, args: ['start'], language: { name: 'Shell', commands: ['bash', 'zsh'] } },
  { id: 'yaml', name: 'YAML · YAML Language Server', languages: ['yaml'], install: { kind: 'npm', package: 'yaml-language-server', bin: 'yaml-language-server' }, args: ['--stdio'] },
  { id: 'json', name: 'JSON · VS Code JSON', languages: ['json'], install: { kind: 'npm', package: 'vscode-langservers-extracted', bin: 'vscode-json-language-server' }, args: ['--stdio'] },
  { id: 'css', name: 'CSS / SCSS / Less · VS Code CSS', languages: ['css', 'scss', 'less'], install: { kind: 'npm', package: 'vscode-langservers-extracted', bin: 'vscode-css-language-server' }, args: ['--stdio'] },
  { id: 'html', name: 'HTML · VS Code HTML', languages: ['html'], install: { kind: 'npm', package: 'vscode-langservers-extracted', bin: 'vscode-html-language-server' }, args: ['--stdio'] },
  { id: 'dockerfile', name: 'Dockerfile · Docker LS', languages: ['dockerfile'], install: { kind: 'npm', package: 'dockerfile-language-server-nodejs', bin: 'dockerfile-language-server-nodejs' }, args: ['--stdio'] },
  { id: 'go', name: 'Go · gopls', languages: ['go'], install: { kind: 'system', command: 'gopls', hint: '在终端运行：go install golang.org/x/tools/gopls@latest（需要 Go 工具链）' }, args: ['serve'], language: { name: 'Go', commands: ['go'] } },
  { id: 'rust', name: 'Rust · rust-analyzer', languages: ['rust'], install: { kind: 'system', command: 'rust-analyzer', hint: '运行：rustup component add rust-analyzer' }, args: [], language: { name: 'Rust', commands: ['rustc', 'cargo'] } },
  { id: 'cpp', name: 'C / C++ · clangd', languages: ['c', 'cpp', 'objective-c'], install: { kind: 'system', command: 'clangd', hint: '安装 LLVM（Windows：winget install LLVM.LLVM），并确保 clangd 在 PATH 中' }, args: [], language: { name: 'C / C++ 工具链', commands: ['clang', 'gcc', 'cc'] } },
  { id: 'java', name: 'Java · Eclipse JDT LS', languages: ['java'], install: { kind: 'system', command: 'jdtls', hint: '下载 eclipse.jdt.ls 并让 jdtls 启动脚本在 PATH 中' }, args: [], language: { name: 'Java', commands: ['java', 'javac'] } },
  { id: 'csharp', name: 'C# · csharp-ls', languages: ['csharp'], install: { kind: 'system', command: 'csharp-ls', hint: '运行：dotnet tool install --global csharp-ls（需要 .NET SDK）' }, args: [], language: { name: '.NET SDK', commands: ['dotnet'] } },
  { id: 'lua', name: 'Lua · Lua Language Server', languages: ['lua'], install: { kind: 'system', command: 'lua-language-server', hint: '从 github.com/LuaLS/lua-language-server/releases 下载，并把 lua-language-server 加入 PATH' }, args: [], language: { name: 'Lua', commands: ['lua', 'lua5.4', 'lua5.3', 'luajit'] } },
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
}

/** Private install root so language servers never touch the user's global npm state. */
export function lspRoot(): string { return join(homedir(), '.dsh', 'dsh-vscode-workbench', 'lsp') }

function npmBinPath(id: string, bin: string): string {
  const path = join(lspRoot(), id, 'node_modules', '.bin', bin)
  return process.platform === 'win32' ? `${path}.cmd` : path
}

async function exists(path: string): Promise<boolean> { return access(path).then(() => true, () => false) }

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
    ]
    : [
      join(home, 'go', 'bin'),
      join(home, '.cargo', 'bin'),
      join(home, '.dotnet', 'tools'),
      join(home, '.local', 'bin'),
      join(home, 'bin'),
      '/opt/homebrew/bin',
      '/usr/local/bin',
      '/usr/bin',
      '/bin',
      '/usr/sbin',
      '/sbin',
    ]
  return [...new Set([...fromPath, ...extras])]
}

async function executableIn(directory: string, command: string): Promise<string | undefined> {
  // Windows has no executable bit: access(X_OK) accepts any file, so only accept real command extensions.
  const names = process.platform === 'win32'
    ? [`${command}.exe`, `${command}.cmd`, `${command}.bat`, `${command}.com`]
    : [command]
  for (const name of names) {
    const file = join(directory, name)
    const found = await access(file, constants.X_OK).then(() => true, () => false)
    if (found) return file
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

async function rustupBinDirs(home: string): Promise<string[]> {
  const root = join(home, '.rustup', 'toolchains')
  const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
  return entries.filter(entry => entry.isDirectory()).map(entry => join(root, entry.name, 'bin'))
}

async function searchDirs(home = homedir()): Promise<string[]> {
  return [...lspSearchDirs(process.env, home), ...await rustupBinDirs(home)]
}

function definition(id: string): LspDefinition {
  const found = LSP_SERVERS.find(server => server.id === id)
  if (found === undefined) throw new WorkbenchError('lsp-unknown', `unknown language server: ${id}`, 404)
  return found
}

async function commandFor(server: LspDefinition, dirs: readonly string[]): Promise<{ command: string; shell: boolean } | undefined> {
  if (server.install.kind === 'npm') {
    const command = npmBinPath(server.id, server.install.bin)
    return await exists(command) ? { command, shell: process.platform === 'win32' } : undefined
  }
  const command = await findExecutable(server.install.command, dirs)
  return command === undefined ? undefined : { command, shell: process.platform === 'win32' }
}

export async function lspStatuses(): Promise<LspStatus[]> {
  const dirs = await searchDirs()
  return Promise.all(LSP_SERVERS.map(async server => {
    const resolved = await commandFor(server, dirs)
    const language = server.language === undefined
      ? undefined
      : { name: server.language.name, installed: (await Promise.all(server.language.commands.map(command => findExecutable(command, dirs)))).some(Boolean) }
    return {
      id: server.id,
      name: server.name,
      languages: server.languages,
      installable: server.install.kind === 'npm',
      installed: resolved !== undefined,
      ...(server.install.kind === 'system' ? { hint: server.install.hint, command: server.install.command } : {}),
      ...(language === undefined ? {} : { language }),
    }
  }))
}

/** Install an npm-distributed server into the plugin's private directory. */
export async function installLsp(id: string): Promise<void> {
  const server = definition(id)
  if (server.install.kind !== 'npm') throw new WorkbenchError('lsp-manual', server.install.hint, 409)
  const directory = join(lspRoot(), id)
  await mkdir(directory, { recursive: true })
  await new Promise<void>((resolve, reject) => {
    const child = spawn('npm', ['install', '--prefix', directory, '--no-save', '--no-audit', '--no-fund', '--loglevel=error', server.install.kind === 'npm' ? server.install.package : ''], {
      cwd: directory, shell: process.platform === 'win32', windowsHide: true,
    })
    let error = ''
    child.stderr.on('data', chunk => { error = (error + String(chunk)).slice(-4000) })
    const timer = setTimeout(() => { child.kill(); reject(new WorkbenchError('lsp-timeout', '语言服务器安装超时', 504)) }, 10 * 60 * 1000)
    child.on('error', cause => { clearTimeout(timer); reject(new WorkbenchError('lsp-install', String(cause), 500)) })
    child.on('close', code => {
      clearTimeout(timer)
      if (code === 0) resolve()
      else reject(new WorkbenchError('lsp-install', error.trim() || `npm exited with ${code}`, 500))
    })
  })
}

export async function uninstallLsp(id: string): Promise<void> {
  const server = definition(id)
  if (server.install.kind !== 'npm') return
  await rm(join(lspRoot(), id), { recursive: true, force: true })
}

/** Resolve the spawn command for a running server, or explain what the user must install. */
export async function resolveLsp(id: string): Promise<{ command: string; shell: boolean; args: string[] }> {
  const server = definition(id)
  const resolved = await commandFor(server, await searchDirs())
  if (resolved === undefined) {
    throw new WorkbenchError('lsp-missing', server.install.kind === 'system' ? server.install.hint : '语言服务器尚未安装', 409)
  }
  return { ...resolved, args: server.args }
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
    kill() { child.kill() },
  }
}
