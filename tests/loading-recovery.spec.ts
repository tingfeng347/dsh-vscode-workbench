// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
afterEach(() => { vi.resetModules(); document.head.replaceChildren(); Reflect.deleteProperty(window, 'require') })
it('retries Monaco after the script fails', async () => {
  const { loadMonaco } = await import('../src/client/MonacoEditor.tsx')
  const first = loadMonaco()
  const failure = expect(first).rejects.toThrow('failed to load Monaco')
  document.head.querySelector('script')!.dispatchEvent(new Event('error'))
  await failure
  const second = loadMonaco()
  expect(second).not.toBe(first)
  expect(document.head.querySelectorAll('script')).toHaveLength(1)
  const retryFailure = expect(second).rejects.toThrow()
  document.head.querySelector('script')!.dispatchEvent(new Event('error'))
  await retryFailure
})
it('retries SheetJS after the script fails', async () => {
  const { loadXlsx } = await import('../src/client/documentPreview.tsx')
  const first = loadXlsx()
  const failure = expect(first).rejects.toThrow('SheetJS')
  document.head.querySelector('script')!.dispatchEvent(new Event('error'))
  await failure
  const second = loadXlsx()
  expect(second).not.toBe(first)
  const retryFailure = expect(second).rejects.toThrow()
  document.head.querySelector('script')!.dispatchEvent(new Event('error'))
  await retryFailure
})
