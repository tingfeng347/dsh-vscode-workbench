import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_WATCH_IGNORES, isIgnoredPath, parseGitIgnore, parseWatchIgnores, watchIgnore, workspaceWatchIgnores } from '../src/watch-ignore.ts'

describe('Workspace watcher exclusions', () => {
  it('skips dependency, vendor and build trees by default', () => {
    expect(isIgnoredPath('third_part/libs/boost/boost/geometry/srs/projections/proj/lagrng.hpp', DEFAULT_WATCH_IGNORES)).toBe(true)
    expect(isIgnoredPath('node_modules/chokidar/index.js', DEFAULT_WATCH_IGNORES)).toBe(true)
    expect(isIgnoredPath('packages/app/dist/bundle.js', DEFAULT_WATCH_IGNORES)).toBe(true)
    expect(isIgnoredPath('.venv/lib/python3.14/site-packages/x.py', DEFAULT_WATCH_IGNORES)).toBe(true)
    expect(isIgnoredPath('__pycache__/module.cpython-314.pyc', DEFAULT_WATCH_IGNORES)).toBe(true)
  })

  it('keeps ordinary source files and root itself watchable', () => {
    expect(isIgnoredPath('src/main.ts', DEFAULT_WATCH_IGNORES)).toBe(false)
    expect(isIgnoredPath('docs/building.md', DEFAULT_WATCH_IGNORES)).toBe(false)
    expect(isIgnoredPath('src/build.ts', DEFAULT_WATCH_IGNORES)).toBe(false)
    expect(isIgnoredPath('', DEFAULT_WATCH_IGNORES)).toBe(false)
  })

  it('accepts user names and relative path fragments', () => {
    const patterns = parseWatchIgnores('generated\nthird_part/libs/boost\n# ignore comments\n\n../outside')
    expect(patterns).toEqual(['generated', 'third_part/libs/boost'])
    expect(isIgnoredPath('docs/generated/api.json', patterns)).toBe(true)
    expect(isIgnoredPath('third_part/libs/boost/boost.hpp', patterns)).toBe(true)
    expect(isIgnoredPath('third_part/libs/other/boost.hpp', patterns)).toBe(false)
  })

  it('matches both path separators and ignores case', () => {
    const patterns = parseWatchIgnores('Third_Part\\Libs')
    expect(isIgnoredPath('third_part/libs/boost/a.hpp', patterns)).toBe(true)
    expect(isIgnoredPath('THIRD_PART/LIBS/boost/a.hpp', patterns)).toBe(true)
  })

  it('builds a chokidar predicate relative to the workspace', () => {
    const ignored = watchIgnore('/repo', parseWatchIgnores('generated'))
    expect(ignored('/repo')).toBe(false)
    expect(ignored(join('/repo', 'third_part', 'libs', 'a.hpp'))).toBe(true)
    expect(ignored(join('/repo', 'src', 'main.ts'))).toBe(false)
    expect(ignored(join('/', 'elsewhere', 'vendor', 'a.js'))).toBe(false)
  })
})

describe('Workspace .gitignore exclusions', () => {
  it('turns literal gitignore rules into watch patterns', () => {
    expect(parseGitIgnore('node_modules\n/generated/\n# comment\n!keep.txt\nthird_part/libs/boost\n*.log\nbuild\n')).toEqual(['node_modules', 'generated', 'third_part/libs/boost', 'build'])
  })

  it('reads the root .gitignore without asking the user', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dvw-ignore-'))
    try {
      await writeFile(join(root, '.gitignore'), 'dist\n.config/local\n')
      expect(await workspaceWatchIgnores(root)).toEqual(['dist', '.config/local'])
      expect(isIgnoredPath('.config/local/settings.json', await workspaceWatchIgnores(root))).toBe(true)
      expect(isIgnoredPath('src/main.ts', await workspaceWatchIgnores(root))).toBe(false)
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it('treats a missing .gitignore as no extra exclusions', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dvw-ignore-'))
    try { expect(await workspaceWatchIgnores(root)).toEqual([]) } finally { await rm(root, { recursive: true, force: true }) }
  })
})
