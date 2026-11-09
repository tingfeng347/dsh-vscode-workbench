/** Page facts needed to resolve a WebSocket URL. */
export interface WebSocketPageLocation {
  readonly protocol: string
  readonly host: string
}

interface NetworkBase {
  readonly protocol: 'http:' | 'https:'
  readonly host: string
}

const WEB_PAGE_PROTOCOLS = new Set(['http:', 'https:', 'blob:', 'data:', 'about:', 'filesystem:'])

/** Parse a shell-published base only when it is a credential-free HTTP(S) origin. */
function networkBase(value: unknown): NetworkBase | undefined {
  if (typeof value !== 'string' || value === '') return undefined
  let url: URL
  try { url = new URL(value) } catch { return undefined }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined
  if (url.username !== '' || url.password !== '' || url.host === '') return undefined
  return { protocol: url.protocol, host: url.host }
}

/** Read the Host origin published by the DSH Desktop shell before application boot. */
export function transportStreamBaseUrl(globals: typeof globalThis = globalThis): string | undefined {
  const transport = (globals as typeof globalThis & { __DSH_TRANSPORT__?: { streamBaseUrl?: unknown } }).__DSH_TRANSPORT__
  return typeof transport?.streamBaseUrl === 'string' ? transport.streamBaseUrl : undefined
}

/**
 * Resolve an absolute workbench route to a WebSocket URL.
 *
 * Network pages keep their own origin. Application-delivered pages such as
 * `dsh-app://app/` have no WebSocket transport of their own, so they must use
 * the local Host origin published by the desktop shell.
 */
export function websocketUrl(
  path: string,
  location: WebSocketPageLocation = globalThis.location,
  streamBaseUrl: string | undefined = transportStreamBaseUrl(),
): string | undefined {
  const route = path.startsWith('/') ? path : `/${path}`
  if (WEB_PAGE_PROTOCOLS.has(location.protocol)) {
    if (location.host === '') return undefined
    return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${route}`
  }
  const base = networkBase(streamBaseUrl)
  if (base === undefined) return undefined
  return `${base.protocol === 'https:' ? 'wss' : 'ws'}://${base.host}${route}`
}
