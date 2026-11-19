import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

describe('commit message settings', () => {
  it('offers detail, language and DSH model choices in the settings panel', () => {
    const workbench = read('src/client/Workbench.tsx')
    const panel = read('src/client/SettingsPanel.tsx')
    expect(workbench).toContain("'dvw:commit-detail'")
    expect(workbench).toContain("'dvw:commit-language'")
    expect(workbench).toContain("'dvw:commit-model'")
    expect(panel).toContain("['concise', '简洁'], ['standard', '标准'], ['detailed', '详细']")
    expect(panel).toContain("['auto', '跟随最近提交'], ['zh', '中文'], ['en', 'English']")
    expect(panel).toContain('生成模型')
    expect(panel).toContain('不需要先与 AI 对话')
    expect(panel).toContain('未手动选择时跟随 DSH 聊天当前使用的模型')
    expect(panel).toContain('提交信息')
  })

  it('resolves the selected DSH model and preferences in the host', () => {
    const index = read('src/index.ts')
    expect(index).toContain("if (method === 'commit.models')")
    expect(index).toContain('commitCatalogFromDsh')
    expect(index).toContain('defaultModel')
    expect(read('src/index.ts')).toContain('normalizeCommitPreferences(body.detail, body.language)')
    expect(index).toContain("projections?.stateOf(session, 'modelSelection')")
    expect(index).toContain('firstSupportedCommitModel(projection?.pending, headerConfig')
  })
})
