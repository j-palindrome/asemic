import { useEffect, useMemo, useRef } from 'react'
import { useAsemicStore } from '../store/asemicStore'
import Slider from './Slider'
import { GlobalSettings } from './SceneSettingsPanel'
import { invoke } from '@tauri-apps/api/core'
import { Y } from 'node_modules/react-router/dist/development/index-react-server-client-DRhjXpk2.mjs'

export default function XYPad({
  globalSettings,
  setGlobalSettings
}: {
  globalSettings: GlobalSettings
  setGlobalSettings: (settings: GlobalSettings) => void
}) {
  const focusedScene = useAsemicStore(state => state.focusedScene)
  const scene = useAsemicStore(state => state.scenesArray[state.focusedScene])
  const memoedPresets = useMemo(() => {
    const presetLength = Object.keys(scene.presets || {}).length
    let memoedPresets = {}
    const presetKeys = Object.keys(scene.presets || {})
    const angle = (1 / presetLength) * 2 * Math.PI
    const radius = 0.5

    const pointA: [number, number] = [1, 0.5]
    const pointB: [number, number] = [
      0.5 + radius * Math.cos(angle),
      0.5 + radius * Math.sin(angle)
    ]
    const computedRadius =
      Math.hypot(pointB[0] - pointA[0], pointB[1] - pointA[1]) / 2
    for (let i = 0; i < presetKeys.length; i++) {
      const key = presetKeys[i]
      const angle = (i / presetLength) * 2 * Math.PI
      const calcPosition = [
        0.5 + radius * Math.cos(angle),
        0.5 + radius * Math.sin(angle)
      ]
      memoedPresets[key] = {
        ...scene.presets![key],
        position: calcPosition,
        radius: computedRadius
      }
    }
    return memoedPresets
  }, [scene.presets])
  const currentValues = useAsemicStore(
    state => state.scrubValues[state.focusedScene]
  )
  const currentValuesRef = useRef(currentValues)
  useEffect(() => {
    currentValuesRef.current = currentValues
  }, [currentValues])
  const setScrubValues = useAsemicStore(state => state.setScrubValues)

  const mostRecentSettings = useRef<Record<string, number[]>>(
    currentValues.params
  )
  const mouseRef = useRef<HTMLDivElement>(null)
  const lastFocusedPreset = useRef<string | null>(null)

  const process = ({ x, y }: { x: number; y: number }) => {
    let found: { preset: string; distance: number }[] = []

    for (let [presetName, preset] of Object.entries(scene.presets || {})) {
      const [px, py] = memoedPresets![presetName].position
      const distance = Math.sqrt((x - px) ** 2 + (y - py) ** 2)
      const distanceRatio = distance / memoedPresets![presetName].radius

      if (distanceRatio < 1) {
        found.push({ preset: presetName, distance: distanceRatio })
      }
    }
    found.sort((a, b) => a.distance - b.distance)

    const closest = found[0]

    if (closest) {
      if (closest.preset !== lastFocusedPreset.current) {
        mostRecentSettings.current = currentValuesRef.current.params
        lastFocusedPreset.current = closest.preset
      }
      const presetSettings = memoedPresets![closest.preset].params || {}

      // Fade between mostRecentSettings and presetSettings
      const fadedSettings: Record<string, number[]> = {}
      const allKeys = new Set([
        ...Object.keys(mostRecentSettings.current),
        ...Object.keys(presetSettings)
      ])

      allKeys.forEach(key => {
        const recent = mostRecentSettings.current[key]
        if (!recent) return
        const preset = presetSettings[key]
        if (!preset) return
        fadedSettings[key] = preset.map(
          (x, i) => recent[i] + (x - recent[i]) * (1 - closest.distance)
        )
      })
      setScrubValues(previous => {
        const newPrevious = [...previous]
        newPrevious[focusedScene] = {
          ...newPrevious[focusedScene],
          params: { ...newPrevious[focusedScene].params, ...fadedSettings }
        }
        return newPrevious
      })
    }
  }

  const processTouches = (e: React.TouchEvent) => {
    const rect = (e.target as HTMLDivElement).getBoundingClientRect()
    const x = (e.touches[0].clientX - rect.left) / rect.width
    const y = (e.touches[0].clientY - rect.top) / rect.height
    // console.log('mouse', x, y)
    process({ x, y })
  }
  const processMouse = (e: React.MouseEvent) => {
    if (e.buttons === 0) return
    const rect = (e.target as HTMLDivElement).getBoundingClientRect()
    const x = (e.clientX - rect.left) / rect.width
    const y = (e.clientY - rect.top) / rect.height
    process({ x, y })
  }
  return (
    <div
      className='h-full w-full relative'
      ref={mouseRef}
      onMouseMove={processMouse}
      onTouchMove={processTouches}
      onMouseDown={() => {
        mostRecentSettings.current = currentValues.params
      }}>
      <div className='absolute top-0 right-0 w-fit h-full flex gap-2'>
        <Slider
          className='w-6 h-full select-none'
          min={0}
          max={1}
          exponent={1}
          values={{ x: 0, y: currentValues.scrub ?? 0 }}
          sliderStyle={({ y }) => ({
            height: `${y * 100}%`,
            left: '50%',
            bottom: 0,
            border: '1px solid white',
            transform: 'translate(-50%, 0)',
            width: '100%',
            borderRadius: '2px',
            backgroundColor: 'white',
            position: 'absolute',
            pointerEvents: 'none',
            flex: 0
          })}
          onChange={({ y }) => {
            setScrubValues(prev => {
              const updated = [...prev]
              updated[focusedScene] = {
                ...updated[focusedScene],
                scrub: y
              }
              return updated
            })
            for (let sendTo of Object.values(globalSettings.sendTo || {})) {
              try {
                invoke('emit_osc_event', {
                  targetAddr: `${sendTo.host}:${sendTo.port}`,
                  eventName: '/params',
                  data: JSON.stringify({
                    scrub: y,
                    scene: focusedScene
                  })
                })
                  .catch(err => {
                    console.error('Failed to emit OSC scene list:', err)
                  })
                  .then(res => {
                    console.log('sent', res)
                  })
              } catch (err) {
                console.error('Failed to emit OSC scene list:', err)
              }
            }
          }}
        />
        <Slider
          className='w-6 h-full select-none'
          min={0}
          max={1}
          exponent={1}
          values={{ x: 0, y: currentValues.fade ?? 0 }}
          sliderStyle={({ y }) => ({
            height: `${y * 100}%`,
            left: '50%',
            bottom: 0,
            border: '1px solid white',
            transform: 'translate(-50%, 0)',
            width: '100%',
            borderRadius: '2px',
            backgroundColor: 'blue',
            position: 'absolute',
            pointerEvents: 'none',
            flex: 0
          })}
          onChange={({ y }) => {
            setScrubValues(prev => {
              const updated = [...prev]
              if (globalSettings.fadeMode === 'single') {
                for (let i = 0; i < updated.length; i++) {
                  if (updated[i].fade > 0 && i !== focusedScene) {
                    updated[i] = {
                      ...updated[i],
                      fade: 1 - y
                    }
                  }
                }
              }
              updated[focusedScene] = {
                ...updated[focusedScene],
                fade: y
              }

              return updated
            })
            for (let sendTo of Object.values(globalSettings.sendTo || {})) {
              invoke('emit_osc_event', {
                targetAddr: `${sendTo.host}:${sendTo.port}`,
                eventName: '/params',
                data: JSON.stringify({
                  fade: y,
                  scene: focusedScene
                })
              })
                .catch(err => {
                  console.error('Failed to emit OSC scene list:', err)
                })
                .then(async res => {
                  const scrubValues = useAsemicStore.getState().scrubValues
                  if (globalSettings.fadeMode === 'single') {
                    for (let i = 0; i < scrubValues.length; i++) {
                      if (i === focusedScene) continue
                      const scene = scrubValues[i]
                      if (scene.fade > 0) {
                        await invoke('emit_osc_event', {
                          targetAddr: `${sendTo.host}:${sendTo.port}`,
                          eventName: '/params',
                          data: JSON.stringify({
                            fade: 1 - y,
                            scene: i
                          })
                        })
                      }
                    }
                  }
                })
            }
          }}
        />
      </div>
    </div>
  )
}
