import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { connectSsh, disconnectSsh, liveSshConnections, sshCreateEntry, sshDeleteEntry, sshGit, sshListFiles, sshOpenFileDownload, sshReadDocument, sshRenameEntry, sshUploadFile, switchSshWorkspace } from '../src/ssh.ts'
import * as sshPassword from '../src/ssh-password.ts'
import { SshChat, type ChatServices } from '../src/ssh-chat.ts'
import type { Session } from '@deepseek-ai/dsh-session'
import type { GitDiff, GitStatus } from '../src/types.ts'

let temp: string | undefined
const session = 'ssh-files-test'

afterEach(async () => {
  for (const connection of liveSshConnections(session)) disconnectSsh(session, connection.id)
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  if (temp !== undefined) await rm(temp, { force: true, recursive: true })
})

async function localSshFixture() {
  temp = await mkdtemp(join(tmpdir(), 'dvw-ssh-files-'))
  const bin = join(temp, 'bin')
  const workspace = join(temp, 'workspace')
  await mkdir(bin)
  await mkdir(workspace)
  // Run the exact remote command OpenSSH would send without a server or credentials.
  await writeFile(join(bin, 'ssh'), '#!/bin/sh\nfor arg; do command=$arg; done\nexec /bin/sh -c "$command"\n', { mode: 0o700 })
  vi.stubEnv('PATH', bin + delimiter + process.env.PATH)
  return workspace
}

it.skipIf(process.platform === 'win32')('saves an SSH password after success and reuses it for the matching host and account', async () => {
  const workspace = await localSshFixture()
  const store = vi.spyOn(sshPassword, 'storeSshPassword').mockResolvedValue(true)
  const read = vi.spyOn(sshPassword, 'readSshPassword').mockResolvedValue(undefined)
  const request = { host: 'dvw-password.invalid', user: 'deploy', port: 22345, workspace }
  const password = 'test password'
  await expect(connectSsh(session, { ...request, workspace: workspace + '/missing', password, savePassword: true })).rejects.toThrow()
  expect(store).not.toHaveBeenCalled()
  const connected = await connectSsh(session, { ...request, password, savePassword: true })
  expect(connected.passwordSaved).toBe(true)
  expect(JSON.stringify(connected)).not.toContain(password)
  const account = store.mock.calls[0]![0]
  expect(store).toHaveBeenCalledWith(account, password)
  read.mockImplementation(async candidate => candidate === account ? password : undefined)
  await expect(connectSsh(session, { ...request, user: 'other', useSavedPassword: true })).rejects.toMatchObject({ code: 'ssh-password-unavailable' })
  await expect(connectSsh(session, { ...request, useSavedPassword: true })).resolves.toMatchObject({ passwordSaved: true, root: connected.root })
  expect(store).toHaveBeenCalledTimes(1)
})

it.skipIf(process.platform === 'win32')('lists metadata without reading special files and preserves filenames containing tabs and line breaks', async () => {
  const workspace = await localSshFixture()
  const filename = '示例\tsecond\nline.txt'
  await mkdir(join(workspace, 'folder'))
  await mkdir(join(workspace, '.git'))
  await writeFile(join(workspace, filename), 'abc')
  await writeFile(join(workspace, '.hidden'), '')
  await symlink(filename, join(workspace, 'link'))
  execFileSync('mkfifo', [join(workspace, 'pipe')])

  const connection = await connectSsh(session, { host: 'dvw-test.invalid', workspace })
  expect(await sshListFiles(session, connection.id, '')).toEqual([
    { kind: 'directory', name: 'folder', path: 'folder' },
    { kind: 'file', name: '.hidden', path: '.hidden', size: 0 },
    { kind: 'file', name: filename, path: filename, size: 3 },
  ])
  await expect(sshListFiles(session, connection.id, 'folder')).resolves.toEqual([])
  await rm(workspace, { recursive: true })
  await expect(sshReadDocument(session, connection.id, filename)).rejects.toThrow()
})

it.skipIf(process.platform === 'win32')('scopes remote Git status, staging and blob reads to the selected subdirectory', async () => {
  const workspace = await localSshFixture()
  const subdir = join(workspace, 'nested')
  await mkdir(subdir)
  const git = (...args: string[]) => execFileSync('git', ['-C', workspace, ...args], { encoding: 'utf8' })
  git('init', '--quiet')
  git('config', 'user.name', 'Test')
  git('config', 'user.email', 'test@example.invalid')
  git('config', 'commit.gpgsign', 'false')
  await writeFile(join(subdir, 'inside.txt'), 'old\n')
  git('add', 'nested/inside.txt')
  git('commit', '--quiet', '-m', 'fixture')
  await writeFile(join(subdir, 'inside.txt'), 'new\n')
  await writeFile(join(workspace, 'outside.txt'), 'outside')

  const connection = await connectSsh(session, { host: 'dvw-test.invalid', workspace: subdir })
  const status = await sshGit(session, connection.id, 'status') as GitStatus
  expect(status.changes.map(change => change.path)).toEqual(['inside.txt'])
  await sshGit(session, connection.id, 'stage.all')
  expect(git('diff', '--cached', '--name-only')).toBe('nested/inside.txt\n')
  const diff = await sshGit(session, connection.id, 'diff', 'inside.txt', 'staged') as GitDiff
  expect(diff).toMatchObject({ original: 'old\n', modified: 'new\n' })
  git('add', 'outside.txt')
  await expect(sshGit(session, connection.id, 'commit', undefined, 'nested commit')).rejects.toThrow('工作区之外还有已暂存的文件')
  git('reset', '--quiet', 'HEAD', '--', 'outside.txt')
  await sshGit(session, connection.id, 'commit', undefined, 'nested commit')
  expect(git('show', '--format=', '--name-only', 'HEAD')).toBe('nested/inside.txt\n')
})

