// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { installConversationNavigation } from '../../src/client/dsh/conversationNavigation.ts'
import { readSource } from '../support/readSource.ts'

const cleanup: Array<() => void> = []
afterEach(() => {
  for (const stop of cleanup.splice(0).reverse()) stop()
  vi.restoreAllMocks()
  document.body.replaceChildren()
})

// DSH ChatView renders the rail next to the transcript. Its marks are virtualized.
function conversation(id = 'main', label = '轮次导航') {
  return `<section data-phase="active" id="${id}"><div data-conversation-content>
    <div data-conversation-scroll><div>
      <div data-native-rail-slot><nav aria-label="${label}"><div><div>
        <button data-index="0" aria-label="跳转到第 1 轮"></button>
        <button data-index="1" aria-label="加载并跳转到第 2 轮"></button>
      </div></div></nav></div>
      <div><div data-native-transcript><p>原始对话内容</p></div></div>
    </div></div></div></section>`
}

async function settle() {
  await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
}

it('adapts the resident native rail while preserving hover, focus and history jump handlers', () => {
  document.body.innerHTML = conversation()
  const rail = document.querySelector('nav')!
  const mark = rail.querySelector('button')!
  const jump = vi.fn(), preview = vi.fn()
  mark.addEventListener('click', jump)
  mark.addEventListener('pointermove', preview)
  mark.addEventListener('focus', preview)
  const children = [...rail.childNodes]
  const transcript = document.querySelector('[data-native-transcript]')!.innerHTML
  const stop = installConversationNavigation(true)
  cleanup.push(stop)
  expect(rail.getAttribute('data-dvw-turn-navigation')).toBe('on')
  expect(rail.parentElement?.getAttribute('data-dvw-turn-navigation-slot')).toBe('on')
  expect([...rail.childNodes]).toEqual(children)
  expect(document.querySelector('[data-native-transcript]')!.innerHTML).toBe(transcript)
  mark.dispatchEvent(new Event('pointermove'))
  mark.focus()
  mark.click()
  expect(jump).toHaveBeenCalledOnce()
  expect(preview).toHaveBeenCalledTimes(2)
})

it('switches off and on for every native conversation and removes its attributes on unload', () => {
  document.body.innerHTML = conversation() + conversation('editor', 'Turn navigation')
  const rails = [...document.querySelectorAll('nav')]
  let stop = installConversationNavigation(false)
  rails.forEach(rail => expect(rail.getAttribute('data-dvw-turn-navigation')).toBe('off'))
  stop()
  rails.forEach(rail => expect(rail.hasAttribute('data-dvw-turn-navigation')).toBe(false))
  stop = installConversationNavigation(true)
  cleanup.push(stop)
  rails.forEach(rail => expect(rail.getAttribute('data-dvw-turn-navigation')).toBe('on'))
  stop()
  expect(document.querySelector('[data-dvw-turn-navigation-slot]')).toBeNull()
})

it('attaches when a session mounts or the virtualized native marks become available', async () => {
  cleanup.push(installConversationNavigation(false))
  document.body.innerHTML = conversation()
  await settle()
  const rail = document.querySelector('nav')!
  expect(rail.getAttribute('data-dvw-turn-navigation')).toBe('off')
  document.getElementById('main')!.remove()
  document.body.insertAdjacentHTML('beforeend', '<section data-phase="active"><div data-conversation-scroll><div><nav aria-label="轮次导航"><div></div></nav></div></div></section>')
  await settle()
  expect(rail.hasAttribute('data-dvw-turn-navigation')).toBe(false)
  const next = document.querySelector('nav')!
  expect(next.hasAttribute('data-dvw-turn-navigation')).toBe(false)
  next.firstElementChild!.innerHTML = '<button data-index="0" aria-label="跳转到第 1 轮"></button>'
  await settle()
  expect(next.getAttribute('data-dvw-turn-navigation')).toBe('off')
})

it('adapts the navigation rail when its existing turn button hydrates', async () => {
  document.body.innerHTML = '<section data-phase=active><div data-conversation-scroll><div><div><nav aria-label="轮次导航"><div><button></button></div></nav></div><div><div>对话</div></div></div></div></section>'
  cleanup.push(installConversationNavigation(true))
  const rail = document.querySelector('nav')!
  const mark = rail.querySelector('button')!
  mark.setAttribute('data-index', '0')
  mark.setAttribute('aria-label', '跳转到第 1 轮')
  await settle()
  expect(rail.getAttribute('data-dvw-turn-navigation')).toBe('on')
  expect(rail.parentElement?.getAttribute('data-dvw-turn-navigation-slot')).toBe('on')
})

