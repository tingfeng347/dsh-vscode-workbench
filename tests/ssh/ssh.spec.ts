// @vitest-environment jsdom
import { execFileSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'
import { isGitTransportFailure, isRemoteWorkspaceSshHost, parseSshConfig, remotePreviewType, remoteRelativePath, shellQuote, sshGitDiffSources, sshRunArguments } from '../../src/host/ssh/ssh.ts'
import { remoteFileParts, remoteFileUri, remotePreviewUrl, rememberSshHost } from '../../src/client/ssh/ssh.ts'

afterEach(() => localStorage.clear())

describe('SSH host configuration', () => {
  it('parses exact Host aliases and ignores wildcard-only blocks', () => {
    const hosts = parseSshConfig(`
Host production production-alt
  HostName prod.example.com
  User deploy
  Port 2222
  IdentityFile ~/.ssh/production

Host *.internal
  User wildcard

Host edge-?
  HostName edge.example.com
`)

    expect(hosts).toEqual([
      {
        alias: 'production',
        hostName: 'prod.example.com',
        user: 'deploy',
        port: 2222,
        identityFile: '~/.ssh/production',
      },
      {
        alias: 'production-alt',
        hostName: 'prod.example.com',
        user: 'deploy',
        port: 2222,
        identityFile: '~/.ssh/production',
      },
    ])
  })

  it('excludes Git hosting endpoints that do not expose a remote workspace shell', () => {
    const hosts = parseSshConfig(`
Host github.com
  HostName github.com
  User git

Host work
  HostName build.example.com
  User deploy

Host gitlab-git
  HostName gitlab.com
  User git
`)

    expect(hosts).toEqual([{
      alias: 'work',
      hostName: 'build.example.com',
      user: 'deploy',
    }])
    expect(isRemoteWorkspaceSshHost('github.com')).toBe(false)
    expect(isRemoteWorkspaceSshHost('GitHub.com.')).toBe(false)
    expect(isRemoteWorkspaceSshHost('build.example.com')).toBe(true)
  })

  it('recognizes when a Git service rejects a remote workspace shell', () => {
    const detail = `Invalid command: sh -c 'set -eu
cd -- '.' && pwd -P'
You appear to be using ssh to clone a git:// URL. Make sure your
core.gitProxy config option and the GIT_PROXY_COMMAND environment variable are NOT set.`

    expect(isGitTransportFailure(detail)).toBe(true)
    expect(isGitTransportFailure('Invalid command: unknown')).toBe(false)
    expect(isGitTransportFailure('bash: sh: command not found')).toBe(false)
  })

  it('quotes remote shell values without interpolation', () => {
    expect(shellQuote('build-host')).toBe("'build-host'")
    expect(shellQuote("a'b")).toBe("'a'\\''b'")
    expect(shellQuote('$(touch /tmp/nope)')).toBe("'$(touch /tmp/nope)'")
  })

  it('passes a multi-line script as one quoted remote command', () => {
    const script = "set -eu\nvalue='two words'\nprintf '%s\\n' \"$value\""
    const args = sshRunArguments(['build-host'], script)
    expect(args).toHaveLength(2)
    expect(args[1]).toBe(`sh -c ${shellQuote(script)}`)
    if (process.platform !== 'win32') {
      expect(execFileSync('/bin/sh', ['-c', args[1]!], { encoding: 'utf8' })).toBe('two words\n')
    }
  })

  it('compares staged content with HEAD and worktree content with the index', () => {
    expect(sshGitDiffSources('staged', 'src/App.tsx')).toEqual({
      original: 'HEAD:src/App.tsx',
      modified: ':src/App.tsx',
    })
    expect(sshGitDiffSources('worktree', 'src/App.tsx')).toEqual({
      original: ':src/App.tsx',
    })
  })

  it('keeps remote paths relative and rejects traversal', () => {
    expect(remoteRelativePath('')).toBe('')
    expect(remoteRelativePath('./src//App.tsx')).toBe('src/App.tsx')
    expect(() => remoteRelativePath('../secret')).toThrow('不能越过工作区')
    expect(() => remoteRelativePath('src/../../secret')).toThrow('不能越过工作区')
    expect(() => remoteRelativePath('/etc/passwd')).toThrow('必须是工作区内的相对路径')
    expect(() => remoteRelativePath('C:\\Users\\secret')).toThrow('必须是工作区内的相对路径')
  })
})

describe('SSH editor references', () => {
  it('round-trips escaped remote paths', () => {
    const uri = remoteFileUri('connection-id', 'src/a #1/文件.ts')
    expect(uri).toBe('ssh://connection-id/src/a%20%231/%E6%96%87%E4%BB%B6.ts')
    expect(remoteFileParts(uri)).toEqual({
      connectionId: 'connection-id',
      remotePath: 'src/a #1/文件.ts',
    })
  })

  it('builds an authenticated preview URL for remote images and documents', () => {
    const url = remotePreviewUrl('session-id', remoteFileUri('connection-id', 'images/果园 #1/orchard.jpg'), 42)
    expect(url).toBeDefined()
    const parsed = new URL(url!, 'http://dsh.local')
    expect(parsed.pathname).toBe('/dsh-vscode/ssh/file')
    expect(Object.fromEntries(parsed.searchParams)).toEqual({
      sessionId: 'session-id',
      connectionId: 'connection-id',
      path: 'images/果园 #1/orchard.jpg',
      v: '42',
    })
    expect(remotePreviewType('images/orchard.JPG')).toBe('image/jpeg')
    expect(remotePreviewType('reports/plan.pdf')).toBe('application/pdf')
    expect(remotePreviewType('src/main.ts')).toBeUndefined()
  })

  it('never persists a connection password in recent-host history', () => {
    const history = rememberSshHost({
      host: 'production',
      user: 'deploy',
      password: 'do-not-store-this',
      workspace: '/srv/app',
    }, 'production:/srv/app')

    expect(history[0]).toMatchObject({ host: 'production', user: 'deploy', workspace: '/srv/app' })
    expect(history[0]).not.toHaveProperty('password')
    expect(localStorage.getItem('dvw:ssh-hosts:v1')).not.toContain('do-not-store-this')
  })
})
