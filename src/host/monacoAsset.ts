import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { monacoAsset } from './host.ts'
import { MONACO_ASSET_REVISION, MONACO_VERSION } from '../shared/monacoAssets.ts'

const require = createRequire(import.meta.url)
const monacoVersion = (require('monaco-editor/package.json') as { version: string }).version
const editorDigest = '90b588bc0b624e24052a576e1bcab2eaffec7bc666895188862eebd9c9745782'
const sectionHeaderStart = '_renderSectionHeaders(N){const'
const emptySectionHeaderGuard = 'if(this._model.getSectionHeaderDecorationsInViewport(N.startLineNumber,N.endLineNumber).length===0)return;'

/**
 * Monaco 0.52.2 assigns canvas.font/letterSpacing before checking for section headers. After
 * view lines change, those setters synchronously resolve their styles even for an empty list.
 * Keep the upstream drawing path intact for real headers, and leave unverified builds intact.
 */
export function patchMonacoEditor(source: Buffer, version: string): Buffer {
  if (version !== MONACO_VERSION || createHash('sha256').update(source).digest('hex') !== editorDigest) return source
  const text = source.toString('utf8')
  const start = text.indexOf(sectionHeaderStart)
  if (start < 0 || text.indexOf(sectionHeaderStart, start + sectionHeaderStart.length) !== -1) return source
  return Buffer.from(text.replace(sectionHeaderStart, `_renderSectionHeaders(N){${emptySectionHeaderGuard}const`))
}

/** Read assets from the dependency without changing package files or a package-manager store. */
export async function readMonacoAsset(raw: string): Promise<{ type: string; body: Buffer }> {
  // Keep legacy URLs usable, while the client uses a revision in the path to bypass immutable caches.
  const path = raw.startsWith(`${MONACO_ASSET_REVISION}/`) ? raw.slice(MONACO_ASSET_REVISION.length + 1) : raw
  const asset = monacoAsset(path)
  const source = await readFile(asset.path)
  return { type: asset.type, body: path === 'vs/editor/editor.main.js' ? patchMonacoEditor(source, monacoVersion) : source }
}
