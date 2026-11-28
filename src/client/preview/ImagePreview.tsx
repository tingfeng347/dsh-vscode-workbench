import { useRef, useState, type CSSProperties, type PointerEvent } from 'react'
import { PreviewFrame, PreviewStatus } from './PreviewFrame.tsx'
import { PreviewViewport, type PreviewView } from './PreviewViewport.tsx'

/** Match the document reader's fit-width, zoom and recoverable image loading. */
export function ImagePreview(props: { src: string; path: string; view?: PreviewView }) {
  return <PreviewFrame src={props.src} path={props.path}><LoadedImage key={props.src} {...props}/></PreviewFrame>
}

function LoadedImage({ src, path, view }: { src: string; path: string; view?: PreviewView }) {
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [width, setWidth] = useState(0)
  const [attempt, setAttempt] = useState(0)
  const pan = useRef<{ x: number; y: number; left: number; top: number; node: HTMLElement }>()
  const endPan = (event: PointerEvent<HTMLImageElement>) => {
    pan.current = undefined
    event.currentTarget.removeAttribute('data-panning')
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }
  return <PreviewViewport width={width} view={view}>{() => <div className="dvw-image-preview">
    <img key={attempt} src={src} alt={path} hidden={state !== 'ready'} draggable={false}
      style={{ '--dvw-preview-width': width + 'px' } as CSSProperties}
      onLoad={event => { setWidth(event.currentTarget.naturalWidth); setState('ready') }}
      onError={() => setState('failed')}
      onPointerDown={event => {
        if (event.button !== 0 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return
        const node = event.currentTarget.closest<HTMLElement>('.dvw-preview-scrollport')!
        if (node.scrollWidth <= node.clientWidth && node.scrollHeight <= node.clientHeight) return
        event.preventDefault()
        pan.current = { x: event.clientX, y: event.clientY, left: node.scrollLeft, top: node.scrollTop, node }
        event.currentTarget.setPointerCapture(event.pointerId)
        event.currentTarget.setAttribute('data-panning', '')
      }}
      onPointerMove={event => {
        const start = pan.current
        if (start === undefined) return
        start.node.scrollLeft = start.left - (event.clientX - start.x)
        start.node.scrollTop = start.top - (event.clientY - start.y)
      }} onPointerUp={endPan} onPointerCancel={endPan} onLostPointerCapture={endPan}/>
    {state === 'loading' && <PreviewStatus>图片加载中…</PreviewStatus>}
    {state === 'failed' && <PreviewStatus error retry={() => { setState('loading'); setAttempt(value => value + 1) }}>无法显示图片，请重试</PreviewStatus>}
  </div>}</PreviewViewport>
}
