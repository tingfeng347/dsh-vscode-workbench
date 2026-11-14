import type { ISidebarRight, SidebarRightOpenResourceOptions } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'

/** The part of DSH's right sidebar used by the generated-file link interceptor. */
export type GeneratedFileOpenHost = Pick<ISidebarRight, 'mounted' | 'openResource'>

/** A session-scoped file address decoded from `dsh-resource://file/session/…`. */
export interface ParsedGeneratedFileAddress {
  readonly sessionId: string
  readonly path: string
}

/** Event payload consumed by the workbench to open a generated file in its editor. */
export interface GeneratedFileOpenDetail extends ParsedGeneratedFileAddress {
  readonly line?: number
}

export const GENERATED_FILE_OPEN_EVENT = 'dvw-open-generated-file'

const FILE_ADDRESS_PREFIX = 'dsh-resource://file/'

/**
 * Parse a session-scoped DSH file address.
 *
 * Every component is decoded independently. Query strings and fragments are
 * outside the address grammar and are ignored only after they have been
 * separated from the encoded path.
 */
export function parseGeneratedFileAddress(address: string): ParsedGeneratedFileAddress | undefined {
  if (typeof address !== 'string' || !address.startsWith(FILE_ADDRESS_PREFIX)) return undefined
  const suffix = address.search(/[?#]/)
  const body = address.slice(FILE_ADDRESS_PREFIX.length, suffix === -1 ? undefined : suffix)
  const parts = body.split('/')
  if (parts[0] !== 'session') return undefined

  const encodedSessionId = parts[1]
  const encodedPath = parts.slice(2)
  if (encodedSessionId === undefined || encodedSessionId === '' || encodedPath.length === 0) return undefined

  try {
    const sessionId = decodeURIComponent(encodedSessionId)
    const path = encodedPath.map(decodeURIComponent).join('/')
    return sessionId === '' || path === '' ? undefined : { sessionId, path }
  } catch {
    return undefined
  }
}

function requestedLine(options: SidebarRightOpenResourceOptions | undefined): number | undefined {
  const params = options?.params as { readonly line?: unknown } | undefined
  const line = params?.line
  return typeof line === 'number' && Number.isSafeInteger(line) && line > 0 ? line : undefined
}

interface InstalledInterceptor {
  readonly original: ISidebarRight['openResource']
  wrapper: ISidebarRight['openResource']
  isWorkbenchVisible(): boolean
  installers: number
}

// Multiple callers may install the same guard. Keep one wrapper per sidebar and
// restore the original only after every installer has disposed.
const installed = new WeakMap<GeneratedFileOpenHost, InstalledInterceptor>()
const CHANGED_FILES_CARD = '[data-changed-files="true"]'

/**
 * Intercept generated file links while the workbench is visible.
 *
 * A matching session-scoped file address becomes a synchronous
 * `dvw-open-generated-file` CustomEvent instead of opening DSH's sidebar
 * viewer. Unsupported addresses, other sessions, and hidden workbenches are
 * passed through to the original `openResource` method with the original
 * arguments.
 */
export function installGeneratedFileOpenInterceptor(
  sidebar: GeneratedFileOpenHost,
  isWorkbenchVisible: () => boolean,
): () => void {
  const existing = installed.get(sidebar)
  if (existing !== undefined) {
    existing.installers++
    existing.isWorkbenchVisible = isWorkbenchVisible
    return installerDisposer(sidebar, existing)
  }

  const original = sidebar.openResource
  const state: InstalledInterceptor = {
    original,
    wrapper: original,
    isWorkbenchVisible,
    installers: 1,
  }
  const wrapper = function (address: string, options?: SidebarRightOpenResourceOptions): void {
    const parsed = state.isWorkbenchVisible()
      ? parseGeneratedFileAddress(address)
      : undefined
    if (parsed !== undefined && sidebar.mounted.getSnapshot() === parsed.sessionId) {
      const line = requestedLine(options)
      window.dispatchEvent(new CustomEvent<GeneratedFileOpenDetail>(GENERATED_FILE_OPEN_EVENT, {
        detail: line === undefined ? parsed : { ...parsed, line },
      }))
      return
    }
    if (arguments.length === 1) original.call(sidebar, address)
    else original.call(sidebar, address, options)
  } as ISidebarRight['openResource']

  state.wrapper = wrapper
  installed.set(sidebar, state)
  sidebar.openResource = wrapper
  return installerDisposer(sidebar, state)
}

function changedFilePath(button: Element): string | undefined {
  const pathNode = [...button.querySelectorAll<HTMLElement>('[class]')]
    .find(node => [...node.classList].some(name => name.split(/[-_\s]+/).includes('path')))
  const text = pathNode?.textContent?.trim()
  if (text !== undefined && text !== '') return text

  const aria = button.getAttribute('aria-label') ?? ''
  return /^查看 (.+) 的改动$/.exec(aria)?.[1]
    ?? /^(?:View|Open) changes (?:to|for) (.+)$/i.exec(aria)?.[1]
}

function directChangedFilePath(button: Element): string | undefined {
  const pathNode = [...button.children].find(node => node.tagName === 'SPAN')
  const text = pathNode?.textContent?.trim()
  return text === undefined || text === '' ? undefined : text
}

function firstChangedFilePath(card: Element): string | undefined {
  for (const button of card.querySelectorAll('button')) {
    const path = changedFilePath(button)
    if (path !== undefined) return path
  }
  return undefined
}

/**
 * Route DSH's turn change card into the workbench.
 *
 * The official card is a DOM contribution rather than an openResource caller,
 * so API interception cannot see it. File rows open their exact path; the card
 * header opens the first visible changed file. The expand-all control keeps its
 * native behavior so the full official list remains available.
 */
export function installDshChangedFilesOpenInterceptor(
  sidebar: GeneratedFileOpenHost,
  isWorkbenchVisible: () => boolean,
  showWorkbench: () => void,
): () => void {
  const onOpen = (event: MouseEvent) => {
    if (event.defaultPrevented || event.button !== 0 || !(event.target instanceof Element)) return
    if (!isWorkbenchVisible()) return
    const button = event.target.closest<HTMLButtonElement>(`${CHANGED_FILES_CARD} button`)
    if (button === null) return
    if (button.getAttribute('aria-expanded') !== null) return
    const card = button.closest(CHANGED_FILES_CARD)
    const sessionId = sidebar.mounted.getSnapshot()
    if (card === null || sessionId === undefined) return

    const isHeader = button === card.querySelector('button')
    const path = changedFilePath(button)
      ?? (isHeader ? firstChangedFilePath(card) : directChangedFilePath(button))
    if (path === undefined || path === '') return

    event.preventDefault()
    event.stopImmediatePropagation()
    showWorkbench()
    window.dispatchEvent(new CustomEvent<GeneratedFileOpenDetail>(GENERATED_FILE_OPEN_EVENT, {
      detail: { sessionId, path },
    }))
  }
  document.addEventListener('click', onOpen, true)
  return () => document.removeEventListener('click', onOpen, true)
}

function installerDisposer(sidebar: GeneratedFileOpenHost, state: InstalledInterceptor): () => void {
  let disposed = false
  return () => {
    if (disposed) return
    disposed = true
    state.installers--
    if (state.installers > 0) return
    if (sidebar.openResource === state.wrapper) sidebar.openResource = state.original
    installed.delete(sidebar)
  }
}
