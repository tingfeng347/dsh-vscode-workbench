/** Locate the central panel DSH renders when a global panel (Plugins, market…) is open. */
export function findDshGlobalPanel(documentRoot: Document = document): HTMLElement | null {
  return documentRoot.querySelector<HTMLElement>('[data-global-panel]')
}

const DSH_PANEL_TITLES: Record<string, string> = {
  plugins: '插件',
  'dsh-market': '插件市场',
  automations: '自动化任务',
  ssh: 'SSH',
}

/** Tab-style label for an embedded DSH panel; unknown ids keep their own name. */
export function dshPanelLabel(id: string): string {
  return DSH_PANEL_TITLES[id] ?? id
}
