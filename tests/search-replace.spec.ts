import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { searchWorkspace, replaceSearchResults } from '../src/host.ts'
import type { SearchMatch } from '../src/types.ts'

let root: string
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'dvw-replace-')) })
afterEach(async () => { await rm(root, { recursive: true, force: true }) })
const edit = (row: SearchMatch, text: string) => ({
  line: row.line, column: row.column, length: row.match.length, lineHash: row.lineHash, text,
})

it('replaces selected occurrences after Unicode text and preserves BOM, CRLF and trailing spaces', async () => {
  const file = join(root, 'a.txt')
  await writeFile(file, '\uFEFF中🍐 foo foo  \r\nfoo\r\n')
  const { matches } = await searchWorkspace(root, { query: 'foo' })
  expect(matches.map(row => row.column)).toEqual([5, 9, 1])
  const result = await replaceSearchResults(root, [{ path: 'a.txt', edits: [edit(matches[1]!, 'longer'), edit(matches[2]!, '')] }])
  expect(result.changed).toEqual(['a.txt'])
  expect(await readFile(file, 'utf8')).toBe('\uFEFF中🍐 foo longer  \r\n\r\n')
})

it('keeps an entire stale file intact and reports which other files succeeded', async () => {
  for (const name of ['a', 'b']) await writeFile(join(root, name), 'x\nx\n')
  const { matches } = await searchWorkspace(root, { query: 'x' })
  await writeFile(join(root, 'b'), 'x\nx changed\n')
  const files = ['a', 'b'].map(path => ({ path, edits: matches.filter(row => row.path === path).map(row => edit(row, 'y')) }))
  expect(await replaceSearchResults(root, files)).toMatchObject({ changed: ['a'], failures: [{ path: 'b' }] })
  expect(await readFile(join(root, 'a'), 'utf8')).toBe('y\ny\n')
  expect(await readFile(join(root, 'b'), 'utf8')).toBe('x\nx changed\n')
})

it('never rewrites invalid UTF-8 bytes elsewhere in a matched file', async () => {
  const original = Buffer.from([0x78, 10, 0xff, 10])
  await writeFile(join(root, 'a'), original)
  const { matches } = await searchWorkspace(root, { query: 'x' })
  expect((await replaceSearchResults(root, [{ path: 'a', edits: [edit(matches[0]!, 'y')] }])).failures).toHaveLength(1)
  expect(await readFile(join(root, 'a'))).toEqual(original)
})

it('expands numbered groups with the same Unicode and inline flag semantics as the search', async () => {
  await writeFile(join(root, 'a'), 'A梨! A苹果!\r\n')
  const { matches } = await searchWorkspace(root, { query: '(?i)(a\\w+)(!)', regex: true, captureGroups: [1, 2] })
  expect(matches.map(row => row.captures)).toEqual([['A梨!', 'A梨', '!'], ['A苹果!', 'A苹果', '!']])
  const { replacementFor } = await import('../src/client/searchReplacement.ts')
  const render = replacementFor({ query: '(?i)(a\\w+)(!)', regex: true }, '$2$1\\nnext', false)
  await replaceSearchResults(root, [{ path: 'a', edits: matches.map(row => edit(row, render(row))) }])
  expect(await readFile(join(root, 'a'), 'utf8')).toBe('!A梨\r\nnext !A苹果\r\nnext\r\n')
})

it('respects comma-separated filters, brace alternatives and the Git worktree pointer', async () => {
  for (const path of ['a.js', 'a.ts', 'a.md', 'b.js', '.git']) await writeFile(join(root, path), 'needle')
  const { matches } = await searchWorkspace(root, { query: 'needle', include: 'a.{ts,js}, b.js', exclude: '*.ts, b.js' })
  expect(matches.map(row => row.path)).toEqual(['a.js'])
  const all = await searchWorkspace(root, { query: 'needle' })
  expect(all.matches.map(row => row.path)).not.toContain('.git')
  expect((await replaceSearchResults(root, [{ path: '.git', edits: [edit(matches[0]!, 'oops')] }])).failures).toHaveLength(1)
})

it('preserves case, treats dollar signs literally outside regex mode and handles empty replacements', async () => {
  await writeFile(join(root, 'a'), 'ONE One one')
  const { matches } = await searchWorkspace(root, { query: 'one' })
  const { replacementFor, referencedGroups } = await import('../src/client/searchReplacement.ts')
  expect(matches.map(replacementFor({ query: 'one' }, 'two', true))).toEqual(['TWO', 'Two', 'two'])
  expect(matches.map(replacementFor({ query: 'one' }, '$1', false))).toEqual(['$1', '$1', '$1'])
  expect(referencedGroups('$$1 $0 $2 $11 $2')).toEqual([2, 11])
})

it('only inserts empty matches at valid Unicode boundaries', async () => {
  await writeFile(join(root, 'a'), '梨🍐x\n')
  const { matches } = await searchWorkspace(root, { query: 'x*', regex: true })
  expect(matches.map(row => [row.column, row.match])).toEqual([[1, ''], [2, ''], [4, 'x']])
  await replaceSearchResults(root, [{ path: 'a', edits: matches.map(row => edit(row, '_')) }])
  expect(await readFile(join(root, 'a'), 'utf8')).toBe('_梨_🍐_\n')
})

it('flags an incomplete result set only when more than 2000 matches exist', async () => {
  const path = join(root, 'limit.txt')
  await writeFile(path, 'x\n'.repeat(2000))
  expect((await searchWorkspace(root, { query: 'x' })).limited).toBe(false)
  await writeFile(path, 'x\n'.repeat(2001))
  const result = await searchWorkspace(root, { query: 'x' })
  expect(result.matches).toHaveLength(2000)
  expect(result.limited).toBe(true)
})
