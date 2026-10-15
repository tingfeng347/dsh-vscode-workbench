import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'

/** Background retains do not select the workspace shown in the main conversation. */
export function mainViewSession(state: SessionListState) {
  return Object.values(state.byId).find(session => (session.retainedBy.mainView ?? 0) > 0)
}
