import type SignalingClient from './signalingClient'

interface SDPCandidate {
  candidate: string
  sdpMLineIndex: number
  sdpMid: string
}

interface Message {
  metadata: {
    apiVersion: string
    compVersion: string
    compOrigin: string
    projectName: string
  }
  signalingType: string
  sender?: string | null
  target?: string
  content: Record<string, any>
}

/**
 * WebRTC Connection Manager
 * Uses Mozilla's Perfect Negotiation pattern
 * https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Perfect_negotiation
 */
class WebRTCConnection {
  private signalingClient: SignalingClient
  private reactSetMouseDataChannelHandler: (channel: RTCDataChannel) => void
  private reactSetKeyboardDataChannelHandler: (channel: RTCDataChannel) => void
  private peerConnection: RTCPeerConnection | null = null
  private mouseDataChannel: RTCDataChannel | null = null
  private keyboardDataChannel: RTCDataChannel | null = null
  private target: string | null = null

  // Perfect negotiation state
  private polite = false
  private makingOffer = false
  private ignoreOffer = false
  private isSettingRemoteAnswerPending = false

  private mediaConstraints = {
    audio: true,
    video: true
  }

  constructor(
    signalingClient: SignalingClient,
    reactSetMouseDataChannelHandler: (channel: RTCDataChannel) => void,
    reactSetKeyboardDataChannelHandler: (channel: RTCDataChannel) => void
  ) {
    this.signalingClient = signalingClient
    this.signalingClient.setWebRTCConnection(this)
    this.reactSetMouseDataChannelHandler = reactSetMouseDataChannelHandler
    this.reactSetKeyboardDataChannelHandler = reactSetKeyboardDataChannelHandler
  }

  private createPeerConnection() {
    this.peerConnection = new RTCPeerConnection({
      iceServers: [
        {
          urls: 'stun:stun.l.google.com:19302'
        }
      ]
    })

    // Assign event handlers to the peerConnection
    this.peerConnection.onconnectionstatechange =
      this.handleConnectionStateChange.bind(this)
    this.peerConnection.ondatachannel = this.handleDataChannel.bind(this)
    this.peerConnection.onicecandidate = this.handleIceCandidate.bind(this)
    this.peerConnection.onicecandidateerror =
      this.handleIceCandidateError.bind(this)
    this.peerConnection.oniceconnectionstatechange =
      this.handleIceConnectionStateChange.bind(this)
    this.peerConnection.onicegatheringstatechange =
      this.handleIceGatheringStateChange.bind(this)
    this.peerConnection.onnegotiationneeded =
      this.handleNegotiationNeeded.bind(this)
    this.peerConnection.onsignalingstatechange =
      this.handleSignalingStateChange.bind(this)
    this.peerConnection.ontrack = this.handleTrack.bind(this)

    // Create data channels
    this.mouseDataChannel = this.peerConnection.createDataChannel('MouseData')
    this.reactSetMouseDataChannelHandler(this.mouseDataChannel)

    this.keyboardDataChannel =
      this.peerConnection.createDataChannel('KeyboardData')
    this.reactSetKeyboardDataChannelHandler(this.keyboardDataChannel)
  }

  private deletePeerConnection() {
    if (this.peerConnection) {
      // Clean up event handlers
      this.peerConnection.onconnectionstatechange = null
      this.peerConnection.ondatachannel = null
      this.peerConnection.onicecandidate = null
      this.peerConnection.onicecandidateerror = null
      this.peerConnection.oniceconnectionstatechange = null
      this.peerConnection.onicegatheringstatechange = null
      this.peerConnection.onnegotiationneeded = null
      this.peerConnection.onsignalingstatechange = null
      this.peerConnection.ontrack = null

      // Close data channels
      if (this.mouseDataChannel) {
        this.mouseDataChannel.close()
      }
      if (this.keyboardDataChannel) {
        this.keyboardDataChannel.close()
      }

      // Close peer connection
      this.peerConnection.close()
      this.peerConnection = null
    }

    this.mouseDataChannel = null
    this.keyboardDataChannel = null
  }

