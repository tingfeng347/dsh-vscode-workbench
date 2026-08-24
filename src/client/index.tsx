import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { VscodeWorkbench } from './service.ts'
import { WorkbenchController } from './service.ts'
import { Launcher, Workbench } from './Workbench.tsx'
import { installStyles } from './styles.ts'

export type { BottomPanelContribution, BottomPanelProps, VscodeWorkbench, WorkbenchCommand, WorkbenchSnapshot, WorkbenchView } from './service.ts'

declare module '@deepseek-ai/cordis' { interface Context { vscodeWorkbench: VscodeWorkbench } }
declare module '@deepseek-ai/dsh-client-ui-slots' { interface SlotInjectMap { 'dsh-vscode-workbench.overlay': { service: VscodeWorkbench }; 'dsh-vscode-workbench.launcher': { service: VscodeWorkbench } } }

const Overlay = ({ service, useSessions }: PropsRuntime<'shell.overlay'> & { service: VscodeWorkbench }) => {
  const sessionId = useSessions(state => state.current) as string | undefined
  return <Workbench key={sessionId ?? 'no-session'} service={service} useSessions={useSessions as never}/>
}
const Footer = ({ service, wide }: PropsRuntime<'sidebar.footer.action'> & { service: VscodeWorkbench }) => {
  const marker=useRef<HTMLSpanElement>(null);const [target,setTarget]=useState<HTMLElement|null>()
  useLayoutEffect(()=>{let container=marker.current?.parentElement;while(container?.previousElementSibling===null)container=container.parentElement;const region=container?.previousElementSibling;if(!(region instanceof HTMLElement)){setTarget(null);return}const mount=document.createElement('div');mount.className='dvw-sidebar-launcher-mount';region.prepend(mount);setTarget(mount);return()=>mount.remove()},[])
  return <><span ref={marker} hidden/>{target===undefined?null:target===null?<Launcher service={service} wide={wide}/>:createPortal(<Launcher service={service} wide={wide}/>,target)}</>
}

export const inject = ['slots']
export function apply(ctx: ClientContext): void {
  const service = new WorkbenchController()
  ctx.effect(() => installStyles(), 'dsh-vscode-workbench: styles')
  ctx.effect(() => { const dispose = ctx.reflect.provide('vscodeWorkbench', service); return () => { void dispose() } }, 'dsh-vscode-workbench: service')
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({ name: 'sidebar.footer.action', id: 'dsh-vscode-workbench-launcher', inject: () => ({ service }) }, Footer))
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: 'dsh-vscode-workbench-overlay', inject: () => ({ service }) }, Overlay))
  ctx.effect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.isComposing || !event.ctrlKey || event.altKey) return
      const view = event.shiftKey && event.code === 'KeyE' ? 'explorer' : event.shiftKey && event.code === 'KeyF' ? 'search' : event.shiftKey && event.code === 'KeyG' ? 'git' : undefined
      if (view !== undefined) { event.preventDefault(); service.show(view) }
    }
    window.addEventListener('keydown', onKey, true); return () => window.removeEventListener('keydown', onKey, true)
  }, 'dsh-vscode-workbench: navigation shortcuts')
}
