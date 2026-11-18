/** Missing translations in Monaco 0.52.2's AMD Chinese bundle.
 * Indices belong to that bundle; the localization test checks the installed assets.
 * Apply before editor.main registers actions and captures their labels.
 */
const MISSING_ZH_CN: Readonly<Record<number, string>> = {
  26: '{0} 个结果',
  54: '编辑器',
  55: '编辑器当前无法访问。',
  56: '{0} 要启用屏幕阅读器优化模式，请使用 {1}',
  57: '{0} 要启用屏幕阅读器优化模式，请使用 {1} 打开快速选择，然后运行“切换屏幕阅读器辅助功能模式”命令。该命令当前无法通过键盘触发。',
  58: '{0} 请使用 {1} 打开键绑定编辑器，为“切换屏幕阅读器辅助功能模式”命令分配快捷键并运行该命令。',
  310: '控制是否在编辑器中显示内联编辑。',
  311: '显示内联建议时始终显示内联编辑工具栏。',
  312: '将鼠标悬停在内联建议上时显示内联编辑工具栏。',
  313: '从不显示内联编辑工具栏。',
  314: '控制何时显示内联编辑工具栏。',
  315: '控制内联编辑的字体。',
  628: '当前上下文是否为多文件差异编辑器',
  796: '点击切换颜色格式（rgb/hsl/hex）',
  797: '关闭颜色选择器的图标',
  798: '显示或聚焦独立颜色选择器(&&S)',
  799: '隐藏颜色选择器',
  800: '使用独立颜色选择器插入颜色',
  801: '显示或聚焦独立颜色选择器',
  802: '显示或聚焦使用默认颜色提供程序的独立颜色选择器，支持 hex/rgb/hsl 颜色。',
  803: '隐藏独立颜色选择器。',
  804: '使用已聚焦的独立颜色选择器插入 hex/rgb/hsl 颜色。',
  841: '配置指定 MIME 类型内容默认使用的拖放提供程序。',
  1095: '接受内联编辑',
  1096: '显示下一处内联编辑',
  1097: '显示上一处内联编辑',
  1098: '触发内联编辑',
  1099: '接受内联编辑',
  1100: '隐藏内联编辑',
  1101: '内联编辑是否可见',
  1102: '内联编辑是否可见',
}

export function completeMonacoChineseMessages(): void {
  const messages = (globalThis as { _VSCODE_NLS_MESSAGES?: Array<string | null> })._VSCODE_NLS_MESSAGES
  if (messages === undefined) return
  for (const [index, text] of Object.entries(MISSING_ZH_CN)) {
    if (messages[Number(index)] === null) messages[Number(index)] = text
  }
}

/** Monaco 0.52.2 hard-codes these labels instead of using its NLS table.
 * Change only the displayed label on the existing action object: re-registering
 * actions would replace their context conditions, shortcuts and handlers.
 * Keep the English alias so command-palette searches still accept English.
 */
export function localizeMonacoActions(editor: Pick<import('monaco-editor').editor.ICodeEditor, 'getAction'>): void {
  const labels: Record<string, string> = {
    'editor.action.inlineEdit.trigger': '触发内联编辑',
    'editor.action.inlineEdit.accept': '接受内联编辑',
    'editor.action.inlineEdit.reject': '拒绝内联编辑',
    'editor.action.inlineEdit.jumpTo': '跳转到内联编辑',
    'editor.action.inlineEdit.jumpBack': '从内联编辑跳回',
  }
  for (const [id, label] of Object.entries(labels)) {
    const action = editor.getAction(id)
    if (action !== null) Object.assign(action, { label })
  }
}
