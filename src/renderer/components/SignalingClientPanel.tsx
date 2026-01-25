interface WebSocketClient {
  id: string
  address: string
  properties?: Record<string, unknown>
}

interface SignalingClientPanelProps {
  clients: WebSocketClient[]
  address: string
  port: number | string
  connectedToServer: boolean
  signalingClient: {
    open: (address: string, port: number | string) => void
    close: () => void
  }
  webRTCConnection: {
    onCallStart: (address: string, properties?: Record<string, unknown>) => void
    onCallEnd: () => void
  }
  setPortHandler: (port: string) => void
  setAddressHandler: (address: string) => void
}

export function SignalingClientPanel(props: SignalingClientPanelProps) {
  const {
    clients,
    address,
    port,
    connectedToServer,
    signalingClient,
    webRTCConnection,
    setPortHandler,
    setAddressHandler
  } = props

  const handleAddressChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    console.log('Signaling Host Address was changed')
    setAddressHandler(event.target.value)
  }

  const handlePortChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    console.log('Signaling Host Port was changed')
    setPortHandler(event.target.value)
  }

  return (
    <div
      id='tdSignaling'
      className='fixed top-4 right-4 w-96 bg-gray-800 border border-gray-700 rounded-lg shadow-lg p-4 z-100 max-h-[90vh] overflow-y-auto select-text'>
      <h2 className='text-xl font-bold mb-4 text-white'>
        Signaling server settings
      </h2>

      <h3 className='text-lg font-semibold mt-4 mb-2 text-white'>IP Address</h3>
      <input
        type='text'
        id='address'
        placeholder='Address'
        defaultValue={address}
        disabled={connectedToServer}
        onChange={handleAddressChange}
        className='w-full px-3 py-2 border border-gray-600 rounded-md bg-gray-700 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-600 disabled:cursor-not-allowed'
      />

      <h3 className='text-lg font-semibold mt-4 mb-2 text-white'>Port</h3>
      <input
        type='text'
        id='port'
        placeholder='Port'
        defaultValue={port}
        disabled={connectedToServer}
        onChange={handlePortChange}
        className='w-full px-3 py-2 border border-gray-600 rounded-md bg-gray-700 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-600 disabled:cursor-not-allowed'
      />

      <button
        id='btnConnect'
        disabled={connectedToServer}
        onClick={() => signalingClient.open(address, port)}
        className='w-full mt-4 px-4 py-2 bg-blue-600 text-white rounded-md font-semibold hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors'>
        Connect
      </button>

      <button
        id='btnDisconnect'
        disabled={!connectedToServer}
        onClick={() => signalingClient.close()}
        className='w-full mt-2 px-4 py-2 bg-red-600 text-white rounded-md font-semibold hover:bg-red-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors'>
        Disconnect
      </button>

      <h4 className='text-base font-semibold mt-4 text-white'>
        Connected to server:{' '}
        <span className={connectedToServer ? 'text-green-400' : 'text-red-400'}>
          {connectedToServer ? 'Yes' : 'No'}
        </span>
      </h4>

      <hr className='my-4 border-gray-700' />

      <div id='tdSignalingList'>
        <h3 className='text-lg font-semibold mb-3 text-white'>
          Signaling clients list
        </h3>
        <div className='clients space-y-2'>
          {clients.map(wsClient => {
            const { id, address: clientAddress, properties } = wsClient

            return (
              <div
                key={id}
                className='flex items-center gap-2 p-3 border border-gray-600 rounded-md bg-gray-700'>
                <div className='flex-1 min-w-0'>
                  <p className='text-sm font-semibold text-white truncate'>
                    {clientAddress}
                  </p>
                  <p className='text-xs text-gray-400 truncate'>{id}</p>
                </div>
                <button
                  onClick={() =>
                    webRTCConnection.onCallStart(clientAddress, properties)
                  }
                  className='px-3 py-1 bg-green-600 text-white text-sm rounded-md hover:bg-green-700 transition-colors whitespace-nowrap'>
                  Start
                </button>
                <button
                  onClick={() => webRTCConnection.onCallEnd()}
                  className='px-3 py-1 bg-red-600 text-white text-sm rounded-md hover:bg-red-700 transition-colors whitespace-nowrap'>
                  End
                </button>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
