import builtins from 'builtin-modules'
import esbuild from 'esbuild'
import inlineWorkerPlugin from 'esbuild-plugin-inline-worker'
import process from 'process'

let entryPoints = [`index.js`]

const plugins = [
  inlineWorkerPlugin({
    sourcemap: 'inline',
    keepNames: true
  })
]

const context = await esbuild.context({
  entryPoints,
  bundle: true,
  external: [...builtins],
  format: 'esm',
  target: 'es2020',
  logLevel: 'info',
  sourcemap: 'inline',
  keepNames: true,
  treeShaking: true,
  outdir: 'dist',
  loader: {
    '.mp3': 'dataurl',
    '.svg': 'text',
    '.png': 'dataurl',
    '.md': 'text'
  },
  plugins
})

await context.rebuild()
process.exit(0)
