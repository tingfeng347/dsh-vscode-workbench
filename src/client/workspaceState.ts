/** Values cleared before another workspace starts loading. */
export interface EmptyWorkspaceDocuments<T> {
  tabs: T[]
  active: undefined
  error: undefined
}

/** Remove editor state that belongs to the previous workspace. */
export function resetWorkspaceDocuments<T>(): EmptyWorkspaceDocuments<T> {
  return { tabs: [], active: undefined, error: undefined }
}

/** Identifies responses that still belong to the active workspace request. */
export class WorkspaceRequestScope {
  private epoch = 0

  /** Begin loading another workspace and invalidate earlier work. */
  begin(): number {
    this.epoch += 1
    return this.epoch
  }

  /** Return the active workspace request identifier. */
  current(): number {
    return this.epoch
  }

  /** Invalidate an active request while preserving any newer request. */
  invalidate(epoch: number): void {
    if (this.epoch === epoch) this.epoch += 1
  }

  /** Return whether a response may update the current workspace. */
  isCurrent(epoch: number): boolean {
    return epoch === this.epoch
  }
}
