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
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
// Start OSC server
import { Client, Server } from 'node-osc'
// Create WebSocket server
import { WebSocketServer } from 'ws'

async function startDevServer() {
  const server = await createServer({
    server: {
      port: 3000,
      host: true
    },
    plugins: [react()],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, './src')
      }
    },
    worker: {
      format: 'es' // Use ES modules for workers
    }
  })

  const oscServer = new Server(7000, '0.0.0.0')
  const wss = new WebSocketServer({ port: 7001 })
  const oscClient = new Client('localhost', 57120)

  // Handle OSC messages and forward to WebSocket clients
  oscServer.on('message', msg => {
    const oscData = { address: msg[0], args: msg.slice(1) }
    wss.clients.forEach(client => {
      if (client.readyState === client.OPEN) {
        client.send(JSON.stringify(oscData))
      }
    })
  })

  // Handle WebSocket messages and forward to OSC server
  wss.on('connection', ws => {
    ws.on('message', data => {
      try {
        const message = JSON.parse(data.toString())

        oscClient.send(message.address, ...message.args)
      } catch (error) {
        console.error('Failed to parse WebSocket message:', error)
      }
    })
  })

  console.log('OSC server listening on port 7000')
  console.log('WebSocket server listening on port 7001')

  await server.listen()
}

startDevServer()
