import { describe, expect, it } from 'vitest'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { buildCommitMessagePrompt, cleanCommitMessage, commitMessageSystemPrompt, compactCommitPatch, generateCommitMessage, normalizeCommitPreferences, prioritizeCommitPatch, type CommitContext, type CommitMessageRuntime } from '../src/commit-message.ts'

const context: CommitContext = {
  repository: '/repo',
  branch: 'main',
  files: ['src/a.ts', 'README.md (新增)'],
  recent: ['feat(editor): add tabs', 'fix(git): retry status'],
  patch: 'diff --git a/src/a.ts b/src/a.ts\n+export const answer = 42',
  truncated: false,
}

function runtime(chunks: StreamChunk[], calls: GenerateOptions[] = []) {
  return {
    stream(options: GenerateOptions) {
      calls.push(options)
      return (async function* () { for (const chunk of chunks) yield chunk })()
    },
  }
}

describe('commit message generation', () => {
  it('includes the branch, file list, recent style and patch in the prompt', () => {
    const prompt = buildCommitMessagePrompt(context)
    expect(prompt).toContain('Branch: main')
    expect(prompt).toContain('- src/a.ts')
    expect(prompt).toContain('- feat(editor): add tabs')
    expect(prompt).toContain('+export const answer = 42')
    expect(prompt).not.toContain('truncated')
    expect(buildCommitMessagePrompt({ ...context, truncated: true })).toContain('truncated')
  })

  it('strips fences, labels and quotes from model output', () => {
    expect(cleanCommitMessage('```text\nfeat(git): add AI commit messages\n```')).toBe('feat(git): add AI commit messages')
    expect(cleanCommitMessage('提交信息：fix(editor): keep preview default')).toBe('fix(editor): keep preview default')
    expect(cleanCommitMessage('"chore: release v0.2.2"')).toBe('chore: release v0.2.2')
  })

  it('drops bodies and bullets so the result stays one Conventional Commit line', () => {
    expect(cleanCommitMessage('feat(git): generate commit messages\n\n- Add a generator\n- Keep the message editable')).toBe('feat(git): generate commit messages')
    expect(cleanCommitMessage('- fix(editor): restore Ctrl+click\n\nbody text')).toBe('fix(editor): restore Ctrl+click')
  })

  it('keeps the body for detailed messages', () => {
    expect(cleanCommitMessage('feat(workbench): add commit settings\n\n- Add detail levels\n- Add language choices', 'detailed')).toBe('feat(workbench): add commit settings\n\n- Add detail levels\n- Add language choices')
    expect(cleanCommitMessage('feat(workbench): add commit settings\n\n* Add detail levels\n• Add language choices', 'detailed')).toBe('feat(workbench): add commit settings\n\n- Add detail levels\n- Add language choices')
  })

  it('applies the requested detail and language to the prompt', () => {
    const detailed = { detail: 'detailed' as const, language: 'en' as const }
    expect(commitMessageSystemPrompt(detailed)).toContain('2 to 4 bullet points')
    expect(commitMessageSystemPrompt(detailed)).toContain('Write the subject and body in English.')
    expect(buildCommitMessagePrompt(context, detailed)).toContain('Requested detail: detailed')
    expect(buildCommitMessagePrompt(context, detailed)).toContain('Requested language: en')
    expect(commitMessageSystemPrompt({ detail: 'concise', language: 'zh' })).toContain('at most 50 characters')
    expect(commitMessageSystemPrompt({ detail: 'concise', language: 'zh' })).toContain('Simplified Chinese')
  })

  it('normalizes unknown preference values', () => {
    expect(normalizeCommitPreferences('unexpected', 'fr')).toEqual({ detail: 'standard', language: 'auto' })
    expect(normalizeCommitPreferences('detailed', 'zh')).toEqual({ detail: 'detailed', language: 'zh' })
  })

  it('streams text into a commit message and forwards the session model', async () => {
    const calls: GenerateOptions[] = []
    const message = await generateCommitMessage(runtime([
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text: 'feat(git): ' },
      { type: 'text-delta', index: 0, text: 'generate commit messages' },
      { type: 'finish', reason: { kind: 'stop' } },
    ], calls), { provider: 'deepseek', model: 'deepseek-chat' }, context)
    expect(message).toBe('feat(git): generate commit messages')
    expect(calls[0]).toMatchObject({ provider: 'deepseek', model: 'deepseek-chat', temperature: 0.2, maxTokens: 1024 })
    expect(calls[0]?.system).toContain('Conventional Commits')
  })

  it('prepares the call with the least reasoning effort so the subject is not starved of tokens', async () => {
    const calls: GenerateOptions[] = []
    const fake: CommitMessageRuntime = {
      async prepareCall(config, _signal, configure) {
        const controls = configure?.({}, { reasoning: { efforts: [{ id: 'minimal' }, { id: 'high' }] } } as never) ?? {}
        return {
          config: { provider: config.provider, model: config.model, ...controls },
          stream(options: GenerateOptions) {
            calls.push(options)
            return (async function* () {
              yield { type: 'text-delta', index: 0, text: 'fix(git): describe the real diff' }
              yield { type: 'finish', reason: { kind: 'stop' } }
            })()
          },
        } as never
      },
      stream() { throw new Error('plain stream must not be used when prepareCall exists') },
    }
    const message = await generateCommitMessage(fake, { provider: 'deepseek', model: 'deepseek-v4-flash' }, context)
    expect(message).toBe('fix(git): describe the real diff')
    expect(calls[0]).toMatchObject({ reasoningEffort: 'minimal', maxTokens: 1024, temperature: 0.2 })
  })

  it('reports provider failures and empty results', async () => {
    await expect(generateCommitMessage(runtime([
      { type: 'finish', reason: { kind: 'error', failure: { code: 'RATE_LIMIT', message: 'rate limited' } } },
    ]), { provider: 'p', model: 'm' }, context)).rejects.toThrow('rate limited')
    await expect(generateCommitMessage(runtime([
      { type: 'finish', reason: { kind: 'stop' } },
    ]), { provider: 'p', model: 'm' }, context)).rejects.toThrow('模型没有返回提交信息')
  })
})

