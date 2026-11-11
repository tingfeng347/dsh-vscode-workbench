import { describe, expect, it } from 'vitest'
import type { GitCommit } from '../src/types.ts'
import { canMoveTo, createdEntryPath, downloadUrlData, movedPath, parentPath, directoryAffected, graphParentPath, graphRows, graphTrackPath, renamedPath, restoreTabPaths, tabLabel, tabScrollLeft, uploadDestination } from '../src/client/Workbench.tsx'
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

  it('draws VS Code style lane shifts and parent arcs', () => {
    expect(graphTrackPath(11,11,0,38,19)).toBe('M 11 0 V 38')
    expect(graphTrackPath(22,11,0,38,19)).toBe('M 22 0 V 14 A 5 5 0 0 1 17 19 H 16 A 5 5 0 0 0 11 24 V 38')
    expect(graphTrackPath(11,22,0,38,19)).toBe('M 11 0 V 14 A 5 5 0 0 0 16 19 H 17 A 5 5 0 0 1 22 24 V 38')
    expect(graphParentPath(11,11,19,38)).toBe('M 11 19 V 38')
    expect(graphParentPath(11,22,19,38)).toBe('M 11 19 H 11 A 11 11 0 0 1 22 30 V 38')
    expect(graphParentPath(33,11,19,38)).toBe('M 33 19 H 22 A 11 11 0 0 0 11 30 V 38')
  })
})

describe('Markdown outline',()=>{it('extracts ordered heading levels',()=>{expect(markdownHeadings('# Title\ntext\n## Section\n### `Code`')).toEqual([{depth:1,text:'Title',index:0},{depth:2,text:'Section',index:1},{depth:3,text:'Code',index:2}])})})

describe('Markdown workspace links',()=>{it('resolves relative links inside the current workspace',()=>{expect(markdownWorkspacePath('docs/README.en.md','../README.md')).toBe('README.md');expect(markdownWorkspacePath('README.en.md','README.md')).toBe('README.md');expect(markdownWorkspacePath('README.md','https://example.com')).toBeUndefined()})})

describe('Editor tab labels',()=>{it('shows only the filename while paths remain distinct',()=>{expect(tabLabel({path:'Additional-Chapter/N8N_INSTALL_GUIDE.png'})).toBe('N8N_INSTALL_GUIDE.png');expect(tabLabel({path:'diff:commit:hash:docs/chapter7/README.md',diffSourcePath:'docs/chapter7/README.md'})).toBe('README.md');expect(tabLabel({path:'diff:anything',title:'nested/LICENSE.txt'})).toBe('LICENSE.txt')})})

describe('Editor tab scrolling',()=>{
  it('reveals a tab hidden past either edge of the strip',()=>{
    const viewport={left:100,right:500}
    expect(tabScrollLeft(40,viewport,{left:120,right:220})).toBe(40)
    expect(tabScrollLeft(40,viewport,{left:80,right:180})).toBe(20)
    expect(tabScrollLeft(40,viewport,{left:480,right:580})).toBe(120)
  })
})

describe('Explorer upload destination',()=>{it('uses the selected directory and falls back to the workspace root',()=>{expect(uploadDestination('docs/assets')).toBe('docs/assets');expect(uploadDestination()).toBe('')})})

describe('Explorer drag and drop',()=>{
  it('moves entries into folders but never into themselves or their current folder',()=>{
    expect(parentPath('src/client/App.tsx')).toBe('src/client')
    expect(movedPath('src/client/App.tsx','tests')).toBe('tests/App.tsx')
    expect(movedPath('docs/a.md','')).toBe('a.md')
    expect(canMoveTo('src/client/App.tsx','tests')).toBe(true)
    expect(canMoveTo('docs/a.md','')).toBe(true)
    expect(canMoveTo('src/client/App.tsx','src/client')).toBe(false)
    expect(canMoveTo('src','src')).toBe(false)
    expect(canMoveTo('src','src/client')).toBe(false)
    expect(canMoveTo('src','srcx')).toBe(true)
  })
  it('offers files to the desktop through a Chromium DownloadURL',()=>{
    expect(downloadUrlData('s 1','docs/报告.pdf','http://127.0.0.1:5173')).toBe('application/octet-stream:报告.pdf:http://127.0.0.1:5173/dsh-vscode/download?sessionId=s+1&path=docs%2F%E6%8A%A5%E5%91%8A.pdf')
  })
})

describe('Explorer inline creation',()=>{it('creates entries in the selected directory or workspace root',()=>{expect(createdEntryPath('docs/assets','logo.svg')).toBe('docs/assets/logo.svg');expect(createdEntryPath('','README.md')).toBe('README.md')})})

describe('Explorer targeted refresh',()=>{it('reloads only the directory containing a changed path',()=>{expect(directoryAffected('src/client',['src/client/App.tsx'])).toBe(true);expect(directoryAffected('src',['src/client/App.tsx'])).toBe(false);expect(directoryAffected('src',['src'])).toBe(true)})})

describe('Lazy tab restore',()=>{it('restores unique unloaded tab headers without content',()=>{expect(restoreTabPaths(['src/a.ts','src/b.ts','src/a.ts']).map(tab=>({path:tab.path,loaded:tab.loaded,draft:tab.draft}))).toEqual([{path:'src/a.ts',loaded:false,draft:''},{path:'src/b.ts',loaded:false,draft:''}])})})

describe('Explorer rename target',()=>{it('keeps an entry in its current directory',()=>{expect(renamedPath('docs/assets/old.txt','new.txt')).toBe('docs/assets/new.txt');expect(renamedPath('old.txt','new.txt')).toBe('new.txt')})})
