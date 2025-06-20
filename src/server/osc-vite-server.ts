import { createServer } from 'vite'
import { createServer as createHttpServer } from 'http'
import { Server, Client } from 'node-osc'
import type { ViteDevServer } from 'vite'
import viteConfig from '../../vite.config'

interface OSCServerConfig {
  port: number
  host: string
}

interface ViteServerConfig {
  port: number
  host: string
  open?: boolean
}

class OSCViteServer {
  private viteServer: ViteDevServer | null = null
  private oscServer: Server | null = null
  private oscClient: Client | null = null

  constructor(
    private oscConfig: OSCServerConfig = { port: 57121, host: '127.0.0.1' },
    private viteConfig: ViteServerConfig = {
      port: 3000,
      host: 'localhost',
      open: true
    }
  ) {}

  async start() {
    try {
      // Start Vite server
      await this.startViteServer()

      // Start OSC server
      await this.startOSCServer()

      console.log('🚀 OSC-Vite Server started successfully!')
      console.log(
        `📱 Vite Dev Server: http://${this.viteConfig.host}:${this.viteConfig.port}`
      )
      console.log(
        `🎵 OSC Server: ${this.oscConfig.host}:${this.oscConfig.port}`
      )
    } catch (error) {
      console.error('❌ Failed to start server:', error)
      process.exit(1)
    }
  }

  private async startViteServer() {
    this.viteServer = await createServer({
      ...viteConfig,
      server: {
        ...viteConfig.server,
        port: this.viteConfig.port,
        host: this.viteConfig.host,
        open: this.viteConfig.open
      }
    })

    await this.viteServer.listen()
  }

  private async startOSCServer() {
    return new Promise<void>((resolve, reject) => {
      try {
        // Create OSC server
        this.oscServer = new Server(this.oscConfig.port, this.oscConfig.host)

        // Create OSC client for sending messages
        this.oscClient = new Client(this.oscConfig.host, this.oscConfig.port)

        this.oscServer.on('listening', () => {
          console.log(
            `🎵 OSC Server listening on ${this.oscConfig.host}:${this.oscConfig.port}`
          )
          resolve()
        })

        this.oscServer.on('message', msg => {
          console.log('📨 OSC Message received:', msg)
        })

        this.oscServer.on('error', error => {
          console.error('❌ OSC Server error:', error)
          reject(error)
        })

        // Set up default OSC message handlers
        this.setupDefaultHandlers()
      } catch (error) {
        reject(error)
      }
    })
  }

  private setupDefaultHandlers() {
    if (!this.oscServer) return

    // Example handlers for common OSC patterns
    this.oscServer.on('message', msg => {
      const [address, ...args] = msg as [string, ...any[]]

      switch (address) {
        case '/asemic/start':
          console.log('🎬 Starting asemic generation...')
          this.broadcastToClients({ type: 'asemic:start', data: args })
          break

        case '/asemic/stop':
          console.log('⏹️ Stopping asemic generation...')
          this.broadcastToClients({ type: 'asemic:stop', data: args })
          break

        case '/asemic/param':
          console.log('⚙️ Parameter update:', args)
          this.broadcastToClients({ type: 'asemic:param', data: args })
          break

        case '/asemic/reset':
          console.log('🔄 Resetting asemic state...')
          this.broadcastToClients({ type: 'asemic:reset', data: args })
          break

        default:
          // Forward all other messages to clients
          this.broadcastToClients({ type: 'osc:message', address, data: args })
      }
    })
  }

  private broadcastToClients(message: any) {
    if (!this.viteServer?.ws) return

    // Broadcast to all connected WebSocket clients
    this.viteServer.ws.send('osc:message', message)
  }

  // Method to send OSC messages programmatically
  sendOSCMessage(address: string, ...args: any[]) {
    if (!this.oscClient) {
      console.warn('⚠️ OSC Client not initialized')
      return
    }

    try {
      this.oscClient.send(address, ...args)
      console.log(`📤 OSC Message sent: ${address}`, args)
    } catch (error) {
      console.error('❌ Failed to send OSC message:', error)
    }
  }

  async stop() {
    try {
      if (this.viteServer) {
        await this.viteServer.close()
        console.log('✅ Vite server stopped')
      }

      if (this.oscServer) {
        this.oscServer.close()
        console.log('✅ OSC server stopped')
      }

      if (this.oscClient) {
        this.oscClient.close()
        console.log('✅ OSC client stopped')
      }
    } catch (error) {
      console.error('❌ Error stopping servers:', error)
    }
  }
}

// Default configuration
const defaultOSCConfig: OSCServerConfig = {
  port: parseInt(process.env.OSC_PORT || '57121'),
  host: process.env.OSC_HOST || '127.0.0.1'
}

const defaultViteConfig: ViteServerConfig = {
  port: parseInt(process.env.VITE_PORT || '3000'),
  host: process.env.VITE_HOST || 'localhost',
  open: process.env.VITE_OPEN !== 'false'
}

// Start server if this file is run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const server = new OSCViteServer(defaultOSCConfig, defaultViteConfig)

  // Graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n🛑 Shutting down servers...')
    await server.stop()
    process.exit(0)
  })

  process.on('SIGTERM', async () => {
    console.log('\n🛑 Shutting down servers...')
    await server.stop()
    process.exit(0)
  })

  server.start()
}

export { OSCViteServer }
export type { OSCServerConfig, ViteServerConfig }
