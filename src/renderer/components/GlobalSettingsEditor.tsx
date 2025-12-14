import { GlobalSettings } from './SceneParamsEditor'
import { useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { RotateCw } from 'lucide-react'

interface GlobalSettingsEditorProps {
  settings: GlobalSettings
  onUpdate: (settings: GlobalSettings) => void
  onClose: () => void
}

export default function GlobalSettingsEditor({
  settings,
  onUpdate,
  onClose
}: GlobalSettingsEditorProps) {
  const [isConnecting, setIsConnecting] = useState(false)
  const [connectionStatus, setConnectionStatus] = useState<
    'idle' | 'connecting' | 'connected' | 'error'
  >('idle')
  const [statusMessage, setStatusMessage] = useState('')

  const handleStartSuperCollider = async () => {
    setIsConnecting(true)
    setConnectionStatus('connecting')
    setStatusMessage('Connecting to SuperCollider...')

    try {
      const result = await invoke<string>('sc_connect', {
        host: `${settings.supercolliderHost || 'localhost'}:${
          settings.supercolliderPort || 57110
        }`
      })
      setConnectionStatus('connected')
      setStatusMessage('Connected to SuperCollider')
      setTimeout(() => setIsConnecting(false), 2000)
    } catch (error) {
      setConnectionStatus('error')
      console.error(error)
      setStatusMessage(
        error instanceof Error
          ? error.message
          : 'Failed to connect to SuperCollider'
      )
      setIsConnecting(false)
    }
  }

  return (
    <div className='absolute bottom-0 left-0 w-full border-l border-t border-white/20 z-50 flex flex-col'>
      {/* Header */}
      <div className='flex items-center justify-between p-3 border-b border-white/20'>
        <span className='text-white text-sm font-semibold'>
          Global Settings
        </span>
        <button
          onClick={onClose}
          className='text-white/50 hover:text-white text-xs px-2 py-0.5 bg-white/10 rounded'>
          ✕
        </button>
      </div>

      {/* Settings Panel */}
      <div className='overflow-y-auto p-3 space-y-4'>
        {/* SuperCollider Settings */}
        <div className='border-b border-white/10 pb-3'>
          <label className='text-white/70 text-sm font-semibold block mb-3'>
            SuperCollider
          </label>
          <div className='space-y-2'>
            <div>
              <label className='text-white/50 text-xs block mb-1'>Host</label>
              <input
                type='text'
                value={settings.supercolliderHost}
                onChange={e =>
                  onUpdate({
                    ...settings,
                    supercolliderHost: e.target.value
                  })
                }
                className='w-full bg-white/10 text-white px-2 py-1 rounded text-xs'
              />
            </div>
            <div>
              <label className='text-white/50 text-xs block mb-1'>Port</label>
              <input
                type='number'
                value={settings.supercolliderPort}
                onChange={e =>
                  onUpdate({
                    ...settings,
                    supercolliderPort: e.target.value
                      ? parseInt(e.target.value)
                      : undefined
                  })
                }
                className='w-full bg-white/10 text-white px-2 py-1 rounded text-xs'
              />
            </div>
            <button
              onClick={handleStartSuperCollider}
              disabled={isConnecting}
              className={`w-full flex items-center justify-center gap-2 px-2 py-1.5 rounded text-xs font-medium transition-colors ${
                connectionStatus === 'connected'
                  ? 'bg-green-500/20 text-green-300 hover:bg-green-500/30'
                  : connectionStatus === 'error'
                  ? 'bg-red-500/20 text-red-300 hover:bg-red-500/30'
                  : 'bg-blue-500/20 text-blue-300 hover:bg-blue-500/30'
              } disabled:opacity-50`}>
              <RotateCw
                size={14}
                className={isConnecting ? 'animate-spin' : ''}
              />
              Start SuperCollider
            </button>
            {statusMessage && (
              <div
                className={`text-xs p-2 rounded ${
                  connectionStatus === 'connected'
                    ? 'bg-green-500/10 text-green-300'
                    : connectionStatus === 'error'
                    ? 'bg-red-500/10 text-red-300'
                    : 'bg-blue-500/10 text-blue-300'
                }`}>
                {statusMessage}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
