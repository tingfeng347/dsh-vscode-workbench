import type { editor } from 'monaco-editor'
import { Icon } from '../ui/Icon.tsx'

export interface Problem { path: string; marker: editor.IMarkerData }

export function ProblemsPanel({ problems, onOpen }: {
  problems: Problem[]
  onOpen(path: string, line: number, column: number): void
}) {
  const byFile = new Map<string, editor.IMarkerData[]>()
  for (const { path, marker } of problems) {
    if (!byFile.has(path)) byFile.set(path, [])
    byFile.get(path)!.push(marker)
  }
  return <div className="dvw-problems" aria-label="问题">
    {byFile.size === 0 && <p>没有发现问题。</p>}
    {[...byFile].sort(([a], [b]) => a.localeCompare(b)).map(([path, markers]) =>
      <details key={path} open>
        <summary>{path} <span>{markers.length}</span></summary>
        {markers.map((marker, index) => <button key={index} type="button"
          onClick={() => onOpen(path, marker.startLineNumber, marker.startColumn)}>
          <Icon name={marker.severity === 8 ? 'error' : marker.severity === 4 ? 'warning' : 'info'} />
          <span>{marker.message}</span>
          {marker.source && <span>{marker.source}</span>}
          <span>({marker.startLineNumber}, {marker.startColumn})</span>
        </button>)}
      </details>)}
  </div>
}
