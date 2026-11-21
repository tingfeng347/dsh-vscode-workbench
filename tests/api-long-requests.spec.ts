import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

// The API used to race every handler against one 8 second deadline. That 504'd the directory
// picker while it was still waiting for the user, and killed LSP installs that npm was still
// running. These assertions keep the shared cap from creeping back.
it('does not cap every API call with one shared deadline', () => {
  const index = read('src/index.ts')
  expect(index).not.toContain('8_000')
  expect(index).not.toMatch(/Promise\.race\(\[\s*dispatch\(/)
  expect(index).toContain('const deadline = API_DEADLINES[method]')
})

it('gives only the external-process calls a deadline of their own', () => {
  const index = read('src/index.ts')
  expect(index).toContain("'lsp.install': 10 * 60 * 1000")
  expect(index).toContain("'lsp.uninstall': 10 * 60 * 1000")
  // The picker waits for the user, so it must not appear in the deadline table.
  expect(index).not.toContain("'workspace.open': 10")
})

it('cancels a request through to the directory picker and the LSP install', () => {
  const index = read('src/index.ts')
  const lsp = read('src/lsp.ts')
  expect(index).toContain('openWorkspaceFromPicker(dshDirectoryPicker, dshWorkspaceRegistry, signal ?? new AbortController().signal)')
  expect(index).toContain("installLsp(stringField(body, 'id'), signal)")
  expect(lsp).toContain("signal?.addEventListener('abort', abort")
  expect(lsp).toContain('child.kill()')
})