interface Client {
  id: number
  address: string
  properties: Record<string, any>
}

interface Message {
  metadata: {
    apiVersion: string
    compVersion: string
    compOrigin: string
    projectName: string
  }
  signalingType: string
  content: Record<string, any>
  [key: string]: any
}

class SignalingClient {
  private webSocket: WebSocket | null = null
  private connectedToServer = false
  private clients: Client[] = []
  private reactClientsHandler: (clients: Client[]) => void
  private reactConnectedHandler: (connected: boolean) => void
  private webRTCConnection: any = null
  id = -1
  assignedAddress = ''
  properties: Record<string, any> = {}

  constructor(
    address: string,
    port: number,
    reactSetWebsocketClientsHandler: (clients: Client[]) => void,
    reactSetConnectedToServerHandler: (connected: boolean) => void
  ) {
    this.reactClientsHandler = reactSetWebsocketClientsHandler
    this.reactConnectedHandler = reactSetConnectedToServerHandler
    this.open(address, port)
  }

  private open(address: string, port: number) {
    try {
      this.webSocket = new WebSocket(`${address}:${port}`)

      this.webSocket.onopen = () => {
        console.log('[WEBSOCKET] Client connected')
        this.connectedToServer = true
        this.reactConnectedHandler(true)
      }

      this.webSocket.onmessage = (message: MessageEvent) => {
        try {
          const messageObj = JSON.parse(message.data) as Message
          this.onWebSocketMessageReceived(messageObj)
          this.reactClientsHandler([...this.clients])
        } catch (error) {
          console.error('[WEBSOCKET] Error parsing message:', error)
        }
      }

      this.webSocket.onclose = (event: CloseEvent) => {
        console.log('[WEBSOCKET] Client closed', event.code, event.reason)
        this.connectedToServer = false
        this.reactConnectedHandler(false)
      }

      this.webSocket.onerror = (error: Event) => {
        console.error('[WEBSOCKET] ERROR', error)
        this.connectedToServer = false
        this.reactConnectedHandler(false)
      }
    } catch (error) {
      console.error('[WEBSOCKET] Failed to create WebSocket:', error)
      this.reactConnectedHandler(false)
    }
  }

  close() {
    if (this.webSocket) {
      this.webSocket.close()
    }
    this.reactConnectedHandler(false)
    this.reactClientsHandler([])
  }

  setWebRTCConnection(webRTCConnection: any) {
    this.webRTCConnection = webRTCConnection
  }

  private onClientsMessage(message: Message): Client[] {
    console.log('[WEBSOCKET] On Clients', message)
    const { clients } = message.content
    return clients || []
  }

  private onClientEnter(message: Message, previousClients: Client[]): Client[] {
    console.log('[WEBSOCKET] On Client Enter', message)
    const { id, address, properties } = message.content.client
    const index = previousClients.findIndex(object => object.id === id)

    if (index === -1) {
      previousClients.push({ id, address, properties })
    }

    return previousClients
  }

  private onClientEntered(message: Message) {
    console.log('[WEBSOCKET] On Client Entered')
    const { self } = message.content
    console.log(self)
    this.id = self.id
    this.assignedAddress = self.address
    this.properties = self.properties
  }

  private onClientExit(message: Message, previousClients: Client[]): Client[] {
    console.log('[WEBSOCKET] On Client Exit', message)
    const { id } = message.content.client
    return previousClients.filter(c => c.id !== id)
  }

  private onWebSocketMessageReceived(messageObject: Message) {
    const { signalingType } = messageObject

    switch (signalingType) {
      case 'Clients':
        this.clients = this.onClientsMessage(messageObject)
        break
      case 'ClientEnter':
        this.clients = this.onClientEnter(messageObject, this.clients)
        break
      case 'ClientEntered':
        this.onClientEntered(messageObject)
        break
      case 'ClientExit':
        this.clients = this.onClientExit(messageObject, this.clients)
        break
      default:
        // Delegate WebRTC negotiation messages to WebRTCConnection
        const signalingClientMessagesTypes = ['Offer', 'Answer', 'Ice']
        if (
          signalingClientMessagesTypes.includes(signalingType) &&
          this.webRTCConnection
        ) {
          this.webRTCConnection.onMessageReceived(messageObject)
        } else {
          console.log(
            '[WEBSOCKET] No match found for signaling type:',
            signalingType
          )
        }
    }
  }

  send(message: Message) {
    if (this.webSocket && this.webSocket.readyState === WebSocket.OPEN) {
      this.webSocket.send(JSON.stringify(message))
    } else {
      console.error('[WEBSOCKET] WebSocket not connected')
    }
  }
}

export default SignalingClient
