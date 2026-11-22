import type { ConfigureCall, GenerateOptions, LlmCallConfig } from '@deepseek-ai/dsh-llm'
import type { CommitMessageRuntime } from './commit-message.ts'

export type InlineCompletionMode = 'off' | 'manual' | 'auto'

export interface InlineCompletionContext {
  path: string
  language: string
  prefix: string
  suffix: string
}

export const INLINE_PREFIX_LIMIT = 6000
export const INLINE_SUFFIX_LIMIT = 2000
export const INLINE_TIMEOUT_MS = 2000
const MAX_COMPLETION_LENGTH = 2000
const MAX_COMPLETION_TOKENS = 192

export function isInlineCompletionPath(path: string): boolean {
  return !path.replaceAll('\\', '/').toLowerCase().split('/').some(part =>
    part === '.env' || part.startsWith('.env.') ||
    /^(?:\.npmrc|\.pypirc|\.netrc|\.git-credentials|id_(?:rsa|dsa|ecdsa|ed25519))$/.test(part) ||
    /\.(?:pem|key|p12|pfx)$/.test(part),
  )
}

export function completionInsertText(raw: string, suffix: string): string {
  let text = raw.replace(/\r\n?/g, '\n')
  const fenced = /^\s*```[^\n]*\n([\s\S]*?)\n```\s*$/.exec(text)
  if (fenced !== null) text = fenced[1]!
  const sameLineSuffix = suffix.split(/\r?\n/, 1)[0]!
  if (sameLineSuffix !== '') {
    // Monaco 0.52 can only show a multi-line insertion when its range ends at EOL.
    text = text.split('\n', 1)[0]!
    for (let length = Math.min(sameLineSuffix.length, text.length, 80); length > 0; length--) {
      const overlap = sameLineSuffix.slice(0, length)
      if ((overlap.trim().length >= 3 || /^[)\]}>,;]+$/.test(overlap)) && text.endsWith(overlap)) {
        text = text.slice(0, -length)
        break
      }
    }
  }
  return text.trim() === '' || text.includes('\0') || text.length > MAX_COMPLETION_LENGTH ? '' : text
}

const system = 'You are an inline code completion engine. Fill the gap between prefix and suffix in the current file. ' +
  'Return only the code to insert, preserving indentation and whitespace. Do not repeat the prefix or suffix. ' +
  'Do not add Markdown fences or explanations. Return nothing if there is no clear continuation.'

const configureCompletionCall: ConfigureCall = (controls, model) => {
  const effort = model.reasoning?.efforts
  const least = effort?.find(option => option.id === 'none')?.id ?? effort?.[0]?.id
  return {
    ...controls, temperature: 0.2, maxTokens: MAX_COMPLETION_TOKENS,
    ...(least === undefined ? {} : { reasoningEffort: least }),
  }
}

export async function generateInlineCompletion(
  runtime: CommitMessageRuntime,
  config: LlmCallConfig,
  context: InlineCompletionContext,
  signal: AbortSignal,
): Promise<string> {
  signal.throwIfAborted()
  const messages: GenerateOptions['messages'] = [
    { role: 'user', content: [{ type: 'text', text: JSON.stringify(context) }] },
  ]
  const prepared = await runtime.prepareCall?.(config, signal, configureCompletionCall)
  signal.throwIfAborted()
  const stream = prepared === undefined
    ? runtime.stream({ ...config, system, messages, temperature: 0.2, maxTokens: MAX_COMPLETION_TOKENS, signal })
    : prepared.stream({ ...prepared.config, system, messages, signal })
  let text = ''
  for await (const chunk of stream) {
    signal.throwIfAborted()
    if (chunk.type === 'text-delta') {
      text += chunk.text
      if (text.length > MAX_COMPLETION_LENGTH) return ''
    } else if (chunk.type === 'finish' && (chunk.reason.kind === 'error' || chunk.reason.kind === 'aborted')) {
      throw new Error(chunk.reason.failure.message)
    }
  }
  return completionInsertText(text, context.suffix)
}
