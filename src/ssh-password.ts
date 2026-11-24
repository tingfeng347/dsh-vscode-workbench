import { createHash } from 'node:crypto'

const service = 'dsh-vscode-workbench.ssh'

export function sshPasswordAccount(host: string, hostName: string, user: string | undefined, port: number | undefined): string {
  return createHash('sha256').update(JSON.stringify([host, hostName, user, port])).digest('hex')
}

async function passwordEntry(account: string) {
  const { AsyncEntry } = await import('@napi-rs/keyring')
  return new AsyncEntry(service, account, { linux: { store: 'secret-service' } })
}

export async function readSshPassword(account: string): Promise<string | undefined> {
  try {
    const entry = await passwordEntry(account)
    const encoded = await entry.getPassword(AbortSignal.timeout(8_000))
    return encoded ? Buffer.from(encoded, 'base64').toString('utf8') || undefined : undefined
  } catch {
    return undefined
  }
}

export async function storeSshPassword(account: string, password: string): Promise<boolean> {
  try {
    const entry = await passwordEntry(account)
    // Keep the existing macOS Keychain data format so saved credentials remain readable.
    await entry.setPassword(Buffer.from(password).toString('base64'), AbortSignal.timeout(8_000))
    return true
  } catch {
    return false
  }
}
