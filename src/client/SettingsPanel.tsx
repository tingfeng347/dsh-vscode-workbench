import type { GitDiffStyle } from './MonacoEditor.tsx'
import { useEffect, useId, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { LspRuntimeStatus, LspServerStatus } from './lsp.ts'
import type { ReviewMode } from './aiReview.ts'
import { settingsHost } from './settingsHost.ts'
import type { CommitModelCatalog, CommitModelOption, CommitModelSelection } from '../commit-message.ts'
import type { InlineCompletionMode } from '../inline-completion.ts'

type WorkbenchTheme = 'dsh' | 'dark' | 'light' | 'white' | 'eyecare'
type MarkdownView = 'preview' | 'source'
type DefaultBrowser = 'builtin' | 'system'
type OpenMode = 'current' | 'floating'
type CommitDetail = 'concise' | 'standard' | 'detailed'
type CommitLanguage = 'auto' | 'zh' | 'en'
type TsIndex = { state: 'idle' | 'loading' | 'ready' | 'error'; files?: number; truncated?: boolean; error?: string }

/** Everything the settings page renders, owned by the mounted workbench. */
export interface WorkbenchSettingsProps {
  reviewMode?: ReviewMode
  setReviewMode?(value: ReviewMode): void
  reviewFollow?: boolean
  setReviewFollow?(value: boolean): void
  theme: WorkbenchTheme
  setTheme(value: WorkbenchTheme): void
  gitDiffStyle: GitDiffStyle
  setGitDiffStyle(value: GitDiffStyle): void
  gitLineBlame: boolean
  setGitLineBlame(value: boolean): void
  fontSize: number
  setFontSize(value: number): void
  minimap: boolean
  setMinimap(value: boolean): void
  primarySideVisible: boolean
  setPrimarySideVisible(value: boolean): void
  chatVisible: boolean
  setChatVisible(value: boolean): void
  statusVisible: boolean
  setStatusVisible(value: boolean): void
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
  commitModel?: CommitModelSelection
  commitModelConfigured: boolean
  setCommitModel(value: CommitModelSelection | undefined): void
  commitModels: readonly CommitModelOption[]
  commitModelStatus: 'idle' | 'loading' | 'ready' | 'error'
  commitModelUnavailable: CommitModelCatalog['unavailable']
  commitModelError: string
  refreshCommitModels(): void
  chatModel?: CommitModelSelection
  inlineCompletionMode: InlineCompletionMode
  setInlineCompletionMode(value: InlineCompletionMode): void
  inlineCompletionModel?: CommitModelSelection
  setInlineCompletionModel(value: CommitModelSelection | undefined): void
  tsIntellisense: boolean
  setTsIntellisense(value: boolean): void
  tsIndex: TsIndex
  lspServers: LspServerStatus[]
  lspBusy?: string
  lspError: string
  lspRuntime: Record<string, LspRuntimeStatus | undefined>
  restartLsp(id: string): void
  pythonPath: string
  setPythonPath(value: string): void
  changeLsp(id: string, action: 'install' | 'uninstall'): void
  refreshLsp(): void
}

const LSP_STATUS_TEXT: Record<LspRuntimeStatus['state'] | 'idle', string> = {
  idle: '已安装，打开对应文件时自动启动', starting: '语言服务启动中', ready: '语言服务运行中', reconnecting: '语言服务正在重连', failed: '语言服务启动失败',
}
const THEMES = [['dsh', '跟随 DSH'], ['dark', '深色'], ['light', '浅色'], ['white', '纯白'], ['eyecare', '护眼']] as const
const MARKDOWN_VIEWS = [['preview', '预览'], ['source', '源码']] as const
const REVIEW_MODES = [['all', '审阅全部改动'], ['latest', '审阅最新改动'], ['none', '无需审阅']] as const
const DEFAULT_BROWSERS = [['builtin', '内置浏览器'], ['system', '系统浏览器']] as const
const OPEN_MODES = [['current', '当前窗口'], ['floating', '浮动窗口']] as const
const COMMIT_DETAILS = [['concise', '简洁'], ['standard', '标准'], ['detailed', '详细']] as const
const COMMIT_LANGUAGES = [['auto', '跟随最近提交'], ['zh', '中文'], ['en', 'English']] as const
const INLINE_COMPLETION_MODES = [['off', '关闭'], ['manual', '仅手动触发'], ['auto', '自动补全']] as const
const FOLLOW_CHAT_MODEL = 'follow-chat'

function modelKey(model: CommitModelSelection): string {
  return JSON.stringify([model.provider, model.model])
}

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

type ModelBadge = NonNullable<CommitModelOption['badge']>

/** DSH's own settings control: a light pill showing the value, with a dropdown menu. */
function Selector<T extends string>({ value, options, label, badges, onChange }: { value: T; options: readonly (readonly [T, string])[]; label: string; badges?: Partial<Record<T, ModelBadge>>; onChange(value: T): void }) {
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const [anchor, setAnchor] = useState<{ right: number; top?: number; bottom?: number; minWidth: number; maxHeight: number }>()
  const button = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const items = useRef<Array<HTMLButtonElement | null>>([])
  const menuId = useId()
  const selectedIndex = options.findIndex(([key]) => key === value)
  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    const pointer = (event: PointerEvent) => {
      if (event.target instanceof Node && button.current?.contains(event.target) === true) return
      close()
    }
    const scroll = (event: Event) => {
      if (event.target instanceof Node && menu.current?.contains(event.target) === true) return
      close()
    }
    window.addEventListener('pointerdown', pointer)
    window.addEventListener('blur', close)
    window.addEventListener('resize', close)
    window.addEventListener('scroll', scroll, true)
    return () => {
      window.removeEventListener('pointerdown', pointer)
      window.removeEventListener('blur', close)
      window.removeEventListener('resize', close)
      window.removeEventListener('scroll', scroll, true)
    }
  }, [open])
  useEffect(() => {
    if (open) items.current[activeIndex]?.focus()
  }, [activeIndex, open])
  const show = (preferredIndex = selectedIndex) => {
    const rect = button.current?.getBoundingClientRect()
    if (rect === undefined) return
    const below = window.innerHeight - rect.bottom - 12
    const above = rect.top - 12
    const useAbove = below < 240 && above > below
    setAnchor({
      right: Math.max(8, window.innerWidth - rect.right),
      ...(useAbove ? { bottom: window.innerHeight - rect.top + 6 } : { top: rect.bottom + 6 }),
      minWidth: Math.min(rect.width, window.innerWidth - 16),
      maxHeight: Math.max(96, Math.min(420, useAbove ? above : below)),
    })
    setActiveIndex(preferredIndex >= 0 ? preferredIndex : 0)
    setOpen(true)
  }
  const toggle = () => {
    if (open) setOpen(false)
    else show()
  }
  const move = (index: number) => {
    if (options.length === 0 || index < 0) return
    setActiveIndex(index)
  }
  const text = options.find(([key]) => key === value)?.[1] ?? (value === '' ? '选择模型' : value)
  const selectedBadge = badges?.[value]
  return <>
    <button ref={button} type="button" className="dvw-set-selector" aria-label={`${label}：${text}`} aria-haspopup="menu" aria-controls={open ? menuId : undefined} aria-expanded={open} onClick={toggle} onKeyDown={event => {
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
      event.preventDefault()
      if (open) {
        const direction = event.key === 'ArrowDown' ? 1 : -1
        move((activeIndex + direction + options.length) % options.length)
      } else show(event.key === 'ArrowUp' ? options.length - 1 : selectedIndex)
    }}><span className="dvw-set-selector-text">{text}{selectedBadge !== undefined && <span className="dvw-set-model-badge" data-tone={selectedBadge.tone}>{selectedBadge.text}</span>}</span><Chevron/></button>
    {open && anchor !== undefined && <div ref={menu} id={menuId} className="dvw-set-menu" role="menu" aria-label={label} style={{ right: anchor.right, top: anchor.top, bottom: anchor.bottom, minWidth: anchor.minWidth, maxHeight: anchor.maxHeight }} onPointerDown={event => event.stopPropagation()} onKeyDown={event => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        setOpen(false)
        button.current?.focus()
      } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        const direction = event.key === 'ArrowDown' ? 1 : -1
        move((activeIndex + direction + options.length) % options.length)
      } else if (event.key === 'Home' || event.key === 'End') {
        event.preventDefault()
        move(event.key === 'Home' ? 0 : options.length - 1)
      } else if (event.key === 'Tab') {
        setOpen(false)
        button.current?.focus()
      }
    }}>
      {options.map(([key, item], index) => {
        const badge = badges?.[key]
        return <button ref={node => { items.current[index] = node }} tabIndex={-1} key={key} type="button" role="menuitemradio" aria-checked={value === key} data-active={value === key} onMouseEnter={() => setActiveIndex(index)} onClick={() => { setOpen(false); onChange(key); queueMicrotask(() => button.current?.focus()) }}><span className="dvw-set-option-label"><span className="dvw-set-option-text">{item}</span>{badge !== undefined && <span className="dvw-set-model-badge" data-tone={badge.tone}>{badge.text}</span>}</span>{value === key && <Check/>}</button>
      })}
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

