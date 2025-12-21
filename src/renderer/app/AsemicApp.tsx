import Asemic from '@/lib/Asemic'
import { Parser, Scene } from '@/lib/parser/Parser'
import { AsemicData } from '@/lib/types'
import _, { isEqual, isUndefined, set } from 'lodash'
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
  Settings
} from 'lucide-react'
import { MouseEventHandler, useEffect, useMemo, useRef, useState } from 'react'
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
import ParamEditors from '../components/ParamEditors'

export type ScrubSettings = {
  scrub: number
  params: Record<string, number[]>
  sent: Record<string, boolean>
}

function AsemicAppInner({
  getRequire
}: {
  getRequire: (file: string) => Promise<string>
}) {
  // Parse scenes as JSON array
  const [scenesArray, _setScenesArray] = useState<SceneSettings[]>([])
  const [globalSettings, _setGlobalSettings] = useState<GlobalSettings>(
    {} as GlobalSettings
  )

  const setScenesArray = (newArray: SceneSettings[]) => {
    // Update only if different
    _setScenesArray(newArray)
    console.log('new settings')

    localStorage.setItem('scenesArray', JSON.stringify(newArray))
  }

  const setGlobalSettings = (newSettings: GlobalSettings) => {
    if (!isEqual(globalSettings, newSettings)) {
      // Update only if different
      _setGlobalSettings(newSettings)
      localStorage.setItem('globalSettings', JSON.stringify(newSettings))
    }
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

  const useProgress = () => {
    const [progress, setProgress] = useState(0)
    const [scenes, setScenes] = useState<number[]>([])

    return [progress, setProgress, scenes, setScenes] as const
  }
  const [progress, setProgress, scenes, setScenes] = useProgress()

  // Calculate scene boundaries from scenesArray for navigation
  const sceneStarts = useMemo(() => {
    let cumulative = 0
    return scenesArray.map((scene, idx) => {
      const start = cumulative
      const length = scene.length || 0.1
      const offset = scene.offset || 0
      cumulative += length - offset
      return start
    })
  }, [scenesArray])

  // Track scrub position and params per scene
  const [scrubValues, setScrubValues] = useState<ScrubSettings[]>([
    { params: {}, scrub: 0, sent: {} }
  ])
  const scrubValuesRef = useRef(scrubValues)
  useEffect(() => {
    scrubValuesRef.current = scrubValues
  }, [scrubValues])

  // Initialize scrub values when scenes change
  useEffect(() => {
    setScrubValues(prev => {
      const newValues: ScrubSettings[] = new Array(scenesArray.length)
        .fill(null)
        .map(() => ({
          scrub: 0,
          params: {},
          sent: {}
        }))
      // Preserve existing scrub values if scenes didn't change length
      if (prev.length === newValues.length) {
        return prev
      }
      // Copy over what we can
      for (let i = 0; i < Math.min(prev.length, newValues.length); i++) {
        newValues[i] = prev[i]
      }
      return newValues
    })
  }, [scenesArray.length])

  // Calculate active scene based on current progress
  const activeScene = useMemo(() => {
    if (sceneStarts.length === 0) return 0

    // Find which scene we're currently in
    for (let i = sceneStarts.length - 1; i >= 0; i--) {
      if (progress >= sceneStarts[i]) {
        return i
      }
    }
    return 0
  }, [progress, sceneStarts])

  const activeSceneRef = useRef(activeScene)
  useEffect(() => {
    activeSceneRef.current = activeScene
  }, [activeScene])

  const animationFrameRef = useRef<number | null>(null)
  const globalTimeRef = useRef<number>(0) // Global time counter, always incrementing

  // const client = useMemo(() => new Client('localhost', 57120), [])
  const [isSetup, setIsSetup] = useState(false)

  useEffect(() => {
    if (!asemic.current) {
      asemic.current = new Asemic(data => {
        if (!isUndefined(data.eval)) {
          for (let evalString of data.eval) {
            const evalFunction = eval(`({_, sc}) => {
                ${evalString}
              }`)
            evalFunction({ _ })
          }
        }
        if (!isUndefined(data.errors)) {
          setErrors(data.errors)
        }
        if (!isUndefined(data.progress)) {
          setProgress(data.progress)
          // Remove Rust state sync
        }
        if (!isUndefined(data.scenes)) {
          setScenes(data.scenes)
        }
      })
    }
  }, [asemic])

  useEffect(() => {
    setIsSetup(true)
  }, [])

  // Animation loop - updates parser and OSC
  const lastFrameTimeRef = useRef<number>(performance.now())

  useEffect(() => {
    const newScrubs = [...scrubValues]
    newScrubs[activeScene] = { ...newScrubs[activeScene], sent: {} }
    if (newScrubs[activeScene] && scenesArray[activeScene]?.params) {
      const sceneParams = scenesArray[activeScene].params
      const currentParams = newScrubs[activeScene].params || {}

      // Initialize any undefined params with their default values
      for (const [key, config] of Object.entries(sceneParams)) {
        if (currentParams[key] === undefined) {
          currentParams[key] = config.default ?? config.min
        }
      }

      newScrubs[activeScene].params = currentParams
    }
    setScrubValues(newScrubs)
  }, [activeScene])

  useEffect(() => {
    const animate = () => {
      try {
        const now = performance.now()
        const deltaTime = (now - lastFrameTimeRef.current) / 1000
        lastFrameTimeRef.current = now

        // Global time always increments
        globalTimeRef.current += deltaTime

        // Update parser with current scene
        const preProcess = {
          replacements: {}
        } as Parser['preProcessing']

        if (activeSceneRef.current < scenesArray.length) {
          const currentSceneSettings = scenesArray[activeSceneRef.current]
          const currentScene: Scene = {
            code: currentSceneSettings.code || '',
            length: currentSceneSettings.length,
            offset: currentSceneSettings.offset,
            pause: currentSceneSettings.pause,
            params: scrubValuesRef.current[activeSceneRef.current]!.params,
            scrub:
              (scrubValuesRef.current[activeSceneRef.current]?.scrub || 0) /
              (currentSceneSettings.length || 0.1)
          }

          asemic.current?.postMessage({
            scene: currentScene,
            sceneIndex: activeSceneRef.current,
            preProcess
          })
          // console.log('drawing scene', currentScene)
        }

        // Evaluate OSC expressions if present
        const sceneSettings = scenesArray[activeSceneRef.current]
        if (sceneSettings?.oscGroups && sceneSettings.oscGroups.length > 0) {
          // Process each OSC group
          for (const group of sceneSettings.oscGroups) {
            const oscHost = group.oscHost || 'localhost'
            const oscPort = group.oscPort || 57120

            // Process OSC messages in group sequentially
            for (const oscMsg of group.osc || []) {
              if (
                oscMsg.play === 'once' &&
                scrubValuesRef.current[activeSceneRef.current]!.sent[
                  oscMsg.name
                ]
              ) {
                continue
              }
              invoke<number>('parser_eval_expression', {
                expr: oscMsg.value.toString(),
                oscAddress: oscMsg.name,
                oscHost: oscHost,
                oscPort: oscPort,
                sceneMetadata: scrubValuesRef.current[activeSceneRef.current]!
              }).then(result => {
                // console.log('OSC expression result:', result)
              })
              if (oscMsg.play === 'once') {
                // immediate update, also save in state
                scrubValuesRef.current[activeSceneRef.current]!.sent[
                  oscMsg.name
                ] = true
                setScrubValues(prev => {
                  const newValues = [...prev]
                  if (newValues[activeSceneRef.current]) {
                    newValues[activeSceneRef.current] = {
                      ...newValues[activeSceneRef.current],
                      sent: {
                        ...newValues[activeSceneRef.current].sent,
                        [oscMsg.name]: true
                      }
                    }
                  }
                  return newValues
                })
              }
            }
          }
        }
      } catch (error) {
        console.error('Animation loop error:', error)
      }

      animationFrameRef.current = requestAnimationFrame(animate)
    }

    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current)
    }
    if (isSetup) {
      lastFrameTimeRef.current = performance.now()
      animationFrameRef.current = requestAnimationFrame(animate)
    }

    return () => {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current)
        animationFrameRef.current = null
      }
    }
  }, [isSetup, scenesArray])

  // Scene settings state
  const [activeSceneSettings, setActiveSceneSettings] = useState<SceneSettings>(
    { params: {} }
  )
  const [deletedScene, setDeletedScene] = useState<{
    scene: SceneSettings
    index: number
  } | null>(null)

  // Extract settings from active scene
  useEffect(() => {
    const sceneSettings = scenesArray[activeScene]
    setActiveSceneSettings(sceneSettings ?? { params: {} })
    asemic.current?.postMessage({ reset: true })
  }, [scenesArray, activeScene])

  // Update scene settings in source
  const updateSceneSettings = (newSettings: typeof activeSceneSettings) => {
    const newScenesArray = [...scenesArray]
    if (activeScene < newScenesArray.length) {
      newScenesArray[activeScene] = {
        ...newScenesArray[activeScene],
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
        console.log('loading', parsed)
      } catch (e) {
        // Ignore parse errors
      }
    }
    stored = localStorage.getItem('globalSettings')
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as GlobalSettings
        setGlobalSettings(parsed)
        console.log('loading', parsed)
      } catch (e) {
        // Ignore parse errors
      }
    }
  }, [])

  // Add new scene after current scene
  const addSceneAfterCurrent = () => {
    const newScenesArray = [...scenesArray]
    // Insert empty scene after current scene
    newScenesArray.splice(activeScene + 1, 0, {
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
    const deletedSceneData = newScenesArray[activeScene]
    newScenesArray.splice(activeScene, 1)
    setScenesArray(newScenesArray)
    // Store deleted scene for undo
    setDeletedScene({
      scene: deletedSceneData,
      index: activeScene
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

  const setShowGlobalSettings = (value: boolean) => {
    if (value && !perform) setPerform(true)
    _setShowGlobalSettings(value)
  }

  const frame = useRef<HTMLDivElement>(null!)
  const requestFullscreen = async () => {
    frame.current.style.setProperty('height', '100vh', 'important')
    await frame.current?.requestFullscreen()
  }
  useEffect(() => {
    if (settings.perform) {
      requestFullscreen()
    }
  }, [settings.perform])

  const lucideProps = useMemo(
    () =>
      ({
        color: 'white',
        opacity: 0.5,
        height: 18,
        width: 18
      } as LucideProps),
    []
  )

  const editorRef = useRef<AsemicEditorRef | null>(null)

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
    <div className='asemic-container relative group'>
      <div
        className={`relative w-full bg-black overflow-auto ${
          settings.h === 'window' ? 'h-screen' : 'h-fit max-h-screen'
        } fullscreen:max-h-screen`}
        ref={frame}>
        <canvas
          style={{
            width: '100%',
            height: settings.h === 'window' ? '100%' : undefined,
            aspectRatio:
              settings.h === 'window' ? undefined : `1 / ${settings.h}`,
            display: showCanvas ? 'block' : 'none'
          }}
          ref={canvas}
          height={1080}
          width={1080}></canvas>

        <div className='fixed top-1 left-1 h-full w-full flex-col flex !z-100 pointer-events-none'>
          <div className='flex items-center px-0 py-1 z-100 pointer-events-auto'>
            <div className='flex items-center gap-1'>
              <button
                onClick={() => {
                  const prevScene = Math.max(0, activeScene - 1)
                  if (prevScene !== activeScene) {
                    // Jump to the start of the previous scene using our calculated boundaries
                    const prevSceneStart = sceneStarts[prevScene] || 0
                    const offset = scenesArray[prevScene]?.offset || 0
                    const targetProgress = prevSceneStart + offset + 0.001
                    setProgress(targetProgress)
                  }
                }}
                disabled={activeScene === 0}
                className='disabled:opacity-30'>
                <ChevronLeft {...lucideProps} size={16} />
              </button>
              <select
                value={activeScene}
                onChange={e => {
                  const sceneIndex = parseInt(e.target.value, 10)
                  const sceneStart = sceneStarts[sceneIndex] || 0
                  const offset = scenesArray[sceneIndex]?.offset || 0
                  setProgress(sceneStart + offset + 0.001)
                }}
                className='text-white text-xs bg-white/10 border border-white/20 rounded px-2 py-1 font-mono cursor-pointer hover:bg-white/20'>
                {scenesArray.map((_, idx) => (
                  <option key={idx} value={idx}>
                    {idx + 1}
                  </option>
                ))}
              </select>
              <button
                onClick={() => {
                  const nextScene = Math.min(
                    scenesArray.length - 1,
                    activeScene + 1
                  )
                  if (nextScene !== activeScene) {
                    // Jump to the start of the next scene using our calculated boundaries
                    const nextSceneStart = sceneStarts[nextScene] || 0
                    const offset = scenesArray[nextScene]?.offset || 0
                    const targetProgress = nextSceneStart + offset + 0.001
                    setProgress(targetProgress)
                  }
                }}
                disabled={activeScene === scenesArray.length - 1}
                className='disabled:opacity-30'>
                <ChevronRight {...lucideProps} size={16} />
              </button>
            </div>
            {/* Scrub slider for current scene */}
            <div className='flex items-center gap-2 px-2'>
              <input
                type='range'
                min='0'
                max={
                  (scenesArray[activeScene]?.length || 0.1) -
                  (scenesArray[activeScene]?.offset || 0)
                }
                step='0.01'
                value={scrubValues[activeScene]?.scrub || 0}
                onChange={e => {
                  const newScrub = parseFloat(e.target.value)
                  setScrubValues(prev => {
                    const newValues = [...prev]
                    if (newValues[activeScene]) {
                      newValues[activeScene].scrub = newScrub
                    }
                    return newValues
                  })
                }}
                className='w-32 h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer'
                style={{
                  accentColor: 'white'
                }}
              />
              <span className='text-white text-xs opacity-50 font-mono min-w-[60px]'>
                {(scrubValues[activeScene]?.scrub || 0).toFixed(2)}s
              </span>
            </div>
            <div className='grow' />
            {deletedScene && (
              <button
                onClick={undoDeleteScene}
                className='flex items-center gap-1 px-2 py-1 bg-white/10 rounded hover:bg-white/20 transition-colors'>
                <Undo {...lucideProps} size={14} />
                <span className='text-white text-xs opacity-70'>
                  Undo Delete
                </span>
              </button>
            )}
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
            <button onClick={() => setPerform(!perform)}>
              {<Ellipsis {...lucideProps} />}
            </button>
          </div>
          {!perform && (
            <>
              <div className='pointer-events-auto'>
                <SceneSettingsPanel
                  sceneList={scenesArray}
                  activeScene={activeScene}
                  settings={activeSceneSettings}
                  onUpdate={newSettings => {
                    setActiveSceneSettings(newSettings)
                    updateSceneSettings(newSettings)
                  }}
                  scrubSettings={scrubValues[activeScene]}
                  onUpdateScrub={newScrubSettings => {
                    setScrubValues(prev => {
                      const newValues = [...prev]
                      newValues[activeScene] = newScrubSettings
                      return newValues
                    })
                  }}
                  onAddScene={addSceneAfterCurrent}
                  onDeleteScene={deleteCurrentScene}
                />
              </div>
            </>
          )}
          {perform && scenesArray[activeScene]?.text && (
            <div className='pointer-events-auto w-full px-4 pb-4 mt-auto max-h-[75%]'>
              <div className='relative bg-black/50 rounded-xl px-4 py-2 text-white text-left max-w-4xl mx-auto whitespace-pre-wrap w-fit font-mono text-base overflow-y-auto h-full'>
                {scenesArray[activeScene]?.text || ''}
              </div>
            </div>
          )}
          {perform && (
            <>
              <div className='pointer-events-auto w-full px-4 pb-4 absolute top-[60px] left-0'>
                <ParamEditors
                  scenesArray={scenesArray}
                  activeScene={activeScene}
                  scrubSettings={scrubValues[activeScene]}
                  setScrubValues={setScrubValues}
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
              />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function AsemicApp(props: {
  getRequire: (file: string) => Promise<string>
}) {
  return <AsemicAppInner {...props} />
}