  onCallStart(address: string, properties: Record<string, any>) {
    this.target = address

    // For polite WebRTC negotiation, ensure this peer has not been there longer
    this.polite =
      this.signalingClient.properties.timeJoined < properties.timeJoined

    this.createPeerConnection()

    // Add transceiver for video receiving
    if (this.peerConnection) {
      this.peerConnection.addTransceiver('video', { direction: 'recvonly' })
    }
  }

  onCallEnd() {
    this.deletePeerConnection()
  }

  private handleConnectionStateChange(event: Event) {
    console.log('[WEBRTC] Connection State Change:', event)
    if (
      this.peerConnection &&
      this.peerConnection.connectionState === 'disconnected'
    ) {
      this.deletePeerConnection()
    }
  }

  private handleDataChannel(event: RTCDataChannelEvent) {
    console.log('[WEBRTC] RTCDataChannel Event:', event)
  }

  private handleIceCandidate(event: any) {
    console.log('[WEBRTC] New ICE Candidate:', event)
    if (event.candidate && this.target) {
      this.onMessageSendingIce(
        this.target,
        event.candidate.candidate,
        event.candidate.sdpMLineIndex ?? -1,
        event.candidate.sdpMid ?? ''
      )
    }
  }

  private handleIceCandidateError(event: Event) {
    console.log('[WEBRTC] ICE Candidate Error:', event)
  }

  private handleIceConnectionStateChange(event: Event) {
    if (!this.peerConnection) return

    switch (this.peerConnection.iceConnectionState) {
      case 'failed':
        console.log('[WEBRTC] ICE Connection failed, restarting...')
        this.peerConnection.restartIce()
        break
      default:
        console.log(
          '[WEBRTC] ICE Connection state:',
          this.peerConnection.iceConnectionState
        )
    }
  }

  private handleIceGatheringStateChange(event: Event) {
    console.log('[WEBRTC] ICE Gathering state changed:', event)
  }

  private async handleNegotiationNeeded(event: Event) {
    console.log('[WEBRTC] Negotiation needed:', event)

    if (!this.peerConnection) return

    if (this.peerConnection.signalingState === 'have-remote-offer') {
      console.log('[WEBRTC] Already have a remote offer, exiting.')
      return
    }

    if (this.makingOffer) {
      console.log('[WEBRTC] Already making an offer, exiting.')
      return
    }

    try {
      this.makingOffer = true
      await this.peerConnection.setLocalDescription()

      if (this.target) {
        this.onMessageSendingOffer(
          this.target,
          this.peerConnection.localDescription?.sdp || ''
        )
      }
    } catch (err) {
      console.error('[WEBRTC] Error in negotiation:', err)
    } finally {
      this.makingOffer = false
    }
  }

  private handleSignalingStateChange(event: Event) {
    if (this.peerConnection) {
      console.log(
        '[WEBRTC] Signaling State Change:',
        this.peerConnection.signalingState
      )
    }
  }

  private handleTrack(event: RTCTrackEvent) {
    console.log('[WEBRTC] New Track Event:', event)
  }

  // Message handlers

  onMessageReceived(messageObj: Message) {
    const fnName = 'onMessageReceived' + messageObj.signalingType
    const fnToCall = this[fnName as keyof WebRTCConnection] as
      | ((msg: Message) => void)
      | undefined

    if (typeof fnToCall === 'function') {
      fnToCall.call(this, messageObj)
    } else {
      console.log('[WEBRTC] Function not implemented:', fnName)
    }
  }

