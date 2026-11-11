/** Convert Word and PowerPoint documents to PDF with a locally installed LibreOffice, like DSH's own preview. */
import { execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { access, mkdir, rename, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, extname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { workspacePath } from './host.ts'
import { WorkbenchError } from './wire.ts'

const CONVERTIBLE = new Set(['.doc', '.docx', '.ppt', '.pptx', '.odt', '.odp', '.rtf'])

/** True for extensions the Office preview routes through a PDF conversion. */
export function isOfficeDocumentPath(path: string): boolean { return CONVERTIBLE.has(extname(path).toLowerCase()) }

/** Whether a path is a document that can only be shown through the converter. */
export function needsOfficeConversion(path: string): boolean {
  const extension = extname(path).toLowerCase()
  return extension === '.doc' || extension === '.docx' || extension === '.ppt' || extension === '.pptx' || extension === '.odt' || extension === '.odp' || extension === '.rtf'
}

/** Install guidance mirrors DSH: the preview never downloads an engine itself. */
export const OFFICE_HINT = '未检测到 LibreOffice。安装 LibreOffice 后可像 DSH 官方预览一样把 Word / PowerPoint 转成 PDF 查看。'

function candidates(): string[] {
  const list = [process.env.DVW_SOFFICE]
  if (process.platform === 'win32') {
    list.push('soffice', 'C:\\Program Files\\LibreOffice\\program\\soffice.exe', 'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe')
  } else if (process.platform === 'darwin') {
    list.push('soffice', '/Applications/LibreOffice.app/Contents/MacOS/soffice')
  } else {
    list.push('soffice', 'libreoffice', '/usr/bin/soffice', '/usr/bin/libreoffice', '/snap/bin/libreoffice')
  }
  return list.filter((value): value is string => typeof value === 'string' && value !== '')
}

function which(command: string): Promise<string | undefined> {
  return new Promise(resolve => {
    const child = spawn(process.platform === 'win32' ? 'where' : 'which', [command], { windowsHide: true })
    let output = ''
    child.stdout.on('data', chunk => { output += String(chunk) })
    child.on('error', () => resolve(undefined))
    child.on('close', code => resolve(code === 0 ? output.split(/\r?\n/).map(line => line.trim()).find(Boolean) : undefined))
  })
}

async function exists(path: string): Promise<boolean> { return access(path).then(() => true, () => false) }

let detected: { path?: string; checked: number } | undefined

/** Locate LibreOffice without repeatedly probing the system for every open tab. */
export async function findOfficeConverter(): Promise<string | undefined> {
  if (detected !== undefined && Date.now() - detected.checked < 60_000) return detected.path
  let found: string | undefined
  for (const candidate of candidates()) {
    if ((candidate.includes('/') || candidate.includes('\\')) && await exists(candidate)) { found = candidate; break }
    const resolved = await which(candidate)
    if (resolved !== undefined) { found = resolved; break }
  }
  detected = { path: found, checked: Date.now() }
  return found
}

/** Availability payload for the settings and preview UI. */
export async function officeStatus(): Promise<{ available: boolean; hint?: string }> {
  const converter = await findOfficeConverter()
  return converter === undefined ? { available: false, hint: OFFICE_HINT } : { available: true }
}

/** Convert one workspace document to a cached PDF and return its absolute path. */
export async function officePdf(cwd: string, path: string): Promise<{ path: string }> {
  if (!needsOfficeConversion(path)) throw new WorkbenchError('unsupported-media', 'file is not a Word or PowerPoint document', 415)
  const source = await workspacePath(cwd, path)
  const converter = await findOfficeConverter()
  if (converter === undefined) throw new WorkbenchError('converter-missing', OFFICE_HINT, 503)
  const info = await stat(source.absolute)
  const root = join(tmpdir(), 'dsh-vscode-workbench-office')
  const key = createHash('sha1').update(`${source.absolute}:${info.size}:${info.mtimeMs}`).digest('hex').slice(0, 20)
  const target = join(root, `${key}.pdf`)
  if (await exists(target)) return { path: target }
  await mkdir(root, { recursive: true })
  const output = join(root, `out-${key}`)
  await mkdir(output, { recursive: true })
  const profile = pathToFileURL(join(root, `profile-${key}-${process.pid}-${Date.now()}`)).href
  try {
    await promisify(execFile)(converter, ['--headless', '--norestore', '--invisible', '--convert-to', 'pdf', '--outdir', output, `-env:UserInstallation=${profile}`, source.absolute], { timeout: 120_000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 })
    const produced = join(output, `${basename(source.absolute, extname(source.absolute))}.pdf`)
    if (!await exists(produced)) throw new WorkbenchError('converter-failed', 'LibreOffice 未能生成 PDF', 500)
    await rename(produced, target)
    return { path: target }
  } finally {
    await rm(output, { recursive: true, force: true }).catch(() => undefined)
  }
}
