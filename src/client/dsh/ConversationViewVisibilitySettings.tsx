import { useEffect, useState } from 'react'
import type { ConversationSessionHeaderInjected } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { CONVERSATION_VIEW_SETTINGS_EVENT } from './DshConversationPanel.tsx'
import { Icon } from '../ui/Icon.tsx'

type Views = ReturnType<ConversationSessionHeaderInjected['hooks']['conversationViews']['getSnapshot']>

interface Props {
  sessionId: string
  useConversationViews: <S>(selector: (views: Views) => S) => S
  useEntryPins: <S>(selector: (ids: readonly string[]) => S) => S
  setPinned: ConversationSessionHeaderInjected['setPinned']
}

/** Main-session host for the view visibility action contributed to the official menu. */
export function ConversationViewVisibilitySettings({ sessionId, useConversationViews, useEntryPins, setPinned }: Props) {
  const views = useConversationViews(value => value)
  const unpinned = useEntryPins(value => value)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const onSettings = (event: Event) => {
      const detail = (event as CustomEvent<{ sessionId: string; origin?: string }>).detail
      if (detail?.sessionId === sessionId && detail.origin === 'main-header') setOpen(true)
    }
    window.addEventListener(CONVERSATION_VIEW_SETTINGS_EVENT, onSettings)
    return () => window.removeEventListener(CONVERSATION_VIEW_SETTINGS_EVENT, onSettings)
  }, [sessionId])

  return <div className="dvw-conversation-view-settings-anchor">
    {open && <div className="dvw-sidebar-conversation-visibility-menu" role="dialog" aria-label="设置显示的视图">
      <div className="dvw-sidebar-conversation-visibility-title"><span>显示的视图</span><button type="button" aria-label="关闭显示设置" onClick={() => setOpen(false)}><Icon name="close"/></button></div>
      {views.map(view => <label key={view.id}><input type="checkbox" checked={!unpinned.includes(view.id)} disabled={view.id === 'chat'} onChange={() => setPinned(view.id, unpinned.includes(view.id))}/><span>{view.label}</span></label>)}
    </div>}
  </div>
}
