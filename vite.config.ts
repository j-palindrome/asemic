import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron/simple'
import { resolve } from 'path'
import tailwindcss from '@tailwindcss/vite'
import { lezer } from '@lezer/generator/rollup'
import wasm from 'vite-plugin-wasm'
import topLevelAwait from 'vite-plugin-top-level-await'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), lezer()],
  worker: { plugins: () => [wasm()] },
  build: {
    sourcemap: true,
    target: 'es2020'
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src')
    }
  },
  server: {
    host: true
  }
})
