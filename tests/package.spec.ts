import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('published plugin assembly', () => {
  it('loads the host plugin when installed as a standalone bundle', async () => {
    const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as {
      dsh?: { bundle?: { patch?: string } }
      files?: string[]
    }

    expect(manifest.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
    expect(manifest.files).toContain('cordis.patch.yml')
    expect((manifest as { dependencies?: Record<string, string> }).dependencies).toMatchObject({ 'node-pty': '^1.1.0', '@xterm/xterm': '^5.5.0', '@xterm/addon-fit': '^0.11.0' })

    const patch = await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
    expect(patch).toContain('name: dsh-vscode-workbench')
  })
})
