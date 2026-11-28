import { useEffect, useState, useSyncExternalStore } from 'react'
import { Icon } from '../ui/Icon.tsx'
import {
  CONVERSATION_ACTION_SETTINGS_EVENT,
  getConversationActionVisibility,
  setConversationActionVisible,
  subscribeConversationActionVisibility,
  type ConversationActionId,
} from './conversationActionVisibility.ts'
import { CONVERSATION_MENU_CHANGED_EVENT } from './DshConversationPanel.tsx'

const actions: readonly { id: ConversationActionId; label: string }[] = [
  { id: 'conversation-placement', label: '在编辑区打开对话' },
  { id: 'open-native-sidebar', label: '打开侧边栏' },
  { id: 'close-conversation-bar', label: '关闭对话栏' },
]

export function ConversationActionVisibilitySettings({ sessionId }: { sessionId: string }) {
  const visibility = useSyncExternalStore(subscribeConversationActionVisibility, getConversationActionVisibility)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const onSettings = (event: Event) => {
      const detail = (event as CustomEvent<{ sessionId: string }>).detail
      if (detail?.sessionId === sessionId) setOpen(true)
    }
    window.addEventListener(CONVERSATION_ACTION_SETTINGS_EVENT, onSettings)
    return () => window.removeEventListener(CONVERSATION_ACTION_SETTINGS_EVENT, onSettings)
  }, [sessionId])

  useEffect(() => {
    window.dispatchEvent(new CustomEvent(CONVERSATION_MENU_CHANGED_EVENT, { detail: { sessionId } }))
  }, [sessionId, visibility])

  return <div className="dvw-conversation-view-settings-anchor">
    {open && <div className="dvw-sidebar-conversation-visibility-menu" role="dialog" aria-label="设置显示的图标">
      <div className="dvw-sidebar-conversation-visibility-title"><span>固定在 ... 左侧</span><button type="button" aria-label="关闭显示设置" onClick={() => setOpen(false)}><Icon name="close"/></button></div>
      {actions.map(action => <label key={action.id}><input type="checkbox" checked={visibility[action.id]} onChange={event => setConversationActionVisible(action.id, event.currentTarget.checked)}/><span>{action.label}</span></label>)}
    </div>}
  </div>
}
