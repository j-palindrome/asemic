import { useEffect, useRef, useState } from 'react'

export interface WebRTCStreamState {
  isConnected: boolean
  connectionState: RTCPeerConnectionState | null
  offer: RTCSessionDescriptionInit | null
}

export const useWebRTCStream = (canvas: React.RefObject<HTMLCanvasElement>) => {
  const pcRef = useRef<RTCPeerConnection | null>(null)
  const [state, setState] = useState<WebRTCStreamState>({
    isConnected: false,
    connectionState: null,
    offer: null
  })

  // Initialize WebRTC connection
  useEffect(() => {
    if (!canvas.current) return

    const initWebRTC = async () => {
      try {
        // Create peer connection
        const pc = new RTCPeerConnection({
          iceServers: [
            { urls: ['stun:stun.l.google.com:19302'] },
            { urls: ['stun:stun1.l.google.com:19302'] }
          ]
        })

        // Capture canvas stream at 30 FPS
        const canvasStream = canvas.current!.captureStream(30)

        // Add video track to peer connection
        canvasStream.getTracks().forEach(track => {
          pc.addTrack(track, canvasStream)
        })

        // Handle connection state changes
        pc.onconnectionstatechange = () => {
          setState(prev => ({
            ...prev,
            connectionState: pc.connectionState as RTCPeerConnectionState,
            isConnected: pc.connectionState === 'connected'
          }))
        }

        // Handle ICE candidates
        pc.onicecandidate = event => {
          if (event.candidate) {
            console.log('ICE candidate:', event.candidate)
          }
        }

        // Handle connection errors
        pc.onicecandidateerror = event => {
          console.error('WebRTC error:', event)
        }

        pcRef.current = pc
      } catch (error) {
        console.error('Failed to initialize WebRTC:', error)
      }
    }

    initWebRTC()

    return () => {
      if (pcRef.current) {
        pcRef.current.getSenders().forEach(sender => {
          if (sender.track) {
            sender.track.stop()
          }
        })
        pcRef.current.close()
        pcRef.current = null
      }
    }
  }, [canvas])

  // Create SDP offer for signaling
  const createOffer = async () => {
    if (!pcRef.current) {
      console.error('Peer connection not initialized')
      return null
    }

    try {
      const offer = await pcRef.current.createOffer({
        offerToReceiveAudio: false,
        offerToReceiveVideo: true
      })
      await pcRef.current.setLocalDescription(offer)
      setState(prev => ({ ...prev, offer }))
      return offer
    } catch (error) {
      console.error('Failed to create offer:', error)
      return null
    }
  }

  // Handle SDP answer from remote peer
  const handleAnswer = async (answer: RTCSessionDescriptionInit) => {
    if (!pcRef.current) {
      console.error('Peer connection not initialized')
      return false
    }

    try {
      await pcRef.current.setRemoteDescription(
        new RTCSessionDescription(answer)
      )
      return true
    } catch (error) {
      console.error('Failed to handle answer:', error)
      return false
    }
  }

  // Add ICE candidate from remote peer
  const addIceCandidate = async (candidate: RTCIceCandidate) => {
    if (!pcRef.current) {
      console.error('Peer connection not initialized')
      return false
    }

    try {
      await pcRef.current.addIceCandidate(candidate)
      return true
    } catch (error) {
      console.error('Failed to add ICE candidate:', error)
      return false
    }
  }

  return {
    state,
    createOffer,
    handleAnswer,
    addIceCandidate,
    peerConnection: pcRef.current
  }
}
