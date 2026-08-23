import { useEffect, useMemo, useRef } from 'react'
import DOMPurify from 'dompurify'
import { marked } from 'marked'

export interface MarkdownHeading { depth:number; text:string; index:number }

/** Extract navigable ATX headings from Markdown source. */
export function markdownHeadings(source:string):MarkdownHeading[]{const headings:MarkdownHeading[]=[];for(const line of source.split('\n')){const match=/^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);if(match)headings.push({depth:match[1]!.length,text:match[2]!.replace(/\[([^\]]+)\]\([^)]*\)|[*_`]/g,'$1'),index:headings.length})}return headings}

export function markdownWorkspacePath(basePath:string,source:string):string|undefined{if(source===''||/^(?:[a-z]+:|\/|#)/i.test(source))return;const clean=source.split(/[?#]/,1)[0]??source;const parts=basePath.split('/').slice(0,-1);for(const part of clean.split('/')){if(part===''||part==='.')continue;if(part==='..')parts.pop();else parts.push(part)}const encoded=parts.join('/');try{return decodeURIComponent(encoded)}catch{return encoded}}

/** Render sanitized workspace Markdown with protected relative images and heading anchors. */
export function MarkdownPreview({ source, sessionId, path }: { source: string; sessionId:string; path:string }) {
  const root=useRef<HTMLElement>(null)
  const html=useMemo(()=>{const clean=DOMPurify.sanitize(marked.parse(source,{gfm:true,breaks:false}) as string,{USE_PROFILES:{html:true}});const template=document.createElement('template');template.innerHTML=clean;template.content.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach((heading,index)=>{heading.id=`dvw-heading-${index}`;heading.setAttribute('data-dvw-heading',String(index))});template.content.querySelectorAll('img').forEach(image=>{const target=markdownWorkspacePath(path,image.getAttribute('src')??'');if(target!==undefined)image.src=`/dsh-vscode/file?sessionId=${encodeURIComponent(sessionId)}&path=${encodeURIComponent(target)}`});return template.innerHTML},[source,sessionId,path])
  useEffect(()=>{const listener=(event:Event)=>{const index=(event as CustomEvent<number>).detail;root.current?.querySelector<HTMLElement>(`[data-dvw-heading="${index}"]`)?.scrollIntoView({behavior:'smooth',block:'start'})};window.addEventListener('dvw-markdown-heading',listener);return()=>window.removeEventListener('dvw-markdown-heading',listener)},[])
  return <article ref={root} className="dvw-markdown" onClick={event=>{const anchor=(event.target as Element).closest('a');if(anchor===null)return;const target=markdownWorkspacePath(path,anchor.getAttribute('href')??'');if(target===undefined)return;event.preventDefault();window.dispatchEvent(new CustomEvent('dvw-open-workspace-path',{detail:target}))}} dangerouslySetInnerHTML={{__html:html}}/>
}
