import type { UserConfig } from 'tsdown'

const EXTERNALS = [
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', 'cordis',
  '@deepseek-ai/cordis', '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-runtime/client',
]

/** Create a DSH host bundle and dynamic browser-client bundle. */
export function dshPackage(packageName: string): UserConfig[] {
  return [
    {
      entry: { index: './src/index.ts' }, outDir: './lib', format: 'esm',
      platform: 'node', dts: false, sourcemap: true, clean: false,
      deps: { neverBundle: true }, outputOptions: { entryFileNames: '[name].js' },
    },
    {
      entry: { client: './src/client/index.tsx' }, outDir: './lib', format: 'cjs',
      platform: 'browser', dts: false, sourcemap: true, clean: false,
      deps: {
        neverBundle: EXTERNALS,
        alwaysBundle: (id: string) => EXTERNALS.includes(id) ? undefined : true,
      },
      define: { 'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production') },
      outputOptions: {
        entryFileNames: 'client.js', codeSplitting: false,
        banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(packageName)}, factory: (require) => {`,
        intro: 'var module = { exports: {} }; var exports = module.exports;',
        footer: 'return module.exports; } });',
      },
    },
  ]
}
