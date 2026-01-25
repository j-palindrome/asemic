import { useEffect, useRef, useState } from 'react'
import SignalingClient from '../utils/signalingClient'
import WebRTCConnection from '../utils/webRTCConnection'
import { SignalingClientPanel } from './SignalingClientPanel'

export default function WebRTCStream({ roomId }: { roomId: string | null }) {
  const [port, setPort] = useState(9980)
  const [address, setAddress] = useState('ws://127.0.0.1')
  const [webSocketClients, setWebSocketClients] = useState([])
  const [connectedToServer, setConnectedToServer] = useState(false)
  const [mouseDataChannel, setMouseDataChannel] = useState()
  const [keyboardDataChannel, setKeyboardDataChannel] = useState()
  const [signalingClient, setSignalingClient] = useState()
  const [webRTCConnection, setWebRTCConnection] = useState()

  /************************************************************************
   * React app rendering
   */
  // We need to use the useEffect hook in order to not open a ws at every refresh
  useEffect(() => {
    // Instantiate Websocket and bing its handlers
    let signalingClient = new SignalingClient(
      address,
      port,
      setWebSocketClients,
      setConnectedToServer
    )
    let webRTCConnection = new WebRTCConnection(
      signalingClient,
      setMouseDataChannel,
      setKeyboardDataChannel
    )

    setSignalingClient(signalingClient)
    setWebRTCConnection(webRTCConnection)

    // Disconnect when done
    return () => {
      // Close websocket
      signalingClient.close()
    }
  }, [])

  return (
    <SignalingClientPanel
      clients={webSocketClients}
      address={address}
      port={port}
      connectedToServer={connectedToServer}
      signalingClient={signalingClient}
      webRTCConnection={webRTCConnection}
      setPortHandler={setPort}
      setAddressHandler={setAddress}
    />
  )
}
