const FILE_LANGUAGES: ReadonlyArray<[language: string, extensions: string[]]> = [
  ['typescript', ['ts', 'tsx', 'mts', 'cts']],
  ['javascript', ['js', 'jsx', 'mjs', 'cjs']],
  ['vue', ['vue']],
  ['python', ['py', 'pyi', 'pyw', 'rpy', 'cpy', 'gyp', 'gypi']],
  ['php', ['php', 'php4', 'php5', 'phtml', 'ctp']],
  ['shell', ['sh', 'bash', 'zsh', 'ksh', 'command']],
  ['yaml', ['yaml', 'yml']],
  ['json', ['json', 'jsonc', 'code-workspace']],
  ['css', ['css']],
  ['scss', ['scss']],
  ['less', ['less']],
  ['html', ['html', 'htm']],
  ['dockerfile', ['dockerfile', 'containerfile']],
  ['go', ['go']],
  ['rust', ['rs']],
  ['c', ['c', 'h']],
  ['cpp', ['cc', 'cpp', 'cxx', 'hpp', 'hh', 'hxx', 'ipp', 'inl']],
  ['objective-c', ['m', 'mm']],
  ['java', ['java', 'jav']],
  ['csharp', ['cs']],
  ['lua', ['lua']],
]

const extensionLanguages = new Map(FILE_LANGUAGES.flatMap(([language, extensions]) =>
  extensions.map(extension => [extension, language] as const)))
const SHELL_RC = new Set(['.bashrc', '.bash_profile', '.bash_login', '.profile', '.zshrc', '.zshenv', '.zprofile', '.zlogin'])
const JSON_RC = new Set(['.bowerrc', '.jshintrc', '.jscsrc', '.eslintrc', '.babelrc'])

export function editorLanguageForPath(path: string): string | undefined {
  const name = path.split(/[\\/]/).at(-1)?.toLowerCase() ?? ''
  if (/^(?:dockerfile|containerfile)(?:\.|$)/.test(name)) return 'dockerfile'
  if (SHELL_RC.has(name)) return 'shell'
  if (JSON_RC.has(name)) return 'json'
  return name.includes('.') ? extensionLanguages.get(name.split('.').at(-1)!) : undefined
}

export function languageServerIdForPath(path: string, servers: readonly { id: string; languages: readonly string[] }[]): string | undefined {
  const language = editorLanguageForPath(path)
  return language === undefined ? undefined : servers.find(server => server.languages.includes(language))?.id
}

/** Monaco uses one JSON language for both syntaxes. The server validates them differently. */
export function protocolLanguageId(language: string, path: string): string {
  if (language === 'shell') return 'shellscript'
  if (language === 'typescript' && /\.tsx$/i.test(path)) return 'typescriptreact'
  if (language === 'javascript' && /\.jsx$/i.test(path)) return 'javascriptreact'
  if (language === 'objective-c' && /\.mm$/i.test(path)) return 'objective-cpp'
  if (language !== 'json') return language
  const normalized = path.replace(/\\/g, '/').toLowerCase()
  return /\.(?:jsonc|code-workspace)$/.test(normalized)
    || /(?:^|\/)(?:tsconfig|jsconfig)(?:\.[^/]+)*\.json$/.test(normalized)
    || /(?:^|\/)\.vscode\/(?:settings|launch|tasks|extensions|mcp)\.json$/.test(normalized)
    ? 'jsonc' : 'json'
}
