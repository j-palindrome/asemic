import React, { useEffect, useState, useCallback } from 'react'
import { createAsemicOSCClient, OSCMessage } from '../oscClient'

interface OSCControllerProps {
  className?: string
}

export const OSCController: React.FC<OSCControllerProps> = ({ className = '' }) => {
  const [isConnected, setIsConnected] = useState(false)
  const [messages, setMessages] = useState<OSCMessage[]>([])
  const [lastMessage, setLastMessage] = useState<OSCMessage | null>(null)
  const [oscClient, setOscClient] = useState<ReturnType<typeof createAsemicOSCClient> | null>(null)

  useEffect(() => {
    // Initialize OSC client
    const client = createAsemicOSCClient()
    setOscClient(client)

    // Set up connection status monitoring
    const checkConnection = () => {
      // In a real implementation, you'd check the actual connection status
      setIsConnected(true)
    }

    // Set up message handlers
    client.client.on('*', (message: OSCMessage) => {
      console.log('OSC Message received:', message)
      setLastMessage(message)
      setMessages(prev => [...prev.slice(-9), message]) // Keep last 10 messages
    })

    // Asemic-specific handlers
    client.onStart((data) => {
      console.log('🎬 Asemic generation started:', data)
    })

    client.onStop((data) => {
      console.log('⏹️ Asemic generation stopped:', data)
    })

    client.onParam((data) => {
      console.log('⚙️ Parameter update:', data)
    })

    client.onReset((data) => {
      console.log('🔄 Asemic reset:', data)
    })

    checkConnection()

    return () => {
      client.disconnect()
    }
  }, [])

  const sendTestMessage = useCallback((address: string, ...args: any[]) => {
    if (oscClient) {
      oscClient.send(address, ...args)
    }
  }, [oscClient])

  const sendAsemicStart = useCallback(() => {
    if (oscClient) {
      oscClient.sendStart('test-session', Date.now())
    }
  }, [oscClient])

  const sendAsemicStop = useCallback(() => {
    if (oscClient) {
      oscClient.sendStop()
    }
  }, [oscClient])

  const sendAsemicParam = useCallback((param: string, value: any) => {
    if (oscClient) {
      oscClient.sendParam(param, value)
    }
  }, [oscClient])

  const sendAsemicReset = useCallback(() => {
    if (oscClient) {
      oscClient.sendReset()
    }
  }, [oscClient])

  return (
    <div className={`osc-controller bg-gray-100 p-6 rounded-lg ${className}`}>
      <div className="mb-4">
        <h3 className="text-lg font-semibold mb-2">OSC Controller</h3>
        <div className="flex items-center gap-2">
          <div className={`w-3 h-3 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`}></div>
          <span className="text-sm text-gray-600">
            {isConnected ? 'Connected to OSC Server' : 'Disconnected'}
          </span>
        </div>
      </div>

      {/* Control Buttons */}
      <div className="grid grid-cols-2 gap-2 mb-4">
        <button
          onClick={sendAsemicStart}
          className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600 transition-colors"
        >
          Start Asemic
        </button>
        <button
          onClick={sendAsemicStop}
          className="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600 transition-colors"
        >
          Stop Asemic
        </button>
        <button
          onClick={() => sendAsemicParam('speed', Math.random())}
          className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
        >
          Random Speed
        </button>
        <button
          onClick={sendAsemicReset}
          className="px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600 transition-colors"
        >
          Reset
        </button>
      </div>

      {/* Custom OSC Message Sender */}
      <div className="mb-4">
        <h4 className="text-md font-medium mb-2">Send Custom OSC Message</h4>
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="/custom/address"
            className="flex-1 px-3 py-2 border rounded"
            onKeyPress={(e) => {
              if (e.key === 'Enter') {
                const target = e.target as HTMLInputElement
                sendTestMessage(target.value, 'test', Math.random())
                target.value = ''
              }
            }}
          />
          <button
            onClick={(e) => {
              const input = (e.target as HTMLElement).previousElementSibling as HTMLInputElement
              if (input.value) {
                sendTestMessage(input.value, 'test', Math.random())
                input.value = ''
              }
            }}
            className="px-4 py-2 bg-purple-500 text-white rounded hover:bg-purple-600 transition-colors"
          >
            Send
          </button>
        </div>
      </div>

      {/* Last Message Display */}
      {lastMessage && (
        <div className="mb-4">
          <h4 className="text-md font-medium mb-2">Last Message</h4>
          <div className="bg-white p-3 rounded border text-sm font-mono">
            <div><strong>Type:</strong> {lastMessage.type}</div>
            {lastMessage.address && <div><strong>Address:</strong> {lastMessage.address}</div>}
            <div><strong>Data:</strong> {JSON.stringify(lastMessage.data)}</div>
          </div>
        </div>
      )}

      {/* Message History */}
      <div>
        <h4 className="text-md font-medium mb-2">Recent Messages</h4>
        <div className="bg-white rounded border max-h-40 overflow-y-auto">
          {messages.length === 0 ? (
            <div className="p-3 text-gray-500 text-sm">No messages yet...</div>
          ) : (
            messages.map((msg, index) => (
              <div key={index} className="p-2 border-b last:border-b-0 text-xs font-mono">
                <span className="text-blue-600">{msg.type}</span>
                {msg.address && <span className="text-purple-600 ml-2">{msg.address}</span>}
                <span className="text-gray-600 ml-2">{JSON.stringify(msg.data)}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

export default OSCController
