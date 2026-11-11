// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
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
})
