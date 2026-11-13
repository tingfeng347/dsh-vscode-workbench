import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

describe('terminal panel', () => {
  it('paints selected text above the opaque selection layer', () => {
    // xterm's selection layer is opaque and sits at z-index 1; without this rule every selected cell is covered.
    expect(read('src/client/styles.ts')).toContain('.dvw-terminal-host .xterm-decoration-top{z-index:2;position:relative}')
  })
})
