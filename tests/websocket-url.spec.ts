import { describe, expect, it } from 'vitest'
import { transportStreamBaseUrl, websocketUrl } from '../src/client/websocket.ts'

describe('workbench WebSocket URL', () => {
  it('keeps network pages on their own origin', () => {
    expect(websocketUrl('/dsh-vscode/ws/files', { protocol: 'http:', host: '127.0.0.1:4312' }, 'http://127.0.0.1:9999'))
      .toBe('ws://127.0.0.1:4312/dsh-vscode/ws/files')
    expect(websocketUrl('/dsh-vscode/ws/files', { protocol: 'https:', host: 'example.test' }))
      .toBe('wss://example.test/dsh-vscode/ws/files')
  })

  it('uses the shell-published Host origin for desktop application pages', () => {
    expect(websocketUrl('/dsh-vscode-terminal/ws?id=one', { protocol: 'dsh-app:', host: 'app' }, 'http://127.0.0.1:4312'))
      .toBe('ws://127.0.0.1:4312/dsh-vscode-terminal/ws?id=one')
    expect(websocketUrl('/dsh-vscode/ws/files', { protocol: 'dsh-app:', host: 'app' }, 'https://localhost:4312'))
      .toBe('wss://localhost:4312/dsh-vscode/ws/files')
  })

  it('rejects a missing or unsafe desktop transport base', () => {
    const page = { protocol: 'dsh-app:', host: 'app' }
    expect(websocketUrl('/dsh-vscode/ws/files', page)).toBeUndefined()
    expect(websocketUrl('/dsh-vscode/ws/files', page, 'file:///tmp/host')).toBeUndefined()
    expect(websocketUrl('/dsh-vscode/ws/files', page, 'http://user:secret@127.0.0.1:4312')).toBeUndefined()
    expect(websocketUrl('/dsh-vscode/ws/files', { protocol: 'http:', host: '' })).toBeUndefined()
  })

  it('reads only a string from the shell transport global', () => {
    expect(transportStreamBaseUrl({ __DSH_TRANSPORT__: { streamBaseUrl: 'http://127.0.0.1:4312' } } as unknown as typeof globalThis)).toBe('http://127.0.0.1:4312')
    expect(transportStreamBaseUrl({ __DSH_TRANSPORT__: { streamBaseUrl: 42 } } as unknown as typeof globalThis)).toBeUndefined()
  })
})
