import { useEffect, useRef, useState } from 'react'
import { api } from './api.ts'

let previewLoading: Promise<typeof import('./previewRuntime.ts')> | undefined
let previewAttempt = 0
function loadPreviewRuntime() {
  const url = `/dsh-vscode/preview.js?v=${previewAttempt}`
  return previewLoading ??= import(/* @vite-ignore */ url).catch(error => {
    previewLoading = undefined; previewAttempt += 1; throw error
  })
}

type XlsxModule = typeof import('xlsx')
let xlsxLoading: Promise<XlsxModule> | undefined

/** Load SheetJS from the host-hosted browser build; bundling it drags Node builtins into the client. */
export function loadXlsx(): Promise<XlsxModule> {
  xlsxLoading ??= new Promise<XlsxModule>((resolve, reject) => {
    const existing = (window as Window & { XLSX?: XlsxModule }).XLSX
    if (existing !== undefined) { resolve(existing); return }
    const script = document.createElement('script')
    script.src = '/dsh-vscode/xlsx.js'
    script.onload = () => {
      const value = (window as Window & { XLSX?: XlsxModule }).XLSX
      if (value === undefined) reject(new Error('SheetJS 加载失败')); else resolve(value)
    }
    script.onerror = () => { script.remove(); reject(new Error('SheetJS 加载失败')) }
    document.head.append(script)
  }).catch(error => { xlsxLoading = undefined; throw error })
  return xlsxLoading
}

export type DocumentPreviewKind = 'pdf' | 'office' | 'sheet' | 'download'

const SHEET_EXTENSIONS = new Set(['xlsx', 'xlsm', 'xls', 'ods'])
const OFFICE_EXTENSIONS = new Set(['doc', 'docx', 'ppt', 'pptx', 'odt', 'odp', 'rtf'])

const MIN_PDF_SCALE = 0.5
const MAX_PDF_SCALE = 3

/** Bound PDF zoom to values that remain usable in the workbench viewport. */
export function clampPdfScale(scale: number): number {
  return Math.max(MIN_PDF_SCALE, Math.min(MAX_PDF_SCALE, Math.round(scale * 100) / 100))
}

/** Return the in-workbench preview supported for a document path. */
export function documentPreviewKind(path: string): DocumentPreviewKind | undefined {
  const extension = path.split('.').at(-1)?.toLowerCase()
  if (extension === 'pdf') return 'pdf'
  if (extension !== undefined && SHEET_EXTENSIONS.has(extension)) return 'sheet'
  if (extension !== undefined && OFFICE_EXTENSIONS.has(extension)) return 'office'
  return undefined
}

/** Convert one worksheet matrix into display rows, keeping large books responsive. */
export function sheetTable(rows: readonly unknown[][], limits: { rows: number; columns: number } = { rows: 500, columns: 50 }): string[][] {
  return rows.slice(0, limits.rows).map(row => (Array.isArray(row) ? row.slice(0, limits.columns) : []).map(cell => cell === null || cell === undefined ? '' : String(cell)))
}

function SheetsPreview({ src, path }: { src: string; path: string }) {
  const [book, setBook] = useState<{ names: string[]; tables: Record<string, string[][]> }>()
  const [active, setActive] = useState('')
  const [error, setError] = useState<string>()
  useEffect(() => {
    const controller = new AbortController()
    setBook(undefined); setError(undefined)
    void (async () => {
      try {
        const response = await fetch(src, { signal: controller.signal })
        if (!response.ok) throw new Error(`无法读取文件 (${response.status})`)
        const buffer = await response.arrayBuffer()
        const xlsx = await loadXlsx()
        if (controller.signal.aborted) return
        const workbook = xlsx.read(buffer, { type: 'array' })
        const tables: Record<string, string[][]> = {}
        for (const name of workbook.SheetNames) {
          tables[name] = sheetTable(xlsx.utils.sheet_to_json<unknown[]>(workbook.Sheets[name]!, { header: 1, defval: '', blankrows: false, raw: false }))
        }
        setBook({ names: workbook.SheetNames, tables })
        setActive(workbook.SheetNames[0] ?? '')
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause))
      }
    })()
    return () => controller.abort()
  }, [src])
  if (error !== undefined) return <div className="dvw-document-error">无法预览表格：{error}</div>
  const rows = book?.tables[active] ?? []
  return <section className="dvw-sheet-preview" aria-label={`${path} 表格预览`}>
    {(book?.names.length ?? 0) > 1 && <div className="dvw-sheet-tabs">{book!.names.map(name => <button key={name} data-active={name === active} onClick={() => setActive(name)}>{name}</button>)}</div>}
    <div className="dvw-sheet-scroll">{book === undefined ? <div className="dvw-message">正在加载表格…</div> : rows.length === 0 ? <div className="dvw-message">此工作表为空</div> : <table className="dvw-sheet-table"><tbody>{rows.map((row, index) => <tr key={index}>{row.map((cell, column) => <td key={column} title={cell}>{cell}</td>)}</tr>)}</tbody></table>}</div>
  </section>
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
        const { renderAsync } = await loadPreviewRuntime()
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

type PdfDocument = {
  numPages: number
  getPage(page: number): Promise<{ getViewport(options: { scale: number }): { width: number; height: number }; render(options: { canvasContext: CanvasRenderingContext2D; viewport: { width: number; height: number } }): { promise: Promise<void>; cancel(): void } }>
  destroy(): void
}

