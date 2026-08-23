import { useLayoutEffect, useRef } from 'react'

/** Reuse the official DSH whale already rendered by the host brand plugin. */
export function DshMark({ size = 18 }: { size?: number }) {
  const mount = useRef<HTMLSpanElement>(null)
  useLayoutEffect(() => {
    const source = [...document.querySelectorAll<SVGSVGElement>('svg')]
      .find(svg => svg.getAttribute('viewBox') === '0 0 23.16 17.04' && !mount.current?.contains(svg))
    if (source === undefined || mount.current === null) return
    const logo = source.cloneNode(true) as SVGSVGElement
    logo.setAttribute('width', String(size))
    logo.setAttribute('height', String((size * 17.04) / 23.16))
    mount.current.replaceChildren(logo)
  }, [size])
  return <span className="dvw-dsh-mark" ref={mount} aria-hidden="true">DSH</span>
}
