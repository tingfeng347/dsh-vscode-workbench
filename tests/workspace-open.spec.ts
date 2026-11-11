import { describe, expect, it, vi } from 'vitest'
import { openWorkspaceFromPicker } from '../src/host.ts'

const signal = new AbortController().signal

describe('Open folder as workspace', () => {
  it('registers a picked directory', async () => {
    const create = vi.fn(async (path: string) => ({ id: 'w1', path, title: path.split(/[\\/]/).at(-1) ?? path }))
    const picker = { capability: () => ({ kind: 'native', pick: async () => 'D:\\projects\\new-app' }) }
    await expect(openWorkspaceFromPicker(picker, { create }, signal)).resolves.toEqual({ opened: true, workspace: { id: 'w1', path: 'D:\\projects\\new-app', title: 'new-app' } })
    expect(create).toHaveBeenCalledWith('D:\\projects\\new-app')
  })

  it('does nothing when the operator cancels the chooser', async () => {
    const create = vi.fn()
    const picker = { capability: () => ({ kind: 'native', pick: async () => null }) }
    await expect(openWorkspaceFromPicker(picker, { create }, signal)).resolves.toEqual({ opened: false })
    expect(create).not.toHaveBeenCalled()
  })

  it('explains unsupported backends and missing services', async () => {
    await expect(openWorkspaceFromPicker({ capability: () => ({ kind: 'browse' }) }, { create: vi.fn() }, signal)).rejects.toMatchObject({ code: 'picker-browse' })
    await expect(openWorkspaceFromPicker(undefined, undefined, signal)).rejects.toMatchObject({ code: 'picker-unavailable' })
    const picker = { capability: () => ({ kind: 'native', pick: async () => '/repo' }) }
    await expect(openWorkspaceFromPicker(picker, undefined, signal)).rejects.toMatchObject({ code: 'workspace-unavailable' })
  })
})
