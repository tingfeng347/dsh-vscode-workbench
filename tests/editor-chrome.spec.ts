import { describe, expect, it } from 'vitest'
import { WORKBENCH_EDITOR_CHROME } from '../src/client/MonacoEditor.tsx'

describe('workbench editor chrome', () => {
  it('keeps a narrow scrollbar without a minimap or overview ruler', () => {
    expect(WORKBENCH_EDITOR_CHROME).toMatchObject({
      minimap: { enabled: false },
      renderOverviewRuler: false,
      overviewRulerLanes: 0,
      scrollbar: { verticalScrollbarSize: 10 },
    })
  })
})
