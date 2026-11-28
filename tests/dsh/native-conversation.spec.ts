// @vitest-environment jsdom
import { expect, it, vi } from 'vitest'
import { NativeConversation, NATIVE_CONVERSATION_KIND } from '../../src/client/dsh/nativeConversation.ts'

function setup(mounted: string | undefined = 'session') {
  const sidebar = {
    mounted: { getSnapshot: () => mounted },
    openTabs: { getSnapshot: () => [] as Array<{ sessionId: string; kind: string; tabId: string }> },
    active: vi.fn(() => undefined),
    openTab: vi.fn(),
    focus: vi.fn(),
    isExpanded: vi.fn(() => false),
    toggleExpanded: vi.fn(),
    closeIn: vi.fn(),
  }
  const slots = { snapshot: vi.fn(() => []), subscribe: vi.fn(() => () => {}) }
  return { sidebar, conversation: new NativeConversation(sidebar as never, slots as never) }
}

it('opens the current session tab through the official sidebar API', () => {
  const { sidebar, conversation } = setup()
  conversation.open('session')
  expect(sidebar.openTab).toHaveBeenCalledWith(NATIVE_CONVERSATION_KIND)
  expect(sidebar.toggleExpanded).not.toHaveBeenCalled()
})

it('focuses an existing conversation tab without creating a duplicate', () => {
  const { sidebar, conversation } = setup()
  sidebar.openTabs.getSnapshot = () => [{ sessionId: 'session', kind: NATIVE_CONVERSATION_KIND, tabId: 'conversation-tab' }]
  conversation.open('session')
  expect(sidebar.focus).toHaveBeenCalledWith('conversation-tab')
  expect(sidebar.openTab).not.toHaveBeenCalled()
  expect(sidebar.toggleExpanded).toHaveBeenCalledOnce()
})

it('does not navigate a tab request into a different session', () => {
  const { sidebar, conversation } = setup('another-session')
  conversation.open('session')
  expect(sidebar.openTab).not.toHaveBeenCalled()
  expect(sidebar.focus).not.toHaveBeenCalled()
})

it('publishes the visible attached surface and releases it when its tab unmounts', () => {
  const { conversation } = setup()
  const element = document.createElement('div')
  const token = Symbol('conversation')
  const release = conversation.attach('session' as never, element, false, token, 'conversation-tab' as never)
  expect(conversation.getSurface('session')).toMatchObject({ root: element, floating: false, token, tabId: 'conversation-tab' })
  release()
  expect(conversation.getSurface('session')).toBeUndefined()
})
