import { afterEach, describe, expect, it } from 'vitest'
import { copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'

const root = fileURLToPath(new URL('../../', import.meta.url))
const directories = []
const cachedMonthly = '<svg><title>monthly downloads: cached</title></svg>'

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

async function runUpdate(scenario, previousVersion = '0.5.0') {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-badges-'))
  directories.push(directory)
  await mkdir(join(directory, 'scripts'))
  await mkdir(join(directory, 'assets/badges'), { recursive: true })
  await copyFile(join(root, 'scripts/update-badges.mjs'), join(directory, 'scripts/update-badges.mjs'))
  await copyFile(join(root, 'package.json'), join(directory, 'package.json'))
  await copyFile(join(root, 'README.md'), join(directory, 'README.md'))
  await copyFile(join(root, 'README.en.md'), join(directory, 'README.en.md'))
  await symlink(join(root, 'node_modules'), join(directory, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
  await writeFile(join(directory, 'assets/badges/npm-version.svg'), `<svg aria-label="npm: v${previousVersion}"><title>npm: v${previousVersion}</title></svg>`)
  await writeFile(join(directory, 'assets/badges/npm-monthly-downloads.svg'), cachedMonthly)

  const result = spawnSync(process.execPath, [
    '--import', new URL('./fixtures/badge-network.mjs', import.meta.url).href,
    join(directory, 'scripts/update-badges.mjs'),
  ], {
    encoding: 'utf8',
    timeout: 10_000,
    env: {
      ...process.env,
      BADGE_TEST_SCENARIO: JSON.stringify(scenario),
      EXPECTED_NPM_VERSION: 'v0.5.1',
      GITHUB_TOKEN: '',
    },
  })
  if (result.error) throw result.error
  const badge = (name) => readFile(join(directory, 'assets/badges', name), 'utf8')
  const readme = (file) => readFile(join(directory, file), 'utf8')
  return { ...result, badge, readme }
}

describe('README badge refresh', () => {
  it('waits for a published version to become visible and renders the six badges locally', async () => {
    const result = await runUpdate({ registries: ['0.5.0', '0.5.1'] })
    expect(result.status, result.stderr).toBe(0)
    expect(await result.badge('npm-version.svg')).toContain('<title>npm: v0.5.1</title>')
    expect(await result.badge('github-stars.svg')).toContain('<title>Stars: 42</title>')
    expect(await result.badge('license.svg')).toContain('<title>license: MIT</title>')
    expect(await result.badge('npm-monthly-downloads.svg')).toContain('7k/month')
    expect(await result.badge('npm-total-downloads.svg')).toContain('11.5k')
    expect(await result.badge('last-commit.svg')).toContain('Nov 27, 2026')
    expect(result.stdout).not.toContain('img.shields.io')
    const hash = createHash('sha256').update(await result.badge('npm-version.svg')).digest('hex').slice(0, 12)
    for (const file of ['README.md', 'README.en.md']) {
      expect(await result.readme(file)).toContain(`npm-version.svg?v=${hash}`)
      expect(await result.readme(file)).not.toContain('https://img.shields.io/github/')
    }
  })

  it('reports stale npm metadata and preserves the previous version badge', async () => {
    const result = await runUpdate({ registries: ['0.5.0'] })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('0.5.1')
    expect(await result.badge('npm-version.svg')).toContain('<title>npm: v0.5.0</title>')
  })

  it('updates the version even if download statistics fail, keeping the last valid statistics', async () => {
    const result = await runUpdate({ registries: ['0.5.1'], failMonthly: true })
    expect(result.status).toBe(1)
    expect(await result.badge('npm-version.svg')).toContain('<title>npm: v0.5.1</title>')
    expect(await result.badge('npm-monthly-downloads.svg')).toBe(cachedMonthly)
    expect(await result.badge('github-stars.svg')).toContain('<title>Stars: 42</title>')
    expect(result.stderr).toContain('503')
    const hash = createHash('sha256').update(await result.badge('npm-version.svg')).digest('hex').slice(0, 12)
    for (const file of ['README.md', 'README.en.md']) {
      const previous = await readFile(join(root, file), 'utf8')
      const monthlyUrl = previous.match(/src="([^"\n]*\/npm-monthly-downloads\.svg[^"\n]*)"/)[1]
      const updated = await result.readme(file)
      expect(updated).toContain(`src="${monthlyUrl}"`)
      expect(updated).toContain(`npm-version.svg?v=${hash}`)
    }
  })

  it('keeps a newer version when an older release event runs against stale metadata', async () => {
    const result = await runUpdate({ registries: ['0.5.1', '0.5.2'] }, '0.5.2')
    expect(result.status, result.stderr).toBe(0)
    expect(await result.badge('npm-version.svg')).toContain('<title>npm: v0.5.2</title>')
  })
})
