import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

describe('workbench dark theme', () => {
  it('uses one chrome surface and one editor surface', () => {
    const styles = read('src/client/styles.ts')
    expect(styles).toContain('--dvw-base:#191a1b')
    expect(styles).toContain('--dvw-surface-1:#121314')
    expect(styles).toContain('--dvw-surface-2:#202122')
    expect(styles).toContain('--dvw-side:#191a1b')
    expect(styles).toContain('--dvw-accent:#307e9f')
    expect(styles).toContain('.dvw-side{grid-column:2;grid-row:1/3;min-width:0;width:100%;background:var(--dvw-side)')
    expect(styles).toContain('.dvw-overlay[data-dvw-theme=dark] .dvw-status{background:var(--dvw-base)')
    expect(styles).toContain('body[data-dvw-palette=dark] [data-dvw-conversation-panel]')
  })

  it('offers the workbench from the sidebar panel list', () => {
    const index = read('src/client/index.tsx')
    expect(index).toContain("export const inject = ['slots', 'layout']")
    expect(index).toContain("name: 'sidebar.panellist'")
    expect(index).toContain("label: () => 'VS Code 工作台'")
    expect(index).not.toContain('sidebar.footer.action')
    expect(read('src/client/DshConversationPanel.tsx')).toContain("body.setAttribute('data-dvw-palette', colorScheme)")
  })

  it('keeps the terminal and Monaco on the same dark surfaces', () => {
    expect(read('src/client/TerminalPanel.tsx')).toContain("background: '#191a1b'")
    const monaco = read('src/client/MonacoEditor.tsx')
    expect(monaco).toContain("DARK_THEME = 'dvw-dark'")
    expect(monaco).toContain("'editor.background': '#121314'")
    expect(monaco).toContain("props.theme === 'dark' ? DARK_THEME : 'vs'")
    expect(monaco.match(/'vs-dark'/g)?.length ?? 0).toBe(1)
  })
})
