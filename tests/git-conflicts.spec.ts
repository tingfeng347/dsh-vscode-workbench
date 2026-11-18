import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, expect, it } from 'vitest'
import type { GitConflictVersions, GitDiff, GitStash } from '../src/types.ts'
import { gitAction, gitBlameLine, gitBlameRange, gitStatus, readDocument, run } from '../src/host.ts'
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
  expect(await gitStatus(root)).toMatchObject({ operation: 'merge', changes: [{ path: 'file with spaces.txt', index: 'U', worktree: 'U', conflicted: true }] })
  expect(await gitAction(root, 'conflict.diff', 'file with spaces.txt')).toMatchObject({ original: 'main\n', modified: 'other\n' })
  expect(await gitAction(root, 'conflict.theirs', 'file with spaces.txt')).toMatchObject({ changes: [{ index: 'M', worktree: '.' }] })
  expect(await gitAction(root, 'operation.continue', undefined, 'merge')).toMatchObject({ changes: [] })
  expect((await git('rev-list', '--parents', '-n1', 'HEAD')).trim().split(' ')).toHaveLength(3)
})
it('consumes the original path of a rename record without parsing it as another change', async () => {
  const { root, git } = await repository()
  // A porcelain-looking original path detects a missing NUL-record consumption.
  // Both names are valid on Windows as well as POSIX filesystems.
  await git('mv', 'file with spaces.txt', '1 original file.txt')
  await git('commit', '-m', 'prepare rename fixture')
  await git('mv', '1 original file.txt', 'renamed with spaces.txt')
  expect((await gitStatus(root)).changes).toMatchObject([{ path: 'renamed with spaces.txt', originalPath: '1 original file.txt', index: 'R' }])
})

it('compares renamed files between two refs and supplies both versions', async () => {
  const { root, git } = await repository()
  await git('branch', 'before')
  await git('mv', 'file with spaces.txt', 'renamed.txt')
  await git('commit', '-m', 'rename')
  const pair = JSON.stringify(['before', 'HEAD'])
  expect(await gitAction(root, 'compare.files', undefined, pair)).toEqual([
    { path: 'renamed.txt', previousPath: 'file with spaces.txt', status: 'R' },
  ])
  expect(await gitAction(root, 'compare.diff', 'renamed.txt', pair)).toMatchObject({ original: 'base\n', modified: 'base\n' })
  expect(await gitAction(root, 'file.history', 'renamed.txt')).toMatchObject([{ subject: 'rename' }, { subject: 'base' }])
  expect(await gitAction(root, 'file.blame', 'renamed.txt')).toContain('base')
})

it('stages and unstages one text hunk and rejects a stale revision', async () => {
  const { root, git } = await repository()
  const target = 'file with spaces.txt'
  const original = Array.from({ length: 30 }, (_, index) => `line ${index}`)
  await writeFile(join(root, target), original.join('\n')+'\n')
  await git('commit', '-am', 'prepare two independent hunks')
  const changed = [...original]
  changed[1] = 'first edit'
  changed[25] = 'second edit'
  await writeFile(join(root, target), changed.join('\n')+'\n')
  const worktree = await gitAction(root, 'diff', target, 'worktree') as GitDiff
  expect(worktree.staging?.hunks).toHaveLength(2)
  const choice = JSON.stringify([worktree.staging?.revision, '0'])
  await gitAction(root, 'hunk.stage', target, choice)
  const cached = await git('diff', '--cached')
  expect(cached).toContain('+first edit')
  expect(cached).not.toContain('+second edit')
  await expect(gitAction(root, 'hunk.stage', target, choice)).rejects.toMatchObject({ code: 'revision-conflict' })
  const staged = await gitAction(root, 'diff', target, 'staged') as GitDiff
  await gitAction(root, 'hunk.unstage', target, JSON.stringify([staged.staging?.revision, '0']))
  expect(await git('diff', '--cached')).toBe('')
  expect(await git('diff')).toContain('+second edit')
})

it('applies a stash with staged and untracked changes and keeps the stash', async () => {
  const { root, git } = await repository()
  await writeFile(join(root, 'file with spaces.txt'), 'staged new content\n')
  await git('add', '.')
  await writeFile(join(root, 'untracked.txt'), 'untracked\n')
  await gitAction(root, 'stash.push', undefined, 'draft')
  expect((await gitStatus(root)).changes).toEqual([])
  const [stash] = await gitAction(root, 'stash.list') as GitStash[]
  expect(stash?.subject).toContain('draft')
  await gitAction(root, 'stash.apply', undefined, JSON.stringify([stash?.ref, stash?.hash]))
  expect((await gitStatus(root)).changes).toMatchObject([{ index: 'M' }, { path: 'untracked.txt', untracked: true }])
  expect(await gitAction(root, 'stash.list')).toHaveLength(1)
})

it('loads all three conflict versions and stages a manually edited result', async () => {
  const { root, git } = await repository()
  const path = 'file with spaces.txt'
  await git('switch', '-c', 'other')
  await writeFile(join(root, path), 'other\n')
  await git('commit', '-am', 'other')
  await git('switch', 'main')
  await writeFile(join(root, path), 'main\n')
  await git('commit', '-am', 'main')
  expect((await run('git', ['merge', 'other'], root)).code).toBe(1)
  const versions = await gitAction(root, 'conflict.versions', path) as GitConflictVersions
  expect(versions).toMatchObject({ base: 'base\n', ours: 'main\n', theirs: 'other\n' })
  const save = (content: string)=>gitAction(root, 'conflict.save', path, JSON.stringify([versions.revision, versions.document?.revision, content]))
  await expect(save(versions.document!.content)).rejects.toMatchObject({ code: 'unresolved-markers' })
  await save('main and other\n')
  expect(await git('show', `:${path}`)).toBe('main and other\n')
})

