import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { gitAction, gitCommitContext } from '../src/host.ts'

const roots: string[] = []
async function temp() { const value = await mkdtemp(join(tmpdir(), 'dvw-commit-')); roots.push(value); return value }
afterEach(async () => { await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))) })

async function init(root: string) {
  const { execFile } = await import('node:child_process')
  const run = (args: string[]) => new Promise<void>((resolve, reject) => execFile('git', args, { cwd: root }, error => error ? reject(error) : resolve()))
  await run(['init', '-b', 'main'])
  await run(['config', 'user.email', 'test@example.com'])
  await run(['config', 'user.name', 'Test'])
}

describe('commit message context', () => {
  it('uses staged changes and reports files plus recent subjects', async () => {
    const root = await temp()
    await init(root)
    await writeFile(join(root, 'base.txt'), 'base\n')
    await gitAction(root, 'stage.all')
    await gitAction(root, 'commit', undefined, 'chore: initial commit')
    await writeFile(join(root, 'base.txt'), 'staged change\n')
    await gitAction(root, 'stage', 'base.txt')
    const context = await gitCommitContext(root)
    expect(context.branch).toBe('main')
    expect(context.files).toEqual(['base.txt'])
    expect(context.recent).toEqual(['chore: initial commit'])
    expect(context.patch).toContain('+staged change')
    expect(context.truncated).toBe(false)
  })

  it('falls back to working-tree and untracked changes', async () => {
    const root = await temp()
    await init(root)
    await mkdir(join(root, 'src'))
    await writeFile(join(root, 'src', 'new.ts'), 'export const value = 1\n')
    const context = await gitCommitContext(root)
    expect(context.files).toEqual(['src/new.ts (新增)'])
    expect(context.patch).toContain('+export const value = 1')
  })

  it('orders source ahead of README and leaves lockfiles out of the patch', async () => {
    const root = await temp()
    await init(root)
    await mkdir(join(root, 'src'))
    await writeFile(join(root, 'README.md'), '# Docs\n\nSome feature description.\n')
    await writeFile(join(root, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n')
    await writeFile(join(root, 'src', 'a.ts'), 'export const answer = 42\n')
    const context = await gitCommitContext(root)
    expect(context.patch).not.toContain('pnpm-lock.yaml')
    expect(context.patch.indexOf('src/a.ts')).toBeLessThan(context.patch.indexOf('README.md'))
  })

  it('refuses to generate a message without changes', async () => {
    const root = await temp()
    await init(root)
    await expect(gitCommitContext(root)).rejects.toMatchObject({ code: 'no-changes' })
  })
})
