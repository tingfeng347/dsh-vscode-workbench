export class ApiError extends Error {
  constructor(public code: string, message: string) { super(message) }
}

/** Back off while DSH publishes the current session after startup; every view shares this retry. */
export function sessionRetryDelay(error: unknown, attempt: number): number | undefined {
  if (!(error instanceof ApiError) || error.code !== 'session-not-found' || attempt >= 10) return undefined
  return Math.min(250 * (attempt + 1), 1000)
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal?.reason ?? new Error('aborted')) }
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve() }, ms)
    if (signal?.aborted === true) { abort(); return }
    signal?.addEventListener('abort', abort, { once: true })
  })
}

async function request<T>(method: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/dsh-vscode/api/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal,
  })
  const answer = await response.json() as { ok: boolean; value?: T; error?: { code?: string; message?: string } }
  if (!response.ok || !answer.ok) throw new ApiError(answer.error?.code ?? 'request-failed', answer.error?.message ?? `request failed (${response.status})`)
  return answer.value as T
}

export async function api<T>(method: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await request<T>(method, body, signal) }
    catch (error) {
      const delay = sessionRetryDelay(error, attempt)
      if (delay === undefined) throw error
      await wait(delay, signal)
    }
  }
}
