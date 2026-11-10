// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { DshConversationPanel, findDshConversationRoot } from '../src/client/DshConversationPanel.tsx'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

afterEach(() => { document.body.replaceChildren(); document.body.removeAttribute('data-dvw-conversation-active') })

it('attaches to the main conversation across the new content container and restores it on unload', async () => {
  document.body.innerHTML = '<div data-conversation-content><div data-conversation-scroll></div></div><div id="main" data-phase="active"><header></header><div data-conversation-content><div data-conversation-scroll></div></div></div><div id="plugin"></div>'
  const conversation = document.getElementById('main')!
  expect(findDshConversationRoot()).toBe(conversation)
  const root = createRoot(document.getElementById('plugin')!)
  await act(async () => { root.render(<DshConversationPanel visible width={420} statusHeight={24}/>) })
  expect(conversation.hasAttribute('data-dvw-conversation-panel')).toBe(true)
  expect(conversation.style.getPropertyValue('--dvw-chat-width')).toBe('420px')
  expect(document.body.hasAttribute('data-dvw-conversation-active')).toBe(true)
  await act(async () => { root.unmount() })
  expect(conversation.hasAttribute('data-dvw-conversation-panel')).toBe(false)
  expect(conversation.style.getPropertyValue('--dvw-chat-width')).toBe('')
  expect(document.body.hasAttribute('data-dvw-conversation-active')).toBe(false)
})

it('does not attach an embedded conversation outside the main phase container', () => {
  document.body.innerHTML = '<div data-conversation-content><div data-conversation-scroll></div></div>'
  expect(findDshConversationRoot()).toBeNull()
})

it('ignores workbench-only DOM churn and re-attaches once per frame', async () => {
  document.body.innerHTML = '<div class="dvw-overlay"><div id="editor"></div></div><div id="plugin"></div>'
  const root = createRoot(document.getElementById('plugin')!)
  await act(async () => { root.render(<DshConversationPanel visible width={420} statusHeight={24}/>) })
  const query = vi.spyOn(document, 'querySelector')
  const editor = document.getElementById('editor')!
  for (let line = 0; line < 20; line++) editor.append(document.createElement('div'))
  await act(async () => { await new Promise(resolve => requestAnimationFrame(resolve)) })
  expect(query).not.toHaveBeenCalled()
  document.body.insertAdjacentHTML('beforeend', '<div id="main" data-phase="active"><div data-conversation-scroll></div></div>')
  document.body.append(document.createElement('div'))
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)) })
  expect(query).toHaveBeenCalledTimes(1)
  expect(document.getElementById('main')!.hasAttribute('data-dvw-conversation-panel')).toBe(true)
  query.mockRestore(); await act(async () => { root.unmount() })
})
