export const CONVERSATION_ACTION_SETTINGS_EVENT = 'dvw-conversation-action-settings'
export const CONVERSATION_ACTION_SETTINGS_KEY = 'dvw:conversation-action-visibility:v1'

export type ConversationActionId = 'conversation-placement' | 'close-conversation-bar' | 'open-native-sidebar'
export type ConversationActionVisibility = Readonly<Record<ConversationActionId, boolean>>

const defaults: ConversationActionVisibility = {
  'conversation-placement': true,
  'close-conversation-bar': false,
  'open-native-sidebar': true,
}

function readVisibility(): ConversationActionVisibility {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(CONVERSATION_ACTION_SETTINGS_KEY) ?? 'null')
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return defaults
    const saved = parsed as Record<string, unknown>
    return {
      'conversation-placement': typeof saved['conversation-placement'] === 'boolean' ? saved['conversation-placement'] : defaults['conversation-placement'],
      'close-conversation-bar': typeof saved['close-conversation-bar'] === 'boolean' ? saved['close-conversation-bar'] : defaults['close-conversation-bar'],
      'open-native-sidebar': typeof saved['open-native-sidebar'] === 'boolean' ? saved['open-native-sidebar'] : defaults['open-native-sidebar'],
    }
  } catch { return defaults }
}

let snapshot = readVisibility()
const listeners = new Set<() => void>()

export function getConversationActionVisibility(): ConversationActionVisibility { return snapshot }

export function subscribeConversationActionVisibility(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function setConversationActionVisible(id: ConversationActionId, visible: boolean): void {
  if (snapshot[id] === visible) return
  snapshot = { ...snapshot, [id]: visible }
  try { localStorage.setItem(CONVERSATION_ACTION_SETTINGS_KEY, JSON.stringify(snapshot)) } catch { /* Storage may be disabled. */ }
  for (const listener of listeners) listener()
}

export function visibleConversationToolbarActions(inSidebar: boolean, visibility: ConversationActionVisibility): ConversationActionId[] {
  return [
    ...(visibility['conversation-placement'] ? ['conversation-placement' as const] : []),
    ...(!inSidebar && visibility['open-native-sidebar'] ? ['open-native-sidebar' as const] : []),
    ...(visibility['close-conversation-bar'] ? ['close-conversation-bar' as const] : []),
  ]
}
