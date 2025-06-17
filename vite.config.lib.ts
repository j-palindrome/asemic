import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = resolve(__filename, '..')

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    lib: {
      entry: {
        index: resolve(__dirname, 'src/index.ts'),
        asemic: resolve(__dirname, 'src/Asemic.ts'),
        parser: resolve(__dirname, 'src/Parser.ts'),
        renderer: resolve(__dirname, 'src/renderer.ts'),
        'canvas-renderer': resolve(__dirname, 'src/canvasRenderer.ts'),
        'webgpu-renderer': resolve(__dirname, 'src/WebGPURenderer.ts'),
        'three-renderer': resolve(__dirname, 'src/threeRenderer.ts'),
        'asemic-app': resolve(__dirname, 'src/app/AsemicApp.tsx'),
        worker: resolve(__dirname, 'src/asemic.worker.ts')
      },
      name: 'Asemic',
      formats: ['es']
    },
    rollupOptions: {
      external: [
        'react',
        'react-dom',
        'three',
        'lodash',
        'pts',
        'tiny-invariant',
        'node-osc',
        'lucide-react',
        'simplex-noise'
      ],
      output: {
        // globals: {
        //   react: 'React',
        //   'react-dom': 'ReactDOM',
        //   three: 'THREE',
        //   lodash: '_',
        //   pts: 'Pts'
        // },
        // // Preserve directory structure
        // entryFileNames: chunkInfo => {
        //   return `${chunkInfo.name}.js`
        // },
        chunkFileNames: 'chunks/[name].js',
        assetFileNames: 'assets/[name].[extname]'
      }
    },
    sourcemap: true,
    emptyOutDir: true,
    target: 'es2020'
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src')
    }
  }
})
