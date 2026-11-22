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

export function waitForDelay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal?.reason ?? new Error('aborted')) }
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve() }, ms)
    if (signal?.aborted === true) { abort(); return }
    signal?.addEventListener('abort', abort, { once: true })
  })
}

const STARTUP_READS = new Set(['workspace', 'git.status', 'commit.models', 'fs.list', 'fs.read', 'project.sources', 'lsp.status', 'review.feed'])

export async function readApiResponse<T>(response: Response, method: string, retryable = false): Promise<T> {
  let answer: { ok?: boolean; value?: T; error?: { code?: string; message?: string } } | null
  try {
    answer = await response.json()
  } catch (cause) {
    if (cause instanceof Error && cause.name === 'AbortError') throw cause
    const unavailable = [404, 502, 503, 504].includes(response.status)
    const reason = response.status === 405
      ? '请确认工作台宿主组件已运行，或重新启动 DSH'
      : unavailable ? 'DSH 宿主接口暂不可用' : '宿主未返回有效的 JSON 响应'
    throw new ApiError(unavailable && retryable ? 'network' : 'invalid-response', `${reason}（${method}，HTTP ${response.status}）`)
  }
  if (typeof answer?.ok !== 'boolean') throw new ApiError('invalid-response', `宿主响应格式无效（${method}，HTTP ${response.status}）`)
  if (!response.ok || !answer.ok) throw new ApiError(answer.error?.code ?? 'request-failed', answer.error?.message ?? `请求 ${method} 失败（HTTP ${response.status}）`)
  return answer.value as T
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
  return readApiResponse<T>(response, method, STARTUP_READS.has(method) || (method === 'git.action' && body.action === 'log'))
}

export async function api<T>(method: string, body: Record<string, unknown>, signal?: AbortSignal, options?: { retry?: boolean }): Promise<T> {
  const send = () => request<T>(method, body, signal)
  return options?.retry === false ? send() : withSessionRetry(send, signal)
}

/** Retry an operation while DSH is still publishing the selected session. */
export async function withSessionRetry<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await operation() }
    catch (error) {
      const delay = sessionRetryDelay(error, attempt)
      if (delay === undefined) throw error
      await waitForDelay(delay, signal)
    }
  }
}
