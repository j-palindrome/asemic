import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import tailwindcss from '@tailwindcss/vite'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': resolve(__dirname, './src')
    }
  },
  worker: {
    format: 'es' // Use ES modules for workers
  },
  build: {
    outDir: 'dist',
    sourcemap: true
  },
  server: {
    port: 3000,
    open: true
  },
  optimizeDeps: {
    include: ['lodash', 'pts', 'tiny-invariant', 'node-osc', 'lucide-react']
  }
})