function ModelSelector({ label, selection, onChange, catalog }: {
  label: string
  selection?: CommitModelSelection
  onChange(value: CommitModelSelection | undefined): void
  catalog: Pick<WorkbenchSettingsProps, 'commitModels' | 'chatModel' | 'commitModelStatus' | 'commitModelUnavailable' | 'refreshCommitModels'>
}) {
  const { commitModels: models, chatModel, commitModelStatus: status, commitModelUnavailable: unavailable, refreshCommitModels: refresh } = catalog
  const followedModel = models.find(model => model.provider === chatModel?.provider && model.model === chatModel?.model)
  // Several providers can expose the same display name; disambiguate those with the provider name.
  const modelNameCount = new Map<string, number>()
  for (const model of models) modelNameCount.set(model.name, (modelNameCount.get(model.name) ?? 0) + 1)
  const options: Array<readonly [string, string]> = [
    [FOLLOW_CHAT_MODEL, followedModel === undefined ? '跟随 DSH 聊天模型' : `跟随 DSH 聊天模型（${followedModel.name}）`],
    ...models.map(model => [modelKey(model), (modelNameCount.get(model.name) ?? 0) > 1 ? `${model.name} · ${model.providerName}` : model.name] as const),
  ]
  const badges: Partial<Record<string, ModelBadge>> = Object.fromEntries(models.flatMap(model => model.badge === undefined ? [] : [[modelKey(model), model.badge]]))
  if (followedModel?.badge !== undefined) badges[FOLLOW_CHAT_MODEL] = followedModel.badge
  if (selection !== undefined && !models.some(model => modelKey(model) === modelKey(selection))) {
    options.unshift([modelKey(selection), `${selection.model}（暂不可用）`])
  }
  if (status === 'error') return <button type="button" className="dvw-set-button" onClick={refresh}>重新读取模型</button>
  if (status !== 'ready') return <span role="status" aria-live="polite"><button type="button" className="dvw-set-button" disabled>正在读取模型…</button></span>
  return <><Selector label={label} value={selection === undefined ? FOLLOW_CHAT_MODEL : modelKey(selection)}
    options={options} badges={badges} onChange={key => {
      if (key === FOLLOW_CHAT_MODEL) { onChange(undefined); return }
      const item = models.find(model => modelKey(model) === key)
      if (item !== undefined) onChange({ provider: item.provider, model: item.model })
    }}/>
    {(unavailable.length > 0 || models.length === 0) && <button type="button" className="dvw-set-button" onClick={refresh}>刷新</button>}
  </>
}

