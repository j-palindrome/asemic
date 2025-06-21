import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import { WebSocketServer } from 'ws'
import { z } from 'zod'
import { Server, Client } from 'node-osc'
import invariant from 'tiny-invariant'
import _ from 'lodash'

const inputSchema = z.object({
  params: z.record(
    z.string(),
    z.object({
      type: z.literal('number'),
      value: z.number(),
      max: z.number(),
      min: z.number()
    })
  )
})

type InputSchema = z.infer<typeof inputSchema>

const WS_PORT = 7004

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
  invariant(httpServer)
  const wss = new WebSocketServer({ port: WS_PORT })

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
                  params: _.pick(
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

  const oscConfig = { port: 57121, host: '127.0.0.1' }

  // Create OSC server
  const oscServer = new Server(oscConfig.port, oscConfig.host)

  // Create OSC client for sending messages
  const oscClient = new Client(oscConfig.host, oscConfig.port)

  oscServer.on('listening', () => {
    console.log(
      `🎵 OSC Server listening on ${oscConfig.host}:${oscConfig.port}`
    )
    resolve()
  })

  oscServer.on('message', msg => {
    console.log('📨 OSC Message received:', msg)
  })

  oscServer.on('error', error => {
    console.error('❌ OSC Server error:', error)
  })

  oscServer.on('message', msg => {
    const [address, ...args] = msg as [string, ...any[]]

    const broadcastToClients = (data: any) => {
      wss.clients.forEach(client => {
        if (client.readyState === client.OPEN) {
          client.send(JSON.stringify(data))
        }
      })
    }

    switch (address) {
      case '/asemic/param':
        console.log('⚙️ Parameter update:', args)
        broadcastToClients({ type: 'asemic:param', data: args })
        break

      default:
        // Forward all other messages to clients
        broadcastToClients({ type: 'osc:message', address, data: args })
    }
  })

  await server.listen()

  server.printUrls()
}

startDevServer()
