import { describe, expect, it } from 'vitest'
import type { GitCommit } from '../src/types.ts'
import { graphRows, tabLabel } from '../src/client/Workbench.tsx'
import { markdownHeadings, markdownWorkspacePath } from '../src/client/MarkdownPreview.tsx'

function commit(hash: string, parents: string[]): GitCommit {
  return { hash, parents, author: 'Test', date: '2026-01-01T00:00:00Z', subject: hash, refs: [] }
}

describe('Git graph lanes', () => {
  it('keeps a linear history on one lane', () => {
    const rows=graphRows([commit('c',['b']),commit('b',['a']),commit('a',[])])
    expect(rows.map(row=>[row.before.length,row.after.length])).toEqual([[1,1],[1,1],[1,0]])
  })

  it('opens and then converges merge lanes', () => {
    const rows=graphRows([commit('m',['a','b']),commit('a',['p']),commit('b',['p']),commit('p',[])])
    expect(rows[0]?.after).toEqual(['a','b'])
    expect(rows.at(-1)?.after).toEqual([])
    expect(Math.max(...rows.map(row=>Math.max(row.before.length,row.after.length)))).toBe(2)
  })

  it('does not retain parents outside the visible history window',()=>{
    const rows=graphRows([commit('c',['outside-c']),commit('b',['outside-b']),commit('a',['outside-a'])])
    expect(rows.map(row=>row.after)).toEqual([[],[],[]])
  })
})

describe('Markdown outline',()=>{it('extracts ordered heading levels',()=>{expect(markdownHeadings('# Title\ntext\n## Section\n### `Code`')).toEqual([{depth:1,text:'Title',index:0},{depth:2,text:'Section',index:1},{depth:3,text:'Code',index:2}])})})

describe('Markdown workspace links',()=>{it('resolves relative links inside the current workspace',()=>{expect(markdownWorkspacePath('docs/README.en.md','../README.md')).toBe('README.md');expect(markdownWorkspacePath('README.en.md','README.md')).toBe('README.md');expect(markdownWorkspacePath('README.md','https://example.com')).toBeUndefined()})})

describe('Editor tab labels',()=>{it('shows only the filename while paths remain distinct',()=>{expect(tabLabel({path:'Additional-Chapter/N8N_INSTALL_GUIDE.png'})).toBe('N8N_INSTALL_GUIDE.png');expect(tabLabel({path:'diff:commit:hash:docs/chapter7/README.md',diffSourcePath:'docs/chapter7/README.md'})).toBe('README.md');expect(tabLabel({path:'diff:anything',title:'nested/LICENSE.txt'})).toBe('LICENSE.txt')})})
