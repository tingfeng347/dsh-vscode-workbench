// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { ConversationViewPins } from '../../src/client/dsh/conversationViewPins.tsx'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const storageKey = 'dvw:conversation-view-pins:v1'

afterEach(() => localStorage.removeItem(storageKey))

it('persists official More-menu pin changes and restores them after remount', async () => {
  const node = document.createElement('div')
  const root = createRoot(node)
  const onPinnedChange = vi.fn()
  const onOpen = vi.fn()
  const onDismiss = vi.fn()
  const pinned = [{ id: 'trace', label: '轨迹', pinned: true }]
  const unpinned = [{ ...pinned[0]!, pinned: false }]
  const actions = { onPinnedChange, onOpen, onDismiss }
  const renderPins = (entries: typeof pinned) => createElement(ConversationViewPins, { entries, ...actions } as never)
  try {
    await act(async () => root.render(renderPins(pinned)))
    await act(async () => root.render(renderPins(unpinned)))
    expect(JSON.parse(localStorage.getItem(storageKey)!)).toEqual(['trace'])
    await act(async () => root.unmount())

    const nextRoot = createRoot(node)
    await act(async () => nextRoot.render(renderPins(pinned)))
    expect(onPinnedChange).toHaveBeenCalledWith('trace', false)
    await act(async () => nextRoot.unmount())
  } finally {
    if (node.hasChildNodes()) await act(async () => root.unmount())
  }
})
