import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { connectSsh, disconnectSsh, liveSshConnections, sshGit, sshListFiles, sshReadDocument } from '../src/ssh.ts'
import type { GitDiff, GitStatus } from '../src/types.ts'

let temp: string | undefined
const session = 'ssh-files-test'

afterEach(async () => {
  for (const connection of liveSshConnections(session)) disconnectSsh(session, connection.id)
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
