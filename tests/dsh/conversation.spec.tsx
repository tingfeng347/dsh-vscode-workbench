// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { CONVERSATION_CLOSE_ICON, CONVERSATION_OPEN_ICON, CONVERSATION_VIEW_SETTINGS_EVENT, CONVERSATION_VIEW_SETTINGS_ICON, DshConversationCloseIcon, DshConversationMenu, DshConversationOpenIcon, DshConversationViewsIcon, DshNativeSidebarOpenIcon, DshConversationPanel, DshReviewActions, findDshConversationRoot, type DshConversationMenus } from '../../src/client/dsh/DshConversationPanel.tsx'
import { SshChatTarget } from '../../src/client/ssh/SshChatTarget.tsx'
import { SidebarConversationHeader } from '../../src/client/dsh/SidebarConversationHeader.tsx'
import { CONVERSATION_ACTION_SETTINGS_KEY, setConversationActionVisible, visibleConversationToolbarActions } from '../../src/client/dsh/conversationActionVisibility.ts'
import { ConversationActionVisibilitySettings } from '../../src/client/dsh/ConversationActionVisibilitySettings.tsx'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

afterEach(() => {
  document.body.replaceChildren()
  document.body.removeAttribute('data-dvw-conversation-active')
  localStorage.removeItem(CONVERSATION_ACTION_SETTINGS_KEY)
  setConversationActionVisible('conversation-placement', true)
  setConversationActionVisible('close-conversation-bar', false)
  setConversationActionVisible('open-native-sidebar', true)
})

it('keeps native menu registration stable and ignores actions from a previous session', async () => {
  const node = document.createElement('div')
  document.body.append(node)
  const root = createRoot(node)
  let contribution: Parameters<DshConversationMenus['register']>[0] | undefined
  const dispose = vi.fn()
  const menus = { register: vi.fn((value: NonNullable<typeof contribution>) => { contribution = value; return dispose }) }
  const open = vi.fn(), latestOpen = vi.fn(), back = vi.fn(), close = vi.fn()
  setConversationActionVisible('conversation-placement', false)
  setConversationActionVisible('close-conversation-bar', false)
  try {
    await act(async () => root.render(<DshConversationMenu menus={menus} sessionId="a" editor={false} onOpen={open} onReturn={back} onClose={close}/>))
    const oldAction = contribution!.resolve({ sessionId: 'a' })[0]!
    expect(oldAction).toMatchObject({ label: '在编辑区打开对话', icon: { key: CONVERSATION_OPEN_ICON } })
    expect(contribution!.resolve({ sessionId: 'a' })[1]).toMatchObject({ label: '关闭对话栏', icon: { key: CONVERSATION_CLOSE_ICON } })
    await act(async () => root.render(<DshConversationMenu menus={menus} sessionId="a" editor={false} onOpen={latestOpen} onReturn={back} onClose={close}/>))
    oldAction.run()
    expect(open).not.toHaveBeenCalled()
    expect(latestOpen).toHaveBeenCalledTimes(1)
    contribution!.resolve({ sessionId: 'a' })[1]!.run()
    expect(close).toHaveBeenCalledTimes(1)
    await act(async () => root.render(<DshConversationMenu menus={menus} sessionId="b" editor onOpen={latestOpen} onReturn={back} onClose={close}/>))
    oldAction.run()
    expect(latestOpen).toHaveBeenCalledTimes(1)
    expect(contribution!.resolve({ sessionId: 'a' })).toEqual([])
    expect(contribution!.resolve({ sessionId: 'b' })[0]).toMatchObject({ label: '移回侧栏', icon: { key: 'dsh-vscode-workbench.open-native-sidebar' } })
    expect(contribution!.resolve({ sessionId: 'b' })[1]).toMatchObject({ label: '关闭对话栏', icon: { key: CONVERSATION_CLOSE_ICON } })
    expect(menus.register).toHaveBeenCalledTimes(1)
    expect(node.childNodes).toHaveLength(0)
  } finally {
    await act(async () => root.unmount())
  }
  expect(dispose).toHaveBeenCalledTimes(1)
})

