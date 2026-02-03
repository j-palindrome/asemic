import { useState, useRef, useEffect } from 'react'
import Slider from './Slider'
import { GlobalSettings } from './SceneSettingsPanel'
import { invoke } from '@tauri-apps/api/core'

interface ParamEditorsProps {
  scenesArray: Array<{
    params?: Record<string, any>
    globalParams?: Record<string, any>
    presets?: Record<string, { params: Record<string, number[]> }>
  }>
  activeScene: number
  scrubSettings: { params?: Record<string, number[]> }
  setScrubValues: (updater: (prev: any) => any) => void
  globalSettings: GlobalSettings
  setGlobalSettings?: (settings: GlobalSettings) => void
  selectedPreset?: string | null
  selectedPresetType?: 'scene' | 'global' | null
  presetInterpolation?: number
  setSelectedPreset?: (preset: string | null) => void
  setSelectedPresetType?: (type: 'scene' | 'global' | null) => void
  setPresetInterpolation?: (value: number) => void
  presetFromRef?: React.MutableRefObject<Record<string, number[]> | null>
}

export default function ParamEditors({
  scenesArray,
  activeScene,
  scrubSettings,
  setScrubValues,
  globalSettings,
  setGlobalSettings,
  selectedPreset,
  selectedPresetType,
  presetInterpolation = 0,
  setSelectedPreset,
  setSelectedPresetType,
  setPresetInterpolation,
  presetFromRef
}: ParamEditorsProps) {
  const [activeParamKey, setActiveParamKey] = useState<string | null>(null)
  const snapTimersRef = useRef<Record<string, number>>({})

  const activeSceneSettings = scenesArray[activeScene]

  // Clean up snap timers on unmount
  useEffect(() => {
    return () => {
      Object.values(snapTimersRef.current).forEach(timer => clearTimeout(timer))
    }
  }, [])
  const visibleGlobalParams = Object.entries(globalSettings?.params || {})
    // .filter(([, config]) => config?.show === true)
    .map(([key]) => key)
    .sort()

  const allParamKeys = [
    ...Object.keys(activeSceneSettings?.params || {}),
    ...visibleGlobalParams
  ]

  const activeParamConfig = activeParamKey
    ? activeSceneSettings?.params?.[activeParamKey] || {
        ...globalSettings.params[activeParamKey],
        ...activeSceneSettings?.globalParams?.[activeParamKey]
      }
    : null

  const availablePresets = [
    ...Object.keys(activeSceneSettings?.presets || {}),
    ...Object.keys(globalSettings.presets || {})
  ]

  if (allParamKeys.length === 0 && availablePresets.length === 0) {
    return <></>
  }

  return (
    <div className='space-y-3 h-full w-full flex'>
      <div className='w-0 grow flex flex-col items-end'>
        {/* Param Selector */}
        <div className='flex justify-end rounded-lg w-full gap-1 flex-wrap pb-2'>
          {allParamKeys.map(paramKey => {
            const isGlobal = visibleGlobalParams.includes(paramKey)
            return (
              <button
                key={paramKey}
                onClick={() =>
                  setActiveParamKey(
                    activeParamKey === paramKey ? null : paramKey
                  )
                }
                className={`px-3 py-1 rounded text-xs font-mono whitespace-nowrap transition-colors ${
                  activeParamKey === paramKey
                    ? '!bg-white/50 !text-black'
                    : isGlobal
                      ? 'bg-white/10 text-white/70 hover:bg-white/20 italic'
                      : 'bg-white/10 text-white hover:bg-white/20'
                }`}
                title={isGlobal ? 'Global Parameter' : 'Scene Parameter'}>
                {paramKey}
              </button>
            )
          })}
        </div>

        {/* Preset Selector */}
        {availablePresets.length > 0 && (
          <div className='flex w-full justify-end rounded-lg gap-1 flex-wrap pb-2'>
            {availablePresets.map(presetName => {
              const isScenePreset = activeSceneSettings?.presets?.[presetName]
              return (
                <button
                  key={presetName}
                  onClick={() => {
                    if (selectedPreset === presetName) {
                      setSelectedPreset?.(null)
                      setSelectedPresetType?.(null)
                      setPresetInterpolation?.(0)
                      if (presetFromRef) {
                        presetFromRef.current = null
                      }
                    } else {
                      if (presetFromRef) {
                        presetFromRef.current = scrubSettings.params
                          ? { ...scrubSettings.params }
                          : null
                      }
                      setSelectedPreset?.(presetName)
                      setSelectedPresetType?.(
                        isScenePreset ? 'scene' : 'global'
                      )
                      setPresetInterpolation?.(0)
                    }
                  }}
                  className={`px-3 py-1 rounded text-xs font-mono whitespace-nowrap transition-colors ${
                    selectedPreset === presetName
                      ? '!bg-blue-500 !text-white'
                      : isScenePreset
                        ? 'bg-white/10 text-white hover:bg-white/20'
                        : 'bg-white/10 text-white/70 hover:bg-white/20 italic'
                  }`}
                  title={isScenePreset ? 'Scene Preset' : 'Global Preset'}>
                  {presetName}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* Param Editor */}

      <div className='rounded-lg p-3 flex-none flex gap-x-4'>
        {activeParamKey &&
          activeParamConfig &&
          Array.from({
            length: activeParamConfig.dimension
          }).map((_, i) => {
            const currentValue =
              scrubSettings.params?.[activeParamKey]?.[i] ??
              activeParamConfig.default?.[i] ??
              activeParamConfig.min

            return (
              <div key={i} className='w-6 h-full'>
                <Slider
                  className='w-full h-full select-none pointer-grab'
                  min={activeParamConfig.min}
                  max={activeParamConfig.max}
                  exponent={activeParamConfig.exponent}
                  values={{ x: 0, y: currentValue }}
                  sliderStyle={({ y }) => ({
                    height: `${y * 100}%`,
                    left: '50%',
                    bottom: 0,
                    border: '1px solid black',
                    transform: 'translate(-50%, 0)',
                    width: '6px',
                    borderRadius: '2px',
                    backgroundColor: 'white',
                    position: 'absolute',
                    pointerEvents: 'none',
                    flex: 0
                  })}
                  onChange={({ y }, end) => {
                    // Clear existing snap timer for this param
                    if (snapTimersRef.current[activeParamKey + i]) {
                      clearTimeout(snapTimersRef.current[activeParamKey + i])
                    }

                    setScrubValues(prev => {
                      const updated = [...prev]
                      const newParams = { ...updated[activeScene].params }
                      newParams[activeParamKey] = [
                        ...(newParams[activeParamKey] || [])
                      ]
                      newParams[activeParamKey][i] = y
                      updated[activeScene] = {
                        ...updated[activeScene],
                        params: newParams
                      }
                      for (let sendTo of Object.values(
                        globalSettings.sendTo || {}
                      )) {
                        invoke('emit_osc_event', {
                          targetAddr: `${sendTo.host}:${sendTo.port}`,
                          eventName: '/params',
                          data: JSON.stringify({
                            params: {
                              [activeParamKey]: newParams[activeParamKey]
                            },
                            scene: activeScene
                          })
                        })
                          .catch(err => {
                            console.error('Failed to emit OSC scene list:', err)
                          })
                          .then(res => {
                            console.log('sent', res)
                          })
                      }
                      return updated
                    })

                    // Set snap timer only on mouseup if snap is enabled
                    if (end && activeParamConfig.snap) {
                      snapTimersRef.current[activeParamKey] = setTimeout(() => {
                        setScrubValues(prev => {
                          const updated = [...prev]
                          const newParams = { ...updated[activeScene].params }
                          newParams[activeParamKey] = [
                            ...(newParams[activeParamKey] || [])
                          ]
                          newParams[activeParamKey][i] = 0
                          updated[activeScene] = {
                            ...updated[activeScene],
                            params: newParams
                          }
                          for (let sendTo of Object.values(
                            globalSettings.sendTo || {}
                          )) {
                            invoke('emit_osc_event', {
                              targetAddr: `${sendTo.host}:${sendTo.port}`,
                              eventName: '/params',
                              data: JSON.stringify({
                                params: {
                                  [activeParamKey]: newParams[activeParamKey]
                                },
                                scene: activeScene
                              })
                            }).catch(err => {
                              console.error(
                                'Failed to emit OSC scene list:',
                                err
                              )
                            })
                          }
                          delete snapTimersRef.current[activeParamKey + i]
                          return updated
                        })
                      }, 500)
                    }
                  }}
                />
                <span className='text-white/70 text-xs p-1 select-none'>
                  {currentValue.toFixed(3)}
                </span>
              </div>
            )
          })}
        {/* Preset Fade Slider */}
        {selectedPreset && (
          <div className='relative h-full w-6'>
            <Slider
              className='w-full h-full select-none pointer-grab'
              min={0}
              max={1}
              exponent={1}
              values={{ x: 0, y: presetInterpolation }}
              sliderStyle={({ y }) => ({
                height: `${y * 100}%`,
                left: '50%',
                bottom: 0,
                border: '1px solid black',
                transform: 'translate(-50%, 0)',
                width: '6px',
                borderRadius: '2px',
                backgroundColor: '#70a0a8',
                position: 'absolute',
                pointerEvents: 'none',
                flex: 0
              })}
              onChange={({ y }) => {
                setPresetInterpolation?.(y)
              }}
            />
            <span className='text-white/70 text-xs p-1 select-none'>
              {(presetInterpolation * 100).toFixed(0)}%
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
