import { readFile } from 'fs/promises'
import { Client, Server } from 'node-osc'
import { extname } from 'path'
import sharp from 'sharp'
import { Socket, Server as SocketIOServer } from 'socket.io'
import { ReceiveMap, SendMap } from '@/lib/types'
import sc from 'supercolliderjs'
import { InputSchema, inputSchema } from '../../renderer/inputSchema'

let schemaState: InputSchema = {
  params: {},
  presets: {}
}

export async function startDevServer() {
  // const server = await createServer({
  //   // config options
  //   plugins: [react(), tailwindcss()],
  //   resolve: {
  //     alias: {
  //       '@': resolve(import.meta.dirname, './src')
  //     }
  //   },
  //   worker: {
  //     format: 'es' // Use ES modules for workers
  //   },
  //   server: {
  //     port: 3000,
  //     host: '0.0.0.0'
  //   }
  // })

  // // Create Socket.IO server
  // const httpServer = server.httpServer
  // invariant(httpServer)
  const io = new SocketIOServer(3000, {
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
      console.log('✅ SuperCollider server started successfully')
    },
    err => {
      console.warn('⚠️ SuperCollider server failed to start:', err.message)
      console.log('🔄 Continuing without SuperCollider server...')
      scServer = null
    }
  )

  const synths: Record<string, { synth: any; buffer: any }> = {}
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

        const def = await scServer.synthDef(
          name,
          `{ |buffer = 0, out = 0|
              ${synthDef} 
          }`
        )
        synthDefs[name] = def
      } catch (err) {
        console.error('Error compiling SynthDef:', err)
        return
      }
    })

    socket.on(
      'sc:set',
      async (name: string, param: string, value: number | number[]) => {
        try {
          if (!synths[name]) return false
          if (value instanceof Array) {
            // synths[name].setn({ [param]: value })
            // @ts-ignore

            scServer.send.msg(
              sc.msg.bufferSetn(synths[name].buffer.id, 0, value)
            )
          } else {
            synths[name].synth.set({ [param]: value })
          }
        } catch (err) {
          console.error('Error setting Synth parameter:', err)
        }
      }
    )

    socket.on('sc:on', async () => {
      for (let synth in synthDefs) {
        const buffer = await scServer.buffer(100, 2)
        synths[synth] = {
          synth: await scServer.synth(synthDefs[synth], { buffer: buffer.id }),
          buffer
        }
        synths[synth].synth.set('buffer', buffer.id)
      }
    })

    socket.on('sc:off', () => {
      for (const key in synths) {
        synths[key].synth.free()
        synths[key].buffer.free()
        delete synths[key]
      }
    })

    socket.on('files:load', async (files, callback) => {
      try {
        const filesBitmaps: Record<string, ImageData[]> = {}

        for (const filePath of files) {
          try {
            const fileData = await readFile(filePath)
            const ext = extname(filePath).toLowerCase()

            if (
              ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'].includes(ext)
            ) {
              // Handle image files using sharp
              const imageBuffer = await sharp(fileData)
                .raw()
                .toBuffer({ resolveWithObject: true })

              // Convert to ImageData-like structure that can be transferred
              const imageData = {
                data: new Uint8ClampedArray(imageBuffer.data),
                width: imageBuffer.info.width,
                height: imageBuffer.info.height,
                colorSpace: 'srgb' as PredefinedColorSpace
              }

              // Since we can't create actual ImageBitmap in Node.js,
              // we'll send the raw image data and let the client handle it
              filesBitmaps[filePath] = [imageData]
            } else if (['.pdf'].includes(ext)) {
            } else if (['.mp4', '.webm', '.mov', '.avi'].includes(ext)) {
              // Handle video files (simplified - would need ffmpeg for proper frame extraction)
              // For now, skip video files or handle them differently
              console.log(
                `Video file ${filePath} detected - video processing not implemented`
              )
            }
          } catch (error) {
            console.error(`Error loading file ${filePath}:`, error)
          }
        }

        callback(filesBitmaps)
      } catch (error) {
        console.error('Error loading files:', error)
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

  // await server.listen()

  // server.printUrls()
}

// startDevServer()
