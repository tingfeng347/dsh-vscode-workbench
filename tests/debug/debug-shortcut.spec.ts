import { expect, it } from 'vitest'
import { debugShortcut } from '../../src/client/debug/debug.ts'

const snapshot = (state: 'idle' | 'starting' | 'running' | 'stopped' | 'ended', activePath: string | undefined = 'a.js') =>
  ({ state, activePath, sessionId: 's', adapterId: 'node' })

it('never restarts a running session from F5', () => {
  // Swallowed rather than unhandled: the host must not see a fresh start either.
  expect(debugShortcut('F5', false, snapshot('running'))).toEqual({ kind: 'swallow' })
  expect(debugShortcut('F5', false, snapshot('starting'))).toEqual({ kind: 'swallow' })
})

it('resumes when paused and starts from idle or ended', () => {
  expect(debugShortcut('F5', false, snapshot('stopped'))).toEqual({ kind: 'resume' })
  expect(debugShortcut('F5', false, snapshot('idle'))).toEqual({ kind: 'start' })
  expect(debugShortcut('F5', false, snapshot('ended'))).toEqual({ kind: 'start' })
  expect(debugShortcut('F5', false, { ...snapshot('idle'), activePath: undefined })).toBeUndefined()
})

it('only takes F10 and F11 while paused, so F11 still reaches the host (fullscreen)', () => {
  expect(debugShortcut('F10', false, snapshot('running'))).toBeUndefined()
  expect(debugShortcut('F11', false, snapshot('running'))).toBeUndefined()
  expect(debugShortcut('F11', false, snapshot('idle'))).toBeUndefined()
  expect(debugShortcut('F11', true, snapshot('running'))).toBeUndefined()
  expect(debugShortcut('F10', false, snapshot('stopped'))).toEqual({ kind: 'step', step: 'next' })
  expect(debugShortcut('F11', false, snapshot('stopped'))).toEqual({ kind: 'step', step: 'in' })
  expect(debugShortcut('F11', true, snapshot('stopped'))).toEqual({ kind: 'step', step: 'out' })
})

it('stops only when there is something to stop', () => {
  expect(debugShortcut('F5', true, snapshot('running'))).toEqual({ kind: 'stop' })
  expect(debugShortcut('F5', true, snapshot('stopped'))).toEqual({ kind: 'stop' })
  expect(debugShortcut('F5', true, snapshot('idle'))).toBeUndefined()
  expect(debugShortcut('F5', true, snapshot('ended'))).toBeUndefined()
})

it('ignores unrelated keys', () => {
  expect(debugShortcut('F6', false, snapshot('stopped'))).toBeUndefined()
  expect(debugShortcut('KeyS', false, snapshot('stopped'))).toBeUndefined()
  expect(debugShortcut('F10', true, snapshot('stopped'))).toBeUndefined()
})