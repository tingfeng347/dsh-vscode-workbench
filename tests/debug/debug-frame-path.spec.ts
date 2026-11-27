import { expect, it } from 'vitest'
import { relativeToWorkspace } from '../../src/client/workbench/Workbench.tsx'

// A call-stack frame carries an absolute path from the adapter; the editor opens tab paths that are
// relative to the workspace, so the jump has to translate one into the other.
it('turns an absolute frame path into a workspace-relative tab path', () => {
  expect(relativeToWorkspace('C:\\work\\app', 'C:\\work\\app\\src\\a.js')).toBe('src/a.js')
  expect(relativeToWorkspace('D:/work/app', 'D:/work/app/src/deep/b.py')).toBe('src/deep/b.py')
  expect(relativeToWorkspace('/home/me/app', '/home/me/app/lib/x.ts')).toBe('lib/x.ts')
})

it('matches the workspace regardless of separator or drive-letter case', () => {
  expect(relativeToWorkspace('C:\\Work\\App', 'c:/work/app/src/a.js')).toBe('src/a.js')
  expect(relativeToWorkspace('C:\\Work\\App\\', 'C:/Work/App/src/a.js')).toBe('src/a.js')
})

it('leaves paths it must not rewrite alone', () => {
  expect(relativeToWorkspace('C:\\work\\app', 'C:\\work\\other\\a.js')).toBe('C:\\work\\other\\a.js')
  expect(relativeToWorkspace('C:\\work\\app', 'C:\\work\\application\\a.js')).toBe('C:\\work\\application\\a.js')
  expect(relativeToWorkspace('C:\\work\\app', 'src/a.js')).toBe('src/a.js')
  expect(relativeToWorkspace(undefined, 'C:\\work\\app\\a.js')).toBe('C:\\work\\app\\a.js')
  expect(relativeToWorkspace('', 'a.js')).toBe('a.js')
})