import type { ComponentType } from 'react'

export type WorkbenchView = 'explorer' | 'search' | 'git'
export interface BottomPanelProps { sessionId: string; cwd: string; visible: boolean; colorScheme: 'dark' | 'light' }
export interface BottomPanelContribution { id: string; title: string; component: ComponentType<BottomPanelProps> }
export interface WorkbenchCommand { id: string; run(): void }
export interface WorkbenchSnapshot { visible: boolean; view: WorkbenchView; bottomPanel?: string }
interface WorkbenchStorage { getItem(key:string):string|null; setItem(key:string,value:string):unknown }

const SNAPSHOT_KEY='dvw:workbench:snapshot:v1'
const DEFAULT_SNAPSHOT:WorkbenchSnapshot={visible:false,view:'explorer'}
function browserStorage():WorkbenchStorage|undefined{try{return globalThis.localStorage}catch{return undefined}}
function restoreSnapshot(storage:WorkbenchStorage|undefined):WorkbenchSnapshot{if(storage===undefined)return {...DEFAULT_SNAPSHOT};try{const raw=storage.getItem(SNAPSHOT_KEY);if(raw===null)return {...DEFAULT_SNAPSHOT};const value=JSON.parse(raw) as Partial<WorkbenchSnapshot>;const view=value.view==='explorer'||value.view==='search'||value.view==='git'?value.view:'explorer';return {visible:value.visible===true,view,...(typeof value.bottomPanel==='string'?{bottomPanel:value.bottomPanel}:{})}}catch{return {...DEFAULT_SNAPSHOT}}}

/** Client service exposed by the workbench to small feature adapters. */
export interface VscodeWorkbench {
  show(view?: WorkbenchView): void
  hide(): void
  registerBottomPanel(contribution: BottomPanelContribution): () => void
  registerCommand(command: WorkbenchCommand): () => void
  toggleBottomPanel(id: string): void
  runCommand(id: string): void
  getSnapshot(): WorkbenchSnapshot
  getPanels(): readonly BottomPanelContribution[]
  subscribe(listener: () => void): () => void
}

export class WorkbenchController implements VscodeWorkbench {
  private snapshot: WorkbenchSnapshot
  private readonly storage:WorkbenchStorage|undefined
  private readonly listeners = new Set<() => void>()
  private readonly panels = new Map<string, BottomPanelContribution>()
  private panelSnapshot: readonly BottomPanelContribution[] = []
  private readonly commands = new Map<string, WorkbenchCommand>()
  constructor(storage:WorkbenchStorage|undefined=browserStorage()){this.storage=storage;this.snapshot=restoreSnapshot(storage)}
  show(view?: WorkbenchView): void { this.update({ ...this.snapshot, visible: true, ...(view === undefined ? {} : { view }) }) }
  hide(): void { this.update({ ...this.snapshot, visible: false }) }
  toggleBottomPanel(id: string): void {
    this.update({ ...this.snapshot, visible: true, bottomPanel: this.snapshot.bottomPanel === id ? undefined : id })
  }
  registerBottomPanel(value: BottomPanelContribution): () => void {
    if (this.panels.has(value.id)) throw new Error(`workbench panel already registered: ${value.id}`)
    this.panels.set(value.id, value); this.refreshPanels()
    return () => { this.panels.delete(value.id); this.refreshPanels() }
  }
  registerCommand(value: WorkbenchCommand): () => void {
    if (this.commands.has(value.id)) throw new Error(`workbench command already registered: ${value.id}`)
    this.commands.set(value.id, value)
    return () => { this.commands.delete(value.id) }
  }
  runCommand(id: string): void { this.commands.get(id)?.run() }
  getSnapshot(): WorkbenchSnapshot { return this.snapshot }
  getPanels(): readonly BottomPanelContribution[] { return this.panelSnapshot }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private update(snapshot: WorkbenchSnapshot): void { this.snapshot = snapshot;try{this.storage?.setItem(SNAPSHOT_KEY,JSON.stringify(snapshot))}catch{/* Browser privacy settings may deny storage while the in-memory workbench remains usable. */}this.emit() }
  private refreshPanels(): void { this.panelSnapshot = [...this.panels.values()]; this.emit() }
  private emit(): void { for (const listener of this.listeners) listener() }
}
