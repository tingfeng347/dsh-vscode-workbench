import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { findOfficeConverter, isOfficeDocumentPath, needsOfficeConversion, officePdf, officeStatus } from '../src/office.ts'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))) })

describe('Office conversion', () => {
  it('recognizes Word and PowerPoint documents', () => {
    for (const path of ['a.doc', 'a.docx', 'b.ppt', 'b.pptx', 'c.odt', 'c.odp', 'd.rtf']) {
      expect(needsOfficeConversion(path)).toBe(true)
      expect(isOfficeDocumentPath(path)).toBe(true)
    }
    expect(needsOfficeConversion('a.xlsx')).toBe(false)
    expect(needsOfficeConversion('a.md')).toBe(false)
  })

  it('reports converter availability without throwing', async () => {
    const status = await officeStatus()
    expect(typeof status.available).toBe('boolean')
    if (!status.available) expect(status.hint).toContain('LibreOffice')
  })

  it('converts a document to a cached PDF when LibreOffice is installed', async () => {
    if (await findOfficeConverter() === undefined) return
    const root = await mkdtemp(join(tmpdir(), 'dvw-office-'))
    roots.push(root)
    await writeFile(join(root, 'note.rtf'), '{\\rtf1\\ansi\\deff0 {\\fonttbl {\\f0 Calibri;}}\\f0\\fs24 Hello Office}\n')
    const first = await officePdf(root, 'note.rtf')
    expect(first.path).toMatch(/\.pdf$/)
    expect((await readFile(first.path)).subarray(0, 4).toString()).toBe('%PDF')
    const second = await officePdf(root, 'note.rtf')
    expect(second.path).toBe(first.path)
    await expect(officePdf(root, 'note.md')).rejects.toMatchObject({ code: 'unsupported-media' })
  }, 150_000)
})
