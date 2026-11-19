import { useLayoutEffect } from 'react'
import { findDshGlobalPanel } from './dshPanels.ts'
import { placeDshSurface, watchDshPlacement } from './dshPlacement.ts'

/** Present the original DSH page over the focused workbench editor. */
export function DshPanelPage({ panelId, active, floating = false }: { panelId: string; active: boolean; floating?: boolean }) {
  useLayoutEffect(() => {
    let panel: HTMLElement | null = null
    let placement: ReturnType<typeof placeDshSurface> | undefined
    const clear = () => {
      placement?.restore()
      panel?.removeAttribute('data-dvw-dsh-page')
      panel?.removeAttribute('data-dvw-dsh-hidden')
    }
    const stop = watchDshPlacement(
      () => document.querySelector<HTMLElement>('.dvw-editor[data-dvw-focused-editor]') ?? document.querySelector('.dvw-editor'),
      rect => {
        const next = findDshGlobalPanel()
        if (next !== panel) {
          clear()
          panel = next
          placement = panel !== null && active ? placeDshSurface(panel, floating) : undefined
          panel?.setAttribute('data-dvw-dsh-page', '')
          panel?.toggleAttribute('data-dvw-dsh-hidden', !active)
        }
        placement?.place(rect)
      },
    )
    return () => { stop(); clear() }
  }, [panelId, active, floating])
  return null
}
