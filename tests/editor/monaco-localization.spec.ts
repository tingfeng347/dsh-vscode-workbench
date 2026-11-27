// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { afterEach, expect, it, vi } from 'vitest'

const bundle = readFileSync('node_modules/monaco-editor/min/vs/nls.messages.zh-cn.js', 'utf8')
const globals = window as unknown as { _VSCODE_NLS_MESSAGES?: Array<string | null> }

afterEach(() => {
  vi.resetModules()
  Reflect.deleteProperty(window, 'require')
  Reflect.deleteProperty(window, 'monaco')
  delete globals._VSCODE_NLS_MESSAGES
})

it('loads a complete Chinese message table before Monaco registers its commands', async () => {
  const register = vi.fn()
  const loader = Object.assign((ids: string[], done: () => void) => {
    if (ids[0] === 'vs/nls.messages.zh-cn') {
      expect(bundle).toContain('Version: 0.52.2(')
      runInNewContext(bundle, { globalThis: window, define: (_dependencies: unknown, factory: () => void) => factory() })
      expect(globals._VSCODE_NLS_MESSAGES!.filter(message => message === null)).toHaveLength(31)
      // This simulates a future upstream translation: supplemental text must preserve it.
      globals._VSCODE_NLS_MESSAGES![26] = '共 {0} 个结果'
    } else {
      expect(globals._VSCODE_NLS_MESSAGES!.filter(message => message === null)).toEqual([])
      expect(globals._VSCODE_NLS_MESSAGES![26]).toBe('共 {0} 个结果')
      expect(globals._VSCODE_NLS_MESSAGES![801]).toBe('显示或聚焦独立颜色选择器')
      expect(globals._VSCODE_NLS_MESSAGES![1099]).toBe('接受内联编辑')
      Object.assign(window, { monaco: { languages: { getLanguages: () => [], register, onLanguage: vi.fn() }, editor: { defineTheme() {} } } })
    }
    done()
  }, { config: vi.fn() })
  Object.assign(window, { require: loader })
  const { loadMonaco } = await import('../../src/client/editor/MonacoEditor.tsx')
  await expect(loadMonaco()).resolves.toBe(window.monaco)
  expect(register).toHaveBeenCalledWith({ id: 'vue', extensions: ['.vue'], aliases: ['Vue'] })
})

it('translates hard-coded inline-edit labels without replacing action behavior', async () => {
  const { localizeMonacoActions } = await import('../../src/client/editor/monacoLocale.ts')
  const run = vi.fn(async () => {})
  const isSupported = vi.fn(() => false)
  const action = { id: 'editor.action.inlineEdit.trigger', label: 'Trigger Inline Edit', alias: 'Trigger Inline Edit', metadata: undefined, run, isSupported }
  localizeMonacoActions({ getAction: id => id === action.id ? action : null })
  expect(action.label).toBe('触发内联编辑')
  expect(action.alias).toBe('Trigger Inline Edit')
  expect(action.isSupported()).toBe(false)
  expect(action.run).toBe(run)
})
