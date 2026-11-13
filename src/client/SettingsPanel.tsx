import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { LspServerStatus } from './lsp.ts'
import { settingsHost } from './settingsHost.ts'

type WorkbenchTheme = 'dsh' | 'dark' | 'light' | 'white' | 'eyecare'
type MarkdownView = 'preview' | 'source'
type DefaultBrowser = 'builtin' | 'system'
type OpenMode = 'current' | 'floating'
type CommitDetail = 'concise' | 'standard' | 'detailed'
type CommitLanguage = 'auto' | 'zh' | 'en'
type TsIndex = { state: 'idle' | 'loading' | 'ready' | 'error'; files?: number; truncated?: boolean; error?: string }

/** Everything the settings page renders, owned by the mounted workbench. */
export interface WorkbenchSettingsProps {
  theme: WorkbenchTheme
  setTheme(value: WorkbenchTheme): void
  fontSize: number
  setFontSize(value: number): void
  primarySideVisible: boolean
  setPrimarySideVisible(value: boolean): void
  chatVisible: boolean
  setChatVisible(value: boolean): void
  statusVisible: boolean
  setStatusVisible(value: boolean): void
  sideWidth: number
  setSideWidth(value: number): void
  chatWidth: number
  setChatWidth(value: number): void
  chatMinWidth: number
  chatMaxWidth: number
  markdownView: MarkdownView
  setMarkdownView(value: MarkdownView): void
  defaultBrowser: DefaultBrowser
  setDefaultBrowser(value: DefaultBrowser): void
  openMode: OpenMode
  setOpenMode(value: OpenMode): void
  resetFloatWindow(): void
  commitDetail: CommitDetail
  setCommitDetail(value: CommitDetail): void
  commitLanguage: CommitLanguage
  setCommitLanguage(value: CommitLanguage): void
  tsIntellisense: boolean
  setTsIntellisense(value: boolean): void
  tsIndex: TsIndex
  lspServers: LspServerStatus[]
  lspBusy?: string
  lspError: string
  changeLsp(id: string, action: 'install' | 'uninstall'): void
  refreshLsp(): void
}

const THEMES = [['dsh', '跟随 DSH'], ['dark', '深色'], ['light', '浅色'], ['white', '纯白'], ['eyecare', '护眼']] as const
const MARKDOWN_VIEWS = [['preview', '预览'], ['source', '源码']] as const
const DEFAULT_BROWSERS = [['builtin', '内置浏览器'], ['system', '系统浏览器']] as const
const OPEN_MODES = [['current', '当前窗口'], ['floating', '浮动窗口']] as const
const COMMIT_DETAILS = [['concise', '简洁'], ['standard', '标准'], ['detailed', '详细']] as const
const COMMIT_LANGUAGES = [['auto', '跟随最近提交'], ['zh', '中文'], ['en', 'English']] as const

/** One settings row: title and explanation on the left, control on the right. */
function Row({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return <div className="dvw-set-row">
    <div className="dvw-set-text">
      <span className="dvw-set-title">{title}</span>
      {description !== undefined && <span className="dvw-set-desc">{description}</span>}
    </div>
    <div className="dvw-set-control">{children}</div>
  </div>
}

function Switch({ checked, label, onChange }: { checked: boolean; label: string; onChange(value: boolean): void }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} className="dvw-set-switch" onClick={() => onChange(!checked)}>
    <span className="dvw-set-knob"/>
  </button>
}

function Chevron() {
  return <svg className="dvw-set-chevron" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 6.5 8 10.5 12 6.5"/></svg>
}

function Check() {
  return <svg className="dvw-set-check" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m3.5 8.5 3 3 6-7"/></svg>
}

/** DSH's own settings control: a light pill showing the value, with a dropdown menu. */
function Selector<T extends string>({ value, options, label, onChange }: { value: T; options: readonly (readonly [T, string])[]; label: string; onChange(value: T): void }) {
  const [open, setOpen] = useState(false)
  const [anchor, setAnchor] = useState<{ right: number; top: number; width: number }>()
  const button = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close() } }
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', escape, true)
    window.addEventListener('blur', close)
    return () => { window.removeEventListener('pointerdown', close); window.removeEventListener('keydown', escape, true); window.removeEventListener('blur', close) }
  }, [open])
  const toggle = () => {
    const rect = button.current?.getBoundingClientRect()
    if (rect !== undefined) setAnchor({ right: Math.max(8, window.innerWidth - rect.right), top: rect.bottom + 6, width: rect.width })
    setOpen(current => !current)
  }
  const text = options.find(([key]) => key === value)?.[1] ?? value
  return <>
    <button ref={button} type="button" className="dvw-set-selector" aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={toggle}>{text}<Chevron/></button>
    {open && anchor !== undefined && <div className="dvw-set-menu" role="menu" aria-label={label} style={{ right: anchor.right, top: anchor.top, minWidth: anchor.width }} onPointerDown={event => event.stopPropagation()}>
      {options.map(([key, item]) => <button key={key} type="button" role="menuitemradio" aria-checked={value === key} data-active={value === key} onClick={() => { setOpen(false); onChange(key) }}><span>{item}</span>{value === key && <Check/>}</button>)}
    </div>}
  </>
}

