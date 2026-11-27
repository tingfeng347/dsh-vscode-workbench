import type {} from '@deepseek-ai/dsh-client-ui-slots'

/** Settings navigation key shared by the section, its icon, and the opener. */
export const SETTINGS_SECTION_ID = 'dsh-vscode-workbench'

/**
 * DSH's settings shell owns these slots but its contract package is not a
 * dependency of this plugin, so the two entries this plugin contributes are
 * declared here. Shapes mirror `dsh-client-ui-settings/client/contract/slots`.
 */
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'settings.section': { kind: 'list'; scope: 'root'; owner: { close(): void } }
    'settings.section.icon': { kind: 'list'; scope: 'root'; inline: true; owner: { size: number; active: boolean } }
  }
}
