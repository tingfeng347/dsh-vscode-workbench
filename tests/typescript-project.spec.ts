import { afterEach, describe, expect, it, vi } from 'vitest'
import { disposeTypeScriptProject, indexTypeScriptProject, projectModelPath, workspacePathFromModel } from '../src/client/typescriptProject.ts'

afterEach(() => vi.unstubAllGlobals())

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

  it('does not create models from a response that arrives after disposal', async () => {
    let finish!: () => void
    vi.stubGlobal('fetch', vi.fn(() => new Promise(resolve => {
      finish = () => resolve({ ok: true, json: async () => ({ ok: true, value: { files: [{ path: 'a.ts', content: 'export const a = 1' }], truncated: false } }) })
    })))
    const models: string[] = []
    const defaults = { setCompilerOptions() {}, setEagerModelSync() {}, setDiagnosticsOptions() {} }
    const monaco = {
      languages: { typescript: { ScriptTarget: { ESNext: 1 }, ModuleKind: { ESNext: 1 }, ModuleResolutionKind: { NodeJs: 1 }, JsxEmit: { ReactJSX: 1 }, typescriptDefaults: defaults, javascriptDefaults: defaults } },
      Uri: { parse: (value: string) => ({ toString: () => value }) },
      editor: { getModel: () => null, createModel: (content: string) => models.push(content) },
    }
    const pending = indexTypeScriptProject(monaco as never, 's', '/tmp/audit')
    disposeTypeScriptProject(monaco as never)
    finish()
    await pending
    expect(models).toEqual([])
  })
})

describe('Monaco workers', () => {
  it('bootstraps AMD workers from an absolute base so the TypeScript worker loads', async () => {
    const { monacoWorkerBootstrap } = await import('../src/client/MonacoEditor.tsx')
    expect(monacoWorkerBootstrap('http://127.0.0.1:5173/dsh-vscode/monaco/')).toBe('self.MonacoEnvironment={baseUrl:"http://127.0.0.1:5173/dsh-vscode/monaco/"};importScripts("http://127.0.0.1:5173/dsh-vscode/monaco/vs/base/worker/workerMain.js");')
  })
})
