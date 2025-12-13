import Asemic from '@/lib/Asemic'
import { Parser, Scene } from '@/lib/parser/Parser'
import { AsemicData } from '@/lib/types'
import _, { isEqual, isUndefined } from 'lodash'
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
  Upload
} from 'lucide-react'
import { MouseEventHandler, useEffect, useMemo, useRef, useState } from 'react'
import invariant from 'tiny-invariant'
import AsemicEditor, { AsemicEditorRef } from '../components/Editor'
import SceneSettingsPanel, {
  SceneSettings
} from '../components/SceneParamsEditor'
import { JsonFileLoader } from '../components/JsonFileLoader'
import { ParsedJsonResult } from '../hooks/useJsonFileLoader'
import { open, save as saveDialog } from '@tauri-apps/plugin-dialog'
import { readTextFile, writeTextFile, readDir } from '@tauri-apps/plugin-fs'
import { invoke } from '@tauri-apps/api/core'
import { convertFileSrc } from '@tauri-apps/api/core'

function AsemicAppInner({
  getRequire
}: {
  getRequire: (file: string) => Promise<string>
}) {
  // Parse scenes as JSON array
  const [scenesArray, _setScenesArray] = useState<SceneSettings[]>([])
  const setScenesArray = (newArray: SceneSettings[]) => {
    if (!isEqual(scenesArray, newArray)) {
      // Update only if different
      _setScenesArray(newArray)
      localStorage.setItem('scenesArray', JSON.stringify(newArray))
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

  // Track scrub position per scene (local playback position within each scene)
  const [scrubValues, setScrubValues] = useState<number[]>([])
  const scrubValuesRef = useRef(scrubValues)
  useEffect(() => {
    scrubValuesRef.current = scrubValues
  }, [scrubValues])

  // Initialize scrub values when scenes change
  useEffect(() => {
    setScrubValues(prev => {
      const newValues = new Array(scenesArray.length).fill(0)
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

  // Audio playback using Web Audio API
  const audioContextRef = useRef<AudioContext | null>(null)
  const audioSourceRef = useRef<AudioBufferSourceNode | null>(null)
  const currentAudioTrackRef = useRef<string | null>(null)
  const [audioBuffers, setAudioBuffers] = useState<Map<string, AudioBuffer>>(
    new Map()
  )

  // Initialize Web Audio context
  useEffect(() => {
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext()
    }
    return () => {
      if (audioSourceRef.current) {
        audioSourceRef.current.stop()
      }
    }
  }, [])

  // Load audio file and convert to AudioBuffer
  const loadAudioTrack = async (filePath: string) => {
    try {
      if (!audioContextRef.current) return

      const response = await fetch(convertFileSrc(filePath))
      const arrayBuffer = await response.arrayBuffer()
      const audioBuffer = await audioContextRef.current.decodeAudioData(
        arrayBuffer
      )

      setAudioBuffers(prev => {
        const next = new Map(prev)
        next.set(filePath, audioBuffer)
        return next
      })

      return audioBuffer
    } catch (error) {
      return null
    }
  }

  // Play audio track with looping
  const playAudioTrack = async (filePath: string) => {
    if (!audioContextRef.current) return

    // Stop current audio if playing
    if (audioSourceRef.current) {
      audioSourceRef.current.stop()
      audioSourceRef.current = null
    }

    // Get or load audio buffer
    let audioBuffer: AudioBuffer | undefined = audioBuffers.get(filePath)
    if (!audioBuffer) {
      const loadedBuffer = await loadAudioTrack(filePath)
      if (!loadedBuffer) return
      audioBuffer = loadedBuffer
    }

    // Create and start audio source
    const source = audioContextRef.current.createBufferSource()
    source.buffer = audioBuffer
    source.loop = true
    source.connect(audioContextRef.current.destination)
    source.start(0)

    audioSourceRef.current = source
    currentAudioTrackRef.current = filePath
  }

  // Stop audio playback
  const stopAudioTrack = () => {
    if (audioSourceRef.current) {
      audioSourceRef.current.stop()
      audioSourceRef.current = null
      currentAudioTrackRef.current = null
    }
  }

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
            params: currentSceneSettings.params,
            scrub:
              (scrubValuesRef.current[activeSceneRef.current] || 0) /
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
        if (sceneSettings?.osc && sceneSettings.osc.length > 0) {
          const oscHost = sceneSettings.oscHost || '127.0.0.1'
          const oscPort = sceneSettings.oscPort || 57120

          // Get canvas dimensions
          const boundingRect = canvas.current?.getBoundingClientRect()
          const width = (boundingRect?.width || 1080) * (devicePixelRatio || 2)
          const height =
            (boundingRect?.height || 1080) * (devicePixelRatio || 2)

          // Build scene metadata array
          const sceneMetadata = scenesArray.map((scene, idx) => ({
            start: 0,
            length: scene.length || 0.1,
            offset: scene.offset || 0,
            params: scene.params
              ? Object.entries(scene.params).reduce((acc, [key, config]) => {
                  acc[key] = config.value ?? config.min ?? 0
                  return acc
                }, {} as Record<string, number>)
              : {}
          }))

          // Process OSC messages sequentially to avoid overwhelming the parser
          for (const oscMsg of sceneSettings.osc) {
            try {
              if (typeof oscMsg.value === 'string' && oscMsg.value.trim()) {
                invoke<number>('parser_eval_expression', {
                  expr: oscMsg.value,
                  oscAddress: oscMsg.name,
                  oscHost: oscHost,
                  oscPort: oscPort,
                  width,
                  height,
                  currentScene: activeSceneRef.current,
                  sceneMetadata
                })
              } else if (typeof oscMsg.value === 'number') {
                invoke<number>('parser_eval_expression', {
                  expr: oscMsg.value.toString(),
                  oscAddress: oscMsg.name,
                  oscHost: oscHost,
                  oscPort: oscPort,
                  width,
                  height,
                  currentScene: activeSceneRef.current,
                  sceneMetadata
                })
              }
            } catch (error) {
              // Silent fail to prevent console spam
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

  const useKeys = () => {
    const [live, setLive] = useState({
      keys: ['', '', '', '', '', '', '', '', '', ''],
      index: { value: 0 }
    } as AsemicData['live'])
    const [isLive, setIsLive] = useState(false)

    useEffect(() => {
      asemic.current?.postMessage({
        live
      })
    }, [live])

    let keysPressed = useRef<Record<string, number>>({})
    useEffect(() => {
      const onKeyDown = (ev: KeyboardEvent) => {
        if (ev.repeat) {
          return
        }

        if (ev.ctrlKey) {
          if (/[0-9]/.test(ev.key)) {
            const index = Number(ev.key)
            setLive({ ...live, index: { ...live.index, value: index } })
          }
          if (ev.key === ' ') {
            ev.preventDefault()
            ev.stopPropagation()
            return
          }
          // Remove End key handling that used totalLength
        } else if (isLive) {
          if (ev.key === 'Escape') {
            setIsLive(false)
          }
          if (ev.key.length === 1 && !ev.metaKey && !ev.ctrlKey) {
            keysPressed.current[String(ev.key)] = performance.now()
          }
          const newKeys = [...live.keys]
          newKeys[live.index.value] = Object.keys(keysPressed.current)
            .sort(x => keysPressed.current[x])
            .join('')

          setLive({ ...live, keys: newKeys })
        }
        const onKeyUp = (ev: KeyboardEvent) => {
          delete keysPressed.current[ev.key]
          const newKeys = [...live.keys]
          newKeys[live.index.value] = Object.keys(keysPressed.current)
            .sort(x => keysPressed.current[x])
            .join('')
          setLive({ ...live, keys: newKeys })
        }

        window.addEventListener('keydown', onKeyDown)
        window.addEventListener('keyup', onKeyUp)
        return () => {
          window.removeEventListener('keydown', onKeyDown)
          window.removeEventListener('keyup', onKeyUp)
        }
      }
    }, [live, isLive])
    return [live, isLive, setIsLive] as const
  }
  const [live, isLive, setIsLive] = useKeys()

  // Scene settings state
  const [activeSceneSettings, setActiveSceneSettings] = useState<SceneSettings>(
    {}
  )
  const [deletedScene, setDeletedScene] = useState<{
    scene: SceneSettings
    index: number
  } | null>(null)

  // Extract settings from active scene
  useEffect(() => {
    try {
      if (activeScene < scenesArray.length) {
        const sceneSettings = scenesArray[activeScene]
        // Normalize params to ensure they have value field
        if (sceneSettings.params) {
          for (const [key, param] of Object.entries(sceneSettings.params)) {
            const p = param as any
            if (p.value === undefined) {
              p.value = p.min ?? 0
            }
          }
        }
        setActiveSceneSettings(sceneSettings)
      } else {
        setActiveSceneSettings({})
      }
    } catch (e) {
      setActiveSceneSettings({})
    }
    asemic.current?.postMessage({ reset: true })
  }, [scenesArray, activeScene])

  // Play/stop audio based on active scene
  useEffect(() => {
    const audioTrack = activeSceneSettings.audioTrack

    if (audioTrack && audioTrack !== currentAudioTrackRef.current) {
      playAudioTrack(audioTrack)
    } else if (!audioTrack && currentAudioTrackRef.current) {
      stopAudioTrack()
    }
  }, [activeSceneSettings.audioTrack, activeScene])

  // Update scene settings in source
  const updateSceneSettings = (newSettings: typeof activeSceneSettings) => {
    const newScenesArray = [...scenesArray]
    console.log('updating scene:', newSettings)

    if (activeScene < newScenesArray.length) {
      newScenesArray[activeScene] = {
        ...newScenesArray[activeScene],
        ...newSettings
      }
    }
    setScenesArray(newScenesArray)
  }

  useEffect(() => {
    const stored = localStorage.getItem('scenesArray')
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as SceneSettings[]
        setScenesArray(parsed)
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
    const newSource = JSON.stringify(newScenesArray, null, 2)
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

  // Audio track loading and playback
  const [audioFiles, setAudioFiles] = useState<Map<string, HTMLAudioElement>>(
    new Map()
  )

  const loadAudioFolder = async () => {
    try {
      const folderPath = await open({
        multiple: false,
        directory: true
      })

      if (!folderPath) {
        // User cancelled
        return
      }

      const entries = await readDir(folderPath as string)
      const audioExtensions = ['.mp3', '.wav', '.ogg', '.m4a', '.flac', '.aac']
      const newAudioFiles = new Map<string, HTMLAudioElement>()

      for (const entry of entries) {
        if (!entry.isFile) continue

        const lowerName = entry.name.toLowerCase()
        const hasAudioExt = audioExtensions.some(ext => lowerName.endsWith(ext))

        if (hasAudioExt) {
          const fullPath = `${folderPath}/${entry.name}`
          const audio = new Audio(convertFileSrc(fullPath))

          // Preload the audio
          audio.preload = 'auto'

          // Store with filename (without extension) as key
          const nameWithoutExt = entry.name.replace(/\.[^/.]+$/, '')
          newAudioFiles.set(nameWithoutExt, audio)
        }
      }

      setAudioFiles(newAudioFiles)
    } catch (error) {
      // Failed to load audio folder
    }
  }

  const [perform, setPerform] = useState(settings.perform)
  useEffect(() => {
    setPerform(settings.perform)
  }, [settings.perform])
  const [showCanvas, setShowCanvas] = useState(true)

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

        <div className='fixed top-1 left-1 h-full w-[calc(100%-60px)] flex-col flex !z-100 pointer-events-none'>
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
              <div className='text-white text-xs opacity-50 px-1 font-mono'>
                Scene {activeScene + 1} / {scenesArray.length}
              </div>
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
                value={scrubValues[activeScene] || 0}
                onChange={e => {
                  const newScrub = parseFloat(e.target.value)
                  setScrubValues(prev => {
                    const newValues = [...prev]
                    newValues[activeScene] = newScrub
                    return newValues
                  })
                }}
                className='w-32 h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer'
                style={{
                  accentColor: 'white'
                }}
              />
              <span className='text-white text-xs opacity-50 font-mono min-w-[60px]'>
                {(scrubValues[activeScene] || 0).toFixed(2)}s
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
            />
            <button onClick={() => setPerform(!perform)}>
              {<Ellipsis {...lucideProps} />}
            </button>
          </div>
          {!perform && (
            <>
              {/* Scene Settings Panel - Now contains the editor */}

              <div className='pointer-events-auto'>
                <SceneSettingsPanel
                  activeScene={activeScene}
                  settings={activeSceneSettings}
                  onUpdate={newSettings => {
                    setActiveSceneSettings(newSettings)
                    updateSceneSettings(newSettings)
                  }}
                  onAddScene={addSceneAfterCurrent}
                  onDeleteScene={deleteCurrentScene}
                />
              </div>
            </>
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
