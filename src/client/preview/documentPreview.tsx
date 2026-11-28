import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { api } from '../transport/api.ts'
import { PdfPreview } from './PdfPreview.tsx'
import { PreviewFrame, PreviewStatus } from './PreviewFrame.tsx'
import { PreviewViewport, type PreviewView } from './PreviewViewport.tsx'
import { loadPreviewRuntime } from './runtime.ts'

export { clampPdfScale } from './PreviewViewport.tsx'

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
  const [attempt, setAttempt] = useState(0)
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
  }, [src, attempt])
  if (error !== undefined) return <PreviewStatus error retry={() => setAttempt(value => value + 1)}>无法预览表格，{error}</PreviewStatus>
  const rows = book?.tables[active] ?? []
  return <section className="dvw-sheet-preview" aria-label={`${path} 表格预览`}>
    {(book?.names.length ?? 0) > 1 && <div className="dvw-sheet-tabs">{book!.names.map(name => <button key={name} data-active={name === active} onClick={() => setActive(name)}>{name}</button>)}</div>}
    <div className="dvw-sheet-scroll">{book === undefined ? <PreviewStatus>文档渲染中…</PreviewStatus> : rows.length === 0 ? <PreviewStatus>此工作表为空</PreviewStatus> : <table className="dvw-sheet-table"><tbody>{rows.map((row, index) => <tr key={index}>{row.map((cell, column) => <td key={column} title={cell}>{cell}</td>)}</tr>)}</tbody></table>}</div>
  </section>
}

function DocxPreview({ src, view }: { src: string; view?: PreviewView }) {
  const root = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string>()
  const [ready, setReady] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    if (!ready) return
    const pages = [...root.current!.querySelectorAll<HTMLElement>('section.docx')]
    setWidth(Math.max(1, ...pages.map(page => page.offsetWidth)))
  }, [ready])
  useEffect(() => {
    const controller = new AbortController()
    const target = root.current!
    setError(undefined); setReady(false)
    void (async () => {
      try {
        const response = await fetch(src, { signal: controller.signal })
        if (!response.ok) throw new Error('无法读取文档（HTTP ' + response.status + '）')
        const blob = await response.blob()
        const { renderAsync } = await loadPreviewRuntime()
        if (controller.signal.aborted) return
        // A detached render prevents an obsolete request from replacing newer content.
        const container = document.createElement('div')
        await renderAsync(blob, container, undefined, { inWrapper: true, ignoreWidth: false, ignoreHeight: false })
        if (controller.signal.aborted) return
        target.replaceChildren(...container.childNodes)
        setReady(true)
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause))
      }
    })()
    return () => controller.abort()
  }, [src, attempt])
  return <PreviewViewport width={width} view={view}>{() => <>
    <div ref={root} className="dvw-docx-preview" hidden={!ready || error !== undefined}/>
    {error !== undefined ? <PreviewStatus error retry={() => setAttempt(value => value + 1)}>无法显示 Word 文档，{error}</PreviewStatus>
      : !ready && <PreviewStatus>文档渲染中…</PreviewStatus>}
  </>}</PreviewViewport>
}

/** Word and PowerPoint retain the workbench's host conversion and DOCX fallback. */
function OfficePreview({ src, path, view }: { src: string; path: string; view?: PreviewView }) {
  const [status, setStatus] = useState<{ available: boolean; hint?: string }>()
  const [error, setError] = useState<string>()
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    const sessionId = new URL(src, location.href).searchParams.get('sessionId')
    setStatus(undefined); setError(undefined)
    if (sessionId === null) { setStatus({ available: false }); return }
    void api<{ available: boolean; hint?: string }>('office.status', { sessionId }, controller.signal)
      .then(value => { if (!controller.signal.aborted) setStatus(value) })
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason)) })
    return () => controller.abort()
  }, [src, attempt])
  if (error !== undefined) return <PreviewStatus error retry={() => setAttempt(value => value + 1)}>无法准备 Office 预览，{error}</PreviewStatus>
  if (status === undefined) return <PreviewStatus>文档渲染中…</PreviewStatus>
  if (status.available) {
    const converted = src.replace('/dsh-vscode/ssh/file?', '/dsh-vscode/ssh/office?').replace('/dsh-vscode/file?', '/dsh-vscode/office?')
    return <PdfPreview src={converted} path={path} view={view}/>
  }
  if (path.toLowerCase().endsWith('.docx')) return <DocxPreview src={src} view={view}/>
  return <PreviewStatus>需要 LibreOffice 才能预览此格式。{status.hint ?? '请下载文件或用本地应用打开。'}</PreviewStatus>
}

export function DocumentPreview({ kind, src, path, view }: { kind: DocumentPreviewKind; src: string; path: string; view?: PreviewView }) {
  return <PreviewFrame src={src} path={path}>
    {kind === 'pdf' ? <PdfPreview key={src} src={src} path={path} view={view}/>
      : kind === 'office' ? <OfficePreview key={src} src={src} path={path} view={view}/>
      : kind === 'sheet' ? <SheetsPreview key={src} src={src} path={path}/>
      : <PreviewStatus>此格式暂不支持预览，请下载文件或用本地应用打开。</PreviewStatus>}
  </PreviewFrame>
}
