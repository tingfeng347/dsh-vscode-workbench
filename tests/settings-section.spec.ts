import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

describe('workbench settings section', () => {
  it('registers a Workbench page in DSH settings and can open it', () => {
    const index = read('src/client/index.tsx')
    expect(index).toContain("name: 'settings.section'")
    expect(index).toContain("id: SETTINGS_SECTION_ID, order: 40, label: 'Workbench'")
    expect(index).toContain("name: 'settings.section.icon'")
    expect(index).toContain('actions.openSection(SETTINGS_SECTION_ID)')
  })

  it('opens DSH settings from the activity bar instead of a private dialog', () => {
    const workbench = read('src/client/Workbench.tsx')
    expect(workbench).not.toContain('dvw-settings-backdrop')
    expect(workbench).toContain('const settingsPage=<WorkbenchSettings')
    expect(workbench).toContain('createPortal(settingsPage,settingsNode)')
    expect(workbench).toContain("onActivate:()=>openSettings?.()")
  })

  it('keeps the workbench layout untouched while settings are open', () => {
    const workbench = read('src/client/Workbench.tsx')
    expect(workbench).toContain('const chatShown=chatVisible&&!showingDshPanel')
    expect(workbench).toContain('const showingDshPanel=dshTabId!==undefined&&dshTabActive')
    expect(workbench).toContain('active={browserId===tab.id&&!dshTabActive&&!switcherOpen&&snapshot.visible}')
  })

  it("reuses DSH's pill controls for buttons and choices", () => {
    const panel = read('src/client/SettingsPanel.tsx')
    const styles = read('src/client/styles.ts')
    expect(panel).toContain('className="dvw-set-selector"')
    expect(panel).toContain('className="dvw-set-button"')
    expect(styles).toContain('.dvw-set-selector{border-radius:var(--dsw-radius-md,12px);background:var(--dsw-alias-bg-module-platform')
    expect(styles).toContain('.dvw-set-button{height:36px;padding:0 14px;border:0;border-radius:var(--dsw-radius-md,12px)')
  })

  it("matches DSH's group labels and switch states", () => {
    const styles = read('src/client/styles.ts')
    expect(styles).toContain('.dvw-set-group-title{margin:18px 8px 4px;font-size:12px;font-weight:400;line-height:18px;color:var(--dsw-alias-label-tertiary,#81858c)}')
    expect(styles).toContain('.dvw-set-switch[aria-checked=true]{background:var(--dsw-alias-brand-primary,#0f1115)}')
    expect(styles).toContain('.dvw-set-switch[aria-checked=false] .dvw-set-knob{background:var(--dsw-alias-switch-thumb,#fff)}')
  })

})
