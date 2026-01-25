# WebRTC Handshake Implementation

## Overview

This document describes the complete WebRTC handshake flow implemented in the Asemic Tauri application, following the WebRTC peer connection protocol with TouchDesigner as the remote peer.

## Architecture

```
Tauri App (Impolite Peer)              Signaling Server              TouchDesigner (Polite Peer)
        │                                    │                              │
        │  1. Create RTCPeerConnection      │                              │
        │  2. Add transceiver (recvonly)    │                              │
        │                                    │                              │
        │  3. negotiationneeded event       │                              │
        │     - Create Offer                │                              │
        │     - Set Local Description       │                              │
        │                                    │                              │
        │  4. Send Offer ─────────────────→ │ ──────────────→ Receives Offer
        │                                    │                │ - Creates RTCPeerConnection
        │                                    │                │ - Sets Remote Description
        │                                    │                │ - Creates Answer
        │                                    │                │ - Sets Local Description
        │                                    │                │
        │  5. Receive Answer ←───────────── │ ← Send Answer ──│
        │     - Set Remote Description      │                │
        │                                    │                │
        ├─ 6. onicecandidate events ───────→│───────────────→ addIceCandidate()
        │                                    │                │
        │                                    │ ← ICE candidates←
        ├─ 7. addIceCandidate() ←──────────│─────────────────┤
        │                                    │                │
        │  8. Connection established        │                │
        │     - connectionState: 'connected'│                │
        │     - Media begins flowing        │                │
        └─────────────────────────────────────────────────────┘
```

## Handshake Steps

### 1. **Peer Connection Setup** (`onCallStart`)

When the user initiates a call to TouchDesigner:

```javascript
onCallStart(address, properties) {
  this.target = address

  // Determine polite/impolite role (Tauri is impolite if it joined more recently)
  this.polite =
    this.signalingClient.properties.timeJoined < properties.timeJoined

  // Create RTCPeerConnection with STUN server
  this.createPeerConnection()

  // Add video transceiver (receive-only)
  this.peerConnection.addTransceiver('video', { direction: 'recvonly' })
}
```

**State**: `signalingState: 'stable'`

### 2. **Offer Generation** (via `negotiationneeded` event)

When media is added to the connection:

```javascript
handleNegotiationNeeded(event) {
  // Prevent collision if already in negotiation
  if (this.peerConnection.signalingState === 'have-remote-offer') return
  if (this.makingOffer) return

  this.makingOffer = true

  // Create and set local description
  this.peerConnection.setLocalDescription()
    .then(() => {
      // Send offer via signaling server
      this.onMessageSendingOffer(
        this.target,
        this.peerConnection.localDescription.sdp
      )
    })
    .finally(() => this.makingOffer = false)
}
```

**State**: `signalingState: 'have-local-offer'`

### 3. **Offer Transmission**

The offer SDP is sent to TouchDesigner through the signaling server:

```javascript
onMessageSendingOffer(target, sdp) {
  const msg = {
    signalingType: 'Offer',
    sender: null,        // Filled by server
    target: target,      // TD address
    content: {
      sdp: sdp          // Full SDP offer
    }
  }
  this.signalingClient.webSocket.send(JSON.stringify(msg))
}
```

### 4. **Receiving Offer** (TouchDesigner → Tauri)

When the signaling server forwards the offer from TouchDesigner:

```javascript
onMessageReceivedOffer(messageObj) {
  // Create peer connection if needed
  if (this.peerConnection === null) {
    this.createPeerConnection()
  }

  // Perfect negotiation: Check if we can accept
  const readyForOffer =
    !this.makingOffer &&
    (this.peerConnection.signalingState === 'stable' ||
     this.isSettingRemoteAnswerPending)

  // Impolite peer (Tauri) ignores offer if collision detected
  if (!this.polite && !readyForOffer) {
    console.log('Offer collision - ignoring')
    return
  }

  this.target = messageObj.sender

  // Set remote description (offer) → create answer → set local description
  this.peerConnection
    .setRemoteDescription({ type: 'offer', sdp: messageObj.content.sdp })
    .then(() => this.peerConnection.createAnswer())
    .then(answer => this.peerConnection.setLocalDescription(answer))
    .then(() => {
      // Send answer back
      this.onMessageSendingAnswer(
        messageObj.sender,
        this.peerConnection.localDescription.sdp
      )
    })
}
```

