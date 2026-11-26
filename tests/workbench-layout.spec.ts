import { expect, it } from 'vitest'
import { fitNativeSidebarLayout } from '../src/client/nativeSidebar.ts'

const base = {
  viewportWidth: 1440, dockWidth: 0, sideWidth: 210, chatWidth: 440,
  minChatWidth: 440, chatVisible: true, sideVisible: true, editorVisible: true,
}

it('gives an empty editor’s space to the conversation beside the native dock', () => {
  const layout = fitNativeSidebarLayout({ ...base, dockWidth: 500, editorVisible: false })
  expect(layout.sideWidth).toBe(210)
  expect(layout.chatWidth).toBe(682)
  expect(layout.sideWidth + layout.chatWidth + 48 + 500).toBe(1440)
})

it('can fill the available window instead of capping the conversation at half width', () => {
  const layout = fitNativeSidebarLayout({ ...base, sideVisible: false, chatWidth: 2000 })
  expect(layout.chatLimit).toBe(1392)
  expect(layout.chatWidth).toBe(1392)
  expect(layout.sideWidth).toBe(0)
})

it('fits a restored wide conversation to a smaller floating window', () => {
  const layout = fitNativeSidebarLayout({ ...base, viewportWidth: 898, chatWidth: 1800 })
  expect(layout.chatWidth).toBe(640)
  expect(layout.sideWidth + layout.chatWidth + 48).toBe(898)
})

it('keeps the preferred chat width when an editor is open again', () => {
  const layout = fitNativeSidebarLayout({ ...base, dockWidth: 500 })
  expect(layout.chatWidth).toBe(440)
  expect(layout.sideWidth).toBe(210)
  expect(layout.chatFits).toBe(true)
})

it('uses a hidden primary sidebar’s space without letting widths become negative', () => {
  const layout = fitNativeSidebarLayout({ ...base, viewportWidth: 850, dockWidth: 300, editorVisible: false, sideVisible: false })
  expect(layout.chatFits).toBe(true)
  expect(layout.chatWidth).toBe(502)
  const cramped = fitNativeSidebarLayout({ ...base, viewportWidth: 600, dockWidth: 700 })
  expect(cramped.chatFits).toBe(false)
  expect(cramped.sideWidth).toBe(0)
  expect(cramped.chatWidth).toBe(0)
  expect(cramped.chatLimit).toBe(0)
})
