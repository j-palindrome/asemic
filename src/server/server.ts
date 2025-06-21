import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

async function startDevServer() {
  const server = await createServer({
    // config options
    plugins: [react()],
    resolve: {
      alias: {
        '@': resolve(import.meta.dirname, './src')
      }
    },
    worker: {
      format: 'es' // Use ES modules for workers
    },
    server: {
      port: 3000,
      host: '0.0.0.0'
    }
  })

  await server.listen()

  server.printUrls()
}

startDevServer().catch(console.error)
