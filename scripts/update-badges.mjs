#!/usr/bin/env node
/**
 * Regenerates the README badges as committed SVGs.
 *
 * Render the six project badges locally so README views only fetch repository
 * assets. A release refresh waits for npm metadata to include the new version.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { createHash } from 'node:crypto'
import { makeBadge } from 'badge-maker'

const PACKAGE = 'dsh-vscode-workbench'
const REPO = 'tingfeng347/dsh-vscode-workbench'
const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'badges')
const npmLogo = 'data:image/svg+xml;base64,' + Buffer.from('<svg fill="whitesmoke" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M1.763 0C.786 0 0 .786 0 1.763v20.474C0 23.214.786 24 1.763 24h20.474c.977 0 1.763-.786 1.763-1.763V1.763C24 .786 23.214 0 22.237 0zM5.13 5.323l13.837.019-.009 13.836h-3.464l.01-10.382h-3.456L12.04 19.17H5.113z"/></svg>').toString('base64')

const compact = (value) => {
  const format = (number, unit) => `${number.toFixed(1).replace(/\.0$/, '')}${unit}`
  if (value >= 1_000_000) return format(value / 1_000_000, 'M')
  if (value >= 1_000) return format(value / 1_000, 'k')
  return String(value)
}

async function fetchJson(url, { headers = {}, attempts = 3, verify = (value) => value } = {}) {
  let lastError
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const requestUrl = new URL(url)
      // Each retry must revalidate npm metadata instead of reusing a cached 200.
      if (requestUrl.hostname === 'registry.npmjs.org') requestUrl.searchParams.set('badge-refresh', Date.now())
      const response = await fetch(requestUrl, {
        headers: { accept: 'application/json', 'user-agent': `${PACKAGE}-badges`, 'cache-control': 'no-cache', ...headers },
        signal: AbortSignal.timeout(10_000),
        cache: 'no-store',
      })
      if (!response.ok) throw new Error(`${url} responded ${response.status}`)
      return verify(await response.json())
    } catch (error) {
      lastError = error
      if (attempt < attempts) {
        console.warn(`retry ${attempt}/${attempts}: ${error.message}`)
        await delay(15_000)
      }
    }
  }
  throw new Error(`cannot fetch ${url}: ${lastError?.message ?? lastError}`)
}

function count(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`invalid badge count: ${value}`)
  return compact(value)
}

const previousSvg = await readFile(join(OUT_DIR, 'npm-version.svg'), 'utf8').catch(() => '')
const previousVersion = previousSvg.match(/<title>npm: v([^<]+)<\/title>/)?.[1]
const expectedVersion = process.env.EXPECTED_NPM_VERSION?.replace(/^v/, '')
const requiredVersions = [...new Set([previousVersion, expectedVersion].filter(Boolean))]
const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
await mkdir(OUT_DIR, { recursive: true })

const registry = fetchJson(`https://registry.npmjs.org/${PACKAGE}`, {
  attempts: expectedVersion ? 20 : 3,
  verify(value) {
    const latest = value['dist-tags']?.latest
    const latestTime = Date.parse(value.time?.[latest])
    if (typeof latest !== 'string' || !Number.isFinite(latestTime) || typeof value.time?.created !== 'string') {
      throw new Error('npm registry response is missing the latest version or publication dates')
    }
    for (const version of requiredVersions) {
      const publishedAt = Date.parse(value.time?.[version])
      if (!value.versions?.[version] || !Number.isFinite(publishedAt) || latestTime < publishedAt) {
        throw new Error(`npm latest is ${latest}, waiting for published version ${version} or newer`)
      }
    }
    return value
  },
})

const dateFormat = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
})
const githubHeaders = process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}

const badges = [
  {
    file: 'npm-version.svg', label: 'npm', color: 'ea7233', logoBase64: npmLogo,
    async message() {
      return `v${(await registry)['dist-tags'].latest}`
    },
  },
  {
    file: 'npm-monthly-downloads.svg', label: 'monthly downloads', color: '44cc11',
    async message() {
      const data = await fetchJson(`https://api.npmjs.org/downloads/point/last-month/${PACKAGE}`)
      return `${count(data.downloads)}/month`
    },
  },
  {
    file: 'npm-total-downloads.svg', label: 'total downloads', color: '007ec6',
    async message() {
      const created = (await registry).time.created.slice(0, 10)
      const today = new Date().toISOString().slice(0, 10)
      const data = await fetchJson(`https://api.npmjs.org/downloads/point/${created}:${today}/${PACKAGE}`)
      return count(data.downloads)
    },
  },
  {
    file: 'github-stars.svg', label: 'Stars', color: '007ec6',
    async message() {
      const data = await fetchJson(`https://api.github.com/repos/${REPO}`, { headers: githubHeaders })
      return count(data.stargazers_count)
    },
  },
  {
    file: 'last-commit.svg', label: 'last commit', color: '44cc11',
    async message() {
      const commits = await fetchJson(`https://api.github.com/repos/${REPO}/commits/main`, { headers: githubHeaders })
      return dateFormat.format(new Date(commits?.commit?.committer?.date))
    },
  },
  { file: 'license.svg', label: 'license', color: '97ca00', message: async () => packageJson.license },
]

const results = await Promise.allSettled(badges.map(async ({ file, message: getMessage, ...format }) => {
  const message = await getMessage()
  const svg = makeBadge({ ...format, message, style: 'flat' })
  const hash = createHash('sha256').update(svg).digest('hex').slice(0, 12)
  const path = join(OUT_DIR, file)
  const previous = await readFile(path, 'utf8').catch(() => '')
  if (previous === svg) {
    console.log(`unchanged ${file}`)
    return hash
  }
  await writeFile(path, svg)
  console.log(`updated ${file} (${format.label}: ${message})`)
  return hash
}))
const hashes = new Map()
for (const [index, result] of results.entries()) {
  if (result.status === 'rejected') {
    console.error(`kept previous ${badges[index].file}: ${result.reason.message}`)
    process.exitCode = 1
  } else {
    hashes.set(badges[index].file, result.value)
  }
}

// A changed image gets a new URL so README viewers do not reuse an old cache.
for (const file of ['README.md', 'README.en.md']) {
  const path = new URL(`../${file}`, import.meta.url)
  const previous = await readFile(path, 'utf8')
  const next = previous.replace(/(<img src="[^"\n]*\/assets\/badges\/)([\w-]+\.svg)(?:\?[^"\n]*)?(")/g,
    (match, prefix, filename, suffix) => {
      const hash = hashes.get(filename)
      return hash ? `${prefix}${filename}?v=${hash}${suffix}` : match
    })
  if (next !== previous) {
    await writeFile(path, next)
    console.log(`updated ${file} badge image URLs`)
  }
}
