export class ApiError extends Error {
  constructor(public code: string, message: string) { super(message) }
}

export async function api<T>(method: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/dsh-vscode/api/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal,
  })
  const answer = await response.json() as { ok: boolean; value?: T; error?: { code?: string; message?: string } }
  if (!response.ok || !answer.ok) throw new ApiError(answer.error?.code ?? 'request-failed', answer.error?.message ?? `request failed (${response.status})`)
  return answer.value as T
}
