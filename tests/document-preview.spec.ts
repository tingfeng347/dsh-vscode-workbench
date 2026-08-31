import { describe, expect, it } from 'vitest'
import { clampPdfScale, documentPreviewKind } from '../src/client/documentPreview.tsx'

describe('document previews', () => {
  it('recognizes browser-previewable PDF and Word documents', () => {
    expect(documentPreviewKind('reports/plan.PDF')).toBe('pdf')
    expect(documentPreviewKind('reports/plan.docx')).toBe('docx')
    expect(documentPreviewKind('reports/legacy.doc')).toBe('download')
    expect(documentPreviewKind('notes.txt')).toBeUndefined()
  })

  it('keeps PDF zoom within the supported range', () => {
    expect(clampPdfScale(0.1)).toBe(0.5)
    expect(clampPdfScale(1.25)).toBe(1.25)
    expect(clampPdfScale(4)).toBe(3)
  })
})
