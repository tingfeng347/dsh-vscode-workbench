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
  })

  it('uses VS Code tabs, activity selection and middle-click close', () => {
    const styles = read('src/client/styles.ts')
    const workbench = read('src/client/Workbench.tsx')
    expect(styles).toContain('.dvw-act .codicon{font-size:18px}')
    expect(styles).toContain('.dvw-act[data-active=true]::before{background:var(--dvw-tab-active)}')
    expect(styles).toContain('.dvw-tab[data-active=true]{background:var(--dvw-surface-1)')
    expect(styles).toContain('--dvw-tab-active:#e8e8e8')
    expect(workbench).toContain('<DshMark size={18}/>')
    expect(workbench).toContain("onAuxClick={event=>{if(event.button===1){event.preventDefault();close(tab)}}}")
  })

  it('opens search results at the matched line with a highlight', () => {
    const workbench = read('src/client/Workbench.tsx')
    expect(workbench).toContain('props.onOpen(path,row.line,row.column,row.match||query)')
    expect(workbench).toContain('highlight={activeTab.highlight}')
    expect(read('src/client/MonacoEditor.tsx')).toContain("inlineClassName: 'dvw-search-hit'")
    expect(read('src/client/styles.ts')).toContain('.dvw-search-hit{')
  })

  it('offers VS Code tab close actions from the context menu', () => {
    const workbench = read('src/client/Workbench.tsx')
    const styles = read('src/client/styles.ts')
    expect(workbench).toContain('onContextMenu={event=>{event.preventDefault();setActive(tab.path);setTabMenu(')
    expect(workbench).toContain('dvw-tab-menu')
    expect(workbench).toContain('关闭其他')
    expect(workbench).toContain('关闭右侧标签页')
    expect(workbench).toContain('关闭已保存')
    expect(workbench).toContain('全部关闭')
    expect(workbench).not.toContain('dvw-close-all')
    expect(styles).toContain('.dvw-tab-menu{min-width:220px}')
  })

  it('uses VS Code light surfaces and separators', () => {
    const styles = read('src/client/styles.ts')
    expect(styles).toContain('--dvw-base:#f8f8f8')
    expect(styles).toContain('--dvw-side:#f8f8f8')
    expect(styles).toContain('--dvw-gutter:#ececec')
    expect(styles).toContain('--dvw-border:#e5e5e5')
    expect(styles).toContain('border-left:1px solid var(--dvw-border);border-top:1px solid var(--dvw-border);border-right:1px solid var(--dvw-border);border-bottom:1px solid var(--dvw-border);border-radius:8px;margin-left:4px;overflow:hidden}')
    expect(styles).toContain('.dvw-overlay[data-dvw-bottom-panel] .dvw-main{border-bottom:0;border-bottom-left-radius:0;border-bottom-right-radius:0}')
    expect(read('src/client/Workbench.tsx')).toContain('data-dvw-bottom-panel={snapshot.bottomPanel||undefined}')
    expect(styles).toContain('.dvw-bottom{grid-column:3;grid-row:2;height:260px;min-height:120px;border-top:1px solid var(--dvw-border);border-left:1px solid var(--dvw-border);border-right:1px solid var(--dvw-border);border-bottom:1px solid var(--dvw-border);border-bottom-left-radius:8px;border-bottom-right-radius:8px;margin-left:4px')
    expect(styles).toContain('.dvw-tabs{height:35px;background:linear-gradient(to top,var(--dvw-border) 0 1px,var(--dvw-base) 1px 100%)')
    expect(styles).toContain('border-top:1px solid var(--dvw-border);border-bottom:1px solid var(--dvw-border);border-right:1px solid var(--dvw-border);border-top-right-radius:8px;border-bottom-right-radius:8px;margin-right:4px')
    expect(styles).toContain('[data-dvw-conversation-panel]{position:fixed!important;top:var(--dvw-titlebar-height)!important;right:4px!important')
    expect(styles).toContain('.dvw-tabs{height:35px')
    expect(styles).toContain('.dvw-tab{position:relative;height:35px')
    expect(styles).toContain('.dvw-tree-row{display:flex;align-items:center;height:22px;')
    expect(styles).toContain('.dvw-overlay ::-webkit-scrollbar-thumb{background:color-mix(in srgb,var(--dvw-text) 20%,transparent);border:2px solid transparent;background-clip:padding-box;border-radius:6px}')
  })

  it('adjusts the editor font size without scaling the workbench chrome', () => {
    const workbench = read('src/client/Workbench.tsx')
    expect(workbench).toContain("localStorage.setItem('dvw:font-size'")
    expect(workbench).toContain('<span>编辑器字体大小</span>')
    expect(workbench).toContain('setTimeout(() => onChange(draft), 180)')
    expect(workbench).toContain('fontSize={fontSize}')
    expect(read('src/client/MonacoEditor.tsx')).toContain('fontSize: props.fontSize ?? 14')
    expect(read('src/client/styles.ts')).toContain('font:13px/1.4')
  })

  it('keeps the terminal and Monaco on the same dark surfaces', () => {
    expect(read('src/client/TerminalPanel.tsx')).toContain("background: '#191a1b'")
    const monaco = read('src/client/MonacoEditor.tsx')
    expect(monaco).toContain("DARK_THEME = 'dvw-dark'")
    expect(monaco).toContain("'editor.background': '#121314'")
    expect(monaco).toContain("props.theme === 'dark' ? DARK_THEME : 'vs'")
    expect(monaco.match(/'vs-dark'/g)?.length ?? 0).toBe(1)
    expect(read('src/client/styles.ts')).toContain('border-bottom:0;background:var(--dvw-base)}.dvw-terminal-actions')
  })
})
