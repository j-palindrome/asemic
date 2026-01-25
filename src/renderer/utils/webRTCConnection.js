class WebRTCConnection {
  constructor(
    signalingClient,
    reactSetMouseDataChannelHandler,
    reactSetKeyboardDataChannelHandler
  ) {
    this.signalingClient = signalingClient
    // Ensure signaling client has access to this instance to delegate messages
    this.signalingClient.setWebRTCConnection(this)

    this.reactSetMouseDataChannelHandler = reactSetMouseDataChannelHandler
    this.reactSetKeyboardDataChannelHandler = reactSetKeyboardDataChannelHandler

    this.mediaConstraints = {
      audio: true,
      video: true
    }
    // Perfect negotiation specific
    this.polite = false
    this.makingOffer = false
    this.ignoreOffer = false
    this.isSettingRemoteAnswerPending = false

    // Connection state tracking
    this.peerConnection = null
    this.connectionState = 'disconnected'
    this.iceConnectionState = 'new'
    this.iceGatheringState = 'new'
    this.signalingState = 'stable'

    this.onMessageReceivedIce.bind(this)
  }

  createPeerConnection() {
    console.log('[WEBRTC] Creating peer connection...')

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
    this.peerConnection.onremovetrack = this.handleRemoveTrack.bind(this)

    console.log('[WEBRTC] ✓ Peer connection created')
  }

  deletePeerConnection() {
    // No need to remove handlers, is this linked to exemples?
    if (this.peerConnection) {
      this.peerConnection.onconnectionstatechange = null
      this.peerConnection.ondatachannel = null
      this.peerConnection.onicecandidate = null
      this.peerConnection.onicecandidateerror = null
      this.peerConnection.oniceconnectionstatechange = null
      this.peerConnection.onicegatheringstatechange = null
      this.peerConnection.onnegotiationneeded = null
      this.peerConnection.onsignalingstatechange = null
      this.peerConnection.ontrack = null
      this.peerConnection.removeTrack = null

      this.peerConnection.close()
    }
  }

  onCallStart(address, properties) {
    // Assign the remote address as a target reference
    this.target = address

    // For polite WebRTC negotiation, we need to make sure the webapp has not been there longer than the remote client
    this.polite =
      this.signalingClient.properties.timeJoined < properties.timeJoined

    this.createPeerConnection()

    // Capture canvas and add video track
    const canvas = document.getElementById('mainCanvas')
    if (canvas) {
      try {
        const canvasStream = canvas.captureStream(30) // 30 FPS
        const videoTrack = canvasStream.getVideoTracks()[0]
        if (videoTrack) {
          this.peerConnection.addTrack(videoTrack)
          console.log('[WEBRTC] ✓ Canvas video track added')
        } else {
          console.error('[WEBRTC] Failed to get video track from canvas')
        }
      } catch (error) {
        console.error('[WEBRTC] Error capturing canvas:', error)
      }
    } else {
      console.error('[WEBRTC] mainCanvas element not found')
    }
  }

  onCallEnd() {
    this.deletePeerConnection()
  }

  handleConnectionStateChange(event) {
    const newState = event.target.connectionState
    console.log('[WEBRTC] Connection State Change: ', newState)
    this.connectionState = newState

    switch (newState) {
      case 'connected':
        console.log('[WEBRTC] ✓ Peer connection established - media flowing')
        break
      case 'disconnected':
        console.log('[WEBRTC] Connection disconnected')
        break
      case 'failed':
        console.log('[WEBRTC] Connection failed - attempting to restart ICE')
        if (this.peerConnection) {
          this.peerConnection.restartIce()
        }
        break
      case 'closed':
        console.log('[WEBRTC] Connection closed')
        this.deletePeerConnection()
        break
      default:
        console.log('[WEBRTC] Unhandled connection state:', newState)
    }
  }

  handleDataChannel(rtcDataChannelEvent) {
    console.log(
      '[WEBRTC] Data channel received:',
      rtcDataChannelEvent.channel.label
    )
    const channel = rtcDataChannelEvent.channel

    channel.onopen = () => {
      console.log('[WEBRTC] Data channel opened:', channel.label)
    }
    channel.onclose = () => {
      console.log('[WEBRTC] Data channel closed:', channel.label)
    }
    channel.onerror = event => {
      console.error('[WEBRTC] Data channel error:', channel.label, event)
    }
    channel.onmessage = event => {
      console.log(
        '[WEBRTC] Message received on',
        channel.label,
        ':',
        event.data
      )
    }
  }

  handleIceCandidate(event) {
    console.log('[WEBRTC] ICE Candidate Event:', event)

    if (event.candidate) {
      console.log(`[WEBRTC] → Sending ICE candidate to ${this.target}`)
      this.onMessageSendingIce(
        this.target,
        event.candidate.candidate,
        event.candidate.sdpMLineIndex,
        event.candidate.sdpMid
      )
    } else {
      console.log('[WEBRTC] ICE gathering complete')
    }
  }

  handleIceCandidateError(event) {
    console.log('[WEBRTC] ICE Candidate Error: ', event)
  }

  handleIceConnectionStateChange(event) {
    const newState = this.peerConnection.iceConnectionState
    console.log('[WEBRTC] ICE Connection State:', newState)
    this.iceConnectionState = newState

    switch (newState) {
      case 'new':
        console.log('[WEBRTC] ICE connection new - gathering candidates')
        break
      case 'checking':
        console.log(
          '[WEBRTC] ICE connection checking - testing candidate pairs'
        )
        break
      case 'connected':
        console.log('[WEBRTC] ✓ ICE connection established')
        break
      case 'completed':
        console.log('[WEBRTC] ✓ ICE connection completed')
        break
      case 'failed':
        console.log('[WEBRTC] ICE connection failed - restarting')
        if (this.peerConnection) {
          this.peerConnection.restartIce()
        }
        break
      case 'disconnected':
        console.log('[WEBRTC] ICE connection disconnected')
        break
      case 'closed':
        console.log('[WEBRTC] ICE connection closed')
        break
      default:
        console.log('[WEBRTC] Unknown ICE connection state:', newState)
    }
  }

  handleIceGatheringStateChange(event) {
    const newState = this.peerConnection.iceGatheringState
    console.log('[WEBRTC] ICE Gathering State:', newState)
    this.iceGatheringState = newState

    switch (newState) {
      case 'new':
        console.log('[WEBRTC] ICE gathering new')
        break
      case 'gathering':
        console.log('[WEBRTC] ICE candidates gathering in progress...')
        break
      case 'complete':
        console.log('[WEBRTC] ✓ ICE gathering complete')
        break
      default:
        console.log('[WEBRTC] Unknown ICE gathering state:', newState)
    }
  }

  handleNegotiationNeeded(event) {
    console.log('[WEBRTC] Negotiation needed')

    // Reject offer if we're not ready
    if (this.peerConnection.signalingState === 'have-remote-offer') {
      console.log('[WEBRTC] Already have remote offer, skipping negotiation')
      return
    }

    if (this.makingOffer) {
      console.log('[WEBRTC] Already making offer, skipping')
      return
    }

    try {
      this.makingOffer = true
      console.log('[WEBRTC] Creating offer...')
      this.peerConnection.setLocalDescription().then(() => {
        console.log('[WEBRTC] → Offer created, sending to', this.target)
        this.onMessageSendingOffer(
          this.target,
          this.peerConnection.localDescription.sdp
        )
      })
    } catch (err) {
      console.error('[WEBRTC] Error during negotiation:', err)
    } finally {
      this.makingOffer = false
    }
  }

  handleSignalingStateChange(event) {
    const newState = this.peerConnection.signalingState
    console.log('[WEBRTC] Signaling State Change:', newState)
    this.signalingState = newState

    switch (newState) {
      case 'stable':
        console.log('[WEBRTC] Signaling stable')
        break
      case 'have-local-offer':
        console.log('[WEBRTC] Created local offer - waiting for answer...')
        break
      case 'have-remote-offer':
        console.log('[WEBRTC] Received remote offer - creating answer...')
        break
      case 'have-local-pranswer':
        console.log('[WEBRTC] Provisional answer set locally')
        break
      case 'have-remote-pranswer':
        console.log('[WEBRTC] Provisional answer received')
        break
      case 'closed':
        console.log('[WEBRTC] Signaling closed')
        break
      default:
        console.log('[WEBRTC] Unknown signaling state:', newState)
    }
  }

  handleTrack(event) {
    console.log(
      '[WEBRTC] New track received:',
      event.track.kind,
      '-',
      event.track.label
    )
  }

  handleRemoveTrack(event) {
    console.log('[WEBRTC] Remove track event: ', event)
  }

  /*
    Signaling WebRTC Messages Specifics, Received
    */
  onMessageReceived(messageObj) {
    var fnName = 'onMessageReceived' + messageObj.signalingType
    var fnToCall = this[fnName].bind(this)

    if (fnToCall === undefined) {
      console.log('The function ' + fnName + ' is not implemented in WebRTC.')
    } else {
      fnToCall(messageObj)
    }
  }

  onMessageReceivedOffer(messageObj) {
    console.log('[WEBRTC] ← Received offer from', messageObj.sender)

    // Create peer connection if it doesn't exist
    if (this.peerConnection === null) {
      console.log('[WEBRTC] Creating peer connection')
      this.createPeerConnection()
    }

    // Check if we're ready to accept an offer (perfect negotiation)
    const readyForOffer =
      !this.makingOffer &&
      (this.peerConnection.signalingState === 'stable' ||
        this.isSettingRemoteAnswerPending)
    const offerCollision = !readyForOffer

    // Polite peer ignores offer in collision, impolite peer accepts
    const ignoreOffer = !this.polite && offerCollision
    if (ignoreOffer) {
      console.log(
        '[WEBRTC] Offer collision detected - ignoring offer (impolite peer)'
      )
      return
    }

    this.target = messageObj.sender
    console.log('[WEBRTC] Setting remote description (offer)...')

    // Set remote description and create answer
    this.peerConnection
      .setRemoteDescription({ type: 'offer', sdp: messageObj.content.sdp })
      .then(() => {
        console.log('[WEBRTC] Remote offer set - creating answer...')
        return this.peerConnection.createAnswer()
      })
      .then(answer => {
        console.log('[WEBRTC] Answer created - setting as local description...')
        return this.peerConnection.setLocalDescription(answer)
      })
      .then(() => {
        console.log('[WEBRTC] → Sending answer to', messageObj.sender)
        this.onMessageSendingAnswer(
          messageObj.sender,
          this.peerConnection.localDescription.sdp
        )
      })
      .catch(error => {
        console.error('[WEBRTC] Error processing offer:', error)
      })
  }

  onMessageReceivedAnswer(messageObj) {
    console.log('[WEBRTC] ← Received answer from', messageObj.sender)

    if (!this.peerConnection) {
      console.error('[WEBRTC] Error: No peer connection available for answer')
      return
    }

    this.isSettingRemoteAnswerPending = true
    console.log('[WEBRTC] Setting remote description (answer)...')

    this.peerConnection
      .setRemoteDescription({ type: 'answer', sdp: messageObj.content.sdp })
      .then(() => {
        console.log('[WEBRTC] ✓ Remote answer set successfully')
        this.isSettingRemoteAnswerPending = false
      })
      .catch(error => {
        console.error('[WEBRTC] Error setting remote answer:', error)
        this.isSettingRemoteAnswerPending = false
      })
  }

  onMessageReceivedIce(messageObj) {
    console.log('[WEBRTC] ← Received ICE candidate from', messageObj.sender)

    if (!this.peerConnection) {
      console.error(
        '[WEBRTC] Error: No peer connection available for ICE candidate'
      )
      return
    }

    const candidate = new RTCIceCandidate({
      candidate: messageObj.content.sdpCandidate,
      sdpMLineIndex: messageObj.content.sdpMLineIndex,
      sdpMid: messageObj.content.sdpMid
    })

    this.peerConnection
      .addIceCandidate(candidate)
      .then(() => {
        console.log('[WEBRTC] ✓ ICE candidate added successfully')
      })
      .catch(error => {
        console.error('[WEBRTC] Error adding ICE candidate:', error)
      })
  }

  onMessageSending(args) {
    console.log('[WEBRTC] Sending message:', args)
  }

  onMessageSendingOffer(target, sdp) {
    const msg = {
      metadata: {
        apiVersion: '1.0.1',
        compVersion: '1.0.1',
        compOrigin: 'WebRTC',
        projectName: 'TDWebRTCWebDemo'
      },
      signalingType: 'Offer',
      sender: null, // will be filled by server
      target: target,
      content: {
        sdp: sdp
      }
    }

    console.log('[WEBRTC] Sending offer to', target)
    console.log('[WEBRTC] Offer SDP:', sdp.substring(0, 100) + '...')

    try {
      this.signalingClient.webSocket.send(JSON.stringify(msg))
      console.log('[WEBRTC] ✓ Offer sent successfully')
    } catch (error) {
      console.error('[WEBRTC] Error sending offer:', error)
    }

    this.makingOffer = false
  }

  onMessageSendingAnswer(target, sdp) {
    const msg = {
      metadata: {
        apiVersion: '1.0.1',
        compVersion: '1.0.1',
        compOrigin: 'WebRTC',
        projectName: 'TDWebRTCWebDemo'
      },
      signalingType: 'Answer',
      sender: null, // will be filled by server
      target: target,
      content: {
        sdp: sdp
      }
    }

    console.log('[WEBRTC] Sending answer to', target)
    console.log('[WEBRTC] Answer SDP:', sdp.substring(0, 100) + '...')

    try {
      this.signalingClient.webSocket.send(JSON.stringify(msg))
      console.log('[WEBRTC] ✓ Answer sent successfully')
    } catch (error) {
      console.error('[WEBRTC] Error sending answer:', error)
    }
  }

  onMessageSendingIce(target, sdpCandidate, sdpMLineIndex, sdpMid) {
    const msg = {
      metadata: {
        apiVersion: '1.0.1',
        compVersion: '1.0.1',
        compOrigin: 'WebRTC',
        projectName: 'TDWebRTCWebDemo'
      },
      signalingType: 'Ice',
      sender: null, // will be filled by server
      target: target,
      content: {
        sdpCandidate: sdpCandidate,
        sdpMLineIndex: sdpMLineIndex,
        sdpMid: sdpMid
      }
    }

    console.log('[WEBRTC] Sending ICE candidate to', target)
    console.log('[WEBRTC] Candidate:', sdpCandidate.substring(0, 50) + '...')

    try {
      this.signalingClient.webSocket.send(JSON.stringify(msg))
    } catch (error) {
      console.error('[WEBRTC] Error sending ICE candidate:', error)
    }
  }

  /* 
    RTCDataChannels Specifics
    */
  onDataReceived(event) {
    console.log('[WEBRTC] RTCDataChannels event', event)
  }

  /**
   * Get current connection status
   * @returns {Object} Connection status object
   */
  getConnectionStatus() {
    return {
      connected: this.connectionState === 'connected',
      connectionState: this.connectionState,
      iceConnectionState: this.iceConnectionState,
      iceGatheringState: this.iceGatheringState,
      signalingState: this.signalingState,
      hasTarget: !!this.target,
      target: this.target
    }
  }

  /**
   * Get human-readable connection status string
   * @returns {String} Status description
   */
  getStatusString() {
    if (this.connectionState === 'connected') {
      return '✓ Connected'
    }
    if (this.connectionState === 'connecting') {
      return '⟳ Connecting...'
    }
    if (this.connectionState === 'failed') {
      return '✗ Connection failed'
    }
    if (this.connectionState === 'disconnected') {
      return '✗ Disconnected'
    }
    if (!this.target) {
      return 'Waiting for peer...'
    }
    return `Negotiating with ${this.target}`
  }
}

export default WebRTCConnection