function Range({ value, min, max, unit, label, onChange }: { value: number; min: number; max: number; unit: string; label: string; onChange(value: number): void }) {
  const fill = max === min ? 0 : Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100))
  return <label className="dvw-set-range" style={{ '--dvw-set-range-fill': `${fill}%` } as CSSProperties}>
    <input type="range" aria-label={label} min={min} max={max} step={1} value={Math.round(value)} onChange={event => onChange(Number(event.target.value))}/>
    <output>{Math.round(value)}{unit}</output>
  </label>
}

/** Same control, but the value lands only after the drag settles (the editor re-lays out on every change). */
function DebouncedRange(props: { value: number; min: number; max: number; unit: string; label: string; onChange(value: number): void }) {
  const [draft, setDraft] = useState(props.value)
  useEffect(() => setDraft(props.value), [props.value])
  useEffect(() => {
    if (draft === props.value) return
    const timer = setTimeout(() => props.onChange(draft), 180)
    return () => clearTimeout(timer)
  }, [draft, props.value, props.onChange])
  return <Range {...props} value={draft} onChange={setDraft}/>
}

/** The page registered as `dsh-vscode-workbench` in DSH's settings navigation. */
export function WorkbenchSettings(props: WorkbenchSettingsProps) {
  const { refreshLsp } = props
  useEffect(() => { refreshLsp() }, [refreshLsp])
  return <div className="dvw-set-page">
    <section className="dvw-set-group">
      <h3 className="dvw-set-group-title">外观</h3>
      <Row title="颜色主题" description="跟随 DSH 时随宿主在深色和浅色之间自动切换。">
        <Selector label="颜色主题" value={props.theme} options={THEMES} onChange={props.setTheme}/>
      </Row>
      <Row title="编辑器字号" description="影响 Monaco 编辑器、差异视图和 Markdown 源码。">
        <DebouncedRange label="编辑器字号" min={11} max={20} unit="px" value={props.fontSize} onChange={props.setFontSize}/>
      </Row>
    </section>

    <section className="dvw-set-group">
      <h3 className="dvw-set-group-title">浏览器</h3>
      <Row title="默认浏览器" description="打开网页链接和 HTML 文件时使用的浏览器。">
        <Selector label="默认浏览器" value={props.defaultBrowser} options={DEFAULT_BROWSERS} onChange={props.setDefaultBrowser}/>
      </Row>
    </section>

    <section className="dvw-set-group">
      <h3 className="dvw-set-group-title">窗口</h3>
      <Row title="打开方式" description="工作台铺满窗口，或浮在 DSH 页面上；切换后立即生效。浮动窗口可以拖动、缩放，点全屏按钮会进入系统全屏并隐藏 DSH，按 Esc 退出。">
        <Selector label="打开方式" value={props.openMode} options={OPEN_MODES} onChange={props.setOpenMode}/>
      </Row>
      {props.openMode==='floating'&&<Row title="重置浮动窗口" description="把窗口恢复到屏幕中央的默认大小；内嵌最大化状态也会一并清除。">
        <button className="dvw-set-button" onClick={props.resetFloatWindow}>重置位置与大小</button>
      </Row>}
    </section>

    <section className="dvw-set-group">
      <h3 className="dvw-set-group-title">布局</h3>
      <Row title="显示左侧视图" description="资源管理器、搜索和源代码管理所在的边栏。">
        <Switch label="显示左侧视图" checked={props.primarySideVisible} onChange={props.setPrimarySideVisible}/>
      </Row>
      <Row title="显示 DSH 对话栏" description="右侧的 DSH 对话面板，可以随时用 Ctrl+Alt+B 切换。">
        <Switch label="显示 DSH 对话栏" checked={props.chatVisible} onChange={props.setChatVisible}/>
      </Row>
      <Row title="显示底部状态栏">
        <Switch label="显示底部状态栏" checked={props.statusVisible} onChange={props.setStatusVisible}/>
      </Row>
      <Row title="左侧视图宽度">
        <Range label="左侧视图宽度" min={210} max={640} unit="px" value={props.sideWidth} onChange={props.setSideWidth}/>
      </Row>
      <Row title="DSH 对话栏宽度">
        <Range label="DSH 对话栏宽度" min={props.chatMinWidth} max={props.chatMaxWidth} unit="px" value={props.chatWidth} onChange={props.setChatWidth}/>
      </Row>
      <Row title="Markdown 默认视图" description="打开 .md 文件时默认进入预览还是源码。">
        <Selector label="Markdown 默认视图" value={props.markdownView} options={MARKDOWN_VIEWS} onChange={props.setMarkdownView}/>
      </Row>
    </section>

    <section className="dvw-set-group">
      <h3 className="dvw-set-group-title">提交信息</h3>
      <Row title="详细程度" description="详细模式会生成标题和 2–4 条说明；简洁模式限制标题长度，标准模式保持单行约定式提交。">
        <Selector label="提交信息详细程度" value={props.commitDetail} options={COMMIT_DETAILS} onChange={props.setCommitDetail}/>
      </Row>
      <Row title="语言" description="跟随最近提交会沿用仓库里上一条提交的语言。">
        <Selector label="提交信息语言" value={props.commitLanguage} options={COMMIT_LANGUAGES} onChange={props.setCommitLanguage}/>
      </Row>
    </section>

    <section className="dvw-set-group">
      <h3 className="dvw-set-group-title">语言智能</h3>
      <div className="dvw-set-row">
        <div className="dvw-set-text">
          <span className="dvw-set-title">TypeScript / JavaScript</span>
          <span className="dvw-set-desc">内置 · {props.tsIntellisense
            ? props.tsIndex.state === 'loading' ? '正在索引工作区…'
              : props.tsIndex.state === 'error' ? `索引失败：${props.tsIndex.error}`
                : props.tsIndex.state === 'ready' ? `已索引 ${props.tsIndex.files} 个文件${props.tsIndex.truncated ? '（已达上限）' : ''}`
                  : '已安装，转到定义、查找引用、Peek、补全、签名帮助'
            : '点击安装'}</span>
        </div>
        <div className="dvw-set-control">
          <button type="button" className="dvw-set-button" onClick={() => props.setTsIntellisense(!props.tsIntellisense)}>{props.tsIntellisense ? '卸载' : '安装'}</button>
        </div>
      </div>
      {props.lspServers.map(server => <div className="dvw-set-row" key={server.id}>
        <div className="dvw-set-text">
          <span className="dvw-set-title">{server.name}</span>
          <span className="dvw-set-desc dvw-set-chips">
            <span className="dvw-set-chip" data-installed={server.language === undefined || server.language.installed} data-action={server.language !== undefined && !server.language.installed}>{server.language === undefined ? '语言：无需安装' : server.language.installed ? '语言：已安装' : '安装语言'}</span>
            <span className="dvw-set-chip" data-installed={server.installed}>{server.installed ? 'LSP：已安装' : 'LSP：未安装'}</span>
            {!server.installed && server.hint !== undefined && <span className="dvw-set-hint">{server.hint}</span>}
          </span>
        </div>
        <div className="dvw-set-control">
          {server.language !== undefined && !server.language.installed
            ? <button type="button" className="dvw-set-button" disabled title="先安装语言工具链，再安装 LSP">等待</button>
            : server.installable && <button type="button" className="dvw-set-button" disabled={props.lspBusy === server.id} onClick={() => props.changeLsp(server.id, server.installed ? 'uninstall' : 'install')}>{props.lspBusy === server.id ? '处理中…' : server.installed ? '卸载 LSP' : '安装 LSP'}</button>}
        </div>
      </div>)}
      <p className="dvw-set-footnote">每种语言使用该生态里最活跃的语言服务器；能自动安装的会装进本插件的私有目录，需要手动安装的会分别检查语言工具链和服务器本身。</p>
      {props.lspError !== '' && <p className="dvw-set-footnote dvw-set-error">{props.lspError}</p>}
    </section>
  </div>
}

/**
 * Slot content for DSH's `settings.section`: it owns only the mount point.
 * The workbench portals the live page here so the settings state, the LSP
 * manager and the editor keep a single owner.
 */
export function WorkbenchSettingsSection() {
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const node = root.current
    if (node !== null) settingsHost.set(node)
    return () => { settingsHost.set(undefined) }
  }, [])
  return <div ref={root}/>
}
