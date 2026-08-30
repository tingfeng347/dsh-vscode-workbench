import { describe, expect, it } from 'vitest'
import { resizedPanelWidth } from '../src/client/Workbench.tsx'

describe('resizedPanelWidth', () => {
  it('grows the source control panel when its right edge moves right', () => {
    expect(resizedPanelWidth(210, 100, 175, 1, 210, 640)).toBe(285)
  })

  it('grows the DSH panel when its left edge moves left', () => {
    expect(resizedPanelWidth(420, 500, 450, -1, 400, 720)).toBe(470)
  })

  it('keeps both panels within their configured limits', () => {
    expect(resizedPanelWidth(210, 100, -500, 1, 210, 640)).toBe(210)
    expect(resizedPanelWidth(420, 500, -500, -1, 400, 720)).toBe(720)
  })
})
