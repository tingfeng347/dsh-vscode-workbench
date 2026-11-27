/**
 * Bridge between DSH's settings page and the mounted workbench.
 *
 * DSH renders every `settings.section` contribution in its own React root, far
 * away from the workbench tree that owns the live settings state. The section
 * publishes its content node here and the workbench portals its settings view
 * into it, so both surfaces share one source of truth without duplicating the
 * state or the LSP plumbing.
 */
class SettingsHost {
  private node: HTMLElement | undefined
  private readonly listeners = new Set<() => void>()

  getSnapshot = (): HTMLElement | undefined => this.node

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  set(node: HTMLElement | undefined): void {
    if (this.node === node) return
    this.node = node
    for (const listener of [...this.listeners]) listener()
  }
}

export const settingsHost = new SettingsHost()
