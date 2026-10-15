// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it } from 'vitest'
import { DshConversationPanel, findDshConversationRoot } from '../src/client/DshConversationPanel.tsx'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

afterEach(() => { document.body.replaceChildren() })

it('attaches to the main conversation across the new content container and restores it on unload', async () => {
  document.body.innerHTML = '<div data-conversation-content><div data-conversation-scroll></div></div><div id="main" data-phase="active"><header></header><div data-conversation-content><div data-conversation-scroll></div></div></div><div id="plugin"></div>'
  const conversation = document.getElementById('main')!
  expect(findDshConversationRoot()).toBe(conversation)
  const root = createRoot(document.getElementById('plugin')!)
  await act(async () => { root.render(<DshConversationPanel visible width={420} statusHeight={24}/>) })
  expect(conversation.hasAttribute('data-dvw-conversation-panel')).toBe(true)
  expect(conversation.style.getPropertyValue('--dvw-chat-width')).toBe('420px')
  await act(async () => { root.unmount() })
  expect(conversation.hasAttribute('data-dvw-conversation-panel')).toBe(false)
  expect(conversation.style.getPropertyValue('--dvw-chat-width')).toBe('')
})

it('does not attach an embedded conversation outside the main phase container', () => {
  document.body.innerHTML = '<div data-conversation-content><div data-conversation-scroll></div></div>'
  expect(findDshConversationRoot()).toBeNull()
})
