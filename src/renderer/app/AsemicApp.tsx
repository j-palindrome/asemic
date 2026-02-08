import Asemic from '@/lib/Asemic'
import { AsemicData, Scene } from '@/lib/types'
import _, { isEqual, isUndefined, last, set } from 'lodash'
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Ellipsis,
  LucideProps,
  Maximize2,
  Plus,
  RefreshCw,
  Save,
  Undo,
  Upload,
  Settings,
  Wifi,
  WifiOff,
  Check
} from 'lucide-react'
import {
  act,
  MouseEventHandler,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import invariant from 'tiny-invariant'
import AsemicEditor, { AsemicEditorRef } from '../components/Editor'
import SceneSettingsPanel, {
  GlobalSettings,
  SceneSettings
} from '../components/SceneSettingsPanel'
import GlobalSettingsEditor from '../components/GlobalSettingsEditor'
import { JsonFileLoader } from '../components/JsonFileLoader'
import { ParsedJsonResult } from '../hooks/useJsonFileLoader'
import { open, save as saveDialog } from '@tauri-apps/plugin-dialog'
import { readTextFile, writeTextFile, readDir } from '@tauri-apps/plugin-fs'
import { invoke } from '@tauri-apps/api/core'
import { convertFileSrc } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { writeText } from '@tauri-apps/plugin-clipboard-manager'
import ParamEditors from '../components/ParamEditors'
import Scroller from '../components/Scrubber'
import WebRTCStream from '../components/WebRTCStream'
import ScenePicker from '../components/ScenePicker'
import { useAsemicStore } from '../store/asemicStore'

export type ScrubSettings = {
  params: Record<string, number[]>
  sent: Record<string, number[]>
  scrub: number
}

export const lucideProps = {
  color: 'white',
  opacity: 0.5,
  height: 18,
  width: 18
} as LucideProps

function AsemicAppInner({
  getRequire
}: {
  getRequire: (file: string) => Promise<string>
}) {
  // Parse scenes as JSON array
  const scenesArray = useAsemicStore(state => state.scenesArray)
  const setScenesArray = useAsemicStore(state => state.setScenesArray)
  const focusedScene = useAsemicStore(state => state.focusedScene)

  const scrubValues = useAsemicStore(state => state.scrubValues)
  const setScrubValues = useAsemicStore(state => state.setScrubValues)
  let activeScenes: number[] = []
  for (let i = 0; i < scrubValues.length; i++) {
    if (scrubValues[i]?.scrub! > 0) {
      activeScenes.push(i)
    }
  }
  let activeScenesRef = useRef<number[]>([])
  activeScenesRef.current = activeScenes
  const [globalSettings, _setGlobalSettings] = useState<GlobalSettings>({
    params: {},
    presets: {}
  } as GlobalSettings)
  const scrubValuesRef = useRef(scrubValues)
  useEffect(() => {
    scrubValuesRef.current = scrubValues
  }, [scrubValues])

  // const setScenesArray = (newArray: SceneSettings[]) => {
  //   if (newArray.length !== scrubValues.length) {
  //     const newValues: ScrubSettings[] = new Array(newArray.length)
  //       .fill(null)
  //       .map(() => ({
  //         params: {},
  //         sent: {}
  //       }))
  //     // Copy over what we can
  //     for (let i = 0; i < Math.min(scrubValues.length, newValues.length); i++) {
  //       newValues[i] = scrubValues[i]
  //     }

  //     setScrubValues(newValues)
  //   }

  //   // Update only if different
  //   _setScenesArray(newArray)

  //   localStorage.setItem('scenesArray', JSON.stringify(newArray))
  // }

  const setGlobalSettings = (newSettings: GlobalSettings) => {
    // Update only if different
    _setGlobalSettings(newSettings)
    localStorage.setItem('globalSettings', JSON.stringify(newSettings))
  }

  const [settings, setSettings] = useState(Asemic.defaultSettings)
  const settingsRef = useRef(settings)
  useEffect(() => {
    settingsRef.current = settings
  }, [settings])

  const canvas = useRef<HTMLCanvasElement>(null!)

  const useErrors = () => {
    const [errors, setErrorsState] = useState<string[]>([])
    const errorsRef = useRef<string[]>(errors)
    useEffect(() => {
      errorsRef.current = errors
    }, [errors])
    const setErrors = (newErrors: string[]) => {
      if (!isEqual(errorsRef.current, newErrors)) {
        setErrorsState(newErrors)
      }
    }
    return [errors, setErrors, errorsRef] as const
  }
  const [errors, setErrors, errorsRef] = useErrors()

  const asemic = useRef<Asemic>(null)

  // active scene is now a "focus" state for the last focused scene

  // useEffect(() => {
  //   for (let sendTo of Object.values(globalSettings.sendTo || {})) {
  //     invoke('emit_osc_event', {
  //       targetAddr: `${sendTo.host}:${9000}`,
  //       eventName: '/progress',
  //       data: `${progress}`
  //     })
  //       .catch(err => {
  //         console.error('Failed to emit OSC scene list:', err)
  //       })
  //       .then(res => {
  //         console.log('sent', res)
  //       })
  //   }
  // }, [progress])

  // useEffect(() => {
  //   setErrors([])
  // }, [activeScene, scenesArray[activeScene]?.code])

  // const client = useMemo(() => new Client('localhost', 57120), [])
  const [isSetup, setIsSetup] = useState(false)

  useEffect(() => {
    if (!asemic.current) {
      asemic.current = new Asemic(data => {
        if (!isUndefined(data.errors)) {
          setErrors(data.errors)
        }
      })
    }
  }, [asemic])

  useEffect(() => {
    setIsSetup(true)
  }, [])

  useEffect(() => {
    const newScrubs = [...scrubValues]
    newScrubs[focusedScene] = { ...newScrubs[focusedScene], sent: {} }
    while (!newScrubs[focusedScene]) {
      newScrubs.push({ params: {}, sent: {}, scrub: 0 })
    }
    if (!scenesArray[focusedScene]) {
      const newArray = [...scenesArray]
      while (!newArray[focusedScene]) {
        newArray.push({ code: '', length: 0.1, offset: 0, params: {} })
      }
      setScenesArray(newArray)
      return
    }

    const sceneParams = scenesArray[focusedScene].params || {}
    const currentParams = newScrubs[focusedScene].params || {}

    // Initialize any undefined params with their default values
    for (const [key, config] of Object.entries(sceneParams)) {
      currentParams[key] = config.default
    }
    // Also initialize global params if present
    for (const [key, config] of Object.entries(globalSettings.params)) {
      // global settings force their saved defaults
      if (scenesArray[focusedScene].globalParams?.[key]) {
        currentParams[key] =
          scenesArray[focusedScene].globalParams?.[key].default
      } else if (
        scenesArray.findLastIndex(
          (scene, i) => i < focusedScene && scene.globalParams?.[key]
        ) !== -1
      ) {
        // find last scene that had this param defined
        const lastSceneIdx = scenesArray.findLastIndex(
          (scene, i) => i < focusedScene && scene.globalParams?.[key]
        )

        currentParams[key] =
          scenesArray[lastSceneIdx].globalParams?.[key].default ??
          config.default
      } else {
        currentParams[key] = config.default
      }
    }

    newScrubs[focusedScene].params = currentParams
    newScrubs[focusedScene].sent = {}

    setScrubValues(newScrubs)
  }, [focusedScene, scenesArray.length])

  const sentValuesRef = useRef<{}>({})

  useEffect(() => {
    sentValuesRef.current = {}
  }, [focusedScene])

  useEffect(() => {
    let animationFrame: number | null = null
    let sceneReady = true

    const animate = () => {
      // animationFrame = requestAnimationFrame(animate)
      try {
        if (!sceneReady) return
        sceneReady = false

        const boundingRect = canvas.current.getBoundingClientRect()
        devicePixelRatio = 2

        const width = boundingRect.width || 1080
        const height = boundingRect.height || 1080

        ;(async () => {
          const groups: any[] = []

          const scenesToProcess = activeScenesRef.current.map(scene => {
            const currentSceneSettings = scenesArray[scene]
            return {
              code: currentSceneSettings.code || '',
              length: currentSceneSettings.length,
              offset: currentSceneSettings.offset,
              pause: currentSceneSettings.pause,
              params: scrubValuesRef.current[scene]!.params,
              scrub: scrubValuesRef.current[scene]!.scrub || 0,
              width,
              height,
              id: `${scene}` // Assign unique ID per scene
            }
          })

          const curves: any = await invoke('parse_asemic_source', {
            scene: scenesToProcess
          })
          groups.push(...curves.groups)
          for (let scene of scenesToProcess) {
            for (const sample of Object.entries(scene.params || {})) {
              const paramName = sample[0]

              // Skip if value hasn't changed from last sent value
              const lastSentValue = sentValuesRef.current[paramName]
              const value = sample[1]

              if (isEqual(lastSentValue, value) || value === undefined) {
                continue
              }
              // if (paramName === 'interfere') debugger

              const newValue: any = await invoke<number>(
                'parser_eval_expression',
                {
                  expr: value.join(','),
                  oscAddress:
                    globalSettings.params[paramName]?.oscPath ??
                    '/' + paramName,
                  oscTargets: [
                    { host: 'localhost', port: 57120 },
                    { host: 'localhost', port: 57110 }
                  ],
                  sceneMetadata: scene
                }
              )

              sentValuesRef.current[paramName] = [...newValue]
            }
            // for (const group of scene.oscGroups || []) {
            //   const oscTargets =
            //     (group.osc?.length || 0) > 0
            //       ? Object.values(globalSettings.sendTo || {}).map(t => ({
            //           host: t.host,
            //           port: t.port
            //         }))
            //       : []

            //   // Process OSC messages in group sequentially
            //   for (const oscMsg of group.osc || []) {
            //     // Skip if once flag is set and value exists
            //     if (
            //       oscMsg.play === 'once' &&
            //       sentValuesRef.current[oscMsg.name]
            //     ) {
            //       continue
            //     }

            //     const result = await invoke<number>('parser_eval_expression', {
            //       expr: oscMsg.value.toString(),
            //       oscAddress: oscMsg.name,
            //       oscTargets: oscTargets,
            //       sceneMetadata: currentScene
            //     })
            //     sentValuesRef.current[oscMsg.name] = [result]
            //   }
            // }
          }

          asemic.current?.postMessage({
            // @ts-ignore
            groups: groups as any,
            scene: {
              scrub: scrubValuesRef.current[focusedScene]?.scrub
            } as any
          })
        })().then(() => {
          sceneReady = true
        })
      } catch (e) {
        console.error('Error in animation frame:', e)
        sceneReady = true
      }
    }

    if (isSetup) {
      animationFrame = requestAnimationFrame(animate)
      // animate()
    }

    return () => {
      if (animationFrame !== null) {
        cancelAnimationFrame(animationFrame)
      }
    }
  }, [isSetup, scenesArray])

  const [deletedScene, setDeletedScene] = useState<{
    scene: SceneSettings
    index: number
  } | null>(null)

  // Extract settings from active scene
  useEffect(() => {
    asemic.current?.postMessage({ reset: true })
  }, [focusedScene])

  // Update scene settings in source
  const updateSceneSettings = (newSettings: SceneSettings) => {
    const newScenesArray = [...scenesArray]
    console.log(newScenesArray)
    if (focusedScene < newScenesArray.length) {
      newScenesArray[focusedScene] = {
        ...newScenesArray[focusedScene],
        ...newSettings
      }
    }

    setScenesArray(newScenesArray)
  }

  useEffect(() => {
    let stored = localStorage.getItem('scenesArray')
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as SceneSettings[]
        setScenesArray(parsed)
        // console.log('loading', parsed)
      } catch (e) {
        // Ignore parse errors
      }
    }
    stored = localStorage.getItem('globalSettings')
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as GlobalSettings
        setGlobalSettings(parsed)
        // console.log('loading', parsed)
      } catch (e) {
        // Ignore parse errors
      }
    }
  }, [])

  // Add new scene after current scene
  const addSceneAfterCurrent = () => {
    const newScenesArray = [...scenesArray]
    // Insert empty scene after current scene
    newScenesArray.splice(focusedScene + 1, 0, {
      code: '',
      length: 0.1,
      offset: 0,
      params: {}
    } as SceneSettings)
    setScenesArray(newScenesArray)
  }

  // Delete current scene
  const deleteCurrentScene = () => {
    if (scenesArray.length <= 1) {
      // Don't delete if it's the only scene
      return
    }
    const newScenesArray = [...scenesArray]
    const deletedSceneData = newScenesArray[focusedScene]
    newScenesArray.splice(focusedScene, 1)
    setScenesArray(newScenesArray)
    // Store deleted scene for undo
    setDeletedScene({
      scene: deletedSceneData,
      index: focusedScene
    })
    // Clear undo after 10 seconds
    setTimeout(() => setDeletedScene(null), 10000)
  }

  // Undo scene deletion
  const undoDeleteScene = () => {
    if (!deletedScene) return
    const newScenesArray = [...scenesArray]
    newScenesArray.splice(deletedScene.index, 0, deletedScene.scene)
    setScenesArray(newScenesArray)
    const newSource = JSON.stringify(newScenesArray, null, 2)
    setDeletedScene(null)
  }

  const [perform, _setPerform] = useState(settings.perform)
  const [showGlobalSettings, _setShowGlobalSettings] = useState(false)
  const [selectedPreset, setSelectedPreset] = useState<string | null>(null)
  const [selectedPresetType, setSelectedPresetType] = useState<
    'scene' | 'global' | null
  >(null)
  const [presetInterpolation, setPresetInterpolation] = useState(0)
  const presetFromRef = useRef<Record<string, number[]> | null>(null)
  const [showWebRTC, setShowWebRTC] = useState(false)
  const setPerform = (value: boolean) => {
    if (!value && showGlobalSettings) {
      _setShowGlobalSettings(false)
    }
    _setPerform(value)
  }
  useEffect(() => {
    setPerform(settings.perform)
  }, [settings.perform])
  const [showCanvas, setShowCanvas] = useState(true)

  // Interpolate between saved ref params and target preset
  useEffect(() => {
    if (
      !selectedPreset ||
      !selectedPresetType ||
      presetInterpolation === 0 ||
      !presetFromRef.current
    ) {
      return
    }

    let targetPreset
    if (selectedPresetType === 'scene') {
      targetPreset = scenesArray[focusedScene]?.presets?.[selectedPreset]
    } else {
      targetPreset = globalSettings.presets?.[selectedPreset]
    }

    if (!targetPreset) return

    setScrubValues(prev => {
      const newValues = [...prev]
      const currentScrub = newValues[focusedScene]
      if (!currentScrub) return prev

      const interpolatedParams: Record<string, number[]> = {}

      // Get all param keys from ref starting point and target
      const allKeys = new Set([
        ...Object.keys(presetFromRef.current || {}),
        ...Object.keys(targetPreset.params || {})
      ])

      for (const key of allKeys) {
        const fromValue = presetFromRef.current?.[key] || []
        const targetValue = targetPreset.params[key] || []

        // Interpolate each dimension from ref to targe t
        interpolatedParams[key] = []
        const maxLen = Math.max(fromValue.length, targetValue.length)

        for (let i = 0; i < maxLen; i++) {
          const from = fromValue[i] ?? 0
          const target = targetValue[i] ?? 0
          interpolatedParams[key][i] =
            from + (target - from) * presetInterpolation
        }
      }

      newValues[focusedScene] = {
        ...currentScrub,
        params: { ...newValues[focusedScene].params, ...interpolatedParams }
      }
      for (let sendTo of Object.values(globalSettings.sendTo || {})) {
        invoke('emit_osc_event', {
          targetAddr: `${sendTo.host}:${9000}`,
          eventName: '/params',
          data: JSON.stringify({
            params: interpolatedParams,
            scene: focusedScene
          })
        })
      }

      return newValues
    })
  }, [selectedPreset, selectedPresetType, presetInterpolation, focusedScene])

  const setShowGlobalSettings = (value: boolean) => {
    if (value && !perform) setPerform(true)
    _setShowGlobalSettings(value)
  }

  // Listen for params events from Tauri
  useEffect(() => {
    let unlistenParams: (() => void) | null = null

    const setupParamsListener = async () => {
      try {
        unlistenParams = await listen<string>('params', event => {
          const { params, scene } = JSON.parse(event.payload)
          const targetScene = scene ?? focusedScene

          setScrubValues(prev => {
            const newValues = [...prev]
            if (!newValues[targetScene]) {
              newValues[targetScene] = { params: {}, sent: {}, scrub: 0 }
            }
            newValues[targetScene].params = {
              ...newValues[targetScene].params,
              ...params
            }

            return newValues
          })
        })
      } catch (error) {
        console.error('Failed to setup params listener:', error)
      }
    }

    setupParamsListener()

    return () => {
      if (unlistenParams) {
        unlistenParams()
      }
    }
  }, [focusedScene])

  useEffect(() => {
    const onResize = () => {
      const boundingRect = canvas.current.getBoundingClientRect()
      devicePixelRatio = 2

      // canvas.current.width = boundingRect.width * devicePixelRatio
      // canvas.current.height = boundingRect.height * devicePixelRatio

      const width = (boundingRect.width || 1080) * devicePixelRatio
      const height = (boundingRect.height || 1080) * devicePixelRatio

      asemic.current!.postMessage({
        preProcess: {
          width,
          height
        }
      })
    }
    if (asemic.current) {
      asemic.current.setup(canvas.current)
      const resizeObserver = new ResizeObserver(onResize)
      resizeObserver.observe(canvas.current)

      window.addEventListener('resize', onResize)
      onResize()
      return () => {
        resizeObserver.disconnect()
        window.removeEventListener('resize', onResize)
      }
    }
  }, [showCanvas, asemic])

  return (
    <div
      className={`relative w-full bg-black overflow-hidden h-screen asemic-app`}>
      <canvas
        style={{
          width: '100%',
          height: '100%',
          display: showCanvas ? 'block' : 'none'
        }}
        id='mainCanvas'
        ref={canvas}
        height={1080}
        width={1080}></canvas>

      <div className='absolute top-0 left-0 h-full w-full flex-col flex !z-100 pointer-events-none select-none'>
        <div className='flex items-center px-0 py-1 z-100 pointer-events-auto'>
          <ScenePicker />
          <div className='grow' />
          {deletedScene && (
            <button
              onClick={undoDeleteScene}
              className='flex items-center gap-1 px-2 py-1 bg-white/10 rounded hover:bg-white/20 transition-colors'>
              <Undo {...lucideProps} size={14} />
              <span className='text-white text-xs opacity-70'>Undo Delete</span>
            </button>
          )}
          <button
            onClick={() => {
              setScenesArray([
                {
                  code: '',
                  length: 0.1,
                  offset: 0,
                  params: {}
                }
              ])
              setScrubValues([{ params: {}, sent: {}, scrub: 0 }])
              setGlobalSettings({ params: {}, presets: {} })
              localStorage.removeItem('scenesArray')
              localStorage.removeItem('globalSettings')
            }}
            title='New Document'
            className='p-1 hover:bg-white/10 rounded transition-colors'>
            <Plus {...lucideProps} size={16} />
          </button>{' '}
          <JsonFileLoader
            sceneList={scenesArray}
            setSceneList={setScenesArray}
            globalSettings={globalSettings}
            setGlobalSettings={setGlobalSettings}
          />
          <button
            onClick={() => setShowGlobalSettings(!showGlobalSettings)}
            title='Global Settings'
            className='p-1 hover:bg-white/10 rounded transition-colors'>
            <Settings {...lucideProps} size={16} />
          </button>
          <button
            onClick={() => setShowWebRTC(!showWebRTC)}
            title='WebRTC Stream'
            className='p-1 hover:bg-white/10 rounded transition-colors'>
            {showWebRTC ? (
              <Wifi {...lucideProps} size={16} />
            ) : (
              <WifiOff {...lucideProps} size={16} />
            )}
          </button>
          <button onClick={() => setPerform(!perform)}>
            {<Ellipsis {...lucideProps} />}
          </button>
        </div>
        {!perform && (
          <>
            <div className='pointer-events-auto'>
              <SceneSettingsPanel
                sceneList={scenesArray}
                activeScene={focusedScene}
                onUpdate={newSettings => {
                  updateSceneSettings(newSettings)
                }}
                scrubSettings={scrubValues[focusedScene]}
                onUpdateScrub={newScrubSettings => {
                  setScrubValues(prev => {
                    const newValues = [...prev]
                    newValues[focusedScene] = newScrubSettings
                    return newValues
                  })
                }}
                onAddScene={addSceneAfterCurrent}
                onDeleteScene={deleteCurrentScene}
                globalSettings={globalSettings}
                setGlobalSettings={setGlobalSettings}
                errors={errors}
                selectedPreset={selectedPreset}
                selectedPresetType={selectedPresetType}
                presetInterpolation={presetInterpolation}
                setSelectedPreset={setSelectedPreset}
                setSelectedPresetType={setSelectedPresetType}
                setPresetInterpolation={setPresetInterpolation}
                presetFromRef={presetFromRef}
              />
            </div>
          </>
        )}
        {perform && scenesArray[focusedScene]?.text && (
          <div className='pointer-events-auto w-full px-4 pb-4 mt-auto max-h-[75%]'>
            <div className='relative bg-black/50 rounded-xl px-4 py-2 text-white text-left max-w-4xl mr-auto whitespace-pre-wrap w-fit font-mono text-base overflow-y-auto h-full'>
              {scenesArray[focusedScene]?.text || ''}
            </div>
          </div>
        )}
        {perform && (
          <>
            <div className='pointer-events-auto w-full h-[calc(100%-60px)] px-4 pb-4 absolute top-[60px] right-0'>
              <ParamEditors
                globalSettings={globalSettings}
                setGlobalSettings={setGlobalSettings}
                selectedPreset={selectedPreset}
                selectedPresetType={selectedPresetType}
                presetInterpolation={presetInterpolation}
                setSelectedPreset={setSelectedPreset}
                setSelectedPresetType={setSelectedPresetType}
                setPresetInterpolation={setPresetInterpolation}
                presetFromRef={presetFromRef}
              />
            </div>
          </>
        )}
        {showGlobalSettings && (
          <div className='pointer-events-auto'>
            <GlobalSettingsEditor
              settings={globalSettings}
              onUpdate={setGlobalSettings}
              onClose={() => setShowGlobalSettings(false)}
              sceneList={scenesArray}
              setSceneList={setScenesArray}
            />
          </div>
        )}
      </div>
      {showWebRTC && (
        <div
          id='tdSignaling'
          className='fixed top-4 right-4 w-96 backdrop-blur border border-gray-700 rounded-lg shadow-lg p-4 z-100 max-h-[90vh] overflow-y-auto select-text'>
          <button
            onClick={() => setShowWebRTC(false)}
            className='absolute top-2 right-2 p-1 hover:bg-white/10 rounded transition-colors'
            title='Close'>
            <span className='text-white text-lg opacity-70 hover:opacity-100'>
              ×
            </span>
          </button>
          <WebRTCStream roomId={null} />
        </div>
      )}
    </div>
  )
}

export default function AsemicApp(props: {
  getRequire: (file: string) => Promise<string>
}) {
  return <AsemicAppInner {...props} />
}
