import { describe, expect, it } from 'vitest'
import { projectModelPath, workspacePathFromModel } from '../src/client/typescriptProject.ts'

describe('TypeScript project models', () => {
  it('uses the same file URIs as editor tabs', () => {
    expect(projectModelPath('/Users/me/repo', 'src/a.ts')).toBe('file:///Users/me/repo/src/a.ts')
    expect(projectModelPath('D:\\code\\repo', 'src/a.ts')).toBe('file:///D:/code/repo/src/a.ts')
  })

  it('maps definition targets back to workspace paths and ignores library files', () => {
    expect(workspacePathFromModel('/Users/me/repo', 'file:///Users/me/repo/src/a.ts')).toBe('src/a.ts')
    expect(workspacePathFromModel('D:\\code\\repo', 'file:///d%3A/code/repo/src/%E6%96%87.ts')).toBe('src/文.ts')
    expect(workspacePathFromModel('/Users/me/repo', 'file:///Users/me/other/a.ts')).toBeUndefined()
    expect(workspacePathFromModel('/Users/me/repo', 'file:///node_modules/@types/node/index.d.ts')).toBeUndefined()
  })
})

describe('Monaco workers', () => {
  it('bootstraps AMD workers from an absolute base so the TypeScript worker loads', async () => {
    const { monacoWorkerBootstrap } = await import('../src/client/MonacoEditor.tsx')
    expect(monacoWorkerBootstrap('http://127.0.0.1:5173/dsh-vscode/monaco/')).toBe('self.MonacoEnvironment={baseUrl:"http://127.0.0.1:5173/dsh-vscode/monaco/"};importScripts("http://127.0.0.1:5173/dsh-vscode/monaco/vs/base/worker/workerMain.js");')
  })
})
