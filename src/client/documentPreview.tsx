import { useEffect, useRef, useState } from 'react'

export type DocumentPreviewKind = 'pdf' | 'docx' | 'download'

/** Return the in-workbench preview supported for a document path. */
export function documentPreviewKind(path: string): DocumentPreviewKind | undefined {
  const extension = path.split('.').at(-1)?.toLowerCase()
  if (extension === 'pdf') return 'pdf'
  if (extension === 'docx') return 'docx'
  if (extension === 'doc' || extension === 'odt') return 'download'
  return undefined
}

function DocxPreview({ src }: { src: string }) {
  const root = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string>()
  useEffect(() => {
    const controller = new AbortController()
    const target = root.current
    if (target === null) return
    setError(undefined)
    void (async () => {
      try {
        const response = await fetch(src, { signal: controller.signal })
        if (!response.ok) throw new Error(`无法读取文档 (${response.status})`)
        const { renderAsync } = await import('docx-preview')
        if (controller.signal.aborted) return
        target.replaceChildren()
        await renderAsync(await response.blob(), target, undefined, { inWrapper: false, ignoreWidth: false, ignoreHeight: false })
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause))
      }
    })()
    return () => controller.abort()
  }, [src])
  return error === undefined ? <div ref={root} className="dvw-docx-preview"/> : <div className="dvw-document-error">无法预览 Word 文档：{error}</div>
}

/** Render an in-workbench preview for PDF and Word documents. */
export function DocumentPreview({ kind, src, path }: { kind: DocumentPreviewKind; src: string; path: string }) {
  if (kind === 'pdf') return <iframe className="dvw-pdf-preview" src={src} title={path}/>
  if (kind === 'docx') return <DocxPreview src={src}/>
  return <div className="dvw-document-download"><strong>此格式无法在浏览器中可靠渲染</strong><a href={src} target="_blank" rel="noreferrer">打开 {path}</a></div>
}
