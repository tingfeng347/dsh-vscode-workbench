import { execFileSync, spawnSync } from 'node:child_process'
import xterm from '@xterm/xterm'
import { expect, it } from 'vitest'
import { sshTerminalOpening } from '../src/client/SSHRemoteTerminal.tsx'
import { sshEnvironment } from '../src/ssh.ts'

it('clears queued terminal output before starting a new SSH session', async () => {
  const terminal = new xterm.Terminal({ cols: 80, rows: 10 })
  terminal.write(`ll\r\n${'M'.repeat(24)}${'3'.repeat(24)}\r\n`)
  terminal.write(sshTerminalOpening('build'))
  await new Promise<void>(resolve => terminal.write('new-session\r\n', resolve))

  const lines: string[] = []
  for (let index = 0; index < terminal.buffer.active.length; index++) {
    const line = terminal.buffer.active.getLine(index)?.translateToString(true)
    if (line !== undefined && line !== '') lines.push(line)
  }

  expect(lines).toEqual(['正在连接 build…', 'new-session'])
})

it('supplies the SSH password through the platform helper and rejects host confirmation prompts', () => {
  const password = 'test 密码 & %'
  const askpass = sshEnvironment({ hostName: 'example.invalid', password })
  const helper = askpass.SSH_ASKPASS!
  const env = { ...process.env, ...askpass, SSH_ASKPASS_PROMPT: '' }
  const answer = execFileSync(helper, ["deploy@example.invalid's password:"], { env, encoding: 'utf8', windowsHide: true })
  expect(answer.replace(/\r?\n$/, '')).toBe(password)
  const confirmation = spawnSync(helper, ['Continue connecting?'], {
    env: { ...env, SSH_ASKPASS_PROMPT: 'confirm' },
    encoding: 'utf8',
    windowsHide: true,
  })
  expect(confirmation.status).toBe(1)
  expect(confirmation.stdout).toBe('')
}, 15_000)
