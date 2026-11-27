import { readSource } from '../support/readSource.ts'
import { describe, expect, it } from 'vitest'

const styles = readSource('src/client/workbench/styles.ts')

describe('window drag regions', () => {
  // The DSH host marks the window's top-left corner as a drag region. Real mouse presses inside it never reach the
  // page, so the workbench must opt its whole surface out; injected events do not show the problem.
  it('carves the workbench out of the host drag region', () => {
    expect(styles).toContain('html:not([data-windows-titlebar]) .dvw-overlay,.dvw-overlay[data-dvw-float=true]{-webkit-app-region:no-drag}')
    expect(styles).not.toMatch(/^\.dvw-overlay\{-webkit-app-region:no-drag\}/m)
  })

  it('anchors the Windows host caption outside scrolling workbench panes', () => {
    expect(styles).toContain('html[data-windows-titlebar]:not([data-fullscreen]) body[data-dvw-workbench-active] :has(> [data-shell-overlay])::before{position:fixed}')
  })

  it('keeps the window draggable from the title bar', () => {
    expect(styles).toMatch(/\.dvw-titlebar\{[^}]*-webkit-app-region:drag/)
  })
})
