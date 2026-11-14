// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { DshConversationPanel, DshReviewActions, findDshConversationRoot } from '../src/client/DshConversationPanel.tsx'

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

it('puts project review actions immediately above the DSH composer', async () => {
  document.body.innerHTML = '<div id="composer-stack"><div data-slot="conversation.composer.bar"><div data-composer-card="true"></div></div></div><div id="plugin"></div>'
  const root = createRoot(document.getElementById('plugin')!)
  const open = vi.fn()
  const accept = vi.fn()
  const reject = vi.fn()
  await act(async () => {
    root.render(<DshReviewActions
      visible
      files={[{ path: 'src/a.ts', count: 2 }]}
      count={2}
      onOpen={open}
      onAcceptAll={accept}
      onRejectAll={reject}
    />)
  })

  const stack = document.getElementById('composer-stack')!
  expect(stack.firstElementChild?.className).toBe('dvw-review-composer-host')
  expect(stack.textContent).toContain('1 个文件')
  expect(stack.textContent).toContain('2 处 AI 改动待审阅')
  const buttons = [...stack.querySelectorAll<HTMLButtonElement>('button')]
  expect(buttons.map(button => button.textContent?.trim())).toEqual(['src/a.ts2', '全部拒绝', '全部接受'])
  await act(async () => buttons[0]!.click())
  await act(async () => buttons[1]!.click())
  await act(async () => buttons[2]!.click())
  expect(open).toHaveBeenCalledWith('src/a.ts')
  expect(reject).toHaveBeenCalledTimes(1)
  expect(accept).toHaveBeenCalledTimes(1)
  await act(async () => root.unmount())
  expect(document.querySelector('.dvw-review-composer-host')).toBeNull()
})