**State transitions**:

- `have-remote-offer` (after `setRemoteDescription`)
- `stable` (after `setLocalDescription` with answer)

### 5. **Receiving Answer** (TouchDesigner → Tauri)

When TouchDesigner's answer arrives:

```javascript
onMessageReceivedAnswer(messageObj) {
  if (!this.peerConnection) {
    console.error('No peer connection for answer')
    return
  }

  this.isSettingRemoteAnswerPending = true

  this.peerConnection
    .setRemoteDescription({ type: 'answer', sdp: messageObj.content.sdp })
    .then(() => {
      this.isSettingRemoteAnswerPending = false
      console.log('✓ Remote answer set successfully')
    })
    .catch(error => {
      console.error('Error setting remote answer:', error)
      this.isSettingRemoteAnswerPending = false
    })
}
```

**State**: `signalingState: 'stable'` (ready for ICE candidates)

### 6. **ICE Candidate Exchange**

#### Local ICE Candidates (Tauri → TouchDesigner)

As ICE candidates are gathered:

```javascript
handleIceCandidate(event) {
  if (event.candidate) {
    // Send candidate to remote peer
    this.onMessageSendingIce(
      this.target,
      event.candidate.candidate,
      event.candidate.sdpMLineIndex,
      event.candidate.sdpMid
    )
  } else {
    console.log('ICE gathering complete')
  }
}

onMessageSendingIce(target, sdpCandidate, sdpMLineIndex, sdpMid) {
  const msg = {
    signalingType: 'Ice',
    target: target,
    content: {
      sdpCandidate,
      sdpMLineIndex,
      sdpMid
    }
  }
  this.signalingClient.webSocket.send(JSON.stringify(msg))
}
```

#### Remote ICE Candidates (TouchDesigner → Tauri)

When receiving candidates:

```javascript
onMessageReceivedIce(messageObj) {
  if (!this.peerConnection) return

  const candidate = new RTCIceCandidate({
    candidate: messageObj.content.sdpCandidate,
    sdpMLineIndex: messageObj.content.sdpMLineIndex,
    sdpMid: messageObj.content.sdpMid
  })

  this.peerConnection
    .addIceCandidate(candidate)
    .then(() => console.log('✓ ICE candidate added'))
    .catch(error => console.error('Error adding ICE candidate:', error))
}
```

### 7. **Connection Established**

Once local and remote candidates form a working pair:

```javascript
handleConnectionStateChange(event) {
  const newState = event.target.connectionState

  switch (newState) {
    case 'connected':
      console.log('✓ Peer connection established - media flowing')
      break
    case 'failed':
      // Restart ICE
      this.peerConnection.restartIce()
      break
    case 'disconnected':
    case 'closed':
      // Clean up
      this.deletePeerConnection()
      break
  }
}

handleIceConnectionStateChange(event) {
  const state = this.peerConnection.iceConnectionState

  // States: new → checking → connected/completed
  // If failed → restartIce()
}
```

## Signaling Message Format

All messages follow the TouchDesigner Signaling API schema:

```json
{
  "metadata": {
    "apiVersion": "1.0.1",
    "compVersion": "1.0.1",
    "compOrigin": "WebRTC",
    "projectName": "TDWebRTCWebDemo"
  },
  "signalingType": "Offer|Answer|Ice|Candidate",
  "sender": "auto-filled by server",
  "target": "touchdesigner-peer-address",
  "content": {
    // Offer/Answer
    "sdp": "v=0\no=...",

    // ICE Candidate
    "sdpCandidate": "candidate:...",
    "sdpMLineIndex": 0,
    "sdpMid": "0"
  }
}
```

