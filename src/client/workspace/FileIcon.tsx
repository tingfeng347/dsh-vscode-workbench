import { fileIconName } from './fileIconMap.ts'

/** Colorful vscode-icons glyph for an explorer entry or editor tab. */
export function FileIcon({ name, directory = false, expanded = false, size = 16, className = 'dvw-file-icon' }: { name: string; directory?: boolean; expanded?: boolean; size?: number; className?: string }) {
  return <img className={className} src={`/dsh-vscode/file-icons/${fileIconName(name, directory, expanded)}`} width={size} height={size} alt="" draggable={false}/>
}