it.each(['data-phase', 'data-dvw-native-conversation'])(
  'adapts an already-mounted rail when the embedded conversation activates via %s',
  async attribute => {
    document.body.innerHTML = '<section id="conversation"><div data-conversation-scroll><div><div><nav aria-label="轮次导航"><div><button data-index="0" aria-label="跳转到第 1 轮"></button></div></nav></div><div><div>对话</div></div></div></div></section>'
    cleanup.push(installConversationNavigation(true))
    const root = document.getElementById('conversation')!
    const rail = root.querySelector('nav')!
    expect(rail.hasAttribute('data-dvw-turn-navigation')).toBe(false)

    root.setAttribute(attribute, attribute === 'data-phase' ? 'active' : 'visible')
    await settle()

    expect(rail.getAttribute('data-dvw-turn-navigation')).toBe('on')
    expect(rail.parentElement?.getAttribute('data-dvw-turn-navigation-slot')).toBe('on')
  },
)

it('refreshes the native rail layout when the right sidebar receives its first size', async () => {
  let notifyResize: ResizeObserverCallback | undefined
  const observed: Element[] = []
  class TestResizeObserver {
    constructor(callback: ResizeObserverCallback) { notifyResize = callback }
    observe(target: Element) { observed.push(target) }
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', TestResizeObserver)
  document.body.innerHTML = '<div data-rightbar-col><section data-phase="active"><div data-conversation-scroll><div data-rail-slot><nav aria-label="轮次导航"><button data-index="0" aria-label="跳转到第 1 轮"></button><button data-index="1" aria-label="跳转到第 2 轮"></button></nav></div><div data-composer-seat></div></div></section></div>'
  const scroller = document.querySelector<HTMLElement>('[data-conversation-scroll]')!
  Object.defineProperty(scroller, 'clientHeight', { configurable: true, value: 360 })
  Object.defineProperty(document.querySelector('[data-composer-seat]')!, 'offsetHeight', { value: 96 })

  cleanup.push(installConversationNavigation(true))
  expect(observed).toContain(document.querySelector('[data-rightbar-col]'))
  expect(observed).toContain(scroller)
  notifyResize?.([], {} as ResizeObserver)
  await settle()

  expect(scroller.style.getPropertyValue('--dsh-composer-height')).toBe('96px')
  expect(scroller.style.getPropertyValue('--dsh-conversation-viewport-height')).toBe('360px')
  expect(document.querySelector('nav')?.getAttribute('data-dvw-turn-navigation')).toBe('on')
})

it('does not rescan navigation during streamed text updates or mark virtualization', async () => {
  document.body.innerHTML = conversation()
  cleanup.push(installConversationNavigation(true))
  const query = vi.spyOn(document, 'querySelectorAll')
  const text = document.querySelector('p')!
  const marks = document.querySelector('nav > div > div')!
  for (let index = 0; index < 20; index++) {
    text.append(document.createTextNode('新增回复'))
    marks.insertAdjacentHTML('beforeend', `<button data-index="${index + 2}" aria-label="跳转"></button>`)
  }
  await settle()
  expect(query).not.toHaveBeenCalled()
})

it('leaves unrelated navigation and embedded message markup untouched', () => {
  document.body.innerHTML = conversation() + '<nav aria-label="项目"><button data-index="0" aria-label="文件"></button></nav>'
  const other = document.querySelector('body > nav')!
  const original = other.outerHTML
  cleanup.push(installConversationNavigation(true))
  expect(other.outerHTML).toBe(original)
})

it('overrides narrow-screen hiding and places previews inside the conversation on the right of the left rail', () => {
  const css = readSource('src/client/workbench/styles.ts')
  expect(css).toContain('nav[data-dvw-turn-navigation=on]{display:block;left:6px;right:auto;')
  expect(css).toContain('nav[data-dvw-turn-navigation=off]{display:none}')
  expect(css).toContain('nav[data-dvw-turn-navigation=on] [role=tooltip]{left:calc(100% + 8px);right:auto;')
  expect(css).toContain('[data-dvw-turn-navigation-slot=on]+div>div:first-child{padding-inline-start:max(42px,')
})