describe('commit patch prioritisation', () => {
  const section = (path: string, body: string) => `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n${body}`

  it('drops unchanged context and clips very long changed lines', () => {
    const patch = [
      'diff --git a/src/a.ts b/src/a.ts',
      'index 1111111..2222222 100644',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -1,3 +1,4 @@',
      ' const unchanged = true',
      `+const veryLong = '${'x'.repeat(800)}'`,
      '-const removed = true',
    ].join('\n')
    const compact = compactCommitPatch(patch)
    expect(compact).toContain('@@ -1,3 +1,4 @@')
    expect(compact).toContain('-const removed = true')
    expect(compact).not.toContain('const unchanged = true')
    expect(compact.length).toBeLessThan(600)
  })

  it('drops lockfiles and puts source diffs ahead of documentation', () => {
    const patch = [
      section('README.md', '+README wording that describes a feature\n'),
      section('pnpm-lock.yaml', '+lockfile noise\n'),
      section('src/a.ts', '+export const answer = 42\n'),
    ].join('')
    const result = prioritizeCommitPatch(patch, 1000)
    expect(result.patch).not.toContain('pnpm-lock.yaml')
    expect(result.patch.indexOf('src/a.ts')).toBeGreaterThanOrEqual(0)
    expect(result.patch.indexOf('src/a.ts')).toBeLessThan(result.patch.indexOf('README.md'))
  })

  it('puts production source ahead of tests', () => {
    const patch = [
      section('README.md', '+docs\n'),
      section('tests/a.spec.ts', '+test code\n'),
      section('src/a.ts', '+source code\n'),
    ].join('')
    const result = prioritizeCommitPatch(patch, 1000)
    expect(result.patch.indexOf('src/a.ts')).toBeLessThan(result.patch.indexOf('tests/a.spec.ts'))
    expect(result.patch.indexOf('tests/a.spec.ts')).toBeLessThan(result.patch.indexOf('README.md'))
  })

  it('cuts the section that no longer fits and keeps the budget', () => {
    const patch = section('README.md', Array.from({ length: 1200 }, (_, index) => `+docs line ${index}`).join('\n')) + section('src/a.ts', '+code\n')
    const result = prioritizeCommitPatch(patch, 600)
    expect(result.truncated).toBe(true)
    expect(result.patch).toContain('+code')
    expect(result.patch.length).toBeLessThanOrEqual(600)
  })
})
