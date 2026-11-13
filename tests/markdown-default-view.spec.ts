// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { MARKDOWN_DEFAULT_VIEW_KEY, markdownDefaultView, restoreTabPaths } from '../src/client/Workbench.tsx'

afterEach(() => localStorage.clear())

describe('Markdown default view', () => {
  it('opens Markdown in preview by default', () => {
    expect(markdownDefaultView()).toBe('preview')
    expect(restoreTabPaths(['README.md', 'src/a.ts']).map(tab => tab.preview)).toEqual([true, undefined])
  })

  it('honours the source setting for restored Markdown tabs', () => {
    localStorage.setItem(MARKDOWN_DEFAULT_VIEW_KEY, 'source')
    expect(markdownDefaultView()).toBe('source')
    expect(restoreTabPaths(['docs/guide.md'])[0]?.preview).toBe(false)
  })

  it('ignores an unknown saved value', () => {
    localStorage.setItem(MARKDOWN_DEFAULT_VIEW_KEY, 'unexpected')
    expect(markdownDefaultView()).toBe('preview')
  })

  it('keeps the default-view control in the layout section', () => {
    const panel = readFileSync('src/client/SettingsPanel.tsx', 'utf8')
    const appearance = panel.slice(panel.indexOf('>外观</h3>'), panel.indexOf('>布局</h3>'))
    const layout = panel.slice(panel.indexOf('>布局</h3>'), panel.indexOf('>提交信息</h3>'))
    expect(appearance).not.toContain('Markdown 默认视图')
    expect(layout).toContain('Markdown 默认视图')
  })
})
