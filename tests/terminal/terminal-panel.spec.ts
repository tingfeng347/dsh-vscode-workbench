import { describe, expect, it } from 'vitest'
import { readSource } from '../support/readSource.ts'

describe('terminal panel', () => {
  it('paints selected text above the opaque selection layer', () => {
    // xterm's selection layer is opaque and sits at z-index 1; without this rule every selected cell is covered.
    expect(readSource('src/client/workbench/styles.ts')).toContain('.dvw-terminal-host .xterm-decoration-top{z-index:2;position:relative}')
  })

  it('gives the selection an explicit foreground in both themes', () => {
    const panel = readSource('src/client/terminal/TerminalPanel.tsx')
    expect(panel).toContain('selectionBackground: \'#add6ff\', selectionForeground: \'#1d2025\'')
    expect(panel).toContain('selectionBackground: \'#264f78\', selectionForeground: \'#ffffff\'')
  })

  it('replaces the native terminal menu with Chinese items', () => {
    const panel = readSource('src/client/terminal/TerminalPanel.tsx')
    expect(panel).toContain("addEventListener('contextmenu'")
    for (const label of ['复制', '粘贴', '全选', '清屏']) expect(panel).toContain(`>${label}</button>`)
  })
})