function PdfPreview({ src, path }: { src: string; path: string }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const documentRef = useRef<PdfDocument>()
  const [page, setPage] = useState(1)
  const [pages, setPages] = useState(0)
  const [scale, setScale] = useState(1)
  const [error, setError] = useState<string>()

  useEffect(() => {
    let cancelled = false
    let document: PdfDocument | undefined
    setPage(1); setPages(0); setError(undefined)
    void (async () => {
      try {
        const { pdf: pdfjs } = await loadPreviewRuntime()
        pdfjs.GlobalWorkerOptions.workerSrc = '/dsh-vscode/pdfjs/worker.mjs'
        document = await pdfjs.getDocument(src).promise as PdfDocument
        if (cancelled) { document.destroy(); return }
        documentRef.current = document
        setPages(document.numPages)
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause))
      }
    })()
    return () => { cancelled = true; documentRef.current = undefined; document?.destroy() }
  }, [src])

  useEffect(() => {
    const document = documentRef.current
    const target = canvas.current
    if (document === undefined || target === null) return
    let cancelled = false
    let task: { promise: Promise<void>; cancel(): void } | undefined
    void document.getPage(page).then(value => {
      if (cancelled) return
      const viewport = value.getViewport({ scale })
      const ratio = window.devicePixelRatio || 1
      target.width = Math.ceil(viewport.width * ratio)
      target.height = Math.ceil(viewport.height * ratio)
      target.style.width = `${viewport.width}px`
      target.style.height = `${viewport.height}px`
      const context = target.getContext('2d')
      if (context === null) throw new Error('无法创建 PDF 画布')
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
      task = value.render({ canvasContext: context, viewport })
      return task.promise
    }).catch(cause => { if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause)) })
    return () => { cancelled = true; task?.cancel() }
  }, [page, scale, pages])

  return <section className="dvw-pdf-preview" aria-label={`${path} PDF 预览`}>
    <header className="dvw-pdf-toolbar">
      <button className="dvw-icon" title="上一页" disabled={page <= 1} onClick={() => setPage(value => Math.max(1, value - 1))}><span aria-hidden="true">‹</span></button>
      <span>{pages === 0 ? '正在加载' : `${page} / ${pages}`}</span>
      <button className="dvw-icon" title="下一页" disabled={pages === 0 || page >= pages} onClick={() => setPage(value => Math.min(pages, value + 1))}><span aria-hidden="true">›</span></button>
      <span className="dvw-pdf-separator"/>
      <button className="dvw-icon" title="缩小" disabled={scale <= MIN_PDF_SCALE} onClick={() => setScale(value => clampPdfScale(value - 0.1))}>−</button>
      <button className="dvw-pdf-zoom" title="重置缩放" onClick={() => setScale(1)}>{Math.round(scale * 100)}%</button>
      <button className="dvw-icon" title="放大" disabled={scale >= MAX_PDF_SCALE} onClick={() => setScale(value => clampPdfScale(value + 0.1))}>+</button>
    </header>
    {error === undefined ? <div className="dvw-pdf-page"><canvas ref={canvas}/></div> : <div className="dvw-document-error">无法预览 PDF：{error}</div>}
  </section>
}

/** Session carried by the shared file URL, used for the converter status probe. */
function sessionOfDocumentUrl(src: string): string | undefined {
  try { return new URL(src, location.href).searchParams.get('sessionId') ?? undefined } catch { return undefined }
}

/** Word and PowerPoint open as a PDF converted on the host, matching DSH's own preview. */
function OfficePreview({ src, path }: { src: string; path: string }) {
  const [status, setStatus] = useState<{ available: boolean; hint?: string }>()
  useEffect(() => {
    const sessionId = sessionOfDocumentUrl(src)
    if (sessionId === undefined) { setStatus({ available: false }); return }
    let cancelled = false
    void api<{ available: boolean; hint?: string }>('office.status', { sessionId }).then(value => { if (!cancelled) setStatus(value) }).catch(() => { if (!cancelled) setStatus({ available: false }) })
    return () => { cancelled = true }
  }, [src])
  if (status === undefined) return <div className="dvw-message">正在准备 Office 预览…</div>
  if (status.available) return <PdfPreview src={src.replace('/dsh-vscode/file?', '/dsh-vscode/office?')} path={path}/>
  // Without LibreOffice, newer formats still render in the browser; legacy binaries fall back to a download.
  const extension = path.split('.').at(-1)?.toLowerCase()
  if (extension === 'docx') return <DocxPreview src={src}/>
  return <div className="dvw-document-download"><strong>需要 LibreOffice 才能预览此格式</strong><span>{status.hint}</span><a href={src} target="_blank" rel="noreferrer">下载 {path}</a></div>
}

export function DocumentPreview({ kind, src, path }: { kind: DocumentPreviewKind; src: string; path: string }) {
  if (kind === 'pdf') return <PdfPreview src={src} path={path}/>
  if (kind === 'office') return <OfficePreview src={src} path={path}/>
  if (kind === 'sheet') return <SheetsPreview src={src} path={path}/>
  return <div className="dvw-document-download"><strong>此格式无法在浏览器中可靠渲染</strong><a href={src} target="_blank" rel="noreferrer">打开 {path}</a></div>
}
