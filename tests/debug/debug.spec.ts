import { expect, it } from 'vitest'
import { ADAPTER_PRESETS, adapterForPath, debugpyAdapter, fileUrlRegex, resolveAdapter, resolveInterpreter, resolveNodeExecutable, scopeLabel, toFileUrl } from '../../src/host/debug.ts'
import { guessAdapter } from '../../src/client/debug/debug.ts'

it('turns a Windows path into the file URL Node reports', () => {
  expect(toFileUrl('D:\\work\\a.js')).toBe('file:///D:/work/a.js')
  expect(toFileUrl('D:/work/a.js')).toBe('file:///D:/work/a.js')
})

it('matches the drive letter regardless of its case', () => {
  const pattern = new RegExp(fileUrlRegex('D:\\work\\a.js'))
  expect(pattern.test('file:///D:/work/a.js')).toBe(true)
  expect(pattern.test('file:///d:/work/a.js')).toBe(true)
  expect(pattern.test('file:///D:/work/other.js')).toBe(false)
})

it('escapes regex metacharacters in the file name', () => {
  const pattern = new RegExp(fileUrlRegex('D:\\work\\a+b(1).js'))
  expect(pattern.test('file:///D:/work/a+b(1).js')).toBe(true)
  expect(pattern.test('file:///D:/work/aab1.js')).toBe(false)
})

it('labels CDP scopes for the panel', () => {
  expect(scopeLabel('local')).toBe('局部')
  expect(scopeLabel('closure')).toBe('闭包')
  expect(scopeLabel('module')).toBe('模块')
  expect(scopeLabel('something-new')).toBe('something-new')
})

it('finds the debugpy adapter only when it is installed', () => {
  expect(debugpyAdapter('Z:\\definitely-missing-adapters-root')).toBeUndefined()
})

it('routes every supported language to an adapter, not just js and python', () => {
  expect(adapterForPath('a.py')?.id).toBe('python')
  expect(adapterForPath('a.cs')?.id).toBe('dotnet')
  expect(adapterForPath('a.js')?.id).toBe('node')
  expect(adapterForPath('a.ts')?.id).toBe('node')
  expect(ADAPTER_PRESETS.map(preset => preset.id)).toContain('python')
})

it('falls back to the Node backend for extensionless scripts', () => {
  expect(adapterForPath('run')?.id).toBe('node')
})

it('reports a missing adapter instead of pretending it is available', () => {
  expect(resolveAdapter('python', { adaptersRoot: 'Z:\\nowhere', program: 'a.py' })).toBeUndefined()
  expect(resolveAdapter('custom', { adaptersRoot: 'Z:\\nowhere', program: 'a.py' })).toBeUndefined()
})

it('the UI default agrees with the host registry', () => {
  expect(guessAdapter('a.py')).toBe('python')
  expect(guessAdapter('a.cs')).toBe('dotnet')
  expect(guessAdapter('a.rs')).toBe('node')
  expect(guessAdapter(undefined)).toBe('node')
})
it('runs a Python file with the Python interpreter', () => {
  const interpreter = resolveInterpreter('a.py')
  expect(interpreter?.command.toLowerCase()).toContain('python')
})

it('runs a Node script with a real Node runtime, never the Electron binary', () => {
  const interpreter = resolveInterpreter('a.js')
  expect(interpreter?.command).toBe(resolveNodeExecutable())
})

it('refuses languages it cannot run yet instead of guessing', () => {
  expect(resolveInterpreter('a.rb')).toBeUndefined()
  expect(resolveInterpreter('a.rs')).toBeUndefined()
})