  private onMessageReceivedOffer(messageObj: Message) {
    console.log('[WEBRTC] Offer received:', messageObj)

    if (!this.peerConnection) {
      this.createPeerConnection()
    }

    if (!this.peerConnection) return

    const readyForOffer =
      !this.makingOffer &&
      (this.peerConnection.signalingState === 'stable' ||
        this.isSettingRemoteAnswerPending)
    const offerCollision = !readyForOffer

    const ignoreOffer = !this.polite && offerCollision
    if (ignoreOffer) {
      console.log(
        '[WEBRTC] Potential collision found. Ignoring offer to avoid collision.'
      )
      return
    }

    this.target = messageObj.sender || null

    this.peerConnection
      .setRemoteDescription({
        type: 'offer',
        sdp: messageObj.content.sdp
      })
      .then(() => {
        return this.peerConnection!.createAnswer()
      })
      .then(answer => {
        return this.peerConnection!.setLocalDescription(answer)
      })
      .then(() => {
        if (this.target) {
          this.onMessageSendingAnswer(
            this.target,
            this.peerConnection!.localDescription?.sdp || ''
          )
        }
      })
      .catch(error => {
        console.error('[WEBRTC] Error handling offer:', error)
      })
  }

  private onMessageReceivedAnswer(messageObj: Message) {
    console.log('[WEBRTC] Answer received:', messageObj)

    if (!this.peerConnection) return

    this.isSettingRemoteAnswerPending = true
    this.peerConnection
      .setRemoteDescription({
        type: 'answer',
        sdp: messageObj.content.sdp
      })
      .then(() => {
        this.isSettingRemoteAnswerPending = false
      })
      .catch(error => {
        console.error('[WEBRTC] Error handling answer:', error)
        this.isSettingRemoteAnswerPending = false
      })
  }

  private onMessageReceivedIce(messageObj: Message) {
    console.log('[WEBRTC] New ICE Candidate received:', messageObj)

    if (!this.peerConnection) return

    const candidate = new RTCIceCandidate({
      candidate: messageObj.content.sdpCandidate,
      sdpMLineIndex: messageObj.content.sdpMLineIndex,
      sdpMid: messageObj.content.sdpMid
    })

    this.peerConnection.addIceCandidate(candidate).catch(error => {
      console.error('[WEBRTC] Error adding ICE candidate:', error)
    })
  }

  // Message sending

  private onMessageSendingOffer(target: string, sdp: string) {
    const msg: Message = {
      metadata: {
        apiVersion: '1.0.1',
        compVersion: '1.0.1',
        compOrigin: 'WebRTC',
        projectName: 'asemic'
      },
      signalingType: 'Offer',
      sender: null,
      target: target,
      content: {
        sdp
      }
    }

    console.log('[WEBRTC] Sending offer:', msg)
    this.signalingClient.send(msg)
    this.makingOffer = false
  }

  private onMessageSendingAnswer(target: string, sdp: string) {
    const msg: Message = {
      metadata: {
        apiVersion: '1.0.1',
        compVersion: '1.0.1',
        compOrigin: 'WebRTC',
        projectName: 'asemic'
      },
      signalingType: 'Answer',
      sender: null,
      target: target,
      content: {
        sdp
      }
    }

    console.log('[WEBRTC] Sending answer:', msg)
    this.signalingClient.send(msg)
  }

  private onMessageSendingIce(
    target: string,
    sdpCandidate: string,
    sdpMLineIndex: number,
    sdpMid: string
  ) {
    const msg: Message = {
      metadata: {
        apiVersion: '1.0.1',
        compVersion: '1.0.1',
        compOrigin: 'WebRTC',
        projectName: 'asemic'
      },
      signalingType: 'Ice',
      sender: null,
      target: target,
      content: {
        sdpCandidate,
        sdpMLineIndex,
        sdpMid
      }
    }

    console.log('[WEBRTC] Sending ICE candidate:', msg)
    this.signalingClient.send(msg)
  }

  // Accessors for UI state

  getPeerConnection(): RTCPeerConnection | null {
    return this.peerConnection
  }

  getConnectionState(): RTCPeerConnectionState | null {
    return this.peerConnection?.connectionState || null
  }

  isConnected(): boolean {
    return this.peerConnection?.connectionState === 'connected'
  }
}

export default WebRTCConnection