it.each([DshConversationOpenIcon, DshConversationCloseIcon, DshNativeSidebarOpenIcon, DshConversationViewsIcon])('renders the conversation menu icon as a compact current-color glyph: %s', async Icon => {
  const node = document.createElement('div')
  document.body.append(node)
  const root = createRoot(node)
  try {
    await act(async () => root.render(<Icon/>))
    expect(node.querySelector('svg')?.getAttribute('viewBox')).toBe('0 0 16 16')
    expect(node.querySelector('svg')?.getAttribute('stroke')).toBe('currentColor')
  } finally { await act(async () => root.unmount()) }
})

it('pins selected action icons before the ellipsis and removes them from its menu', async () => {
  const node = document.createElement('div')
  document.body.append(node)
  const root = createRoot(node)
  let contribution: Parameters<DshConversationMenus['register']>[0] | undefined
  const menus = { register: (value: NonNullable<typeof contribution>) => { contribution = value; return () => {} } }
  const onOpen = vi.fn()
  try {
    await act(async () => root.render(<>
      <DshConversationMenu menus={menus} sessionId="a" editor={false} onOpen={onOpen} onReturn={vi.fn()} onClose={vi.fn()} onOpenSidebar={vi.fn()}/>
      <ConversationActionVisibilitySettings sessionId="a"/>
    </>))
    const configure = contribution!.resolve({ sessionId: 'a' }).find(item => item.id === 'configure-action-icons')
    expect(configure).toMatchObject({ label: '设置显示的图标', icon: { key: CONVERSATION_VIEW_SETTINGS_ICON } })
    await act(async () => configure!.run())
    expect(node.querySelector('[role="dialog"][aria-label="设置显示的图标"]')).not.toBeNull()
    const placement = [...node.querySelectorAll('label')].find(label => label.textContent?.includes('在编辑区打开对话'))!.querySelector('input')!
    const openSidebar = [...node.querySelectorAll('label')].find(label => label.textContent?.includes('打开侧边栏'))!.querySelector('input')!
    expect(placement.checked).toBe(true)
    expect(openSidebar.checked).toBe(true)
    expect(contribution!.resolve({ sessionId: 'a' }).some(item => item.id === 'open-in-editor')).toBe(false)
    expect(contribution!.resolve({ sessionId: 'a' }).some(item => item.id === 'open-native-sidebar')).toBe(false)
    await act(async () => openSidebar.click())
    expect(contribution!.resolve({ sessionId: 'a' }).some(item => item.id === 'open-native-sidebar')).toBe(true)
  } finally { await act(async () => root.unmount()) }
})

it('shows the configured close icon in the main header as well as in the sidebar', () => {
  const visibility = { 'conversation-placement': true, 'open-native-sidebar': true, 'close-conversation-bar': true }
  expect(visibleConversationToolbarActions(false, visibility)).toEqual(['conversation-placement', 'open-native-sidebar', 'close-conversation-bar'])
  expect(visibleConversationToolbarActions(true, visibility)).toEqual(['conversation-placement', 'close-conversation-bar'])
})

it('offers an icon-labelled native sidebar opener scoped to the current session', async () => {
  const node = document.createElement('div')
  document.body.append(node)
  const root = createRoot(node)
  let contribution: Parameters<DshConversationMenus['register']>[0] | undefined
  const menus = { register: (value: NonNullable<typeof contribution>) => { contribution = value; return () => {} } }
  const openSidebar = vi.fn()
  setConversationActionVisible('open-native-sidebar', false)
  const noop = () => {}
  try {
    await act(async () => root.render(<DshConversationMenu menus={menus} sessionId="a" editor={false} onOpen={noop} onReturn={noop} onClose={noop} onOpenSidebar={openSidebar}/>))
    const action = contribution!.resolve({ sessionId: 'a' }).find(item => item.id === 'open-native-sidebar')
    expect(action).toMatchObject({ label: '打开侧边栏', icon: { key: 'dsh-vscode-workbench.open-native-sidebar' } })
    action!.run()
    expect(openSidebar).toHaveBeenCalledTimes(1)
    await act(async () => root.render(<DshConversationMenu menus={menus} sessionId="b" editor onOpen={noop} onReturn={noop} onClose={noop} onOpenSidebar={openSidebar}/>))
    action!.run()
    expect(openSidebar).toHaveBeenCalledTimes(1)
    expect(contribution!.resolve({ sessionId: 'b' }).some(item => item.id === 'open-native-sidebar')).toBe(true)
  } finally { await act(async () => root.unmount()) }
})

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

