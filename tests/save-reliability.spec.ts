import { chmod, lstat, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { deleteEntry, readDocument, saveDocument } from '../src/host.ts'

const roots: string[] = []
async function temp() { const root = await mkdtemp(join(tmpdir(), 'dvw-save-')); roots.push(root); return root }
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

it.each(['', '.', './', 'sub/..'])('rejects deleting workspace root via %j', async path => {
  const root = await temp()
  await writeFile(join(root, 'keep.txt'), 'keep')
  await expect(deleteEntry(root, path)).rejects.toMatchObject({ code: 'root-delete' })
  expect(await readFile(join(root, 'keep.txt'), 'utf8')).toBe('keep')
})

it.skipIf(process.platform === 'win32').each([0o755, 0o600])('preserves file permissions %i when saving', async mode => {
  const root = await temp()
  await writeFile(join(root, 'script.sh'), 'old')
  await chmod(join(root, 'script.sh'), mode)
  const doc = await readDocument(root, 'script.sh')
  await saveDocument(root, 'script.sh', 'new', doc.revision)
  expect((await stat(join(root, 'script.sh'))).mode & 0o777).toBe(mode)
})

it.skipIf(process.platform === 'win32')('saves through an internal symbolic link without replacing it', async () => {
  const root = await temp()
  await writeFile(join(root, 'target.txt'), 'old')
  await symlink('target.txt', join(root, 'link.txt'))
  const doc = await readDocument(root, 'link.txt')
  const saved = await saveDocument(root, 'link.txt', 'new', doc.revision)
  expect(saved.path).toBe('link.txt')
  expect((await lstat(join(root, 'link.txt'))).isSymbolicLink()).toBe(true)
  expect(await readFile(join(root, 'target.txt'), 'utf8')).toBe('new')
})

it('rejects the second concurrent save with the same revision', async () => {
  const root = await temp()
  await writeFile(join(root, 'file.txt'), 'old')
  const doc = await readDocument(root, 'file.txt')
  const results = await Promise.allSettled([
    saveDocument(root, 'file.txt', 'first', doc.revision),
    saveDocument(root, './file.txt', 'second', doc.revision),
  ])
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
  const rejected = results.find(result => result.status === 'rejected') as PromiseRejectedResult
  expect(rejected.reason).toMatchObject({ code: 'revision-conflict' })
  const current = await readDocument(root, 'file.txt')
  await expect(saveDocument(root, 'file.txt', 'next', current.revision)).resolves.toMatchObject({ content: 'next' })
})
