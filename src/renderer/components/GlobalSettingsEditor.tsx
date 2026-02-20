import { GlobalSettings, SceneSettings } from './SceneSettingsPanel'
import { useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { Plus, RotateCw } from 'lucide-react'
import Slider from './Slider'
import { sortBy } from 'lodash'
import { useAsemicStore } from '../store/asemicStore'
import { confirm } from '@tauri-apps/plugin-dialog'

interface GlobalSettingsEditorProps {
  settings: GlobalSettings
  setSettings: (settings: GlobalSettings) => void
  onClose: () => void
  sceneList: SceneSettings[]
  setSceneList: (sceneList: SceneSettings[]) => void
}

export default function GlobalSettingsEditor({
  settings,
  setSettings,
  onClose,
  sceneList,
  setSceneList
}: GlobalSettingsEditorProps) {
  const [isConnecting, setIsConnecting] = useState(false)
  const [connectionStatus, setConnectionStatus] = useState<
    'idle' | 'connecting' | 'connected' | 'error'
  >('idle')
  const [statusMessage, setStatusMessage] = useState('')
  const [showAddParam, setShowAddParam] = useState(false)
  const [newParamName, setNewParamName] = useState('')
  const [renamingParam, setRenamingParam] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [showAddSyncTarget, setShowAddSyncTarget] = useState(false)
  const [newSyncTargetName, setNewSyncTargetName] = useState('')
  const [newSyncTargetHost, setNewSyncTargetHost] = useState('localhost')
  const [newSyncTargetPort, setNewSyncTargetPort] = useState('57120')

  const handleAddParam = () => {
    if (newParamName.trim()) {
      setSettings({
        ...settings,
        params: {
          ...(settings.params || {}),
          [newParamName.trim()]: {
            max: 1,
            min: 0,
            exponent: 1,
            dimension: 1,
            default: [1],
            labels: [],
            oscPath: '',
            snap: false
          }
        }
      })
      setNewParamName('')
      setShowAddParam(false)
    }
  }

  const handleDeleteParam = (key: string) => {
    const newParams = { ...(settings.params || {}) }
    delete newParams[key]
    setSettings({ ...settings, params: newParams })
  }

  const handleRenameParam = (oldKey: string) => {
    if (!renameValue.trim() || renameValue === oldKey) {
      setRenamingParam(null)
      setRenameValue('')
      return
    }

    const newKey = renameValue.trim()
    const newParams = { ...(settings.params || {}) }
    const paramData = newParams[oldKey]
    newParams[newKey] = paramData
    delete newParams[oldKey]

    const newSceneList = [...sceneList]
    for (let i = 0; i < newSceneList.length; i++) {
      if (newSceneList[i].globalParams?.[oldKey]) {
        newSceneList[i] = {
          ...newSceneList[i],
          globalParams: {
            ...newSceneList[i].globalParams,
            [newKey]: newSceneList[i].globalParams![oldKey]
          }
        }
        delete newSceneList[i].globalParams![oldKey]
      }
    }
    setSceneList(newSceneList)

    setSettings({ ...settings, params: newParams })
    setRenamingParam(null)
    setRenameValue('')
  }

  const handleAddSyncTarget = () => {
    if (newSyncTargetName.trim()) {
      setSettings({
        ...settings,
        sendTo: {
          ...(settings.sendTo || {}),
          [newSyncTargetName.trim()]: {
            host: newSyncTargetHost,
            port: parseInt(newSyncTargetPort) || 57120
          }
        }
      })
      setNewSyncTargetName('')
      setNewSyncTargetHost('localhost')
      setNewSyncTargetPort('57120')
      setShowAddSyncTarget(false)
    }
  }

  const handleDeleteSyncTarget = (key: string) => {
    const newSendTo = { ...(settings.sendTo || {}) }
    delete newSendTo[key]
    setSettings({ ...settings, sendTo: newSendTo })
  }

  const handleUpdateSyncTarget = (
    key: string,
    updates: { host?: string; port?: number }
  ) => {
    setSettings({
      ...settings,
      sendTo: {
        ...(settings.sendTo || {}),
        [key]: {
          ...settings.sendTo![key],
          ...updates
        }
      }
    })
  }

  // const scrubValues = useAsemicStore(state => state.scrubValues)
  const setScrubValues = useAsemicStore(state => state.setScrubValues)
  const setScenesArray = useAsemicStore(state => state.setScenesArray)

  return (
    <div className='absolute bottom-0 left-0 w-full border-l border-t border-white/20 z-50 flex flex-col max-h-[calc(100vh-50px)] overflow-y-auto'>
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
      <div className='overflow-y-auto p-3 space-y-4 flex-1'>
        {/* Send To Settings */}
        <div className='border-b border-white/10 pb-3'>
          <div className='flex items-center gap-2 mb-3'>
            <label className='text-white/70 text-sm font-semibold'>
              Send To (Sync Targets)
            </label>
            <button
              onClick={e => {
                e.preventDefault()
                e.stopPropagation()
                setShowAddSyncTarget(true)
              }}
              className='text-white/50 hover:text-white text-xs px-2 py-0.5 bg-white/10 rounded'>
              + Add
            </button>
          </div>

          {/* Add Sync Target Input */}
          {showAddSyncTarget && (
            <div className='mb-3 p-2 bg-white/5 rounded border border-white/20'>
              <div className='space-y-2'>
                <div>
                  <label className='text-white/50 text-xs block mb-1'>
                    Target Name
                  </label>
                  <input
                    type='text'
                    placeholder='e.g., instance-2, secondary'
                    value={newSyncTargetName}
                    onChange={e => setNewSyncTargetName(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && newSyncTargetName.trim()) {
                        handleAddSyncTarget()
                      } else if (e.key === 'Escape') {
                        setNewSyncTargetName('')
                        setShowAddSyncTarget(false)
                      }
                    }}
                    autoFocus
                    className='w-full bg-white/10 text-white px-2 py-1 rounded text-xs'
                  />
                </div>
                <div className='flex gap-2'>
                  <div className='flex-1'>
                    <label className='text-white/50 text-xs block mb-1'>
                      Host
                    </label>
                    <input
                      type='text'
                      placeholder='localhost'
                      value={newSyncTargetHost}
                      onChange={e => setNewSyncTargetHost(e.target.value)}
                      className='w-full bg-white/10 text-white px-2 py-1 rounded text-xs'
                    />
                  </div>
                  <div className='flex-1'>
                    <label className='text-white/50 text-xs block mb-1'>
                      Port
                    </label>
                    <input
                      type='number'
                      placeholder='57120'
                      value={newSyncTargetPort}
                      onChange={e => setNewSyncTargetPort(e.target.value)}
                      className='w-full bg-white/10 text-white px-2 py-1 rounded text-xs'
                    />
                  </div>
                </div>
                <div className='flex gap-2'>
                  <button
                    onClick={handleAddSyncTarget}
                    className='flex-1 text-white bg-blue-500 hover:bg-blue-600 px-2 py-1 rounded text-xs'>
                    Add
                  </button>
                  <button
                    onClick={() => {
                      setNewSyncTargetName('')
                      setShowAddSyncTarget(false)
                    }}
                    className='text-white/50 hover:text-white text-xs px-2 py-1'>
                    ✕
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Sync Targets List */}
          <div className='space-y-2'>
            {sortBy(Object.entries(settings.sendTo || {}), 0).map(
              ([key, config]) => (
                <div
                  key={key}
                  className='bg-white/5 p-2 rounded border border-white/10 flex items-end gap-2'>
                  <div className='flex-1'>
                    <label className='text-white/50 text-xs block mb-1'>
                      Name
                    </label>
                    <div className='text-white/90 text-sm font-medium'>
                      {key}
                    </div>
                  </div>
                  <div className='flex-1'>
                    <label className='text-white/50 text-xs block mb-1'>
                      Host
                    </label>
                    <input
                      type='text'
                      value={config.host}
                      onChange={e =>
                        handleUpdateSyncTarget(key, { host: e.target.value })
                      }
                      className='w-full bg-white/10 text-white px-2 py-1 rounded text-xs'
                    />
                  </div>
                  <div className='flex-1'>
                    <label className='text-white/50 text-xs block mb-1'>
                      Port
                    </label>
                    <input
                      type='number'
                      value={config.port}
                      onChange={e =>
                        handleUpdateSyncTarget(key, {
                          port: parseInt(e.target.value)
                        })
                      }
                      className='w-full bg-white/10 text-white px-2 py-1 rounded text-xs'
                    />
                  </div>
                  <button
                    onClick={() => handleDeleteSyncTarget(key)}
                    className='text-red-400 hover:text-red-300 text-xs px-2 py-1'>
                    ✕
                  </button>
                </div>
              )
            )}
          </div>

          {(!settings.sendTo || Object.keys(settings.sendTo).length === 0) && (
            <p className='text-white/40 text-xs italic'>
              No sync targets configured
            </p>
          )}
        </div>

        {/* Slide Toggle */}
        <div className='border-b border-white/10 pb-3 flex items-center gap-4'>
          <label className='text-white/70 text-sm font-semibold flex items-center gap-2 cursor-pointer'>
            <input
              type='checkbox'
              checked={settings.fadeMode === 'single'}
              onChange={e =>
                setSettings({
                  ...settings,
                  fadeMode: e.target.checked ? 'single' : 'multiple'
                })
              }
              className='w-4 h-4 bg-white/10 rounded cursor-pointer'
            />
            Slide
          </label>
          <button
            onClick={() => {
              setScrubValues(scrubValues =>
                scrubValues.map(scene => ({
                  ...scene,
                  fade: 0,
                  progress: 0
                }))
              )
            }}
            className='text-white/50 hover:text-white text-xs px-2 py-0.5 bg-white/10 rounded flex items-center gap-1'>
            <RotateCw size={12} />
          </button>
          <button
            onClick={() => {
              confirm(
                'Are you sure you want to create a new document? This will erase all current scenes and settings.'
              ).then(confirmed => {
                if (confirmed) {
                  setScenesArray([
                    {
                      code: '',
                      length: 0.1,
                      offset: 0,
                      params: {}
                    }
                  ])
                  setScrubValues([{ params: {}, sent: {}, scrub: 0, fade: 0 }])
                  setSettings({
                    params: {},
                    presets: {},
                    fadeMode: 'single'
                  })
                  localStorage.removeItem('scenesArray')
                  localStorage.removeItem('globalSettings')
                }
              })
            }}
            title='New Document'
            className='p-1 hover:bg-white/10 rounded transition-colors'>
            <Plus size={16} />
          </button>{' '}
        </div>

        <div className='border-b border-white/10 pb-3'>
          <div className='flex items-center gap-2 mb-3'>
            <label className='text-white/70 text-sm font-semibold'>
              Global Params
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

          {/* Params List */}
          <div className='space-y-3'>
            {sortBy(Object.entries(settings.params || {}), 0).map(
              ([key, paramConfig]) => (
                <div
                  key={key}
                  className='bg-white/5 p-2 rounded border border-white/10 relative hover:backdrop-blur'>
                  {/* Title and Controls Row */}
                  <div className='flex items-end gap-2 mb-2'>
                    <div className='flex-1 min-w-[80px]'>
                      <label className='text-white/50 text-xs block mb-1'>
                        Name
                      </label>
                      <div className='text-white/90 text-sm font-medium'>
                        {key}
                      </div>
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
                          setSettings({
                            ...settings,
                            params: {
                              ...(settings.params || {}),
                              [key]: {
                                ...settings.params![key],
                                min: parseFloat(e.target.value)
                              }
                            }
                          })
                        }
                        className='w-16 bg-white/10 text-white px-1 py-0.5 rounded text-xs'
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
                          setSettings({
                            ...settings,
                            params: {
                              ...(settings.params || {}),
                              [key]: {
                                ...settings.params![key],
                                max: parseFloat(e.target.value)
                              }
                            }
                          })
                        }
                        className='w-16 bg-white/10 text-white px-1 py-0.5 rounded text-xs'
                      />
                    </div>
                    <div>
                      <label className='text-white/50 text-xs block mb-1'>
                        Exp
                      </label>
                      <input
                        type='number'
                        step='0.1'
                        value={paramConfig.exponent}
                        onChange={e =>
                          setSettings({
                            ...settings,
                            params: {
                              ...(settings.params || {}),
                              [key]: {
                                ...settings.params![key],
                                exponent: parseFloat(e.target.value)
                              }
                            }
                          })
                        }
                        className='w-14 bg-white/10 text-white px-1 py-0.5 rounded text-xs'
                      />
                    </div>
                    <div className='flex-1'>
                      <label className='text-white/50 text-xs block mb-1'>
                        Labels
                      </label>
                      <input
                        type='text'
                        placeholder='Comma-separated labels'
                        value={(paramConfig.labels || []).join(', ')}
                        onChange={e => {
                          const labelText = e.target.value
                          const labels = labelText
                            .split(',')
                            .map(s => s.trim())
                            .filter(s => s)
                          setSettings({
                            ...settings,
                            params: {
                              ...(settings.params || {}),
                              [key]: {
                                ...settings.params![key],
                                labels: labels.length > 0 ? labels : undefined
                              }
                            }
                          })
                        }}
                        className='w-full bg-white/10 text-white px-1 py-0.5 rounded text-xs'
                      />
                    </div>
                    <div className='flex items-end'>
                      <label className='text-white/50 text-xs flex items-center gap-1 cursor-pointer'>
                        <input
                          type='checkbox'
                          checked={paramConfig.snap || false}
                          onChange={e =>
                            setSettings({
                              ...settings,
                              params: {
                                ...(settings.params || {}),
                                [key]: {
                                  ...settings.params![key],
                                  snap: e.target.checked
                                }
                              }
                            })
                          }
                          className='w-3 h-3 bg-white/10 rounded cursor-pointer'
                        />
                        Snap
                      </label>
                    </div>
                    <div>
                      <label className='text-white/50 text-xs block mb-1'>
                        Dim
                      </label>
                      <input
                        type='number'
                        min='1'
                        step='1'
                        value={paramConfig.dimension}
                        onChange={e => {
                          const newDim = Math.max(1, parseInt(e.target.value))
                          // Adjust param values array if dimension changed
                          const currentValues = paramConfig.default || []
                          if (currentValues.length !== newDim) {
                            const newValues = Array(newDim).fill(
                              paramConfig.min
                            )
                            currentValues.forEach((v, i) => {
                              if (i < newDim) newValues[i] = v
                            })
                            setSettings({
                              ...settings,
                              params: {
                                ...settings.params,
                                [key]: {
                                  ...settings.params[key],
                                  dimension: newDim,
                                  default: newValues
                                }
                              }
                            })
                          }
                        }}
                        className='w-12 bg-white/10 text-white px-1 py-0.5 rounded text-xs'
                      />
                    </div>
                    <button
                      onClick={() => {
                        setRenamingParam(key)
                        setRenameValue(key)
                      }}
                      className='text-white/50 hover:text-white text-xs px-2 py-0.5 bg-white/10 rounded'
                      title='Rename parameter'>
                      Rename
                    </button>
                    <button
                      onClick={() => handleDeleteParam(key)}
                      className='text-white/50 hover:text-red-400 text-xs pb-1'>
                      ✕
                    </button>
                  </div>

                  {/* Rename Param Dialog */}
                  {renamingParam === key && (
                    <div className='mb-2 p-2 bg-white/10 rounded border border-white/30'>
                      <div className='flex items-center gap-2'>
                        <span className='text-white/70 text-xs'>
                          Rename to:
                        </span>
                        <input
                          type='text'
                          placeholder='New parameter name'
                          value={renameValue}
                          onChange={e => setRenameValue(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') {
                              handleRenameParam(key)
                            } else if (e.key === 'Escape') {
                              setRenamingParam(null)
                              setRenameValue('')
                            }
                          }}
                          autoFocus
                          className='flex-1 bg-white/10 text-white px-2 py-1 rounded text-xs border border-white/20'
                        />
                        <button
                          onClick={() => handleRenameParam(key)}
                          className='text-white bg-blue-500 hover:bg-blue-600 px-2 py-1 rounded text-xs'>
                          Rename
                        </button>
                        <button
                          onClick={() => {
                            setRenamingParam(null)
                            setRenameValue('')
                          }}
                          className='text-white/50 hover:text-white text-xs'>
                          ✕
                        </button>
                      </div>
                    </div>
                  )}

                  {/* OSC Field */}
                  <div className='flex space-x-1 items-center justify-start *:flex-1'>
                    <div className=''>
                      <label className='text-white/50 text-xs block mb-1'>
                        OSC Path
                      </label>
                      <input
                        type='text'
                        value={paramConfig.oscPath || ''}
                        onChange={e =>
                          setSettings({
                            ...settings,
                            params: {
                              ...(settings.params || {}),
                              [key]: {
                                ...settings.params![key],
                                oscPath: e.target.value
                              }
                            }
                          })
                        }
                        className='w-full bg-white/10 text-white px-2 py-1 rounded text-xs'
                      />
                    </div>
                    <div className=''>
                      <label className='text-white/50 text-xs block mb-1'>
                        Default Value
                      </label>
                      <div className='space-y-1'>
                        {(paramConfig.default || []).map((value, idx) => (
                          <input
                            key={idx}
                            type='number'
                            step='0.01'
                            value={value}
                            onChange={e => {
                              const newDefault = [
                                ...(paramConfig.default || [])
                              ]
                              newDefault[idx] = parseFloat(e.target.value)
                              setSettings({
                                ...settings,
                                params: {
                                  ...(settings.params || {}),
                                  [key]: {
                                    ...settings.params![key],
                                    default: newDefault
                                  }
                                }
                              })
                            }}
                            placeholder={`Dimension ${idx + 1}`}
                            className='w-full bg-white/10 text-white px-2 py-1 rounded text-xs mb-1'
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )
            )}
          </div>

          {(!settings.params || Object.keys(settings.params).length === 0) && (
            <p className='text-white/40 text-xs italic'>
              No global params defined
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
