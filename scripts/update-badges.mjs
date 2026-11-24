#!/usr/bin/env node
/**
 * Regenerates the README badges as committed SVGs.
 *
 * GitHub's camo image proxy intermittently times out on shields.io dynamic
 * badges (npm downloads, last commit), which leaves broken images in the
 * README. Rendering them once per run through shields' static endpoint and
 * committing the result keeps page views independent of a live third party.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PACKAGE = 'dsh-vscode-workbench'
const REPO = 'tingfeng347/dsh-vscode-workbench'
const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'badges')

const compact = (value) => {
  const format = (number, unit) => `${number.toFixed(1).replace(/\.0$/, '')}${unit}`
  if (value >= 1_000_000) return format(value / 1_000_000, 'M')
  if (value >= 1_000) return format(value / 1_000, 'k')
  return String(value)
}

async function fetchJson(url, headers = {}) {
  const response = await fetch(url, {
    headers: { accept: 'application/json', 'user-agent': `${PACKAGE}-badges`, ...headers },
  })
  if (!response.ok) throw new Error(`${url} responded ${response.status}`)
  return response.json()
}

async function fetchSvg(url) {
  let lastError
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { 'user-agent': `${PACKAGE}-badges` } })
      const body = await response.text()
      if (!response.ok) throw new Error(`responded ${response.status}`)
      if (!body.startsWith('<svg')) throw new Error(`unexpected payload: ${body.slice(0, 60)}`)
      return body
    } catch (error) {
      lastError = error
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 2000))
    }
  }
  throw new Error(`cannot fetch ${url}: ${lastError?.message ?? lastError}`)
}

function badgeUrl({ label, message, color, logo }) {
  const query = new URLSearchParams({ label, message, color, style: 'flat', ...(logo ? { logo } : {}) })
  return `https://img.shields.io/static/v1?${query.toString().replaceAll('+', '%20')}`
}

const registry = await fetchJson(`https://registry.npmjs.org/${PACKAGE}`)
const version = registry['dist-tags']?.latest
const created = registry.time?.created?.slice(0, 10)
if (typeof version !== 'string' || typeof created !== 'string') {
  throw new Error('npm registry response is missing the latest version or creation date')
}

const today = new Date().toISOString().slice(0, 10)
const [monthly, total, commits] = await Promise.all([
  fetchJson(`https://api.npmjs.org/downloads/point/last-month/${PACKAGE}`),
  fetchJson(`https://api.npmjs.org/downloads/point/${created}:${today}/${PACKAGE}`),
  fetchJson(`https://api.github.com/repos/${REPO}/commits/main`, process.env.GITHUB_TOKEN
    ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
    : {}),
])

const committedAt = commits?.commit?.committer?.date
if (typeof committedAt !== 'string') throw new Error('GitHub response is missing the last commit date')

const dateFormat = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
})

const badges = [
  { file: 'npm-version.svg', label: 'npm', message: `v${version}`, color: 'ea7233', logo: 'npm' },
  { file: 'npm-monthly-downloads.svg', label: 'monthly downloads', message: `${compact(monthly.downloads)}/month`, color: '44cc11' },
  { file: 'npm-total-downloads.svg', label: 'total downloads', message: compact(total.downloads), color: '007ec6' },
  { file: 'last-commit.svg', label: 'last commit', message: dateFormat.format(new Date(committedAt)), color: '44cc11' },
]

await mkdir(OUT_DIR, { recursive: true })
for (const badge of badges) {
  const svg = await fetchSvg(badgeUrl(badge))
  const path = join(OUT_DIR, badge.file)
  const previous = await readFile(path, 'utf8').catch(() => '')
  if (previous === svg) {
    console.log(`unchanged ${badge.file}`)
    continue
  }
  await writeFile(path, svg)
  console.log(`updated ${badge.file} (${badge.label}: ${badge.message})`)
}
