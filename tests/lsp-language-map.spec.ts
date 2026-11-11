import { describe, expect, it } from 'vitest'
import { languageServerIdForPath } from '../src/client/lsp.ts'

describe('Language server routing', () => {
  it('maps common extensions to the right server', () => {
    const cases: [string, string][] = [
      ['src/app.ts', 'typescript'], ['src/app.tsx', 'typescript'], ['src/app.mjs', 'typescript'],
      ['main.py', 'python'], ['index.php', 'php'], ['deploy.sh', 'shell'],
      ['config.yml', 'yaml'], ['package.json', 'json'], ['styles.scss', 'css'],
      ['index.html', 'html'], ['Dockerfile', 'dockerfile'], ['Dockerfile.dev', 'dockerfile'],
      ['main.go', 'go'], ['lib.rs', 'rust'], ['main.cpp', 'cpp'], ['Main.java', 'java'],
      ['Program.cs', 'csharp'], ['init.lua', 'lua'],
    ]
    for (const [path, id] of cases) expect(languageServerIdForPath(path)).toBe(id)
  })

  it('ignores files no configured server handles', () => {
    expect(languageServerIdForPath('README.md')).toBeUndefined()
    expect(languageServerIdForPath('Makefile')).toBeUndefined()
    expect(languageServerIdForPath('notes.txt')).toBeUndefined()
  })
})
