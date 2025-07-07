import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import { Socket, Server as SocketIOServer } from 'socket.io'
import { z } from 'zod'
import { Server, Client } from 'node-osc'
import invariant from 'tiny-invariant'
import _ from 'lodash'
import tailwindcss from '@tailwindcss/vite'
import { InputSchema, inputSchema } from './inputSchema'

const paramsState: InputSchema = {
  params: {},
  presets: {}
}

async function startDevServer() {
  const server = await createServer({
    // config options
    plugins: [react(), tailwindcss()],
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

  // Create Socket.IO server
  const httpServer = server.httpServer
  invariant(httpServer)
  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST']
    }
  })

  io.on('connection', (socket: Socket<ReceiveMap, SendMap>) => {
    socket.emit('params', paramsState)

    socket.on('params:reset', () => {
      paramsState.params = {}
    })
    socket.on('params', obj => {
      try {
        const validatedObj = inputSchema.parse(obj)
        for (let key of Object.keys(validatedObj)) {
          Object.assign(paramsState[key], validatedObj[key])
        }
        io.emit('params', paramsState)
      } catch (error) {
        console.error('Invalid params received:', error)
      }
    })

    socket.on('disconnect', () => {
      console.log('Socket.IO client disconnected:', socket.id)
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
  })

  oscServer.on('message', msg => {
    console.log('📨 OSC Message received:', msg)
  })

  oscServer.on('error', error => {
    console.error('❌ OSC Server error:', error)
  })

  oscServer.on('message', msg => {
    const [address, ...args] = msg as [string, ...any[]]

    switch (address) {
      default:
        // Forward all other messages to clients
        io.emit('osc:message', { address, data: args })
    }
  })

  await server.listen()

  server.printUrls()
}

startDevServer()
