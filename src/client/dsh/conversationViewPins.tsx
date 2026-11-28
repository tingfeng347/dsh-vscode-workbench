import { useEffect, useRef } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'

const STORAGE_KEY = 'dvw:conversation-view-pins:v1'

function readUnpinned(): Set<string> | undefined {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')
    if (!Array.isArray(value) || !value.every(id => typeof id === 'string')) return
    return new Set(value)
  } catch { return }
}

/** Persists the official View pin choices through the public More-menu owner API. */
export function ConversationViewPins({ entries, onPinnedChange }: PropsRuntime<'conversation.session.header.views.actions'>) {
  const restored = useRef(false)
  const entriesRef = useRef(entries)
  entriesRef.current = entries
  const entryKey = JSON.stringify(entries.map(({ id, pinned }) => [id, pinned]))

  useEffect(() => {
    if (!restored.current) {
      restored.current = true
      const saved = readUnpinned()
      if (saved !== undefined) {
        for (const { id, pinned } of entriesRef.current) {
          const wanted = !saved.has(id)
          if (pinned !== wanted) onPinnedChange(id, wanted)
        }
        return
      }
    }

    const previouslySaved = readUnpinned() ?? new Set<string>()
    for (const { id } of entriesRef.current) previouslySaved.delete(id)
    for (const { id, pinned } of entriesRef.current) if (!pinned) previouslySaved.add(id)
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify([...previouslySaved])) } catch { /* Storage may be disabled. */ }
  }, [entryKey, onPinnedChange])

  return null
}