## Perfect Negotiation Pattern

The implementation uses the "perfect negotiation" pattern to avoid deadlocks:

1. **One peer is "polite"** (determined by join time)
2. **One peer is "impolite"**
3. **During offer collision**:
   - Polite peer accepts the offer and creates an answer
   - Impolite peer ignores the offer and retries later

```javascript
// Check for collision
const readyForOffer =
  !this.makingOffer &&
  (this.peerConnection.signalingState === 'stable' ||
    this.isSettingRemoteAnswerPending)
const offerCollision = !readyForOffer

// Impolite peer ignores during collision
const ignoreOffer = !this.polite && offerCollision
if (ignoreOffer) {
  console.log('Offer collision - ignoring (impolite peer)')
  return
}
```

## Connection State Machine

```
                  ┌─────────────────┐
                  │     create      │
                  │ RTCPeerConnection
                  └────────┬────────┘
                           │
                           ▼
                  ┌─────────────────┐
                  │     stable      │ ◄──── Both sides done
                  │ signalingState  │       with negotiation
                  └────────┬────────┘
                           │ negotiationneeded
                           ▼
                  ┌──────────────────────┐
                  │ have-local-offer     │
                  │ (sent offer)         │
                  └────────┬─────────────┘
                           │ Answer received
                           ▼
                  ┌──────────────────────┐
                  │ stable (answer set)  │ ◄──── Offer/Answer done
                  │                      │       ICE starting
                  └────────┬─────────────┘
                           │
                    ICE candidates
                    exchange ↔
                           │
                           ▼
                  ┌──────────────────────┐
                  │ connected            │
                  │ (media flowing)      │
                  └──────────────────────┘
```

## Debugging Connection Issues

Enable the browser console to see detailed logs:

```
[WEBRTC] Creating peer connection...
[WEBRTC] → Offer created, sending to 127.0.0.1:8000
[WEBRTC] ← Received answer from 127.0.0.1:8000
[WEBRTC] ✓ Remote answer set successfully
[WEBRTC] → Sending ICE candidate to 127.0.0.1:8000
[WEBRTC] ICE Connection State: checking
[WEBRTC] ✓ ICE connection established
[WEBRTC] ✓ Peer connection established - media flowing
```

Common issues:

1. **Offer never received**: Check signaling server is running and forwarding messages
2. **Answer not received**: Verify TouchDesigner peer is responding
3. **ICE candidates not connecting**: Check STUN server accessibility, firewall rules
4. **Connection fails after initial connection**: Network path changed - ICE restart triggered automatically
5. **No media flowing**: Check video track is being added correctly

## API Methods

### Connection Management

```javascript
// Check current connection status
const status = webRTCConnection.getConnectionStatus()
// Returns: { connected, connectionState, iceConnectionState, ... }

// Get human-readable status
const statusStr = webRTCConnection.getStatusString()
// Returns: "✓ Connected", "⟳ Connecting...", etc.

// Start call
webRTCConnection.onCallStart(address, properties)

// End call
webRTCConnection.onCallEnd()
```

### Receiving Signaling Messages

The SignalingClient automatically routes messages to WebRTCConnection:

```javascript
// Offer received
webRTCConnection.onMessageReceivedOffer(messageObj)

// Answer received
webRTCConnection.onMessageReceivedAnswer(messageObj)

// ICE candidate received
webRTCConnection.onMessageReceivedIce(messageObj)
```

## Related Files

- [src/renderer/utils/webRTCConnection.js](src/renderer/utils/webRTCConnection.js) - Main implementation
- [src/renderer/utils/signalingClient.js](src/renderer/utils/signalingClient.js) - Signaling transport
- [src/renderer/components/WebRTCStream.tsx](src/renderer/components/WebRTCStream.tsx) - React component
- [src/renderer/components/SignalingClientPanel.tsx](src/renderer/components/SignalingClientPanel.tsx) - UI controls
