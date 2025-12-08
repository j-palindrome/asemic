import { useState } from 'react'
import { open } from '@tauri-apps/plugin-dialog'
import AsemicExpressionEditor from './AsemicExpressionEditor'

type ParamConfig = {
  default: number
  max: number
  min: number
  exponent: number
}

type SceneSettings = {
  length?: number
  offset?: number
  pause?: number | false
  params?: Record<string, ParamConfig>
  osc?: Array<{ name: string; value: number | string }>
  audioTrack?: string
}

interface SceneSettingsPanelProps {
  activeScene: number
  settings: SceneSettings
  onUpdate: (settings: SceneSettings) => void
  onClose: () => void
}

export default function SceneSettingsPanel({
  activeScene,
  settings,
  onUpdate,
  onClose
}: SceneSettingsPanelProps) {
  const [showAddParam, setShowAddParam] = useState(false)
  const [newParamName, setNewParamName] = useState('')

  const handleAddParam = () => {
    if (newParamName.trim()) {
      onUpdate({
        ...settings,
        params: {
          ...settings.params,
          [newParamName.trim()]: {
            default: 0.5,
            max: 1,
            min: 0,
            exponent: 1
          }
        }
      })
      setNewParamName('')
      setShowAddParam(false)
    }
  }

  const handleDeleteParam = (key: string) => {
    const newParams = { ...settings.params }
    delete newParams[key]
    onUpdate({ ...settings, params: newParams })
  }

  const handleUpdateParam = (
    key: string,
    field: keyof ParamConfig,
    value: number
  ) => {
    onUpdate({
      ...settings,
      params: {
        ...settings.params,
        [key]: {
          ...settings.params![key],
          [field]: value
        }
      }
    })
  }

  return (
    <div className='absolute bottom-0 left-0 right-0 bg-black/90 border-t border-white/20 p-3 z-50 max-h-[80vh] overflow-y-auto'>
      <div className='flex items-center gap-2 mb-2'>
        <span className='text-white text-sm font-semibold'>
          Scene {activeScene} Settings
        </span>
        <button className='ml-auto' onClick={onClose}>
          ✕
        </button>
      </div>

      {/* Basic Settings */}
      <div className='grid grid-cols-3 gap-3 text-xs'>
        <div>
          <label className='text-white/70 block mb-1'>Length</label>
          <input
            type='number'
            step='0.1'
            value={settings.length ?? 0.1}
            onChange={e =>
              onUpdate({
                ...settings,
                length: parseFloat(e.target.value) || 0.1
              })
            }
            className='w-full bg-white/10 text-white px-2 py-1 rounded'
          />
        </div>
        <div>
          <label className='text-white/70 block mb-1'>Offset</label>
          <input
            type='number'
            step='0.1'
            value={settings.offset ?? 0}
            onChange={e =>
              onUpdate({
                ...settings,
                offset: parseFloat(e.target.value) || 0
              })
            }
            className='w-full bg-white/10 text-white px-2 py-1 rounded'
          />
        </div>
        <div>
          <label className='text-white/70 block mb-1'>Pause</label>
          <input
            type='number'
            step='0.1'
            value={settings.pause === false ? -1 : settings.pause ?? 0}
            onChange={e => {
              const val = parseFloat(e.target.value)
              onUpdate({
                ...settings,
                pause: (val < 0 ? false : val) as number | false
              })
            }}
            className='w-full bg-white/10 text-white px-2 py-1 rounded'
          />
          <span className='text-white/50 text-[10px]'>(-1 for false)</span>
        </div>
      </div>

      {/* Params Section */}
      <div className='mt-3 border-t border-white/10 pt-3'>
        <div className='flex items-center gap-2 mb-2'>
          <label className='text-white/70 text-sm font-semibold'>
            Params (Global)
          </label>
          <button
            onClick={e => {
              e.preventDefault()
              e.stopPropagation()
              setShowAddParam(true)
            }}
            className='text-white/50 hover:text-white text-xs px-2 py-0.5 bg-white/10 rounded'>
            + Add
          </button>
        </div>

        {/* Add Param Input */}
        {showAddParam && (
          <div className='mb-3 p-2 bg-white/5 rounded border border-white/20'>
            <div className='flex items-center gap-2'>
              <input
                type='text'
                placeholder='Parameter name'
                value={newParamName}
                onChange={e => setNewParamName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && newParamName.trim()) {
                    handleAddParam()
                  } else if (e.key === 'Escape') {
                    setNewParamName('')
                    setShowAddParam(false)
                  }
                }}
                autoFocus
                className='flex-1 bg-white/10 text-white px-2 py-1 rounded text-xs'
              />
              <button
                onClick={handleAddParam}
                className='text-white bg-blue-500 hover:bg-blue-600 px-2 py-1 rounded text-xs'>
                Add
              </button>
              <button
                onClick={() => {
                  setNewParamName('')
                  setShowAddParam(false)
                }}
                className='text-white/50 hover:text-white text-xs'>
                ✕
              </button>
            </div>
          </div>
        )}

        <div className='space-y-3 max-h-64 overflow-y-auto pr-1'>
          {Object.entries(settings.params || {}).map(([key, paramConfig]) => (
            <div
              key={key}
              className='bg-white/5 p-2 rounded border border-white/10'>
              <div className='flex items-center justify-between mb-2'>
                <label className='text-white/90 text-sm font-medium'>
                  {key}
                </label>
                <button
                  onClick={() => handleDeleteParam(key)}
                  className='text-white/50 hover:text-red-400 text-xs'>
                  ✕
                </button>
              </div>
              <div className='grid grid-cols-2 gap-2'>
                <div>
                  <label className='text-white/50 text-xs block mb-1'>
                    Default
                  </label>
                  <input
                    type='number'
                    step='0.01'
                    value={paramConfig.default}
                    onChange={e =>
                      handleUpdateParam(
                        key,
                        'default',
                        parseFloat(e.target.value) || 0
                      )
                    }
                    className='w-full bg-white/10 text-white px-2 py-1 rounded text-xs'
                  />
                </div>
                <div>
                  <label className='text-white/50 text-xs block mb-1'>
                    Min
                  </label>
                  <input
                    type='number'
                    step='0.01'
                    value={paramConfig.min}
                    onChange={e =>
                      handleUpdateParam(
                        key,
                        'min',
                        parseFloat(e.target.value) || 0
                      )
                    }
                    className='w-full bg-white/10 text-white px-2 py-1 rounded text-xs'
                  />
                </div>
                <div>
                  <label className='text-white/50 text-xs block mb-1'>
                    Max
                  </label>
                  <input
                    type='number'
                    step='0.01'
                    value={paramConfig.max}
                    onChange={e =>
                      handleUpdateParam(
                        key,
                        'max',
                        parseFloat(e.target.value) || 1
                      )
                    }
                    className='w-full bg-white/10 text-white px-2 py-1 rounded text-xs'
                  />
                </div>
                <div>
                  <label className='text-white/50 text-xs block mb-1'>
                    Exponent
                  </label>
                  <input
                    type='number'
                    step='0.1'
                    value={paramConfig.exponent}
                    onChange={e =>
                      handleUpdateParam(
                        key,
                        'exponent',
                        parseFloat(e.target.value) || 1
                      )
                    }
                    className='w-full bg-white/10 text-white px-2 py-1 rounded text-xs'
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
        {(!settings.params || Object.keys(settings.params).length === 0) && (
          <p className='text-white/40 text-xs italic'>No params defined</p>
        )}
      </div>

      {/* OSC Messages Section */}
      <div className='mt-3 border-t border-white/10 pt-3'>
        <div className='flex items-center gap-2 mb-2'>
          <label className='text-white/70 text-sm font-semibold'>
            OSC Messages
          </label>
          <button
            onClick={e => {
              e.preventDefault()
              e.stopPropagation()
              onUpdate({
                ...settings,
                osc: [...(settings.osc || []), { name: '', value: 0 }]
              })
            }}
            className='text-white/50 hover:text-white text-xs px-2 py-0.5 bg-white/10 rounded'>
            + Add
          </button>
        </div>
        <div className='flex flex-col gap-2'>
          {(settings.osc || []).map((osc, index) => (
            <div key={index} className='flex items-center gap-2'>
              <input
                type='text'
                placeholder='OSC path'
                value={osc.name}
                onChange={e => {
                  const newOsc = [...(settings.osc || [])]
                  newOsc[index] = { ...newOsc[index], name: e.target.value }
                  onUpdate({ ...settings, osc: newOsc })
                }}
                className='flex-1 bg-white/10 text-white px-2 py-1 rounded text-xs'
              />
              <div className='w-48 bg-white/10 rounded px-1 py-0.5'>
                <AsemicExpressionEditor
                  value={
                    typeof osc.value === 'number'
                      ? osc.value.toString()
                      : osc.value.toString()
                  }
                  onChange={value => {
                    const newOsc = [...(settings.osc || [])]
                    // Store as string to preserve expressions, will be evaluated later
                    newOsc[index] = {
                      ...newOsc[index],
                      value: value as any
                    }
                    onUpdate({ ...settings, osc: newOsc })
                  }}
                />
              </div>
              <button
                onClick={() => {
                  const newOsc = [...(settings.osc || [])]
                  newOsc.splice(index, 1)
                  onUpdate({ ...settings, osc: newOsc })
                }}
                className='text-white/50 hover:text-red-400 text-xs'>
                ✕
              </button>
            </div>
          ))}
        </div>
        <div className='text-white/50 text-[10px] mt-1'>
          Values support Asemic expressions (e.g., T, I, ~, etc.)
        </div>
        {(!settings.osc || settings.osc.length === 0) && (
          <p className='text-white/40 text-xs italic'>
            No OSC messages defined
          </p>
        )}
      </div>

      {/* Audio Track Section */}
      <div className='mt-3 border-t border-white/10 pt-3'>
        <div className='flex items-center gap-2 mb-2'>
          <label className='text-white/70 text-sm font-semibold'>
            Audio Track
          </label>
          <button
            onClick={async e => {
              e.preventDefault()
              e.stopPropagation()
              try {
                const filePath = await open({
                  multiple: false,
                  directory: false,
                  filters: [
                    {
                      name: 'Audio files',
                      extensions: ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac']
                    }
                  ]
                })

                if (filePath) {
                  onUpdate({ ...settings, audioTrack: filePath as string })
                }
              } catch (error) {
                console.error('Failed to select audio file:', error)
              }
            }}
            className='text-white/50 hover:text-white text-xs px-2 py-0.5 bg-white/10 rounded'>
            Select File
          </button>
          {settings.audioTrack && (
            <button
              onClick={() => onUpdate({ ...settings, audioTrack: undefined })}
              className='text-white/50 hover:text-red-400 text-xs'>
              ✕
            </button>
          )}
        </div>
        {settings.audioTrack ? (
          <div className='text-white/70 text-xs break-all'>
            {settings.audioTrack.split('/').pop()}
          </div>
        ) : (
          <p className='text-white/40 text-xs italic'>
            No audio track selected
          </p>
        )}
      </div>
    </div>
  )
}