it('compares a tracked working-tree file against a ref', async () => {
  const { root } = await repository()
  const path = 'file with spaces.txt'
  await writeFile(join(root, path), 'working copy\n')
  const pair = JSON.stringify(['HEAD', ':worktree:'])
  expect(await gitAction(root, 'compare.files', undefined, pair)).toEqual([{ path, status: 'M' }])
  expect(await gitAction(root, 'compare.diff', path, pair)).toMatchObject({ original: 'base\n', modified: 'working copy\n' })
})

it('opens a deleted tracked file as a deletion in both working-tree diff paths', async () => {
  const { root } = await repository()
  const path = 'file with spaces.txt'
  await rm(join(root,path))
  const expected = { original:'base\n', modified:'', diff:expect.stringContaining('-base') }
  expect(await gitAction(root,'diff',path,'worktree')).toMatchObject(expected)
  expect(await gitAction(root,'compare.diff',path,JSON.stringify(['HEAD',':worktree:']))).toMatchObject(expected)
})

it('rejects oversized working-tree text instead of substituting an empty snapshot', async () => {
  const { root, git } = await repository()
  const path = 'file with spaces.txt'
  const large = ('x'.repeat(99)+'\n').repeat(52_500)
  await writeFile(join(root,path),large)
  await git('commit','-am','large file')
  await writeFile(join(root,path),large+'added line\n')
  const expected = {code:'too-large',status:413}
  await expect(gitAction(root,'diff',path,'worktree')).rejects.toMatchObject(expected)
  await expect(gitAction(root,'compare.diff',path,JSON.stringify(['HEAD',':worktree:']))).rejects.toMatchObject(expected)
})

it('attributes clicked lines to the correct snapshot and commit on each side', async () => {
  const { root, git } = await repository()
  const path = 'file with spaces.txt'
  const first = (await git('rev-parse', 'HEAD')).trim()
  await git('config', 'user.name', 'Second Author')
  await writeFile(join(root,path), 'base\ncommitted line\n')
  await git('commit', '-am', 'second commit')
  const second = (await git('rev-parse', 'HEAD')).trim()
  const historical = await gitAction(root,'commit.file.diff',path,second) as GitDiff
  expect(await gitBlameLine(root,historical.blame?.original,1))
    .toMatchObject({kind:'commit',hash:first,author:'Test',subject:'base',timestamp:expect.any(Number)})
  expect(await gitBlameLine(root,historical.blame?.modified,2))
    .toMatchObject({kind:'commit',hash:second,author:'Second Author',subject:'second commit'})

  await writeFile(join(root,path), 'base\ncommitted line\nstaged line\n')
  await git('add', path)
  await writeFile(join(root,path), 'base\nworktree edit\nstaged line\n')
  const diff = await gitAction(root,'diff',path,'worktree') as GitDiff
  expect(await gitBlameRange(root,diff.blame?.modified,1,3)).toEqual({
    startLine:1,lines:[expect.objectContaining({hash:first}),{kind:'uncommitted'},{kind:'uncommitted'}],
  })
  expect(await gitBlameLine(root,diff.blame?.original,2)).toMatchObject({hash:second})
  expect(await gitBlameLine(root,diff.blame?.modified,2)).toEqual({kind:'uncommitted'})
  expect(await gitBlameLine(root,diff.blame?.original,3)).toEqual({kind:'uncommitted'})

  const document = await readDocument(root,path)
  const source = {kind:'document',path,revision:document.revision}
  expect(await gitBlameLine(root,source,1)).toMatchObject({hash:first})
  expect(await gitBlameLine(root,source,2)).toEqual({kind:'uncommitted'})
  await writeFile(join(root,path), 'file changed again\n')
  await expect(gitBlameLine(root,diff.blame?.modified,2)).rejects.toMatchObject({code:'stale-diff'})
  await expect(gitBlameLine(root,source,1)).rejects.toMatchObject({code:'stale-diff'})
})

it('preserves the committed history of a staged rename in both the diff and file editor', async () => {
  const { root, git } = await repository()
  const path = 'renamed.txt'
  const head = (await git('rev-parse', 'HEAD')).trim()
  await git('mv', 'file with spaces.txt', path)
  const diff = await gitAction(root,'diff',path,'staged') as GitDiff
  expect(await gitBlameLine(root,diff.blame?.original,1)).toMatchObject({hash:head})
  expect(await gitBlameLine(root,diff.blame?.modified,1)).toMatchObject({hash:head})
  const document = await readDocument(root,path)
  expect(await gitBlameLine(root,{kind:'document',path,revision:document.revision},1)).toMatchObject({hash:head})
})

it('creates a tag from a selected ref and renames a local branch', async () => {
  const { root, git } = await repository()
  await git('branch', 'before')
  await gitAction(root, 'tag.create', 'refs/heads/before', 'release-test')
  await gitAction(root, 'branch.rename', undefined, JSON.stringify(['before', 'after']))
  expect(await gitAction(root, 'refs')).toEqual(['refs/heads/after', 'refs/heads/main', 'refs/tags/release-test'])
  await gitAction(root, 'branch.delete', undefined, 'after')
  await gitAction(root, 'tag.delete', undefined, 'release-test')
  expect(await gitAction(root, 'refs')).toEqual(['refs/heads/main'])
})
