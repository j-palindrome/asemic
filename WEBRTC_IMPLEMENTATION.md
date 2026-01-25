# WebRTC Streaming to TouchDesigner - Implementation Summary

## Overview

Successfully implemented comprehensive WebRTC streaming support for Asemic using the TouchDesigner WebRTC Remote Panel reference architecture. The implementation uses Mozilla's Perfect Negotiation pattern and includes full signaling protocol support.

## Files Created/Modified

### New Utility Files

#### [src/renderer/utils/signalingClient.ts](src/renderer/utils/signalingClient.ts)

WebSocket signaling client for establishing WebRTC peer connections with TouchDesigner and other clients.

**Key Features:**

- WebSocket connection management to signaling server
- Client discovery and management (Clients, ClientEnter, ClientExit messages)
- Session-aware negotiation with timeJoined tracking
- Delegates WebRTC negotiation messages (Offer/Answer/Ice) to WebRTCConnection

**Public Methods:**

- `constructor(address, port, clientsHandler, connectedHandler)` - Initialize and connect to signaling server
- `close()` - Disconnect from signaling server
- `setWebRTCConnection(webRTCConnection)` - Register WebRTC connection instance
- `send(message)` - Send signaling messages to remote peers

#### [src/renderer/utils/webRTCConnection.ts](src/renderer/utils/webRTCConnection.ts)

Core WebRTC peer connection handler implementing Perfect Negotiation pattern.

**Key Features:**

- Automatic peer connection creation and management
- Data channel support (MouseData, KeyboardData)
- ICE candidate handling and gathering
- SDP offer/answer negotiation
- Connection state monitoring

**Public Methods:**

- `onCallStart(address, properties)` - Initiate WebRTC connection with remote peer
- `onCallEnd()` - Terminate connection and clean up resources
- `getPeerConnection()` - Get underlying RTCPeerConnection
- `getConnectionState()` - Get current connection state
- `isConnected()` - Check if actively connected
- `onMessageReceived(message)` - Handle incoming signaling messages

### Updated Hook

#### [src/renderer/hooks/useWebRTCStream.ts](src/renderer/hooks/useWebRTCStream.ts)

React hook encapsulating WebRTC and signaling client lifecycle.

**Returns:**

```typescript
{
  state: WebRTCStreamState // Connection status
  signalingClient: SignalingClient // Signaling client instance
  webRTCConnection: WebRTCConnection // WebRTC connection instance
  mouseDataChannel: RTCDataChannel // Mouse data channel
  keyboardDataChannel: RTCDataChannel // Keyboard data channel
  addCanvasStream(fps) // Add canvas stream to peer connection
  initiateCall(address, properties) // Start call with specific peer
  endCall() // Terminate current call
}
```

**Configuration:**

```typescript
useWebRTCStream(canvas, {
  signalingAddress: 'ws://localhost', // Default: 'wss://127.0.0.1'
  signalingPort: 9980 // Default: 443
})
```

### Updated Components

#### [src/renderer/app/AsemicApp.tsx](src/renderer/app/AsemicApp.tsx)

Integrated new WebRTC implementation with improved UI/UX.

**Changes:**

- Replaced manual WebSocket handling with useWebRTCStream hook
- Removed manual SDP offer/answer management
- New WebRTC panel with client discovery
- One-click connection to available peers
- Real-time canvas stream control
- Connection status indicators

**New UI Features:**

- Signaling connection status (blue indicator)
- WebRTC connection status (green/red indicator)
- Available clients list with connect buttons
- Canvas stream control buttons
- End call functionality
- Improved instructions panel

## Architecture Overview

```
┌─────────────────────────────────────────┐
│         AsemicApp (React)               │
│  • Canvas rendering                     │
│  • Parameter UI                         │
│  • WebRTC panel                         │
└──────────────┬──────────────────────────┘
               │
        useWebRTCStream Hook
               │
       ┌───────┴───────┐
       │               │
  ┌────▼──────┐  ┌─────▼─────────┐
  │ Signaling │  │ WebRTC        │
  │ Client    │  │ Connection    │
  │           │  │               │
  │ • WebSocket  │ • RTCPeer     │
  │ • Messaging  │ • ICE Cand.   │
  │ • Clients    │ • Data Chans. │
  └────┬──────┘  └─────┬─────────┘
       │               │
       └───────┬───────┘
               │
    ┌──────────▼──────────┐
    │  Signaling Server   │
    │  (TouchDesigner)    │
    └─────────────────────┘
```

