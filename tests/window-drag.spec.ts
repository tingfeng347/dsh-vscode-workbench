import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const styles = readFileSync(new URL('../src/client/styles.ts', import.meta.url), 'utf8')

describe('window drag regions', () => {
  // The DSH host marks the window's top-left corner as a drag region. Real mouse presses inside it never reach the
  // page, so the workbench must opt its whole surface out; injected events do not show the problem.
  it('carves the workbench out of the host drag region', () => {
    expect(styles).toContain('.dvw-overlay{-webkit-app-region:no-drag}')
  })

  it('keeps the window draggable from the title bar', () => {
    expect(styles).toMatch(/\.dvw-titlebar\{[^}]*-webkit-app-region:drag/)
  })
})
