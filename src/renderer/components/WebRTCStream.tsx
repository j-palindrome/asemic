import { useEffect, useRef, useState } from 'react'
import SignalingClient from '../utils/signalingClient'
import WebRTCConnection from '../utils/webRTCConnection'
import { GlobalSettings } from './SceneSettingsPanel'
import { ad } from 'node_modules/react-router/dist/development/context-jKip1TFB.mjs'

export default function WebRTCStream({
  settings,
  setSettings
}: {
  settings: GlobalSettings
  setSettings: (settings: GlobalSettings) => void
}) {
  const port = settings.webRTC?.port
  const address = settings.webRTC?.host
  const [clients, setWebSocketClients] = useState([])
  const [connectedToServer, setConnectedToServer] = useState(false)
  const [signalingClient, setSignalingClient] =
    useState<SignalingClient | null>(null)
  const [webRTCConnection, setWebRTCConnection] =
    useState<WebRTCConnection | null>(null)

  /************************************************************************
   * React app rendering
   */
  // We need to use the useEffect hook in order to not open a ws at every refresh
  useEffect(() => {
    if (!address || !port) return
    // Instantiate Websocket and bing its handlers
    try {
      let signalingClient = new SignalingClient(
        address,
        port,
        setWebSocketClients,
        setConnectedToServer
      )
      let webRTCConnection = new WebRTCConnection(signalingClient)

      setSignalingClient(signalingClient)
      setWebRTCConnection(webRTCConnection)
      // Disconnect when done
      return () => {
        // Close websocket
        signalingClient.close()
      }
    } catch (error) {
      console.error('Failed to connect to signaling server:', error)
    }
  }, [address, port])

  const handleAddressChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    console.log('Signaling Host Address was changed')
    setSettings({
      ...settings,
      webRTC: {
        ...settings.webRTC,
        host: event.target.value
      }
    })
  }

  const handlePortChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    console.log('Signaling Host Port was changed')
    setSettings({
      ...settings,
      webRTC: {
        ...settings.webRTC,
        port: parseInt(event.target.value)
      }
    })
  }

  return (
    <>
      <div className='space-y-3'>
        <div className='bg-white/5 p-2 rounded border border-white/10 hover:bg-black/50 hover:backdrop-blur-sm'>
          <h2 className='text-white/70 text-sm font-semibold mb-3'>
            Signaling Server Settings
          </h2>
          <div className='flex w-full gap-3'>
            <div className='flex-1'>
              <label className='text-white/50 text-xs block mb-1'>
                IP Address
              </label>
              <input
                type='text'
                id='address'
                placeholder='Address'
                defaultValue={address}
                disabled={connectedToServer}
                onChange={handleAddressChange}
                className='w-full bg-white/10 text-white px-2 py-1 rounded text-xs border border-white/20 placeholder-white/30 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-white/5 disabled:cursor-not-allowed'
              />
            </div>

            <div className='flex-1'>
              <label className='text-white/50 text-xs block mb-1'>Port</label>
              <input
                type='text'
                id='port'
                placeholder='Port'
                defaultValue={port}
                disabled={connectedToServer}
                onChange={handlePortChange}
                className='w-full bg-white/10 text-white px-2 py-1 rounded text-xs border border-white/20 placeholder-white/30 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-white/5 disabled:cursor-not-allowed'
              />
            </div>
            <div className='flex flex-col justify-end gap-2'>
              <button
                id='btnConnect'
                disabled={connectedToServer}
                onClick={() => signalingClient!.open(address, port)}
                className='px-2 py-1 bg-blue-500 text-white rounded text-xs font-medium hover:bg-blue-600 disabled:bg-white/10 disabled:text-white/30 disabled:cursor-not-allowed transition-colors'>
                Connect
              </button>

              <button
                id='btnDisconnect'
                disabled={!connectedToServer}
                onClick={() => signalingClient!.close()}
                className='px-2 py-1 bg-red-500 text-white rounded text-xs font-medium hover:bg-red-600 disabled:bg-white/10 disabled:text-white/30 disabled:cursor-not-allowed transition-colors'>
                Disconnect
              </button>
            </div>
          </div>

          <div className='mt-3 pt-3 border-t border-white/10'>
            <p className='text-white/70 text-xs'>
              Connected to server:{' '}
              <span
                className={
                  connectedToServer ? 'text-green-400' : 'text-red-400'
                }>
                {connectedToServer ? 'Yes' : 'No'}
              </span>
            </p>
          </div>
        </div>
      </div>
    </>
  )
}
