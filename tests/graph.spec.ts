import { describe, expect, it } from 'vitest'
import type { GitCommit } from '../src/types.ts'
import { createdEntryPath, directoryAffected, graphRows, graphTrackPath, renamedPath, restoreTabPaths, tabLabel, uploadDestination } from '../src/client/Workbench.tsx'
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
    expect(rows[0]?.after.map(track=>track.hash)).toEqual(['a','b'])
    expect(rows.at(-1)?.after).toEqual([])
    expect(Math.max(...rows.map(row=>Math.max(row.before.length,row.after.length)))).toBe(2)
  })

  it('does not retain parents outside the visible history window',()=>{
    const rows=graphRows([commit('c',['outside-c']),commit('b',['outside-b']),commit('a',['outside-a'])])
    expect(rows.map(row=>row.after)).toEqual([[],[],[]])
  })

  it('keeps each branch color stable while lane positions compact', () => {
    const rows=graphRows([commit('m',['a','b']),commit('a',['p']),commit('b',['p']),commit('p',[])])
    const branch=rows[0]!.after.find(track=>track.hash==='b')!
    expect(rows[1]!.before.find(track=>track.hash==='b')?.color).toBe(branch.color)
    expect(rows[2]!.before.find(track=>track.hash==='b')?.color).toBe(branch.color)
  })

  it('uses aligned vertical segments and fixed-radius lane turns', () => {
    expect(graphTrackPath(8,8,0,38,19)).toBe('M 8 0 V 38')
    expect(graphTrackPath(8,22,0,38,19)).toBe('M 8 0 V 14 Q 8 19 13 19 H 17 Q 22 19 22 24 V 38')
  })
})

describe('Markdown outline',()=>{it('extracts ordered heading levels',()=>{expect(markdownHeadings('# Title\ntext\n## Section\n### `Code`')).toEqual([{depth:1,text:'Title',index:0},{depth:2,text:'Section',index:1},{depth:3,text:'Code',index:2}])})})

describe('Markdown workspace links',()=>{it('resolves relative links inside the current workspace',()=>{expect(markdownWorkspacePath('docs/README.en.md','../README.md')).toBe('README.md');expect(markdownWorkspacePath('README.en.md','README.md')).toBe('README.md');expect(markdownWorkspacePath('README.md','https://example.com')).toBeUndefined()})})

describe('Editor tab labels',()=>{it('shows only the filename while paths remain distinct',()=>{expect(tabLabel({path:'Additional-Chapter/N8N_INSTALL_GUIDE.png'})).toBe('N8N_INSTALL_GUIDE.png');expect(tabLabel({path:'diff:commit:hash:docs/chapter7/README.md',diffSourcePath:'docs/chapter7/README.md'})).toBe('README.md');expect(tabLabel({path:'diff:anything',title:'nested/LICENSE.txt'})).toBe('LICENSE.txt')})})

describe('Explorer upload destination',()=>{it('uses the selected directory and falls back to the workspace root',()=>{expect(uploadDestination('docs/assets')).toBe('docs/assets');expect(uploadDestination()).toBe('')})})

describe('Explorer inline creation',()=>{it('creates entries in the selected directory or workspace root',()=>{expect(createdEntryPath('docs/assets','logo.svg')).toBe('docs/assets/logo.svg');expect(createdEntryPath('','README.md')).toBe('README.md')})})

describe('Explorer targeted refresh',()=>{it('reloads only the directory containing a changed path',()=>{expect(directoryAffected('src/client',['src/client/App.tsx'])).toBe(true);expect(directoryAffected('src',['src/client/App.tsx'])).toBe(false);expect(directoryAffected('src',['src'])).toBe(true)})})

describe('Lazy tab restore',()=>{it('restores unique unloaded tab headers without content',()=>{expect(restoreTabPaths(['src/a.ts','src/b.ts','src/a.ts']).map(tab=>({path:tab.path,loaded:tab.loaded,draft:tab.draft}))).toEqual([{path:'src/a.ts',loaded:false,draft:''},{path:'src/b.ts',loaded:false,draft:''}])})})

describe('Explorer rename target',()=>{it('keeps an entry in its current directory',()=>{expect(renamedPath('docs/assets/old.txt','new.txt')).toBe('docs/assets/new.txt');expect(renamedPath('old.txt','new.txt')).toBe('new.txt')})})