it('prefers a visible conversation over an older hidden session root', () => {
  document.body.innerHTML = '<div id="old" data-phase="active" style="display:none"><div data-conversation-scroll></div></div><div id="new" data-phase="hero"><div data-conversation-scroll></div></div>'
  expect(findDshConversationRoot()).toBe(document.getElementById('new'))
})

it('leaves the official header untouched; opening in the editor belongs to the More menu', async () => {
  document.body.innerHTML = '<div id="main" data-phase="active"><header data-window-drag><span>Greeting</span><button>标准模式</button></header><nav>对话 轨迹 上下文</nav><div data-conversation-scroll></div><textarea>unsent</textarea></div><div id="plugin"></div>'
  const surface = document.getElementById('main')!
  const original = surface.innerHTML
  const header = surface.querySelector('header')!
  const root = createRoot(document.getElementById('plugin')!)
  try {
    await act(async () => root.render(<DshConversationPanel visible width={420} statusHeight={24}/>))
    expect(surface.querySelector('header')).toBe(header)
    expect(surface.children).toHaveLength(4)
    expect(header.hasAttribute('draggable')).toBe(false)
    expect(header.hasAttribute('data-dvw-conversation-grip')).toBe(false)
    expect(surface.innerHTML).toBe(original)
  } finally {
    await act(async () => root.unmount())
    expect(surface.innerHTML).toBe(original)
  }
})

it('places the existing conversation over its editor slot, follows resizing, and restores its inline styles', async () => {
  document.body.innerHTML = '<div id="main" data-phase="active" style="left:3px;top:4px;width:600px;height:500px"><div data-conversation-scroll></div><textarea>unsent</textarea></div><div class="dvw-overlay"><div data-dvw-conversation-editor></div></div><div id="plugin"></div>'
  const surface = document.getElementById('main')!
  const parent = surface.parentElement
  const slot = document.querySelector<HTMLElement>('[data-dvw-conversation-editor]')!
  let rect = new DOMRect(150, 80, 700, 600)
  vi.spyOn(slot, 'getBoundingClientRect').mockImplementation(() => rect)
  const root = createRoot(document.getElementById('plugin')!)
  try {
    await act(async () => root.render(<DshConversationPanel visible editor width={420} statusHeight={24}/>))
    expect(surface.dataset.dvwConversationPanel).toBe('editor')
    expect(surface.parentElement).toBe(parent)
    expect(surface.style.left).toBe('150px')
    expect(surface.style.top).toBe('80px')
    expect(surface.style.width).toBe('700px')
    expect(surface.style.height).toBe('600px')
    rect = new DOMRect(200, 100, 500, 400)
    await act(async () => {
      window.dispatchEvent(new Event('resize'))
      await new Promise(resolve => requestAnimationFrame(resolve))
    })
    expect(surface.style.left).toBe('200px')
    expect(surface.style.width).toBe('500px')
    await act(async () => root.render(<DshConversationPanel visible={false} editor width={420} statusHeight={24}/>))
    expect(surface.style.left).toBe('3px')
    expect(surface.style.top).toBe('4px')
    expect(surface.style.width).toBe('600px')
    expect(surface.style.height).toBe('500px')
    expect(surface.querySelector('textarea')!.value).toBe('unsent')
    expect(surface.hasAttribute('data-dvw-conversation-panel')).toBe(false)
  } finally {
    await act(async () => root.unmount())
    vi.restoreAllMocks()
  }
})

