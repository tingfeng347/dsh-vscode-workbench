/** A request that never reached the host says nothing about which call failed; name it, and let
 *  the startup race heal itself the same way a just-published session already does. */
export class ApiError extends Error {
  constructor(public code: string, message: string) { super(message) }
}

/** Back off while the host connection or the current session is still settling after startup. */
export function sessionRetryDelay(error: unknown, attempt: number): number | undefined {
  if (!(error instanceof ApiError)) return undefined
  if (error.code === 'session-not-found') return attempt >= 10 ? undefined : Math.min(250 * (attempt + 1), 1000)
  // The renderer can mount before the host webserver answers, or right after a plugin reload.
  if (error.code === 'network') return attempt >= 6 ? undefined : Math.min(300 * (attempt + 1), 1500)
  return undefined
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
  let response: Response
  try {
    response = await fetch(`/dsh-vscode/api/${method}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal,
    })
  } catch (error) {
    if (signal?.aborted === true) throw error
    const reason = error instanceof Error ? error.message : String(error)
    throw new ApiError('network', `无法连接 DSH 宿主（${method}）：${reason}`)
  }
  const answer = await response.json() as { ok: boolean; value?: T; error?: { code?: string; message?: string } }
  if (!response.ok || !answer.ok) throw new ApiError(answer.error?.code ?? 'request-failed', answer.error?.message ?? `请求 ${method} 失败（HTTP ${response.status}）`)
  return answer.value as T
}

export async function api<T>(method: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  return withSessionRetry(() => request<T>(method, body, signal), signal)
}

/** Retry an operation while DSH is still publishing the selected session. */
export async function withSessionRetry<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await operation() }
    catch (error) {
      const delay = sessionRetryDelay(error, attempt)
      if (delay === undefined) throw error
      await wait(delay, signal)
    }
  }
}