import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

describe('commit message settings', () => {
  it('offers detail and language choices in the settings panel', () => {
    const workbench = read('src/client/Workbench.tsx')
    const panel = read('src/client/SettingsPanel.tsx')
    expect(workbench).toContain("'dvw:commit-detail'")
    expect(workbench).toContain("'dvw:commit-language'")
    expect(panel).toContain("['concise', '简洁'], ['standard', '标准'], ['detailed', '详细']")
    expect(panel).toContain("['auto', '跟随最近提交'], ['zh', '中文'], ['en', 'English']")
    expect(panel).toContain('提交信息')
  })

  it('sends the selected preferences with the generation request', () => {
    const workbench = read('src/client/Workbench.tsx')
    expect(workbench).toContain('detail:props.preferences.detail,language:props.preferences.language')
    expect(workbench).toContain('<GitView sessionId={sessionId} preferences={commitPreferences}')
    expect(read('src/index.ts')).toContain('normalizeCommitPreferences(body.detail, body.language)')
  })
})