it('ignores workbench-only DOM churn and re-attaches once per frame', async () => {
  document.body.innerHTML = '<div class="dvw-overlay"><div id="editor"></div></div><div id="plugin"></div>'
  const root = createRoot(document.getElementById('plugin')!)
  await act(async () => { root.render(<DshConversationPanel visible width={420} statusHeight={24}/>) })
  const query = vi.spyOn(document, 'querySelectorAll')
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
  expect(stack.textContent).toContain('2 处改动')
  const fileButton = stack.querySelector<HTMLButtonElement>('.dvw-review-composer-files button')!
  const rejectButton = stack.querySelector<HTMLButtonElement>('[data-action=reject]')!
  const acceptButton = stack.querySelector<HTMLButtonElement>('[data-action=accept]')!
  expect(fileButton.textContent?.trim()).toBe('src/a.ts2')
  expect(rejectButton.textContent?.trim()).toBe('全部拒绝')
  expect(acceptButton.textContent?.trim()).toBe('全部接受')
  expect(stack.querySelector('.dvw-review-composer')?.getAttribute('aria-busy')).toBeNull()
  await act(async () => fileButton.click())
  await act(async () => rejectButton.click())
  await act(async () => acceptButton.click())
  expect(open).toHaveBeenCalledWith('src/a.ts')
  expect(reject).toHaveBeenCalledTimes(1)
  expect(accept).toHaveBeenCalledTimes(1)
  await act(async () => root.unmount())
  expect(document.querySelector('.dvw-review-composer-host')).toBeNull()
})

it('keeps overflowed project files reachable with visible scroll controls', async () => {
  document.body.innerHTML = '<div id="composer-stack"><div data-slot="conversation.composer.bar"></div></div><div id="plugin"></div>'
  const root = createRoot(document.getElementById('plugin')!)
  const files = Array.from({ length: 8 }, (_, index) => ({ path: `src/review/file-${index}.ts`, count: 1 }))
  await act(async () => {
    root.render(<DshReviewActions visible files={files} count={files.length} onOpen={() => undefined} onAcceptAll={() => undefined} onRejectAll={() => undefined}/>)
  })

  const list = document.querySelector<HTMLElement>('.dvw-review-composer-files')!
  const scrollTo = vi.fn(({ left }: ScrollToOptions) => { list.scrollLeft = left ?? 0 })
  Object.defineProperty(list, 'scrollTo', { value: scrollTo })
  Object.defineProperty(list, 'clientWidth', { configurable: true, value: 220 })
  Object.defineProperty(list, 'scrollWidth', { configurable: true, value: 720 })
  await act(async () => list.dispatchEvent(new Event('scroll')))

  const next = await vi.waitFor(() => {
    const button = document.querySelector<HTMLButtonElement>('.dvw-review-composer-scroll[data-direction=next]')
    expect(button).not.toBeNull()
    return button!
  })
  await act(async () => next.click())
  expect(scrollTo).toHaveBeenLastCalledWith({ left: 165, behavior: 'smooth' })
  await act(async () => next.click())
  expect(scrollTo).toHaveBeenLastCalledWith({ left: 330, behavior: 'smooth' })
  expect(document.querySelector('.dvw-review-composer-scroll[data-direction=previous]')).not.toBeNull()
  await act(async () => root.unmount())
})

it('attaches the SSH selector when DSH creates and replaces its composer status row', async () => {
  document.body.innerHTML = '<div data-phase="active"><div data-conversation-scroll></div></div><div id="plugin"></div>'
  const conversationRoot = document.querySelector<HTMLElement>('[data-phase]')!
  const root = createRoot(document.getElementById('plugin')!)
  try {
    await act(async () => root.render(<SshChatTarget conversationRoot={conversationRoot} sessionId="session" visible status={{ available: true }} onSelect={vi.fn()} onOpenSsh={vi.fn()}/>))
    expect(conversationRoot.querySelector('.dvw-ssh-chat-trigger')).toBeNull()
    const previous = document.createElement('div')
    previous.innerHTML = '<button aria-label="上下文已用 3%"></button>'
    await act(async () => {
      conversationRoot.append(previous)
      await new Promise(resolve => requestAnimationFrame(resolve))
    })
    expect(previous.querySelector('.dvw-ssh-chat-trigger')?.textContent).toBe('选择 SSH')
    const next = previous.cloneNode(false) as HTMLElement
    next.innerHTML = '<button aria-label="上下文已用 4%"></button>'
    await act(async () => {
      previous.replaceWith(next)
      await new Promise(resolve => requestAnimationFrame(resolve))
    })
    expect(next.querySelector('.dvw-ssh-chat-trigger')?.textContent).toBe('选择 SSH')
    expect(conversationRoot.querySelectorAll('.dvw-ssh-chat-host')).toHaveLength(1)
    expect(previous.hasAttribute('data-dvw-ssh-chat-status')).toBe(false)
  } finally {
    await act(async () => root.unmount())
  }
})

