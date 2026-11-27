import { describe, expect, it } from 'vitest'
import { editorLanguageForPath, languageServerIdForPath, protocolLanguageId } from '../../src/client/lsp/lspLanguage.ts'
import { LSP_SERVERS } from '../../src/host/lsp.ts'

describe('Language server routing', () => {
  it('maps common extensions to the right server', () => {
    const cases: [string, string][] = [
      ['src/app.ts', 'typescript'], ['src/app.tsx', 'typescript'], ['src/app.mjs', 'typescript'],
      ['main.py', 'python'], ['main.go', 'go'], ['lib.rs', 'rust'], ['Main.java', 'java'],
      ['src/App.vue', 'vue'], ['src/main.cpp', 'cpp'], ['include/widget.hpp', 'cpp'], ['lib.c', 'cpp'],
    ]
    for (const [path, id] of cases) expect(languageServerIdForPath(path, LSP_SERVERS)).toBe(id)
  })

  it('assigns language ids to files Monaco would otherwise leave as plain text', () => {
    expect(editorLanguageForPath('types/service.pyi')).toBe('python')
    expect(editorLanguageForPath('D:\\repo\\.zshrc')).toBe('shell')
    expect(editorLanguageForPath('deploy/Containerfile.prod')).toBe('dockerfile')
    expect(editorLanguageForPath('deploy/build.DOCKERFILE')).toBe('dockerfile')
    expect(editorLanguageForPath('settings.jsonc')).toBe('json')
    expect(editorLanguageForPath('Bridge.mm')).toBe('objective-c')
    expect(editorLanguageForPath('view.phtml')).toBe('php')
    expect(editorLanguageForPath('README.md')).toBeUndefined()
  })

  it('uses the server language ids without incorrectly allowing comments in strict JSON files', () => {
    for (const path of ['settings.jsonc', 'project.code-workspace', 'tsconfig.app.json', '.vscode/settings.json']) {
      expect(protocolLanguageId('json', path)).toBe('jsonc')
    }
    expect(protocolLanguageId('json', 'package.json')).toBe('json')
    expect(protocolLanguageId('json', 'tests/settings.json')).toBe('json')
    expect(protocolLanguageId('shell', 'script.sh')).toBe('shellscript')
    expect(protocolLanguageId('objective-c', 'App.mm')).toBe('objective-cpp')
  })

  it('ignores files no configured server handles', () => {
    for (const path of ['README.md', 'Makefile', 'notes.txt', 'index.php', 'config.yml', 'index.html', 'Dockerfile', 'style.css']) {
      expect(languageServerIdForPath(path, LSP_SERVERS)).toBeUndefined()
    }
  })
})
