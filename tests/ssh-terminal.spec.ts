import xterm from '@xterm/xterm'
import { expect, it } from 'vitest'
import { sshTerminalOpening } from '../src/client/SSHRemoteTerminal.tsx'

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
