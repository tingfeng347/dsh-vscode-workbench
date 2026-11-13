import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { WorkspaceSite } from '../src/site.ts'
import type { HostContext } from '../src/context.ts'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })

async function workspace() {
  const root = await mkdtemp(join(tmpdir(), 'dvw-site-'))
  roots.push(root)
  await writeFile(join(root, 'index.html'), '<!doctype html><link rel="stylesheet" href="style.css"><h1>预览</h1>')
  await writeFile(join(root, 'style.css'), 'h1 { color: red }')
  const ctx = { sessions: { get: (id: string) => id === 's' ? {} : undefined }, workingDirectory: { get: () => root } } as unknown as HostContext
  return { root, site: new WorkspaceSite(ctx) }
}

it('serves a workspace page and its relative assets from a token-guarded origin', async () => {
  const { site } = await workspace()
  const url = await site.url('s', 'index.html')
  const page = await fetch(url)
  expect(page.status).toBe(200)
  expect(page.headers.get('content-type')).toBe('text/html; charset=utf-8')
  expect(await page.text()).toContain('预览')
  const asset = await fetch(new URL('style.css', url))
  expect(asset.status).toBe(200)
  expect(asset.headers.get('content-type')).toBe('text/css; charset=utf-8')
  expect(await asset.text()).toContain('color: red')
  site.dispose()
})

it('refuses the wrong token and paths outside the workspace', async () => {
  const { site } = await workspace()
  const url = new URL(await site.url('s', 'index.html'))
  const wrong = new URL(url); wrong.pathname = wrong.pathname.replace(url.pathname.split('/')[1]!, 'nope')
  expect((await fetch(wrong)).status).toBe(404)
  expect((await fetch(await site.url('s', '../secret.txt'))).status).not.toBe(200)
  site.dispose()
})
