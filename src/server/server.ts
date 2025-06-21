import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import { WebSocketServer } from 'ws'
import { z } from 'zod'
import { InputSchema, inputSchema } from './schema'
import { pick } from 'lodash'

const paramsState: InputSchema = {
  params: {}
}
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

  // Create WebSocket server
  const httpServer = server.httpServer
  if (httpServer) {
    const wss = new WebSocketServer({ port: 7000 })

    wss.on('connection', ws => {
      console.log('WebSocket client connected')
      ws.send(JSON.stringify(paramsState))

      ws.on('message', message => {
        const obj = inputSchema.safeParse(JSON.parse(message.toString()))
        if (obj.data) {
          for (let param of Object.keys(obj.data.params)) {
            paramsState.params[param] = obj.data.params[param]
            wss.clients.forEach(client => {
              if (client.readyState === client.OPEN) {
                client.send(
                  JSON.stringify({
                    params: pick(
                      paramsState.params,
                      Object.keys(obj.data.params)
                    )
                  })
                )
              }
            })
          }
        }
      })

      ws.on('close', () => {
        console.log('WebSocket client disconnected')
      })
    })
  }

  await server.listen()

  server.printUrls()
}

startDevServer().catch(console.error)
