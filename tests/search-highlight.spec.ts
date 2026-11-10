import { describe, expect, it } from 'vitest'
import { searchHighlightRange } from '../src/client/searchHighlight.ts'

describe('searchHighlightRange', () => {
  it('selects the matched needle on the reported line', () => {
    expect(searchHighlightRange('## Highlights', 'Highlights', 4)).toEqual({ startColumn: 4, endColumn: 14 })
  })

  it('falls back to the reported column when the needle is not on the line', () => {
    expect(searchHighlightRange('abc', 'missing', 2)).toEqual({ startColumn: 2, endColumn: 9 })
  })
})
