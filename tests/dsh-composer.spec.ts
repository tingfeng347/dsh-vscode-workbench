// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { dshReference, findDshComposer, insertIntoDshComposer, isAddToDshShortcut, referenceSeparator } from '../src/client/dshComposer.ts'

afterEach(() => { document.body.replaceChildren(); vi.unstubAllGlobals() })

describe('DSH chat references', () => {
  it('references files, folders and line-ranged selections', () => {
    expect(dshReference('src/client/App.tsx')).toBe('`src/client/App.tsx`')
    expect(dshReference('src/client', { directory: true })).toBe('`src/client/`')
    expect(dshReference('tsconfig.json', { selection: { text: '{\n  "jsx": "react-jsx"\n}\n', startLine: 1, endLine: 3 } })).toBe('`tsconfig.json:1-3`\n```json\n{\n  "jsx": "react-jsx"\n}\n```\n')
    expect(dshReference('a.ts', { selection: { text: 'x', startLine: 7, endLine: 7 } })).toBe('`a.ts:7`\n```ts\nx\n```\n')
    expect(dshReference('README.md', { selection: { text: '```sh\nls\n```', startLine: 2, endLine: 4 } })).toContain('````md\n```sh\nls\n```\n````')
  })

  it('separates references from an existing draft', () => {
    expect(referenceSeparator('', '`a`')).toBe('')
    expect(referenceSeparator('look at', '`a`')).toBe(' ')
    expect(referenceSeparator('look at', '`a:1`\n```\nx\n```\n')).toBe('\n')
    expect(referenceSeparator('look at\n', '`a`')).toBe('')
  })

  it('matches Ctrl/Cmd+Alt+K only', () => {
    const key = { ctrlKey: true, metaKey: false, altKey: true, shiftKey: false, code: 'KeyK', isComposing: false }
    expect(isAddToDshShortcut(key)).toBe(true)
    expect(isAddToDshShortcut({ ...key, ctrlKey: false, metaKey: true })).toBe(true)
    expect(isAddToDshShortcut({ ...key, altKey: false })).toBe(false)
    expect(isAddToDshShortcut({ ...key, shiftKey: true })).toBe(false)
  })
})

describe('DSH composer insertion', () => {
  it('prefers the composer inside the workbench conversation column', () => {
    document.body.innerHTML = '<div data-composer-card><textarea id="other"></textarea></div><div data-dvw-conversation-panel><div data-composer-card><textarea id="panel"></textarea></div></div>'
    expect(findDshComposer()?.id).toBe('panel')
  })

  it('finds the DSH Desktop Lexical composer', () => {
    document.body.innerHTML = '<div data-dvw-conversation-panel><div data-composer-card><div id="lexical" contenteditable="true" role="textbox" data-composer-input></div></div></div>'
    expect(findDshComposer()?.id).toBe('lexical')
  })

  it('pastes into the Lexical composer at the end of the draft', async () => {
    class FakeTransfer { private value = ''; setData(_type: string, value: string) { this.value = value } getData() { return this.value } }
    class FakeClipboardEvent extends Event { clipboardData: FakeTransfer; constructor(type: string, init: { clipboardData: FakeTransfer; bubbles: boolean; cancelable: boolean }) { super(type, init); this.clipboardData = init.clipboardData } }
    vi.stubGlobal('DataTransfer', FakeTransfer); vi.stubGlobal('ClipboardEvent', FakeClipboardEvent)
    document.body.innerHTML = '<div data-composer-card><div contenteditable="true" data-composer-input>explain</div></div>'
    const input = document.querySelector<HTMLElement>('[data-composer-input]')!
    const pasted: string[] = []
    input.addEventListener('paste', event => { pasted.push((event as unknown as FakeClipboardEvent).clipboardData.getData()); event.preventDefault() })
    expect(await insertIntoDshComposer('`src/a.ts`')).toBe(true)
    expect(pasted).toEqual([' `src/a.ts` '])
    input.setAttribute('contenteditable', 'false')
    expect(await insertIntoDshComposer('`b`')).toBe(false)
  })

  it('appends through an input event and refuses a busy composer', async () => {
    document.body.innerHTML = '<div data-composer-card><textarea>explain</textarea></div>'
    const input = document.querySelector('textarea')!
    const seen: string[] = []
    input.addEventListener('input', () => seen.push(input.value))
    expect(await insertIntoDshComposer('`src/a.ts`')).toBe(true)
    expect(input.value).toBe('explain `src/a.ts` ')
    expect(seen).toEqual(['explain `src/a.ts` '])
    input.readOnly = true
    expect(await insertIntoDshComposer('`b`')).toBe(false)
    document.body.replaceChildren()
    expect(await insertIntoDshComposer('`b`')).toBe(false)
  })
})
