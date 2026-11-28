import { describe, expect, it } from 'vitest'
import { readSource } from '../support/readSource.ts'
import { isBinaryDiffPath, isPreviewDocumentPath } from '../../src/client/workbench/Workbench.tsx'

describe('Binary diffs', () => {
  it('classifies documents and archives git prints as text', () => {
    for (const path of ['docs/大模型范式.pdf', 'report.docx', 'sheet.xlsx', 'deck.pptx', 'archive.zip', 'app.exe', 'font.woff2', 'photo.PNG', 'notes.md', 'src/main.ts']) {
      expect(isBinaryDiffPath(path)).toBe(path !== 'notes.md' && path !== 'src/main.ts')
    }
  })

  it('opens previewable documents instead of a binary notice', () => {
    for (const path of ['docs/plan.pdf', 'report.docx', 'sheet.xlsx', 'deck.pptx', 'photo.png']) expect(isPreviewDocumentPath(path)).toBe(true)
    expect(isPreviewDocumentPath('archive.zip')).toBe(false)
    expect(isPreviewDocumentPath('notes.txt')).toBe(false)
  })

  it('opens binary changes as a message instead of a text patch', () => {
    const workbench = readSource('src/client/workbench/Workbench.tsx')
    expect(workbench).toContain("if(isPreviewDocumentPath(source)&&!path.startsWith('commit:')){openPath(source);return}")
    expect(workbench).toContain('const binary=isBinaryDiffPath(source)')
    expect(workbench).toContain('diff:binary?undefined:diff')
    expect(workbench).toContain('二进制文件无法在文本编辑器或差异视图中打开')
    expect(workbench).toContain('<button onClick={()=>void openPath(activeTab.diffSourcePath!)}>打开文件</button>')
  })

  it('opens previewable files from commit history through the committed blob', () => {
    const workbench = readSource('src/client/workbench/Workbench.tsx')
    expect(workbench).toContain('openCommitPreview(preview.commit,preview.path,title)')
    expect(workbench).toContain("&commit=${encodeURIComponent(commit)}")
    expect(workbench).toContain('<ImagePreview key={activeTab.path} src={activeTab.imageUrl} path={activeTab.diffSourcePath??activeTab.path}')
  })
})
