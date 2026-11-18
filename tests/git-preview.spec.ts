import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { gitAction, gitPreviewFile } from '../src/host.ts'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

async function repository() {
  const root = await mkdtemp(join(tmpdir(), 'dvw-preview-')); roots.push(root)
  const git = (...args: string[]) => new Promise<void>((resolve, reject) => execFile('git', args, { cwd: root }, error => error ? reject(error) : resolve()))
  await git('init')
  await git('config', 'user.email', 'test@example.com')
  await git('config', 'user.name', 'Test')
  return { root, git }
}

it('reads binary previews from the committed blob and falls back to the parent for deletions', async () => {
  const { root } = await repository()
  await mkdir(join(root, 'assets'))
  const first = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01, 0x02])
  const second = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x03, 0x04])
  await writeFile(join(root, 'assets', 'shot.png'), first)
  await gitAction(root, 'stage.all')
  await gitAction(root, 'commit', undefined, 'first image')
  const [initial] = await gitAction(root, 'log') as Array<{ hash: string }>
  const original = await gitPreviewFile(root, initial?.hash ?? '', 'assets/shot.png')
  expect(original).toMatchObject({ type: 'image/png', name: 'shot.png' })
  expect(original.data.equals(first)).toBe(true)

  await writeFile(join(root, 'assets', 'shot.png'), second)
  await gitAction(root, 'stage.all')
  await gitAction(root, 'commit', undefined, 'second image')
  const [head] = await gitAction(root, 'log') as Array<{ hash: string }>
  expect((await gitPreviewFile(root, head?.hash ?? '', 'assets/shot.png')).data.equals(second)).toBe(true)

  await rm(join(root, 'assets', 'shot.png'))
  await gitAction(root, 'stage.all')
  await gitAction(root, 'commit', undefined, 'delete image')
  const [deleted] = await gitAction(root, 'log') as Array<{ hash: string }>
  expect((await gitPreviewFile(root, deleted?.hash ?? '', 'assets/shot.png')).data.equals(second)).toBe(true)

  await expect(gitPreviewFile(root, head?.hash ?? '', 'missing.png')).rejects.toMatchObject({ code: 'not-found' })
  await writeFile(join(root, 'README.txt'), 'text')
  await gitAction(root, 'stage.all')
  await gitAction(root, 'commit', undefined, 'text file')
  await expect(gitPreviewFile(root, head?.hash ?? '', 'README.txt')).rejects.toMatchObject({ code: 'unsupported-media' })
})
