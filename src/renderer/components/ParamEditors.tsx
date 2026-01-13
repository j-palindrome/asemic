import { useState } from 'react'
import Slider from './Slider'
import { GlobalSettings } from './SceneSettingsPanel'

interface ParamEditorsProps {
  scenesArray: Array<{
    params?: Record<string, any>
    globalParams?: Record<string, any>
  }>
  activeScene: number
  scrubSettings: { params?: Record<string, number[]> }
  setScrubValues: (updater: (prev: any) => any) => void
  globalSettings: GlobalSettings
  setGlobalSettings?: (settings: GlobalSettings) => void
}

export default function ParamEditors({
  scenesArray,
  activeScene,
  scrubSettings,
  setScrubValues,
  globalSettings,
  setGlobalSettings
}: ParamEditorsProps) {
  const [activeParamKey, setActiveParamKey] = useState<string | null>(null)

  const activeSceneSettings = scenesArray[activeScene]

  // Collect visible global params (where show is true)
  const visibleGlobalParams = Object.entries(
    activeSceneSettings?.globalParams || {}
  )
    .filter(([, config]) => config?.show === true)
    .map(([key]) => key)

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

  if (allParamKeys.length === 0) {
    return <></>
  }

  return (
    <div className='space-y-3'>
      {/* Param Selector */}
      <div className='flex gap-2 overflow-x-auto pb-2'>
        {allParamKeys.map(paramKey => {
          const isGlobal = visibleGlobalParams.includes(paramKey)
          return (
            <button
              key={paramKey}
              onClick={() =>
                setActiveParamKey(activeParamKey === paramKey ? null : paramKey)
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

      {/* Param Editor */}
      {activeParamKey && activeParamConfig && (
        <div className='rounded-lg p-3'>
          {Array.from({
            length: activeParamConfig.dimension
          }).map((_, i) => {
            const currentValue =
              scrubSettings.params?.[activeParamKey]?.[i] ??
              activeParamConfig.default?.[i] ??
              activeParamConfig.min

            return (
              <div key={i} className='w-full'>
                {activeParamConfig.labels?.[i] && (
                  <div className='text-white/50 text-xs mb-1 px-1'>
                    {activeParamConfig.labels[i]}
                  </div>
                )}
                <div className='flex relative h-6 rounded'>
                  <span className='text-white/70 text-xs absolute left-0 top-0 p-1 select-none'>
                    {currentValue.toFixed(3)}
                  </span>
                  <Slider
                    className='w-full h-full select-none pointer-grab'
                    min={activeParamConfig.min}
                    max={activeParamConfig.max}
                    exponent={activeParamConfig.exponent}
                    values={{ x: currentValue, y: 0 }}
                    sliderStyle={({ x }) => ({
                      width: `${x * 200}%`,
                      left: 0,
                      top: '50%',
                      transform: 'translate(-50%, -50%)',
                      opacity: x,
                      height: '4px',
                      borderRadius: '2px',
                      backgroundColor: 'white',
                      position: 'absolute',
                      pointerEvents: 'none',
                      flex: 0
                    })}
                    onChange={({ x }) => {
                      setScrubValues(prev => {
                        const updated = [...prev]
                        const newParams = { ...updated[activeScene].params }
                        newParams[activeParamKey] = [
                          ...(newParams[activeParamKey] || [])
                        ]
                        newParams[activeParamKey][i] = x
                        updated[activeScene] = {
                          ...updated[activeScene],
                          params: newParams
                        }
                        return updated
                      })
                    }}
                  />
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
