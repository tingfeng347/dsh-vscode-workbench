import { describe, expect, it } from 'vitest'
import { fileIconName } from '../src/client/fileIconMap.ts'

describe('fileIconName', () => {
  it('maps files and folders to vscode-icons assets', () => {
    expect(fileIconName('package.json', false, false)).toBe('file_type_npm.svg')
    expect(fileIconName('README.md', false, false)).toBe('file_type_markdown.svg')
    expect(fileIconName('src', true, false)).toBe('folder_type_src.svg')
    expect(fileIconName('src', true, true)).toBe('folder_type_src_opened.svg')
  })

  it('falls back to the default file and folder icons', () => {
    expect(fileIconName('unknown.extension-xyz', false, false)).toBe('default_file.svg')
    expect(fileIconName('unmapped-folder-name', true, false)).toMatch(/^default_folder/)
  })
})
