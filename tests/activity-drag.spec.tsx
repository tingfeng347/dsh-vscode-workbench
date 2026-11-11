// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ActivityBar } from '../src/client/ActivityBar.tsx'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks() })

const views = ['explorer', 'search', 'git'].map(id => ({ id, label: id, icon: null, active: false, onActivate() {} }))

describe('Activity bar pointer dragging', () => {
  it('moves the dragged view to the pointer drop position', async () => {
    const onOrderChange = vi.fn()
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    await act(async () => {
      root.render(<ActivityBar views={views} fixed={[]} order={['explorer', 'search', 'git']} hidden={[]} onOrderChange={onOrderChange} onHiddenChange={() => {}}/>)
    })
    const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>('[data-act-id]'))
    const [first, second] = buttons
    Object.defineProperty(document, 'elementFromPoint', { value: () => second, configurable: true })
    vi.spyOn(second!, 'getBoundingClientRect').mockReturnValue({ top: 0, height: 48, bottom: 48, left: 0, right: 48, width: 48, x: 0, y: 0, toJSON() {} } as DOMRect)
    const pointer = (type: string, y: number) => new MouseEvent(type, { bubbles: true, button: 0, clientX: 5, clientY: y })
    await act(async () => {
      first!.dispatchEvent(pointer('pointerdown', 5))
      first!.dispatchEvent(pointer('pointermove', 40))
    })
    await act(async () => {
      first!.dispatchEvent(pointer('pointerup', 40))
    })
    expect(onOrderChange).toHaveBeenCalledWith(['search', 'explorer', 'git'])
    await act(async () => { root.unmount() })
  })

  it('still activates a view on a plain click', async () => {
    const onActivate = vi.fn()
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    await act(async () => {
      root.render(<ActivityBar views={[{ id: 'explorer', label: 'explorer', icon: null, active: false, onActivate }]} fixed={[]} order={['explorer']} hidden={[]} onOrderChange={() => {}} onHiddenChange={() => {}}/>)
    })
    const button = container.querySelector<HTMLButtonElement>('[data-act-id]')!
    await act(async () => {
      button.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 5, clientY: 5 }))
      button.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, button: 0, clientX: 5, clientY: 5 }))
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(onActivate).toHaveBeenCalledTimes(1)
    await act(async () => { root.unmount() })
  })
})
