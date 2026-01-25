import { useEffect, useRef, useState } from 'react'
import SignalingClient from '../utils/signalingClient'
import WebRTCConnection from '../utils/webRTCConnection'

export interface WebRTCStreamState {
  isConnected: boolean
  connectionState: RTCPeerConnectionState | null
  clients: Array<{
    id: number
    address: string
    properties: Record<string, any>
  }>
  connectedToServer: boolean
}

export const useWebRTCStream = (
  canvas: React.RefObject<HTMLCanvasElement>,
  config?: { signalingAddress?: string; signalingPort?: number }
) => {
  const signalingClientRef = useRef<SignalingClient | null>(null)
  const webRTCConnectionRef = useRef<WebRTCConnection | null>(null)

  const [state, setState] = useState<WebRTCStreamState>({
    isConnected: false,
    connectionState: null,
    clients: [],
    connectedToServer: false
  })

  const [mouseDataChannel, setMouseDataChannel] =
    useState<RTCDataChannel | null>(null)
  const [keyboardDataChannel, setKeyboardDataChannel] =
    useState<RTCDataChannel | null>(null)

  const signalingAddress = config?.signalingAddress || 'wss://127.0.0.1'
  const signalingPort = config?.signalingPort || 443

  // Initialize WebRTC and Signaling
  useEffect(() => {
    if (!canvas.current) return

    try {
      // Create signaling client
      const signalingClient = new SignalingClient(
        signalingAddress,
        signalingPort,
        (clients: any[]) => {
          setState(prev => ({ ...prev, clients }))
        },
        (connected: boolean) => {
          setState(prev => ({ ...prev, connectedToServer: connected }))
        }
      )

      // Create WebRTC connection
      const webRTCConnection = new WebRTCConnection(
        signalingClient,
        (channel: RTCDataChannel) => {
          setMouseDataChannel(channel)
        },
        (channel: RTCDataChannel) => {
          setKeyboardDataChannel(channel)
        }
      )

      signalingClientRef.current = signalingClient
      webRTCConnectionRef.current = webRTCConnection

      // Monitor connection state
      const stateCheckInterval = setInterval(() => {
        const pc = webRTCConnection.getPeerConnection()
        if (pc) {
          setState(prev => ({
            ...prev,
            connectionState: webRTCConnection.getConnectionState(),
            isConnected: webRTCConnection.isConnected()
          }))
        }
      }, 500)

      return () => {
        clearInterval(stateCheckInterval)
        signalingClient.close()
      }
    } catch (error) {
      console.error('Failed to initialize WebRTC:', error)
    }
  }, [canvas, signalingAddress, signalingPort])

  // Add canvas stream to peer connection
  const addCanvasStream = async (fps: number = 30) => {
    if (!canvas.current || !webRTCConnectionRef.current) {
      console.error('Canvas or WebRTC connection not available')
      return false
    }

    try {
      const pc = webRTCConnectionRef.current.getPeerConnection()
      if (!pc) {
        console.error('Peer connection not initialized')
        return false
      }

      const canvasStream = canvas.current.captureStream(fps)
      canvasStream.getTracks().forEach(track => {
        pc.addTrack(track, canvasStream)
      })

      return true
    } catch (error) {
      console.error('Failed to add canvas stream:', error)
      return false
    }
  }

  // Initiate call with a remote client
  const initiateCall = (
    targetAddress: string,
    properties: Record<string, any>
  ) => {
    if (!webRTCConnectionRef.current) {
      console.error('WebRTC connection not initialized')
      return false
    }

    try {
      webRTCConnectionRef.current.onCallStart(targetAddress, properties)
      addCanvasStream()
      return true
    } catch (error) {
      console.error('Failed to initiate call:', error)
      return false
    }
  }

  // End current call
  const endCall = () => {
    if (!webRTCConnectionRef.current) return

    webRTCConnectionRef.current.onCallEnd()
  }

  return {
    state,
    signalingClient: signalingClientRef.current,
    webRTCConnection: webRTCConnectionRef.current,
    mouseDataChannel,
    keyboardDataChannel,
    addCanvasStream,
    initiateCall,
    endCall
  }
}
