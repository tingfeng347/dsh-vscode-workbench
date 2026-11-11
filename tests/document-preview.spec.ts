import { describe, expect, it } from 'vitest'
import { clampPdfScale, documentPreviewKind, sheetTable } from '../src/client/documentPreview.tsx'

describe('document previews', () => {
  it('recognizes PDF, Word, Excel and PowerPoint previews', () => {
    expect(documentPreviewKind('reports/plan.PDF')).toBe('pdf')
    expect(documentPreviewKind('reports/plan.docx')).toBe('office')
    expect(documentPreviewKind('reports/legacy.doc')).toBe('office')
    expect(documentPreviewKind('reports/data.XLSX')).toBe('sheet')
    expect(documentPreviewKind('reports/data.xls')).toBe('sheet')
    expect(documentPreviewKind('reports/data.ods')).toBe('sheet')
    expect(documentPreviewKind('decks/kickoff.pptx')).toBe('office')
    expect(documentPreviewKind('decks/legacy.ppt')).toBe('office')
    expect(documentPreviewKind('notes.txt')).toBeUndefined()
  })

  it('keeps PDF zoom within the supported range', () => {
    expect(clampPdfScale(0.1)).toBe(0.5)
    expect(clampPdfScale(1.25)).toBe(1.25)
    expect(clampPdfScale(4)).toBe(3)
  })
})

describe('spreadsheet tables', () => {
  it('normalizes cells and caps oversized sheets', () => {
    expect(sheetTable([['name', 'count'], ['alpha', 2], [null, undefined]])).toEqual([['name', 'count'], ['alpha', '2'], ['', '']])
    expect(sheetTable([[1, 2, 3]], { rows: 5, columns: 2 })).toEqual([['1', '2']])
    expect(sheetTable([[1], [2], [3]], { rows: 2, columns: 5 })).toEqual([['1'], ['2']])
  })
})
