import { describe, expect, it } from 'vitest'
import { documentPreviewKind } from '../src/client/documentPreview.tsx'

describe('document previews', () => {
  it('recognizes browser-previewable PDF and Word documents', () => {
    expect(documentPreviewKind('reports/plan.PDF')).toBe('pdf')
    expect(documentPreviewKind('reports/plan.docx')).toBe('docx')
    expect(documentPreviewKind('reports/legacy.doc')).toBe('download')
    expect(documentPreviewKind('notes.txt')).toBeUndefined()
  })
})
