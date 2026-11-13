// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it } from 'vitest'
import { MarkdownPreview } from '../src/client/MarkdownPreview.tsx'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
afterEach(() => { document.body.replaceChildren() })

async function render(source: string, path: string) {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () => { root.render(<MarkdownPreview source={source} sessionId="s" path={path}/>) })
  return { host, root }
}

function click(host: HTMLElement, text: string) {
  const anchor = [...host.querySelectorAll('a')].find(node => node.textContent === text)
  expect(anchor).toBeDefined()
  anchor!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
}

it('sends web links to the configured browser instead of navigating the app', async () => {
  const { host, root } = await render('[外链](https://example.com/docs)', 'README.md')
  const seen: string[] = []
  const listener = (event: Event) => seen.push((event as CustomEvent<string>).detail)
  window.addEventListener('dvw-open-external-url', listener)
  click(host, '外链')
  window.removeEventListener('dvw-open-external-url', listener)
  expect(seen).toEqual(['https://example.com/docs'])
  await act(async () => { root.unmount() })
})

it('keeps relative links inside the workbench editor', async () => {
  const { host, root } = await render('[文档](docs/guide.md)', 'README.md')
  const seen: string[] = []
  const listener = (event: Event) => seen.push((event as CustomEvent<string>).detail)
  window.addEventListener('dvw-open-workspace-path', listener)
  click(host, '文档')
  window.removeEventListener('dvw-open-workspace-path', listener)
  expect(seen).toEqual(['docs/guide.md'])
  await act(async () => { root.unmount() })
})
