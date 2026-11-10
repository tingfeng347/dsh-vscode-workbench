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

  it('keeps the DSH chat toggle in the activity bar', () => {
    const workbench = read('src/client/Workbench.tsx')
    expect(workbench).toContain("title={chatVisible?'关闭 DSH 对话栏 (Ctrl+Alt+B)':'显示 DSH 对话栏 (Ctrl+Alt+B)'}")
    expect(workbench).not.toContain('dvw-chat-toggle')
    expect(read('src/client/styles.ts')).toContain('.dvw-tab-actions{flex:none;width:42px;display:grid;place-items:center;padding:0 6px;background:var(--dvw-surface-1)}')
  })

  it('uses rounded tabs and larger activity icons', () => {
    const styles = read('src/client/styles.ts')
    expect(styles).toContain('.dvw-act .codicon{font-size:24px}')
    expect(styles).toContain('.dvw-tab[data-active=true]{background:var(--dvw-tab-active)')
    expect(styles).toContain('--dvw-tab-active:#f0f0f0')
    expect(read('src/client/Workbench.tsx')).toContain('<DshMark size={24}/>')
  })

  it('uses VS Code light surfaces and separators', () => {
    const styles = read('src/client/styles.ts')
    expect(styles).toContain('--dvw-base:#f8f8f8')
    expect(styles).toContain('--dvw-side:#f8f8f8')
    expect(styles).toContain('--dvw-border:#e5e5e5')
    expect(styles).toContain('border-left:1px solid var(--dvw-border);border-top:1px solid var(--dvw-border);border-top-left-radius:8px;border-bottom-left-radius:8px')
    expect(styles).toContain('.dvw-bottom{grid-column:3;grid-row:2;height:260px;min-height:120px;border-top:1px solid var(--dvw-border);border-left:1px solid var(--dvw-border);border-top-left-radius:8px')
  })

  it('adjusts the workbench, editor and terminal font size', () => {
    const workbench = read('src/client/Workbench.tsx')
    expect(workbench).toContain("localStorage.setItem('dvw:font-size'")
    expect(workbench).toContain('<span>字体大小</span>')
    expect(workbench).toContain('fontSize={fontSize}')
    expect(read('src/client/MonacoEditor.tsx')).toContain('fontSize: props.fontSize ?? 14')
    expect(read('src/client/TerminalPanel.tsx')).toContain('terminalRef.current.options.fontSize = fontSize')
    expect(read('src/client/styles.ts')).toContain('font:var(--dvw-font-size,13px)')
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
