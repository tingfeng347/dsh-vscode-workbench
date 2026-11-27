import timers from 'node:timers/promises'
import { syncBuiltinESMExports } from 'node:module'

timers.setTimeout = async () => {}
syncBuiltinESMExports()
const originalTimeout = globalThis.setTimeout
globalThis.setTimeout = (callback, _delay, ...args) => originalTimeout(callback, 0, ...args)

const scenario = JSON.parse(process.env.BADGE_TEST_SCENARIO)
let registryRequests = 0

globalThis.fetch = async (input) => {
  const url = new URL(input)
  console.log(`fixture request ${url.host}${url.pathname}`)
  if (url.host === 'registry.npmjs.org') {
    const version = scenario.registries[Math.min(registryRequests++, scenario.registries.length - 1)]
    const versions = ['0.5.0', '0.5.1', '0.5.2'].slice(0, ['0.5.0', '0.5.1', '0.5.2'].indexOf(version) + 1)
    return Response.json({
      'dist-tags': { latest: version },
      versions: Object.fromEntries(versions.map((value) => [value, { version: value }])),
      time: {
        created: '2026-11-01T00:00:00Z',
        ...Object.fromEntries(versions.map((value, index) => [value, `2026-11-${25 + index}T00:00:00Z`])),
      },
    })
  }
  if (url.host === 'api.npmjs.org') {
    if (url.pathname.includes('last-month') && scenario.failMonthly) {
      return new Response('unavailable', { status: 503 })
    }
    return Response.json({ downloads: url.pathname.includes('last-month') ? 7000 : 11500 })
  }
  if (url.host === 'api.github.com') {
    if (url.pathname.endsWith('/commits/main')) {
      return Response.json({ commit: { committer: { date: '2026-11-27T01:58:08Z' } } })
    }
    return Response.json({ stargazers_count: 42 })
  }
  throw new Error(`Unexpected network request ${url}`)
}
