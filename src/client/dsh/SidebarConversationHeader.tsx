import { useEffect, useState } from 'react'
import { CONVERSATION_VIEW_SETTINGS_EVENT, DshConversationCloseIcon, DshConversationOpenIcon } from './DshConversationPanel.tsx'
import { Icon } from '../ui/Icon.tsx'
import type { ConversationSessionHeaderInjected } from '@deepseek-ai/dsh-client-ui-conversation/client'

type ViewRoster = ReturnType<ConversationSessionHeaderInjected['hooks']['conversationViews']['getSnapshot']>

interface Props {
  sessionId: string
  title: string
  activeView: string | null
  useConversationViews: <S>(selector: (views: ViewRoster) => S) => S
  useEntryPins: <S>(selector: (ids: readonly string[]) => S) => S
  useEntryActions: <S>(selector: (enabled: boolean) => S) => S
  selectView: ConversationSessionHeaderInjected['selectView']
  setPinned: ConversationSessionHeaderInjected['setPinned']
}

/** Session title and view navigation above the embedded official Conversation content. */
export function SidebarConversationHeader({ sessionId, title, activeView, useConversationViews, useEntryPins, useEntryActions, selectView, setPinned }: Props) {
  const views = useConversationViews(value => value)
  const unpinned = useEntryPins(value => value)
  const hasActions = useEntryActions(value => value)
  const [moreOpen, setMoreOpen] = useState(false)
  const [visibilityOpen, setVisibilityOpen] = useState(false)
  const active = views.find(view => view.id === activeView) ?? views.find(view => view.id === 'chat')
  const preferred = [
    ...views.filter(view => view.id === 'chat'),
    ...views.filter(view => view.id !== 'chat' && !unpinned.includes(view.id)),
  ]
  const defaultVisible = hasActions ? preferred.slice(0, 4) : preferred
  const visible = defaultVisible
  const visibleIds = new Set(visible.map(view => view.id))
  const more = views.filter(view => !visibleIds.has(view.id))

  useEffect(() => {
    const openSettings = (event: Event) => {
      const detail = (event as CustomEvent<{ sessionId: string; origin?: string }>).detail
      if (detail?.sessionId === sessionId && detail.origin !== 'main-header') setVisibilityOpen(true)
    }
    window.addEventListener(CONVERSATION_VIEW_SETTINGS_EVENT, openSettings)
    return () => window.removeEventListener(CONVERSATION_VIEW_SETTINGS_EVENT, openSettings)
  }, [sessionId])

  const toggleVisible = (viewId: string) => {
    if (viewId === 'chat') return
    if (visibleIds.has(viewId)) {
      setPinned(viewId, false)
      return
    }
    setPinned(viewId, true)
    if (hasActions && visible.length >= 4) {
      const replaced = [...visible].reverse().find(view => view.id !== 'chat')
      if (replaced !== undefined) setPinned(replaced.id, false)
    }
  }

  return <header className="dvw-native-conversation-header">
    <div className="dvw-sidebar-conversation-title-row">
      <div className="dvw-sidebar-conversation-title">
        <span className="dvw-sidebar-conversation-title-text">{title}</span>
        <span className="dvw-sidebar-conversation-mode"><Icon name="git-branch"/> 标准模式</span>
      </div>
      <div className="dvw-sidebar-conversation-actions">
        <button type="button" className="dvw-official-conversation-action" aria-label="在编辑区打开对话" title="在编辑区打开对话" onClick={() => window.dispatchEvent(new CustomEvent('dvw-workbench-conversation-action', { detail: { sessionId, action: 'open-editor' } }))}><DshConversationOpenIcon/></button>
        <button type="button" className="dvw-official-conversation-action" aria-label="关闭对话栏" title="关闭对话栏" onClick={() => window.dispatchEvent(new CustomEvent('dvw-workbench-conversation-action', { detail: { sessionId, action: 'close' } }))}><DshConversationCloseIcon/></button>
      </div>
    </div>
    {views.length > 1 && <div className="dvw-sidebar-conversation-tabs" role="tablist">
      {visible.map(view => <button key={view.id} type="button" role="tab" aria-selected={view.id === active?.id} className={'dvw-sidebar-conversation-tab' + (view.id === active?.id ? ' is-active' : '')} onClick={() => selectView(view.id)}>{view.label}</button>)}
      {hasActions && more.length > 0 && <div className="dvw-sidebar-conversation-more">
        <button type="button" className={'dvw-sidebar-conversation-tab' + (more.some(view => view.id === active?.id) ? ' is-active' : '')} aria-label="更多视图" aria-haspopup="menu" aria-expanded={moreOpen} onClick={() => setMoreOpen(value => !value)}>…</button>
        {moreOpen && <div className="dvw-sidebar-conversation-menu" role="menu">{more.map(view => <div key={view.id} className="dvw-sidebar-conversation-menu-row">
          <button type="button" role="menuitem" onClick={() => selectView(view.id)}>{view.label}</button>
          <button type="button" aria-label={(unpinned.includes(view.id) ? '固定' : '取消固定') + view.label} title={unpinned.includes(view.id) ? '固定' : '取消固定'} onClick={() => setPinned(view.id, unpinned.includes(view.id))}>{unpinned.includes(view.id) ? '☆' : '★'}</button>
        </div>)}</div>}
      </div>}
    </div>}
    {views.length > 1 && visibilityOpen && <div className="dvw-sidebar-conversation-visibility-menu" role="dialog" aria-label="设置显示的视图">
      <div className="dvw-sidebar-conversation-visibility-title"><span>显示的视图</span><button type="button" aria-label="关闭显示设置" onClick={() => setVisibilityOpen(false)}><Icon name="close"/></button></div>
      {views.map(view => <label key={view.id}><input type="checkbox" checked={visibleIds.has(view.id)} disabled={view.id === 'chat'} onChange={() => toggleVisible(view.id)}/><span>{view.label}</span></label>)}
    </div>}
  </header>
}