it('renders the sidebar session title and view tabs with a working overflow menu', async () => {
  const node = document.createElement('div')
  document.body.append(node)
  const root = createRoot(node)
  const onSelect = vi.fn()
  const setPinned = vi.fn()
  const unpinned: string[] = []
  const views = [
    { id: 'chat', label: '对话' }, { id: 'trajectory', label: '轨迹' },
    { id: 'context', label: '上下文' }, { id: 'files', label: '文件' }, { id: 'changes', label: '变更' }, { id: 'reviews', label: '审阅' },
  ]
  try {
    await act(async () => root.render(<SidebarConversationHeader sessionId="session-1" title="问候 (1)" activeView="chat"
      useConversationViews={select => select(views)} useEntryPins={select => select(unpinned)} useEntryActions={select => select(true)} selectView={onSelect} setPinned={setPinned}/>))
    expect(node.textContent).toContain('问候 (1)')
    expect(node.textContent).toContain('标准模式')
    expect(node.querySelector('[role="tablist"]')?.textContent).toContain('轨迹')
    await act(async () => window.dispatchEvent(new CustomEvent(CONVERSATION_VIEW_SETTINGS_EVENT, { detail: { sessionId: 'session-1' } })))
    expect(node.querySelector('[role="dialog"][aria-label="设置显示的视图"]')).not.toBeNull()
    const trajectory = [...node.querySelectorAll('label')].find(label => label.textContent?.includes('轨迹'))!
    const trajectoryCheckbox = trajectory.querySelector('input')!
    expect(trajectoryCheckbox.checked).toBe(true)
    expect([...node.querySelectorAll('label')].find(label => label.textContent?.includes('对话'))?.querySelector('input')?.disabled).toBe(true)
    await act(async () => trajectoryCheckbox.click())
    expect(setPinned).toHaveBeenCalledWith('trajectory', false)
    unpinned.push('trajectory')
    await act(async () => root.render(<SidebarConversationHeader sessionId="session-1" title="问候 (1)" activeView="chat"
      useConversationViews={select => select(views)} useEntryPins={select => select(unpinned)} useEntryActions={select => select(true)} selectView={onSelect} setPinned={setPinned}/>))
    expect(node.querySelector('[role="tablist"]')?.textContent).not.toContain('轨迹')
    const reviews = [...node.querySelectorAll('label')].find(label => label.textContent?.includes('审阅'))!.querySelector('input')!
    await act(async () => reviews.click())
    expect(setPinned).toHaveBeenCalledWith('reviews', true)
    expect(setPinned).toHaveBeenCalledWith('changes', false)
    unpinned.push('changes')
    await act(async () => root.render(<SidebarConversationHeader sessionId="session-1" title="问候 (1)" activeView="chat"
      useConversationViews={select => select(views)} useEntryPins={select => select(unpinned)} useEntryActions={select => select(true)} selectView={onSelect} setPinned={setPinned}/>))
    expect(node.querySelector('[role="tablist"]')?.textContent).toContain('审阅')
    await act(async () => (node.querySelector('[aria-label="更多视图"]') as HTMLButtonElement).click())
    expect(node.querySelector('[role="menu"]')?.textContent).toContain('轨迹')
    await act(async () => (node.querySelector('[role="menuitem"]') as HTMLButtonElement).click())
    expect(onSelect).toHaveBeenCalledWith('trajectory')
  } finally { await act(async () => root.unmount()) }
})
