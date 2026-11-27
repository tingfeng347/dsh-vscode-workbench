import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export function readSource(path: string): string {
  return readFileSync(resolve(import.meta.dirname, '../..', path), 'utf8')
}