it.skipIf(process.platform === 'win32')('uploads and downloads binary bytes, renames entries, and refuses overwrite and workspace escapes', async () => {
  const workspace = await localSshFixture()
  const connection = await connectSsh(session, { host: 'dvw-test.invalid', workspace })
  const binary = Buffer.from([0, 1, 255, 10, 13])
  await sshCreateEntry(session, connection.id, '资料', 'directory')
  await sshUploadFile(session, connection.id, '资料', 'raw #1.bin', binary)
  await expect(sshUploadFile(session, connection.id, '资料', 'raw #1.bin', Buffer.from('other'))).rejects.toMatchObject({ code: 'target-exists' })
  await expect(sshUploadFile(session, connection.id, '..', 'bad', binary)).rejects.toMatchObject({ code: 'path-outside' })
  await sshRenameEntry(session, connection.id, '资料/raw #1.bin', '资料/renamed.bin')
  const download = await sshOpenFileDownload(session, connection.id, '资料/renamed.bin')
  expect(download).toMatchObject({ name: 'renamed.bin', size: binary.length })
  const bytes: Buffer[] = []
  for await (const chunk of download.child.stdout) bytes.push(chunk)
  expect(Buffer.concat(bytes)).toEqual(binary)
  await expect(sshDeleteEntry(session, connection.id, '')).rejects.toMatchObject({ code: 'root-delete' })
  await sshDeleteEntry(session, connection.id, '资料')
  await expect(sshListFiles(session, connection.id, '')).resolves.toEqual([])
})

it.skipIf(process.platform === 'win32')('routes native DSH file tools and references only to the selected SSH workspace and honors read-only mode', async () => {
  const workspace = await localSshFixture()
  const connection = await connectSsh(session, { host: 'dvw-test.invalid', workspace })
  await writeFile(join(workspace, 'main.ts'), 'one\ntwo\nthree\n')
  const chat = new SshChat()
  let tool!: Parameters<ChatServices['tools']['register']>[0]
  let activation!: Parameters<ChatServices['tools']['register']>[1]
  let guard!: Parameters<ChatServices['tools']['guard']>[0]
  let mode = 'read-only'
  let status = 'idle'
  const localCompletion = vi.fn(async () => [{ path: 'local.txt', kind: 'file' as const }])
  const services: ChatServices = {
    agents: { get: () => ({ status }) },
    sandboxPolicy: { resolve: () => ({ mode }) },
    fileReferences: { list: localCompletion },
    tools: {
      register(next, options) { tool = next; activation = options; return () => {} },
      guard(next) { guard = next; return () => {} },
    },
  }
  const dispose = chat.install(services)
  try {
    const agent = { session: { id: session } as Session }
    const otherAgent = { session: { id: 'other' } as Session }
    const execution = { agent, name: tool.name, callId: 'fixture', signal: new AbortController().signal }
    expect(activation.when({ agent })).toBe(false)
    expect(chat.select(session, connection.id)).toMatchObject({ available: true, connected: true, target: { id: connection.id } })
    expect(activation.when({ agent })).toBe(true)
    expect(activation.when({ agent: otherAgent })).toBe(false)
    const nested = join(workspace, 'nested')
    await mkdir(nested)
    const browsing = await switchSshWorkspace(session, connection.id, nested, true)
    expect(browsing.id).not.toBe(connection.id)
    expect(chat.status(session)).toMatchObject({ connected: true, target: { id: connection.id } })
    expect(guard({ ...execution, name: 'bash' })).toContain('targets SSH')
    expect(guard({ ...execution, agent: otherAgent, name: 'bash' })).toBeUndefined()
    await expect(tool.execute({ action: 'exec', command: 'printf remote-ok' }, execution)).rejects.toMatchObject({ code: 'ssh-chat-read-only' })
    expect(await services.fileReferences.list(agent, 'ma', execution.signal)).toEqual([{ path: 'main.ts', kind: 'file' }])
    expect(await services.fileReferences.list(otherAgent, '', execution.signal)).toEqual([{ path: 'local.txt', kind: 'file' }])
    const selectedLine = await tool.execute({ action: 'read', path: 'main.ts', startLine: 2, endLine: 2 }, execution)
    expect(selectedLine).toContain('Lines: 2–2')
    expect(selectedLine.split('\n').at(-1)).toBe('two')
    const revision = selectedLine.match(/Revision: ([a-f0-9]+)/)![1]
    await expect(tool.execute({ action: 'save', path: 'main.ts', revision, content: 'remote change\n' }, execution))
      .rejects.toMatchObject({ code: 'ssh-chat-read-only' })
    mode = 'workspace-write'
    expect(await tool.execute({ action: 'exec', command: 'printf remote-ok' }, execution)).toContain('remote-ok')
    await tool.execute({ action: 'save', path: 'main.ts', revision, content: 'remote change\n' }, execution)
    expect(await readFile(join(workspace, 'main.ts'), 'utf8')).toBe('remote change\n')
    await expect(tool.execute({ action: 'read', path: 'main.ts' }, { ...execution, agent: otherAgent })).rejects.toMatchObject({ code: 'ssh-chat-target' })
    status = 'running'
    expect(() => chat.select(session, null)).toThrow('请等待当前回复结束')
    disconnectSsh(session, connection.id)
    expect(chat.status(session)).toMatchObject({ connected: false, target: { id: connection.id } })
    expect(guard({ ...execution, name: 'bash' })).toContain('targets SSH')
  } finally { dispose() }
  expect(services.fileReferences.list).toBe(localCompletion)
})
