import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

describe('commit message settings', () => {
  it('offers detail and language choices in the settings panel', () => {
    const workbench = read('src/client/Workbench.tsx')
    expect(workbench).toContain("['commit','提交信息','sparkle']")
    expect(workbench).toContain("'dvw:commit-detail'")
    expect(workbench).toContain("'dvw:commit-language'")
    expect(workbench).toContain("['concise','简洁'],['standard','标准'],['detailed','详细']")
    expect(workbench).toContain("['auto','跟随最近提交'],['zh','中文'],['en','English']")
    expect(workbench).toContain('提交信息')
  })

  it('sends the selected preferences with the generation request', () => {
    const workbench = read('src/client/Workbench.tsx')
    expect(workbench).toContain('detail:props.preferences.detail,language:props.preferences.language')
    expect(workbench).toContain('<GitView sessionId={sessionId} preferences={commitPreferences}')
    expect(read('src/index.ts')).toContain('normalizeCommitPreferences(body.detail, body.language)')
  })
})
