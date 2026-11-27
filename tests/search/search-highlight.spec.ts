import { describe, expect, it } from 'vitest'
import { searchHighlightRange } from '../../src/client/search/searchHighlight.ts'

describe('searchHighlightRange', () => {
  it('selects the matched needle on the reported line', () => {
    expect(searchHighlightRange('## Highlights', 'Highlights', 4)).toEqual({ startColumn: 4, endColumn: 14 })
  })

  it('selects the requested occurrence when the needle repeats after Unicode text', () => {
    expect(searchHighlightRange('梨🍐 foo foo', 'foo', 9)).toEqual({ startColumn: 9, endColumn: 12 })
  })

  it('falls back to the reported column when the needle is not on the line', () => {
    expect(searchHighlightRange('abc', 'missing', 2)).toEqual({ startColumn: 2, endColumn: 9 })
  })
})