/** The page registered as `dsh-vscode-workbench` in DSH's settings navigation. */
export function WorkbenchSettings(props: WorkbenchSettingsProps) {
  const { refreshLsp } = props
  useEffect(() => { refreshLsp() }, [refreshLsp])
  const modelNotices = <>
    {props.commitModelUnavailable.map(provider => <p className="dvw-set-footnote" role="status" aria-live="polite" key={provider.provider}>无法读取 {provider.providerName}：{provider.message}</p>)}
    {props.commitModelError !== '' && <p className="dvw-set-footnote dvw-set-error" role="alert">读取 DSH 模型失败：{props.commitModelError}</p>}
  </>
  return <div className="dvw-set-page">
    <section className="dvw-set-group">
      <h3 className="dvw-set-group-title">外观</h3>
      <Row title="颜色主题" description="跟随 DSH 时随宿主在深色和浅色之间自动切换。">
        <Selector label="颜色主题" value={props.theme} options={THEMES} onChange={props.setTheme}/>
      </Row>
      <Row title="编辑器字号" description="影响 Monaco 编辑器、差异视图和 Markdown 源码。">
        <DebouncedRange label="编辑器字号" min={11} max={20} unit="px" value={props.fontSize} onChange={props.setFontSize}/>
      </Row>
      <Row title="代码缩略图" description="在编辑器右侧显示整份文件的缩略图，点击或拖动滑块可快速定位。关闭后只保留滚动条，差异视图不受影响。">
        <Switch label="代码缩略图" checked={props.minimap} onChange={props.setMinimap}/>
      </Row>
    </section>

    <section className="dvw-set-group">
      <h3 className="dvw-set-group-title">浏览器</h3>
      <Row title="默认浏览器" description="打开网页链接和 HTML 文件时使用的浏览器。">
        <Selector label="默认浏览器" value={props.defaultBrowser} options={DEFAULT_BROWSERS} onChange={props.setDefaultBrowser}/>
      </Row>
    </section>

    <section className="dvw-set-group">
      <h3 className="dvw-set-group-title">AI 改动审阅</h3>
      <Row title="代码审阅模式" description="审阅全部改动会保留每轮待处理差异；审阅最新改动会在新任务开始时接受上一任务；无需审阅会自动接受全部改动。">
        <Selector label="代码审阅模式" value={props.reviewMode??'none'} options={REVIEW_MODES} onChange={value=>props.setReviewMode?.(value)}/>
      </Row>
      {props.reviewMode!=='none'&&<Row title="自动跟随 AI 修改" description="收到新修改时更新原文件；输入、滚动或操作指针期间不会抢焦点。">
        <Switch label="自动跟随 AI 修改" checked={props.reviewFollow??true} onChange={value=>props.setReviewFollow?.(value)}/>
      </Row>}
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
      <Row title="Markdown 默认视图" description="打开 .md 文件时默认进入预览还是源码。">
        <Selector label="Markdown 默认视图" value={props.markdownView} options={MARKDOWN_VIEWS} onChange={props.setMarkdownView}/>
      </Row>
    </section>

    <section className="dvw-set-group">
      <h3 className="dvw-set-group-title">Git</h3>
      <Row title="Git 对比样式" description="IDEA / PyCharm 使用并排差异、改动连线和联动滚动。VS Code 使用经典内联差异。">
        <Selector label="Git 对比样式" value={props.gitDiffStyle} options={[['ribbon', 'IDEA / PyCharm（默认）'], ['classic', 'VS Code']]} onChange={props.setGitDiffStyle}/>
      </Row>
      <Row title="逐行提交信息" description="点击文件编辑器或 Git 对比中的代码行，在代码行尾显示提交作者、时间和摘要。">
        <Switch label="逐行提交信息" checked={props.gitLineBlame} onChange={props.setGitLineBlame}/>
      </Row>
      <h3 className="dvw-set-group-title">提交信息</h3>
      <Row title="详细程度" description="详细模式会生成标题和 2–4 条说明；简洁模式限制标题长度，标准模式保持单行约定式提交。">
        <Selector label="提交信息详细程度" value={props.commitDetail} options={COMMIT_DETAILS} onChange={props.setCommitDetail}/>
      </Row>
      <Row title="语言" description="跟随最近提交会沿用仓库里上一条提交的语言。">
        <Selector label="提交信息语言" value={props.commitLanguage} options={COMMIT_LANGUAGES} onChange={props.setCommitLanguage}/>
      </Row>
      <Row title="生成模型" description="未手动选择时跟随 DSH 聊天当前使用的模型，不需要先与 AI 对话即可生成提交信息。">
        <ModelSelector label="提交信息生成模型" selection={props.commitModelConfigured ? props.commitModel : undefined} onChange={props.setCommitModel} catalog={props}/>
      </Row>
      {modelNotices}
    </section>

    <section className="dvw-set-group">
      <h3 className="dvw-set-group-title">AI 代码补全</h3>
      <Row title="触发方式" description="编辑器内按 Alt/Option + \ 手动触发，自动模式也会在输入停顿后显示灰字。按 Tab 接受，按 Esc 隐藏。">
        <Selector label="AI 代码补全触发方式" value={props.inlineCompletionMode} options={INLINE_COMPLETION_MODES} onChange={props.setInlineCompletionMode}/>
      </Row>
      <Row title="补全模型" description="补全时会向所选的 DSH 模型发送当前文件的相对路径和光标附近的代码，包括未保存的内容。">
        <ModelSelector label="AI 代码补全模型" selection={props.inlineCompletionModel} onChange={props.setInlineCompletionModel} catalog={props}/>
      </Row>
    </section>

    <section className="dvw-set-group">
      <h3 className="dvw-set-group-title">语言智能</h3>
      <p className="dvw-set-footnote">编辑代码无需安装语言服务。按需安装后，可以补全代码、跳转到定义、查找引用，并在编辑时查看错误提示。</p>
      {!props.lspServers.some(server => server.id === 'typescript' && server.installed) && <div className="dvw-set-row">
        <div className="dvw-set-text">
          <span className="dvw-set-title">TypeScript / JavaScript（内置索引）</span>
          <span className="dvw-set-desc">{props.tsIntellisense
            ? props.tsIndex.state === 'loading' ? '正在索引工作区…'
              : props.tsIndex.state === 'error' ? `索引失败：${props.tsIndex.error}`
                : props.tsIndex.state === 'ready' ? `已索引 ${props.tsIndex.files} 个文件${props.tsIndex.truncated ? '（已达上限）' : ''}`
                  : '已启用，可在工作区中跳转到定义和查找引用'
            : '启用后可在工作区中跳转到定义和查找引用'}</span>
        </div>
        <div className="dvw-set-control">
          <button type="button" className="dvw-set-button" onClick={() => props.setTsIntellisense(!props.tsIntellisense)}>{props.tsIntellisense ? '停用索引' : '启用索引'}</button>
        </div>
      </div>}
      {props.lspServers.map(server => <div className="dvw-set-row" key={server.id}>
        <div className="dvw-set-text">
          <span className="dvw-set-title">{server.name}{server.id === 'typescript' ? '（项目语言服务）' : ''}</span>
          <span className="dvw-set-desc dvw-set-chips">
            <span className="dvw-set-chip" data-installed={server.installed && (!props.lspRuntime[server.id] || props.lspRuntime[server.id]?.state === 'ready')} title={props.lspRuntime[server.id]?.message}>
              {server.installed ? LSP_STATUS_TEXT[props.lspRuntime[server.id]?.state ?? 'idle']
                : server.installable ? '语言服务未安装（可选）' : `未检测到 ${server.command ?? server.name}（可手动安装）`}
            </span>
            {server.language && !server.language.installed && <span className="dvw-set-hint">未检测到 {server.language.name} 环境</span>}
            {!server.installed && server.hint !== undefined && <span className="dvw-set-hint">{server.hint}</span>}
          </span>
        </div>
        <div className="dvw-set-control">
          {server.installable && <button type="button" className="dvw-set-button" disabled={props.lspBusy !== undefined} onClick={() => props.changeLsp(server.id, server.installed ? 'uninstall' : 'install')}>
            {props.lspBusy === server.id ? (server.installed ? '正在卸载…' : '正在安装…') : (server.installed ? '卸载语言服务' : '安装语言服务')}
          </button>}
          {server.installed && props.lspRuntime[server.id] !== undefined && <button type="button" className="dvw-set-button" onClick={() => props.restartLsp(server.id)}>重启服务</button>}
        </div>
      </div>)}
      {props.lspServers.some(server => server.id === 'python' && server.installed) && <Row title="Python 解释器" description="当前工作区。留空时优先使用项目中的虚拟环境。">
        <input key={props.pythonPath} className="dvw-input" aria-label="Python 解释器路径" defaultValue={props.pythonPath}
          placeholder={props.lspServers.find(server => server.id === 'python')?.pythonPath ?? '输入 Python 解释器的完整路径'}
          onBlur={event => props.setPythonPath(event.currentTarget.value)}
          onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur() }} />
      </Row>}
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
