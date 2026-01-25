# WebRTC Quick Reference

## Setup

```typescript
import { useWebRTCStream } from '@/renderer/hooks/useWebRTCStream'

// In your component
const {
  state, // Connection state object
  addCanvasStream, // Function to add canvas stream
  initiateCall, // Function to initiate call
  endCall, // Function to end call
  mouseDataChannel, // RTCDataChannel for mouse events
  keyboardDataChannel // RTCDataChannel for keyboard events
} = useWebRTCStream(canvasRef)
```

## State Object

```typescript
interface WebRTCStreamState {
  isConnected: boolean // Is WebRTC peer connected?
  connectionState: RTCPeerConnectionState // Current connection state
  clients: Array<{
    // Available clients on server
    id: number
    address: string
    properties: Record<string, any>
  }>
  connectedToServer: boolean // Is signaling server connected?
}
```

## Methods

### addCanvasStream(fps: number)

Adds the canvas stream to the peer connection.

```typescript
await addCanvasStream(30) // Stream at 30 FPS
```

### initiateCall(address: string, properties: object)

Start a WebRTC connection with a specific client.

```typescript
initiateCall(client.address, client.properties)
```

### endCall()

Terminate the current WebRTC connection.

```typescript
endCall()
```

## Configuration

```typescript
useWebRTCStream(canvasRef, {
  signalingAddress: 'ws://localhost', // Signaling server URL
  signalingPort: 9980 // Signaling server port
})
```

## Status Indicators

- **Signaling: Connected** (blue) - Connected to signaling server
- **WebRTC: connected** (green) - Active peer connection
- **WebRTC: disconnected** (red) - No active peer connection

## Connection Flow

1. Hook initializes SignalingClient
2. User sees available clients in UI
3. User clicks "Connect" to initiate call
4. Click "Add Canvas Stream" to begin streaming
5. TouchDesigner receives video stream
6. Click "End Call" to disconnect

## Troubleshooting

| Issue                                  | Solution                            |
| -------------------------------------- | ----------------------------------- |
| Signaling not connecting               | Check server URL and port           |
| Clients not appearing                  | Ensure server has clients connected |
| Connection fails after client selected | Check firewall/network settings     |
| Video stream issues                    | Check canvas is rendering properly  |

## Console Logs

All operations log to console with prefixes:

- `[WEBSOCKET]` - Signaling client events
- `[WEBRTC]` - Peer connection events

## Data Channels

Two automatic data channels are created:

- **MouseData** - For mouse event transmission
- **KeyboardData** - For keyboard event transmission

Access via:

```typescript
mouseDataChannel?.send(data)
keyboardDataChannel?.send(data)
```
