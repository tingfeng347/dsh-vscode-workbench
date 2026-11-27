/** Bump the revision when the served Monaco bundle changes so immutable caches cannot reuse it. */
export const MONACO_VERSION = '0.52.2'
export const MONACO_ASSET_REVISION = `${MONACO_VERSION}-section-headers-1`
export const MONACO_ASSET_BASE = `/dsh-vscode/monaco/${MONACO_ASSET_REVISION}/`