## Perfect Negotiation Pattern

The implementation uses Mozilla's Perfect Negotiation to handle:

1. **Simultaneous offers** - One peer is "polite" (backed off), the other is "impolite" (asserts)
2. **Collision handling** - When both peers try to create offers simultaneously
3. **State management** - Tracked via:
   - `makingOffer` - Currently creating offer
   - `ignoreOffer` - Skip collision-causing offers
   - `isSettingRemoteAnswerPending` - Answer being set asynchronously

## Signaling Protocol

Supports TouchDesigner's signaling API:

**Message Format:**

```typescript
{
  metadata: {
    apiVersion: string
    compVersion: string
    compOrigin: string
    projectName: string
  }
  signalingType: 'Clients' |
    'ClientEnter' |
    'ClientEntered' |
    'ClientExit' |
    'Offer' |
    'Answer' |
    'Ice'
  content: Record<string, any>
}
```

**Supported Message Types:**

- `Clients` - Initial client list from server
- `ClientEnter` - New client joined
- `ClientEntered` - Confirmation of client registration
- `ClientExit` - Client left
- `Offer` - SDP offer for peer negotiation
- `Answer` - SDP answer response
- `Ice` - ICE candidate for connection

## Usage Example

```typescript
// Initialize in component
const { state, addCanvasStream, initiateCall, endCall } = useWebRTCStream(
  canvasRef,
  {
    signalingAddress: 'ws://touchdesigner-host',
    signalingPort: 9980
  }
)

// Check connection status
if (state.connectedToServer) {
  // Signaling server is connected
}

if (state.isConnected) {
  // WebRTC peer connection is active
}

// Available clients to connect to
state.clients.forEach(client => {
  // Connect to a specific client
  initiateCall(client.address, client.properties)
  addCanvasStream(30) // 30 FPS
})

// Terminate connection
endCall()
```

## Configuration

### Signaling Server Connection

Default configuration connects to local development server:

```typescript
{
  signalingAddress: 'ws://localhost',
  signalingPort: 9980
}
```

For production TouchDesigner instance:

```typescript
{
  signalingAddress: 'ws://touchdesigner-server-ip',
  signalingPort: 443  // Use secure wss:// in production
}
```

## Features

✅ **Full WebRTC Support**

- Peer connection management
- SDP offer/answer negotiation
- ICE candidate gathering and handling
- Data channel creation (Mouse, Keyboard)

✅ **Perfect Negotiation**

- Automatic collision handling
- Polite peer determination based on join time
- Stateful negotiation tracking

✅ **Client Discovery**

- Automatic server client list updates
- Real-time client join/exit notifications
- Simple UI for connecting to peers

✅ **Canvas Streaming**

- Configurable FPS (default 30)
- Efficient canvas capture
- Automatic track management

✅ **Connection Monitoring**

- Real-time connection state tracking
- ICE connection state monitoring
- Graceful error handling and recovery

## Error Handling

All operations include error handling:

- WebSocket connection failures
- Peer connection failures
- SDP negotiation errors
- ICE candidate errors

Errors are logged to console with `[WEBSOCKET]` and `[WEBRTC]` prefixes for easy debugging.

## Testing

To test the implementation:

1. **Start TouchDesigner Signaling Server**

   ```
   TouchDesigner with signaling server running on port 9980
   ```

2. **Run Asemic Application**

   ```
   The app will automatically connect to the local signaling server
   ```

3. **Test Client Discovery**
   - Available clients should appear in the WebRTC panel
   - Check "Signaling: Connected" indicator

4. **Test Peer Connection**
   - Click "Connect" on an available client
   - Check "WebRTC: connected" indicator changes to green
   - Click "Add Canvas Stream" to begin streaming

5. **Verify Stream**
   - In TouchDesigner, confirm video is being received
   - Monitor console for any errors

## Breaking Changes

The following were removed/replaced:

- Manual WebSocket management (use hook instead)
- Custom offer/answer handling (automatic via WebRTCConnection)
- Direct peer connection creation (managed by hook)

All functionality is now encapsulated in `useWebRTCStream` hook and is backward compatible with existing UI patterns.

## References

- [Mozilla WebRTC API - Perfect Negotiation](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Perfect_negotiation)
- [TouchDesigner WebRTC Remote Panel Demo](https://github.com/TouchDesigner/WebRTC-Remote-Panel-Web-Demo)
- [TouchDesigner Signaling Server Docs](https://docs.derivative.ca/Palette:signalingServer)
