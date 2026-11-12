// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it } from 'vitest'
import { DshPanelPage } from '../src/client/DshPanelPage.tsx'
import { dshPanelLabel, findDshGlobalPanel } from '../src/client/dshPanels.ts'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

afterEach(() => { document.body.replaceChildren() })

function stage() {
  document.body.innerHTML = '<div class="dvw-overlay"><div class="dvw-editor"></div></div><div data-global-panel id="plugins"></div><div id="host"></div>'
  const editor = document.querySelector<HTMLElement>('.dvw-editor')!
  editor.getBoundingClientRect = () => ({ left: 100, top: 85, width: 800, height: 565, right: 900, bottom: 650, x: 100, y: 85, toJSON() {} })
  return { panel: document.getElementById('plugins')!, host: document.getElementById('host')! }
}

it('pins the official DSH panel over the editor and releases it on unmount', async () => {
  const { panel, host } = stage()
  expect(findDshGlobalPanel()).toBe(panel)
  const root = createRoot(host)
  await act(async () => { root.render(<DshPanelPage panelId="plugins" active/>) })
  expect(panel.hasAttribute('data-dvw-dsh-page')).toBe(true)
  expect(panel.hasAttribute('data-dvw-dsh-hidden')).toBe(false)
  expect(panel.style.getPropertyValue('left')).toBe('100px')
  expect(panel.style.getPropertyValue('top')).toBe('85px')
  expect(panel.style.getPropertyValue('width')).toBe('800px')
  expect(panel.style.getPropertyValue('height')).toBe('565px')
  await act(async () => { root.unmount() })
  expect(panel.hasAttribute('data-dvw-dsh-page')).toBe(false)
  expect(panel.style.getPropertyValue('left')).toBe('')
})

it('hides the official panel while a file tab is active and restores it', async () => {
  const { panel, host } = stage()
  const root = createRoot(host)
  await act(async () => { root.render(<DshPanelPage panelId="plugins" active/>) })
  await act(async () => { root.render(<DshPanelPage panelId="plugins" active={false}/>) })
  expect(panel.hasAttribute('data-dvw-dsh-page')).toBe(true)
  expect(panel.hasAttribute('data-dvw-dsh-hidden')).toBe(true)
  await act(async () => { root.render(<DshPanelPage panelId="plugins" active/>) })
  expect(panel.hasAttribute('data-dvw-dsh-hidden')).toBe(false)
  expect(panel.style.getPropertyValue('width')).toBe('800px')
  await act(async () => { root.unmount() })
})

it('names known DSH panels and keeps unknown ids readable', () => {
  expect(dshPanelLabel('plugins')).toBe('插件')
  expect(dshPanelLabel('third-party-panel')).toBe('third-party-panel')
})
