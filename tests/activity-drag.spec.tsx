// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ActivityBar } from '../src/client/ActivityBar.tsx'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks() })

const views = ['explorer', 'search', 'git'].map(id => ({ id, label: id, icon: null, active: false, onActivate() {} }))

/** jsdom has no layout, so pin each activity button to a 48px slot in DOM order. */
const layout = (buttons: HTMLButtonElement[]) => {
  buttons.forEach((button, index) => {
    const top = index * 48
    vi.spyOn(button, 'getBoundingClientRect').mockReturnValue({ top, height: 48, bottom: top + 48, left: 0, right: 48, width: 48, x: 0, y: top, toJSON() {} } as DOMRect)
  })
}

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
    layout(buttons)
    const first = buttons[0]!
    const pointer = (type: string, y: number) => new MouseEvent(type, { bubbles: true, button: 0, clientX: 5, clientY: y })
    await act(async () => {
      first!.dispatchEvent(pointer('pointerdown', 5))
      first!.dispatchEvent(pointer('pointermove', 80))
    })
    await act(async () => {
      first!.dispatchEvent(pointer('pointerup', 80))
    })
    expect(onOrderChange).toHaveBeenCalledWith(['search', 'explorer', 'git'])
    await act(async () => { root.unmount() })
  })

  it('drops a view at the end when the pointer passes the last slot', async () => {
    const onOrderChange = vi.fn()
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    await act(async () => {
      root.render(<ActivityBar views={views} fixed={[]} order={['explorer', 'search', 'git']} hidden={[]} onOrderChange={onOrderChange} onHiddenChange={() => {}}/>)
    })
    const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>('[data-act-id]'))
    layout(buttons)
    const pointer = (type: string, y: number) => new MouseEvent(type, { bubbles: true, button: 0, clientX: 5, clientY: y })
    await act(async () => {
      buttons[0]!.dispatchEvent(pointer('pointerdown', 5))
      buttons[0]!.dispatchEvent(pointer('pointermove', 140))
    })
    await act(async () => { buttons[0]!.dispatchEvent(pointer('pointerup', 140)) })
    expect(onOrderChange).toHaveBeenCalledWith(['search', 'git', 'explorer'])
    await act(async () => { root.unmount() })
  })

  it('commits the reorder even when the pointer is released outside the button', async () => {
    const onOrderChange = vi.fn()
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    await act(async () => {
      root.render(<ActivityBar views={views} fixed={[]} order={['explorer', 'search', 'git']} hidden={[]} onOrderChange={onOrderChange} onHiddenChange={() => {}}/>)
    })
    const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>('[data-act-id]'))
    layout(buttons)
    await act(async () => {
      buttons[0]!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 5, clientY: 5 }))
      window.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, button: 0, clientX: 5, clientY: 140 }))
      window.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, button: 0, clientX: 5, clientY: 140 }))
    })
    expect(onOrderChange).toHaveBeenCalledWith(['search', 'git', 'explorer'])
    await act(async () => { root.unmount() })
  })

  it('keeps fixed actions above the draggable views', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    await act(async () => {
      root.render(<ActivityBar views={views} fixed={[{ id: 'workspaces', label: 'workspaces', icon: null, active: false, onActivate() {} }]} order={['explorer', 'search', 'git']} hidden={[]} onOrderChange={() => {}} onHiddenChange={() => {}}/>)
    })
    const ids = Array.from(container.querySelectorAll<HTMLElement>('[data-act-id]')).map(element => element.dataset.actId)
    expect(ids).toEqual(['workspaces', 'explorer', 'search', 'git'])
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

  it('still activates a view when a shaky click crosses the drag threshold without reordering', async () => {
    const onActivate = vi.fn()
    const onOrderChange = vi.fn()
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    await act(async () => {
      root.render(<ActivityBar views={[{ id: 'explorer', label: 'explorer', icon: null, active: false, onActivate }, ...views.slice(1)]} fixed={[]} order={['explorer', 'search', 'git']} hidden={[]} onOrderChange={onOrderChange} onHiddenChange={() => {}}/>)
    })
    const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>('[data-act-id]'))
    layout(buttons)
    const pointer = (type: string, x: number) => new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: 5 })
    await act(async () => {
      buttons[0]!.dispatchEvent(pointer('pointerdown', 0))
      window.dispatchEvent(pointer('pointermove', 20))
      window.dispatchEvent(pointer('pointerup', 20))
      buttons[0]!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(onOrderChange).not.toHaveBeenCalled()
    expect(onActivate).toHaveBeenCalledTimes(1)
    await act(async () => { root.unmount() })
  })
})
