import { getIconForFile, getIconForFolder, getIconForOpenFolder } from 'vscode-icons-js'

/** Resolve the vscode-icons asset name for a tree entry or tab. */
export function fileIconName(name: string, directory: boolean, expanded: boolean): string {
  if (directory) return (expanded ? getIconForOpenFolder(name) : getIconForFolder(name)) ?? (expanded ? 'default_folder_opened.svg' : 'default_folder.svg')
  return getIconForFile(name) ?? 'default_file.svg'
}
