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
import sc from 'supercolliderjs'

let schemaState: InputSchema = {
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

  let scServer: any = null

  // @ts-ignore
  sc.server.boot().then(
    async thisServer => {
      scServer = thisServer
    },
    err => {
      console.error('error' + err.message)
    }
  )

  const synths: Record<string, any> = {}
  const synthDefs: Record<string, any> = {}

  io.on('connection', (socket: Socket<ReceiveMap, SendMap>) => {
    socket.emit('params', schemaState)

    socket.on('params:reset', () => {
      schemaState.params = {}
    })
    socket.on('params', obj => {
      try {
        schemaState = { ...schemaState, ...inputSchema.parse(obj) }
        io.emit('params', schemaState)
      } catch (error) {
        console.error('Invalid params received:', error)
      }
    })

    socket.on('sc:synth', async (name: string, synthDef: string) => {
      if (!scServer) return

      try {
        // Compile a SynthDef from inline SuperCollider language code and send it to the server
        const def = await scServer.synthDef(name, synthDef)
        synthDefs[name] = def
      } catch (err) {
        console.error('Error compiling SynthDef:', err)
        return
      }
    })

    socket.on('sc:set', async (name: string, param: string, value: number) => {
      try {
        if (!synths[name]) return false
        synths[name].set({ [param]: value })
      } catch (err) {
        console.error('Error setting Synth parameter:', err)
      }
    })

    socket.on('sc:on', async () => {
      for (let synth in synthDefs) {
        synths[synth] = await scServer.synth(synthDefs[synth])
      }
    })

    socket.on('sc:off', () => {
      for (const key in synths) {
        synths[key].free()
        delete synths[key]
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
      case '/asemic/param':
        console.log('⚙️ Parameter update:', args)
        io.emit('asemic:param', args)
        break

      default:
        // Forward all other messages to clients
        io.emit('osc:message', { address, data: args })
    }
  })

  await server.listen()

  server.printUrls()
}

startDevServer()
