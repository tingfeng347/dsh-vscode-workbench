import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import { expect, it } from 'vitest'
import { monacoAsset } from '../../src/host/host.ts'
import { patchMonacoEditor, readMonacoAsset } from '../../src/host/monacoAsset.ts'
import { MONACO_ASSET_REVISION, MONACO_VERSION } from '../../src/shared/monacoAssets.ts'

/** Execute the shipped method with a canvas that records the writes which force style resolution. */
function sectionHeaderCalls(source: string, lines: number[]): unknown[] {
  const start = source.indexOf('_renderSectionHeaders(N){')
  const end = source.indexOf('static _fitSectionHeader', start)
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  const calls: unknown[] = []
  const canvas = new Proxy({}, {
    set(target, key, value) { calls.push(['canvas', key, value]); return Reflect.set(target, key, value) },
  })
  const render = runInNewContext(`({${source.slice(start, end)}})._renderSectionHeaders`, {
    M: {
      _fitSectionHeader() {},
      _renderSectionLabel(_context: unknown, ...args: unknown[]) { calls.push(['label', ...args]) },
    },
    p: { MINIMAP_GUTTER_WIDTH: 2 },
  }) as (this: unknown, layout: unknown) => void
  render.call({
    _model: {
      options: {
        minimapLineHeight: 2, sectionHeaderFontSize: 9, sectionHeaderLetterSpacing: 1,
        canvasInnerWidth: 84, backgroundColor: { r: 18, g: 19, b: 20 },
        sectionHeaderFontColor: { r: 200, g: 201, b: 202 }, sectionHeaderFontFamily: 'Consolas',
      },
      getSectionHeaderDecorationsInViewport: () => lines.map(line => ({
        range: { startLineNumber: line }, options: { minimap: { sectionHeaderStyle: line % 2 + 1 } },
      })),
      getSectionHeaderText: (decoration: { range: { startLineNumber: number } }) => `Header ${decoration.range.startLineNumber}`,
    },
    _decorationsCanvas: { domNode: { getContext(type: string) { calls.push(['getContext', type]); return canvas } } },
  }, { startLineNumber: 1, endLineNumber: 10, getYForLineNumber: (line: number, height: number) => line * height })
  return calls
}

it('avoids canvas font writes when the actual Monaco bundle has no section headers to draw', async () => {
  const original = await readFile(monacoAsset('vs/editor/editor.main.js').path, 'utf8')
  // Confirm the fixture exercises the upstream path that caused synchronous style calculation.
  expect(sectionHeaderCalls(original, [])).toContainEqual(['canvas', 'font', '500 9px Consolas'])
  const served = await readMonacoAsset('vs/editor/editor.main.js')
  expect(sectionHeaderCalls(served.body.toString('utf8'), [])).toEqual([])
})

it('preserves section header drawing, sorting and canvas settings when headers exist', async () => {
  const original = await readFile(monacoAsset('vs/editor/editor.main.js').path, 'utf8')
  const served = await readMonacoAsset(`${MONACO_ASSET_REVISION}/vs/editor/editor.main.js`)
  for (const lines of [[2], [7, 1, 4]]) {
    expect(sectionHeaderCalls(served.body.toString('utf8'), lines)).toEqual(sectionHeaderCalls(original, lines))
  }
})

it('changes only the empty-header guard and leaves unverified versions or builds untouched', async () => {
  const original = await readFile(monacoAsset('vs/editor/editor.main.js').path)
  const served = await readMonacoAsset('vs/editor/editor.main.js')
  const guard = 'if(this._model.getSectionHeaderDecorationsInViewport(N.startLineNumber,N.endLineNumber).length===0)return;'
  const text = served.body.toString('utf8')
  expect(text.split(guard)).toHaveLength(2)
  expect(Buffer.from(text.replace(guard, '')).equals(original)).toBe(true)
  expect(patchMonacoEditor(original, '0.53.0')).toBe(original)
  const unknownBuild = Buffer.concat([original, Buffer.from('/* different build */')])
  expect(patchMonacoEditor(unknownBuild, MONACO_VERSION)).toBe(unknownBuild)
  const unknownMethod = Buffer.from('_renderSectionHeaders(other){const changed=true}')
  expect(patchMonacoEditor(unknownMethod, MONACO_VERSION)).toBe(unknownMethod)
})

it.each(['vs/loader.js', 'vs/nls.messages.zh-cn.js', 'vs/base/worker/workerMain.js', 'vs/editor/editor.main.css'])(
  'serves %s unchanged at the revised and legacy paths', async path => {
    const original = await readFile(monacoAsset(path).path)
    const legacy = await readMonacoAsset(path)
    const revised = await readMonacoAsset(`${MONACO_ASSET_REVISION}/${path}`)
    expect(legacy.body.equals(original)).toBe(true)
    expect(revised.body.equals(original)).toBe(true)
    expect(revised.type).toBe(legacy.type)
  },
)

it('keeps revisioned asset requests inside the Monaco package', async () => {
  await expect(readMonacoAsset(`${MONACO_ASSET_REVISION}/../../package.json`)).rejects.toMatchObject({ code: 'asset-invalid' })
})
