// @vitest-environment jsdom
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { GitCommit } from '../../src/shared/types.ts'
import { absoluteEntryPath, canMoveTo, createdEntryPath, downloadUrlData, movedPath, parentPath, directoryAffected, CommitGraph, graphParentPath, graphRows, graphTrackPath, renamedPath, restoreTabPaths, tabLabel, tabScrollLeft, uploadDestination } from '../../src/client/workbench/Workbench.tsx'
import { markdownHeadings, markdownWorkspacePath } from '../../src/client/preview/MarkdownPreview.tsx'

function commit(hash: string, parents: string[]): GitCommit {
  return { hash, parents, author: 'Test', date: '2026-01-01T00:00:00Z', subject: hash, refs: [] }
}

describe('Git graph lanes', () => {
  it('keeps a linear history on one lane', () => {
    const rows=graphRows([commit('c',['b']),commit('b',['a']),commit('a',[])])
    expect(rows.map(row=>[row.before.length,row.after.length])).toEqual([[0,1],[1,1],[1,0]])
  })

  it('retains distinct lanes until their shared target, including across consecutive merges', () => {
    const rows = graphRows([
      { ...commit('m16', ['m15','test']), refs: ['HEAD -> main'] },
      commit('test', ['m15']), commit('m15', ['release','fix']),
      commit('fix', ['release']), commit('release', []),
    ])
    expect(rows.map(row => row.after.map(track => [track.hash, track.color]))).toEqual([
      [['m15',0],['test',1]], [['m15',0],['m15',1]],
      [['release',0],['fix',2]], [['release',0],['release',2]], [],
    ])
    expect(rows.map(row => row.lane)).toEqual([0,1,0,1,0])
  })

  it('carries unrelated lanes through a root or truncated branch', () => {
    for (const parents of [[], ['outside']]) {
      const rows = graphRows([commit('m',['a','b']), commit('a',parents), commit('b',[])])
      expect(rows[1]!.parentLanes).toEqual([])
      expect(rows[1]!.after).toEqual([rows[0]!.after[1]])
      expect(rows[2]!.color).toBe(rows[0]!.after[1]!.color)
    }
  })

  it('does not retain parents outside the visible history window',()=>{
    const rows=graphRows([commit('c',['outside-c']),commit('b',['outside-b']),commit('a',['outside-a'])])
    expect(rows.map(row=>row.after)).toEqual([[],[],[]])
  })

  it('rounds lane shifts in either direction', () => {
    expect(graphTrackPath(22,11)).toBe('M 22 0 V 6 A 5 5 0 0 1 17 11 H 16 A 5 5 0 0 0 11 16 V 22')
    expect(graphTrackPath(11,22)).toBe('M 11 0 V 6 A 5 5 0 0 0 16 11 H 17 A 5 5 0 0 1 22 16 V 22')
    expect(graphParentPath(11,33)).toBe('M 11 11 H 22 A 11 11 0 0 1 33 22')
  })

  it('renders consecutive merges and keeps both lanes connected across expanded files', () => {
    const commits = [
      { ...commit('e2c3415', ['4845605', '0df051f']), refs: ['HEAD -> main'] },
      commit('0df051f', ['4845605']),
      commit('4845605', ['62b9947', '247503d']),
      commit('247503d', ['62b9947']),
      commit('62b9947', ['3cfd16e']),
    ]
    const noop = () => {}
    const actions = { onToggle: noop, onOpenFile: noop, onTools: noop }
    const graph = document.createElement('div')
    graph.innerHTML = renderToStaticMarkup(createElement(CommitGraph, {
      commits, expanded: '0df051f', files: new Map([['0df051f', [{ path: 'tests/git.spec.ts', status: 'M' }]]]), ...actions,
    }))
    expect(graph.querySelector('.dvw-commit-file-name')?.textContent).toBe('git.spec.ts')
    const rows = graph.querySelectorAll<HTMLButtonElement>('.dvw-graph-row')
    const svgs = graph.querySelectorAll<SVGSVGElement>('.dvw-graph-svg')
    expect(svgs).toHaveLength(5)
    for (const [index, svg] of svgs.entries()) {
      expect(rows[index]!.style.height).toBe('22px')
      expect(svg.style.marginTop).toBe('')
      expect(svg.getAttribute('height')).toBe('22')
      expect(svg.querySelector('circle')?.getAttribute('cy')).toBe('11')
    }

    const paths = Array.from(svgs, svg => Array.from(svg.querySelectorAll('path')))
    expect(paths.map(row => row.map(path => path.getAttribute('d')))).toEqual([
      ['M 11 11 V 22', 'M 11 11 H 11 A 11 11 0 0 1 22 22'],
      ['M 11 0 V 22', 'M 22 0 V 11', 'M 22 11 V 22'],
      ['M 11 0 V 11', 'M 22 0 A 11 11 0 0 1 11 11 H 11', 'M 11 11 V 22', 'M 11 11 H 11 A 11 11 0 0 1 22 22'],
      ['M 11 0 V 22', 'M 22 0 V 11', 'M 22 11 V 22'],
      ['M 11 0 V 11', 'M 22 0 A 11 11 0 0 1 11 11 H 11'],
    ])
    const continuation = graph.querySelectorAll<SVGLineElement>('.dvw-graph-continuation line')
    expect(Array.from(continuation, line => [line.getAttribute('x1'), line.getAttribute('x2'), line.style.stroke])).toEqual([
      ['11', '11', 'var(--dvw-graph-ref)'], ['22', '22', 'rgb(255, 176, 0)'],
    ])
    for (const [start, end, color] of [[0, 2, 'rgb(255, 176, 0)'], [2, 4, 'rgb(220, 38, 127)']] as const) {
      expect(paths[start]!.at(-1)!.style.stroke).toBe(color)
      expect(svgs[start + 1]!.querySelector('circle')?.style.fill).toBe(color)
      expect(paths[start + 1]!.slice(1).map(path => path.style.stroke)).toEqual([color, color])
      expect(paths[end]![1]!.style.stroke).toBe(color)
    }
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

describe('Explorer absolute paths',()=>{it('joins the workspace root with the entry path on both platforms',()=>{
  expect(absoluteEntryPath('/Users/me/project','src/main.ts')).toBe('/Users/me/project/src/main.ts')
  expect(absoluteEntryPath('/Users/me/project/','src/main.ts')).toBe('/Users/me/project/src/main.ts')
  expect(absoluteEntryPath('/Users/me/project','')).toBe('/Users/me/project')
  expect(absoluteEntryPath('C:\\work\\project','src/main.ts')).toBe('C:\\work\\project\\src\\main.ts')
})})

describe('Explorer targeted refresh',()=>{it('reloads only the directory containing a changed path',()=>{expect(directoryAffected('src/client',['src/client/App.tsx'])).toBe(true);expect(directoryAffected('src',['src/client/App.tsx'])).toBe(false);expect(directoryAffected('src',['src'])).toBe(true)})})

describe('Lazy tab restore',()=>{it('restores unique unloaded tab headers without content',()=>{expect(restoreTabPaths(['src/a.ts','src/b.ts','src/a.ts']).map(tab=>({path:tab.path,loaded:tab.loaded,draft:tab.draft}))).toEqual([{path:'src/a.ts',loaded:false,draft:''},{path:'src/b.ts',loaded:false,draft:''}])})})

describe('Explorer rename target',()=>{it('keeps an entry in its current directory',()=>{expect(renamedPath('docs/assets/old.txt','new.txt')).toBe('docs/assets/new.txt');expect(renamedPath('old.txt','new.txt')).toBe('new.txt')})})
