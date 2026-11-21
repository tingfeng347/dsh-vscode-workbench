// @vitest-environment jsdom
import { afterEach, describe, expect, test } from 'vitest'
import { installStyles } from '../src/client/styles.ts'

const SELECTOR = 'style[data-plugin-css="dsh-vscode-workbench/styles"]'

afterEach(() => {
  document.head.innerHTML = ''
})

describe('installStyles', () => {
  test('mounts exactly one plugin style tag without throwing', () => {
    const dispose = installStyles()
    expect(document.head.querySelectorAll(SELECTOR)).toHaveLength(1)
    dispose()
    expect(document.head.querySelectorAll(SELECTOR)).toHaveLength(0)
  })

  test('reuses an existing tag instead of stacking a second one', () => {
    const dispose = installStyles()
    const second = installStyles()
    expect(document.head.querySelectorAll(SELECTOR)).toHaveLength(1)
    second()
    dispose()
  })

  test('ships the debug panel rules in the installed stylesheet', () => {
    const dispose = installStyles()
    const css = document.head.querySelector(SELECTOR)?.textContent ?? ''
    expect(css).toContain('.dvw-debug-toolbar')
    expect(css).toContain('.dvw-debug-paused-line')
    dispose()
  })

  test('maps every codicon the workbench renders, including the debug entry', () => {
    const dispose = installStyles()
    const css = document.head.querySelector(SELECTOR)?.textContent ?? ''
    // The activity bar renders Icon name="debug-alt"; without this rule the button is blank.
    expect(css).toContain('.codicon-debug-alt:before{content:"\\eb91"}')
    expect(css).toContain('.codicon-terminal:before')
    dispose()
  })
})