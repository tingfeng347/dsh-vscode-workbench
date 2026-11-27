import { ApiError } from '../transport/api.ts'
import type { SshConnectRequest, SshConnection, SshHost } from '../../shared/types.ts'

const HISTORY_KEY = 'dvw:ssh-hosts:v1'

export type { SshConnectRequest, SshConnection, SshHost }

export interface SshHistoryEntry extends Omit<SshConnectRequest, 'password' | 'savePassword' | 'useSavedPassword'> {
  label: string
  lastUsed: string
  authMethod?: 'password' | 'key'
  passwordSaved?: boolean
}

/** Encode a remote file as an editor path without making its directory structure ambiguous. */
export function remoteFileUri(connectionId: string, path: string): string {
  const encoded = path.split('/').filter(Boolean).map(encodeURIComponent).join('/')
  return `ssh://${connectionId}/${encoded}`
}

export function isRemoteFileUri(path: string): boolean {
  return path.startsWith('ssh://')
}

export function remoteFileParts(path: string): { connectionId: string; remotePath: string } | undefined {
  if (!isRemoteFileUri(path)) return undefined
  try {
    const url = new URL(path)
    return {
      connectionId: url.hostname,
      remotePath: url.pathname.slice(1).split('/').filter(Boolean).map(decodeURIComponent).join('/'),
    }
  } catch {
    return undefined
  }
}

/** Authenticated HTTP source for a remote image or document preview. */
export function remotePreviewUrl(sessionId: string, path: string, version = Date.now()): string | undefined {
  const parts = remoteFileParts(path)
  if (parts === undefined || parts.remotePath === '') return undefined
  return `/dsh-vscode/ssh/file?${new URLSearchParams({
    sessionId,
    connectionId: parts.connectionId,
    path: parts.remotePath,
    v: String(version),
  })}`
}

export function readSshHistory(): SshHistoryEntry[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]')
    if (!Array.isArray(value)) return []
    return value.filter((row): row is SshHistoryEntry => row !== null && typeof row === 'object'
      && !Array.isArray(row)
      && typeof (row as SshHistoryEntry).host === 'string'
      && (row as SshHistoryEntry).host !== ''
      && typeof (row as SshHistoryEntry).label === 'string'
      && typeof (row as SshHistoryEntry).lastUsed === 'string')
      .sort((left, right) => right.lastUsed.localeCompare(left.lastUsed))
      .slice(0, 20)
  } catch {
    return []
  }
}

export function rememberSshHost(request: SshConnectRequest, label: string, authMethod?: SshHistoryEntry['authMethod'], passwordSaved?: boolean): SshHistoryEntry[] {
  const { password: _password, savePassword: _save, useSavedPassword: _use, ...safeRequest } = request
  const previous = readSshHistory()
  const last = previous.find(row => row.host === request.host && row.user === request.user)
  const method = authMethod ?? (request.password ? 'password' : last?.authMethod)
  const saved = passwordSaved ?? last?.passwordSaved
  const entry: SshHistoryEntry = {
    ...(method === undefined ? {} : { authMethod: method }),
    ...(method === 'password' && saved !== undefined ? { passwordSaved: saved } : {}),
    ...safeRequest,
    label,
    lastUsed: new Date().toISOString(),
  }
  const next = [entry, ...previous.filter(row => !(row.host === entry.host && row.user === entry.user && row.workspace === entry.workspace))].slice(0, 20)
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(next)) } catch { /* Private browsing can still use the current connection. */ }
  return next
}

export function forgetSshHost(host: string): SshHistoryEntry[] {
  const next = readSshHistory().filter(row => row.host !== host)
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(next)) } catch { /* Keep the in-memory form usable. */ }
  return next
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}


export function sshDisconnected(error: unknown): boolean {
  return error instanceof ApiError && error.code === 'ssh-disconnected'
}


export function fileParts(path: string): { directory: string; name: string } {
  const index = path.lastIndexOf('/')
  return index < 0 ? { directory: '', name: path } : { directory: path.slice(0, index), name: path.slice(index + 1) }
}
