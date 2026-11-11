/** Host-side registry and process bridge for language servers exposed to the workbench editor. */
import { spawn, type ChildProcess } from 'node:child_process'
import { access, mkdir, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { WorkbenchError } from './wire.ts'

export type LspInstall = { kind: 'npm'; package: string; bin: string } | { kind: 'system'; command: string; hint: string }

export interface LspDefinition {
  id: string
  name: string
  /** Monaco language ids this server answers for. */
  languages: string[]
  install: LspInstall
  args: string[]
}

/** The strongest maintained server for each language, installable where the ecosystem allows it. */
export const LSP_SERVERS: readonly LspDefinition[] = [
  { id: 'python', name: 'Python · Pyright', languages: ['python'], install: { kind: 'npm', package: 'pyright', bin: 'pyright-langserver' }, args: ['--stdio'] },
  { id: 'php', name: 'PHP · Intelephense', languages: ['php'], install: { kind: 'npm', package: 'intelephense', bin: 'intelephense' }, args: ['--stdio'] },
  { id: 'shell', name: 'Shell · Bash Language Server', languages: ['shell'], install: { kind: 'npm', package: 'bash-language-server', bin: 'bash-language-server' }, args: ['start'] },
  { id: 'yaml', name: 'YAML · YAML Language Server', languages: ['yaml'], install: { kind: 'npm', package: 'yaml-language-server', bin: 'yaml-language-server' }, args: ['--stdio'] },
  { id: 'json', name: 'JSON · VS Code JSON', languages: ['json'], install: { kind: 'npm', package: 'vscode-langservers-extracted', bin: 'vscode-json-language-server' }, args: ['--stdio'] },
  { id: 'css', name: 'CSS / SCSS / Less · VS Code CSS', languages: ['css', 'scss', 'less'], install: { kind: 'npm', package: 'vscode-langservers-extracted', bin: 'vscode-css-language-server' }, args: ['--stdio'] },
  { id: 'html', name: 'HTML · VS Code HTML', languages: ['html'], install: { kind: 'npm', package: 'vscode-langservers-extracted', bin: 'vscode-html-language-server' }, args: ['--stdio'] },
  { id: 'dockerfile', name: 'Dockerfile · Docker LS', languages: ['dockerfile'], install: { kind: 'npm', package: 'dockerfile-language-server-nodejs', bin: 'dockerfile-language-server-nodejs' }, args: ['--stdio'] },
  { id: 'go', name: 'Go · gopls', languages: ['go'], install: { kind: 'system', command: 'gopls', hint: '在终端运行：go install golang.org/x/tools/gopls@latest（需要 Go 工具链）' }, args: ['serve'] },
  { id: 'rust', name: 'Rust · rust-analyzer', languages: ['rust'], install: { kind: 'system', command: 'rust-analyzer', hint: '运行：rustup component add rust-analyzer' }, args: [] },
  { id: 'cpp', name: 'C / C++ · clangd', languages: ['c', 'cpp', 'objective-c'], install: { kind: 'system', command: 'clangd', hint: '安装 LLVM（Windows：winget install LLVM.LLVM），并确保 clangd 在 PATH 中' }, args: [] },
  { id: 'java', name: 'Java · Eclipse JDT LS', languages: ['java'], install: { kind: 'system', command: 'jdtls', hint: '下载 eclipse.jdt.ls 并让 jdtls 启动脚本在 PATH 中' }, args: [] },
  { id: 'csharp', name: 'C# · csharp-ls', languages: ['csharp'], install: { kind: 'system', command: 'csharp-ls', hint: '运行：dotnet tool install --global csharp-ls（需要 .NET SDK）' }, args: [] },
  { id: 'lua', name: 'Lua · Lua Language Server', languages: ['lua'], install: { kind: 'system', command: 'lua-language-server', hint: '从 github.com/LuaLS/lua-language-server/releases 下载，并把 lua-language-server 加入 PATH' }, args: [] },
] as const

export interface LspStatus {
  id: string
  name: string
  languages: string[]
  installable: boolean
  installed: boolean
  hint?: string
}

/** Private install root so language servers never touch the user's global npm state. */
export function lspRoot(): string { return join(homedir(), '.dsh', 'dsh-vscode-workbench', 'lsp') }

function npmBinPath(id: string, bin: string): string {
  const path = join(lspRoot(), id, 'node_modules', '.bin', bin)
  return process.platform === 'win32' ? `${path}.cmd` : path
}

async function exists(path: string): Promise<boolean> { return access(path).then(() => true, () => false) }

function which(command: string): Promise<string | undefined> {
  return new Promise(resolve => {
    const child = spawn(process.platform === 'win32' ? 'where' : 'which', [command], { windowsHide: true })
    let output = ''
    child.stdout.on('data', chunk => { output += String(chunk) })
    child.on('error', () => resolve(undefined))
    child.on('close', code => resolve(code === 0 ? output.split(/\r?\n/).map(line => line.trim()).find(Boolean) : undefined))
  })
}

function definition(id: string): LspDefinition {
  const found = LSP_SERVERS.find(server => server.id === id)
  if (found === undefined) throw new WorkbenchError('lsp-unknown', `unknown language server: ${id}`, 404)
  return found
}

async function commandFor(server: LspDefinition): Promise<{ command: string; shell: boolean } | undefined> {
  if (server.install.kind === 'npm') {
    const command = npmBinPath(server.id, server.install.bin)
    return await exists(command) ? { command, shell: process.platform === 'win32' } : undefined
  }
  const command = await which(server.install.command)
  return command === undefined ? undefined : { command, shell: process.platform === 'win32' }
}

export async function lspStatuses(): Promise<LspStatus[]> {
  return Promise.all(LSP_SERVERS.map(async server => {
    const resolved = await commandFor(server)
    return {
      id: server.id,
      name: server.name,
      languages: server.languages,
      installable: server.install.kind === 'npm',
      installed: resolved !== undefined,
      ...(server.install.kind === 'system' ? { hint: server.install.hint } : {}),
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
  const resolved = await commandFor(server)
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
