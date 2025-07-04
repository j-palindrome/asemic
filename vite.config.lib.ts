import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import { fileURLToPath } from 'url'
import tailwindcss from '@tailwindcss/vite'

const __filename = fileURLToPath(import.meta.url)
const __dirname = resolve(__filename, '..')

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'Asemic',
      formats: ['es', 'cjs']
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
        // Preserve directory structure
        entryFileNames: chunkInfo => {
          return `${chunkInfo.name}.[format].js`
        },
        chunkFileNames: 'chunks/[name].[format].js',
        assetFileNames: 'assets/[name][extname]'
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
