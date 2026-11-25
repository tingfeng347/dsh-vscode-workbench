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
    expect(css).toContain('.dvw-ssh-terminal-host .xterm-viewport{position:absolute;inset:0')
    expect(css).toContain('.dvw-ssh-terminal-host .xterm-helper-textarea{position:absolute;padding:0;border:0;margin:0;opacity:0;left:-9999em')
    expect(css).toContain('.dvw-diff-hunk-actions[hidden]{display:none}')
    expect(css).toContain('.dvw-diff-hunk-actions::before{content:"";position:absolute;inset:-12px -36px;pointer-events:none}')
    expect(css).toContain('.dvw-diff-ribbons path{fill:var(--dvw-diff-modified)}')
    expect(css).toContain('.dvw-ssh-workspace-section[data-expanded=true]')
    expect(css).toContain(':is(.dvw-scm-head,.dvw-ssh-section-head):is(:hover,:focus-within){background:var(--dvw-hover)}')
    expect(css).toContain(':is(.dvw-scm-head,.dvw-ssh-section-head) .dvw-icon{flex:0 1 22px;width:22px;min-width:17px;padding:0}')
    expect(css).toContain('.dvw-ssh-targets-resizer')
    dispose()
  })

  test('maps every codicon the workbench renders, including the debug entry', () => {
    const dispose = installStyles()
    const css = document.head.querySelector(SELECTOR)?.textContent ?? ''
    // The activity bar renders Icon name="debug-alt"; without this rule the button is blank.
    expect(css).toContain('.codicon-debug-alt:before{content:"\\eb91"}')
    expect(css).toContain('.codicon-terminal:before')
    // The SSH activity entry and disconnect action use the same local codicon stylesheet.
    expect(css).toContain('.codicon-remote-explorer:before{content:"\\eb39"}')
    expect(css).toContain('.codicon-debug-disconnect:before{content:"\\ead0"}')
    dispose()
  })
})
