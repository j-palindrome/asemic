/**
 * Client-side utility for communicating with the OSC server via Vite's WebSocket
 */

export interface OSCMessage {
  type:
    | 'osc:message'
    | 'asemic:start'
    | 'asemic:stop'
    | 'asemic:param'
    | 'asemic:reset'
  address?: string
  data: any[]
}

export class OSCClient {
  private ws: WebSocket | null = null
  private reconnectAttempts = 0
  private maxReconnectAttempts = 5
  private reconnectDelay = 1000
  private messageHandlers: Map<string, ((message: OSCMessage) => void)[]> =
    new Map()

  constructor(private wsUrl: string = `ws://0.0.0.0:3000`) {
    this.connect()
  }

  private connect() {
    try {
      // Use Vite's HMR WebSocket connection if available in development
      if (
        typeof window !== 'undefined' &&
        (window as any).__VITE_HMR_SOCKET__
      ) {
        this.setupViteConnection()
      } else {
        this.setupDirectConnection()
      }
    } catch (error) {
      this.scheduleReconnect()
    }
  }

  private setupViteConnection() {
    // Try to hook into Vite's HMR system if available
    const viteSocket = (window as any).__VITE_HMR_SOCKET__
    if (viteSocket) {
      viteSocket.addEventListener('message', (event: MessageEvent) => {
        try {
          const data = JSON.parse(event.data)
          if (data.type === 'osc:message') {
            this.handleMessage(data.payload)
          }
        } catch (error) {
          // Ignore non-OSC messages
        }
      })
    } else {
      // Fallback to direct connection
      this.setupDirectConnection()
    }
  }

  private setupDirectConnection() {
    this.ws = new WebSocket(this.wsUrl)

    this.ws.onopen = () => {
      this.reconnectAttempts = 0
    }

    this.ws.onmessage = event => {
      try {
        const message: OSCMessage = JSON.parse(event.data)
        this.handleMessage(message)
      } catch (error) {
        // Ignore parse errors
      }
    }

    this.ws.onclose = () => {
      this.scheduleReconnect()
    }

    this.ws.onerror = error => {
      console.error('❌ OSC WebSocket error:', error)
    }
  }

  private scheduleReconnect() {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++

      setTimeout(() => {
        this.connect()
      }, this.reconnectDelay * this.reconnectAttempts)
    }
  }

  private handleMessage(message: OSCMessage) {
    // Call type-specific handlers
    const typeHandlers = this.messageHandlers.get(message.type) || []
    typeHandlers.forEach(handler => handler(message))

    // Call address-specific handlers (for generic osc:message types)
    if (message.address) {
      const addressHandlers = this.messageHandlers.get(message.address) || []
      addressHandlers.forEach(handler => handler(message))
    }

    // Call global handlers
    const globalHandlers = this.messageHandlers.get('*') || []
    globalHandlers.forEach(handler => handler(message))
  }

  /**
   * Register a handler for OSC messages
   * @param pattern - Message type, OSC address, or '*' for all messages
   * @param handler - Function to handle the message
   */
  on(pattern: string, handler: (message: OSCMessage) => void) {
    if (!this.messageHandlers.has(pattern)) {
      this.messageHandlers.set(pattern, [])
    }
    this.messageHandlers.get(pattern)!.push(handler)
  }

  /**
   * Remove a handler for OSC messages
   */
  off(pattern: string, handler: (message: OSCMessage) => void) {
    const handlers = this.messageHandlers.get(pattern)
    if (handlers) {
      const index = handlers.indexOf(handler)
      if (index > -1) {
        handlers.splice(index, 1)
      }
    }
  }

  /**
   * Send a message to the server (if direct WebSocket connection is available)
   */
  send(address: string, ...args: any[]) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const message = {
        type: 'client:osc',
        address,
        data: args
      }
      this.ws.send(JSON.stringify(message))
    }
  }

  /**
   * Clean up the connection
   */
  disconnect() {
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
    this.messageHandlers.clear()
  }
}

// Convenience functions for Asemic-specific OSC messages
export const createAsemicOSCClient = (wsUrl?: string) => {
  const client = new OSCClient(wsUrl)

  return {
    client,

    // Asemic-specific methods
    onStart: (handler: (data: any[]) => void) => {
      client.on('asemic:start', msg => handler(msg.data))
    },

    onStop: (handler: (data: any[]) => void) => {
      client.on('asemic:stop', msg => handler(msg.data))
    },

    onParam: (handler: (data: any[]) => void) => {
      client.on('asemic:param', msg => handler(msg.data))
    },

    onReset: (handler: (data: any[]) => void) => {
      client.on('asemic:reset', msg => handler(msg.data))
    },

    // Generic OSC message handler
    onOSC: (address: string, handler: (data: any[]) => void) => {
      client.on(address, msg => handler(msg.data))
    },

    // Send methods (if direct connection is available)
    sendStart: (...args: any[]) => client.send('/asemic/start', ...args),
    sendStop: (...args: any[]) => client.send('/asemic/stop', ...args),
    sendParam: (param: string, value: any) =>
      client.send('/asemic/param', param, value),
    sendReset: () => client.send('/asemic/reset'),
    send: (address: string, ...args: any[]) => client.send(address, ...args),

    disconnect: () => client.disconnect()
  }
}

export default OSCClient
