# Installation

Plugin 0.2.3 targets DeepSeek Harness `0.2.2-rc.1` (Cordis `4.1.0`). Architecture and the full compatibility table are in [Architecture](ARCHITECTURE.en.md).

## Install

```bash
npm i -g @deepseek-ai/dsh@0.2.2-rc.1
dsh plugin --profile web add dsh-vscode-workbench
```

Installing from the DSH Plugins page or a marketplace adds the package to `dsh.profile.bundles` and enables it. The CLI command only writes `dependencies`, so add `dsh-vscode-workbench` to `dsh.profile.bundles` in `~/.dsh/profiles/web/package.json` and restart `dsh web`:

```json
{
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "dsh-vscode-workbench"
      ]
    }
  }
}
```

## Terminal support on first install

The terminal uses `node-pty`. If installation reports a blocked build script, merge the following into `~/.dsh/profiles/web/pnpm-workspace.yaml` on the DSH host, preserving existing settings:

```yaml
allowBuilds:
  node-pty: true
```

Newer Harness releases may roll back failed installations, so run the install command again after configuring builds. If the plugin is installed but `node-pty` still cannot load:

```bash
cd ~/.dsh/profiles/web
pnpm rebuild node-pty
```

pnpm can delay versions published less than 24 hours ago. Retry after the waiting period, or use DSH's "Update now" action when offered.

## Upgrading

With HMR active, the running plugin manager rejects installing over an existing package. Remove the old plugin first:

```bash
dsh plugin --profile web remove dsh-vscode-workbench
dsh plugin --profile web add dsh-vscode-workbench
```

Reopen the workbench afterwards; restart `dsh web` and refresh the page if needed.

## Install fails: incompatible Harness

If the install ends with only this line, Harness refused the plugin before installing anything — pnpm never ran and no file was written:

```
dsh: plugin command failed; diagnostics: ~/.dsh/profiles/<profile>/.plugin-manager/logs/operation-*/pnpm.log
```

Harness runs a compatibility preflight first: `engines.dsh` takes precedence; when absent, every `@deepseek-ai/dsh*` peerDependency must match the running Harness version, including prereleases. The diagnostic log holds the verdict:

```
dsh: installation rejected: Plugin dsh-vscode-workbench@<plugin version> is incompatible with dsh <Harness version>: peerDependencies {...}
dsh: nothing was installed.
```

The marketplace files this under the generic `plugin-side install failure`, so the auto-submitted issue keeps only the `pnpm.log` path.

Update Harness to `0.2.2-rc.1` before installing plugin 0.2.3:

```bash
npm i -g @deepseek-ai/dsh@0.2.2-rc.1
```

`dsh plugin allow-version` only bypasses the version gate; it does not supply missing host services, so the plugin still fails to load on `0.2.0-rc.2`.
