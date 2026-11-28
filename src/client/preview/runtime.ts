let loading: Promise<typeof import('./previewRuntime.ts')> | undefined
let attempt = 0

/** Keep the heavy document engines lazy and allow a failed download to retry. */
export function loadPreviewRuntime() {
  const url = `/dsh-vscode/preview.js?v=${attempt}`
  return loading ??= import(/* @vite-ignore */ url).catch(error => {
    loading = undefined
    attempt++
    throw error
  })
}
