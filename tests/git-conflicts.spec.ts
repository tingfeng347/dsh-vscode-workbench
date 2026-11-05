import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, expect, it } from 'vitest'
import { gitStatus, run } from '../src/host.ts'
const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
async function repository() {
  const root = await mkdtemp(join(tmpdir(), 'dvw-git-')); roots.push(root)
  const git = async (...args: string[]) => { const result = await run('git', args, root); if (result.code !== 0) throw new Error(result.stderr); return result.stdout }
  await git('init', '-b', 'main'); await git('config', 'user.email', 'test@example.com'); await git('config', 'user.name', 'Test')
  await writeFile(join(root, 'file with spaces.txt'), 'base\n'); await git('add', '.'); await git('commit', '-m', 'base')
  return { root, git }
}
it('shows unresolved merge conflicts', async () => {
  const { root, git } = await repository()
  await git('switch', '-c', 'other'); await writeFile(join(root, 'file with spaces.txt'), 'other\n'); await git('commit', '-am', 'other')
  await git('switch', 'main'); await writeFile(join(root, 'file with spaces.txt'), 'main\n'); await git('commit', '-am', 'main')
  expect((await run('git', ['merge', 'other'], root)).code).toBe(1)
  expect((await gitStatus(root)).changes).toMatchObject([{ path: 'file with spaces.txt', index: 'U', worktree: 'U' }])
})
it('consumes the original path of a rename record without parsing it as another change', async () => {
  const { root, git } = await repository()
  await git('mv', 'file with spaces.txt', '? renamed.txt')
  expect((await gitStatus(root)).changes).toMatchObject([{ path: '? renamed.txt', originalPath: 'file with spaces.txt', index: 'R' }])
})
