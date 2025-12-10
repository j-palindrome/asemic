import Asemic from '@/lib/Asemic'
import { Parser, Scene } from '@/lib/parser/Parser'
import { AsemicData } from '@/lib/types'
import _, { isEqual, isUndefined } from 'lodash'
import {
  Download,
  Ellipsis,
  Info,
  LucideProps,
  Maximize2,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Save,
  Settings2,
  Upload
} from 'lucide-react'
import { MouseEventHandler, useEffect, useMemo, useRef, useState } from 'react'
import invariant from 'tiny-invariant'
import AsemicEditor, { AsemicEditorRef } from '../components/Editor'
import SceneSettingsPanel, {
  SceneSettings
} from '../components/SceneParamsEditor'
import { open, save as saveDialog } from '@tauri-apps/plugin-dialog'
import { readTextFile, writeTextFile, readDir } from '@tauri-apps/plugin-fs'
import { invoke } from '@tauri-apps/api/core'
import { convertFileSrc } from '@tauri-apps/api/core'

function AsemicAppInner({
  source,
  save,
  getRequire
}: {
  source: string
  save: (source: string, { reload }: { reload: boolean }) => void
  getRequire: (file: string) => Promise<string>
}) {
  const [scenesSource, setScenesSource] = useState(source)

  // Parse scenes as JSON array
  const scenesArray = useMemo(() => {
    try {
      const trimmedSource = scenesSource.trim()
      if (trimmedSource.startsWith('[')) {
        return JSON.parse(trimmedSource) as SceneSettings[]
      }
      // Fallback: treat as single scene with code property
      return [{ code: trimmedSource }] as SceneSettings[]
    } catch (e) {
      // On parse error, return single empty scene
      return [{}] as SceneSettings[]
    }
  }, [scenesSource])
  useEffect(() => {
    if (scenesSource !== source) {
      save(scenesSource, { reload: false })
    }
  }, [scenesSource])
  const scenesSourceRef = useRef(scenesSource)
  useEffect(() => {
    scenesSourceRef.current = scenesSource
  }, [scenesSource])
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

  const usePauseAt = () => {
    const [pauseAt, setPauseAt] = useState<Parser['pauseAt']>(false)
    const pauseAtRef = useRef(pauseAt)
    useEffect(() => {
      pauseAtRef.current = pauseAt
    }, [pauseAt])
    return [pauseAt, setPauseAt, pauseAtRef] as const
  }
  const [pauseAt, setPauseAt, pauseAtRef] = usePauseAt()
  const asemic = useRef<Asemic>(null)

  const useProgress = () => {
    const [progress, setProgress] = useState(0)
    const [totalLength, setTotalLength] = useState(0)
    const [scenes, setScenes] = useState<number[]>([])

    return [
      progress,
      setProgress,
      totalLength,
      setTotalLength,
      scenes,
      setScenes
    ] as const
  }
  const [
    progress,
    setProgress,
    totalLength,
    setTotalLength,
    scenes,
    setScenes
  ] = useProgress()

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
    if (scenes.length === 0) return 0

    // Find which scene we're currently in
    for (let i = scenes.length - 1; i >= 0; i--) {
      if (progress >= scenes[i]) {
        return i
      }
    }
    return 0
  }, [progress, scenes])

  const activeSceneRef = useRef(activeScene)
  useEffect(() => {
    activeSceneRef.current = activeScene
  }, [activeScene])

  const animationFrameRef = useRef<number | null>(null)

  const setup = () => {
    // const client = useMemo(() => new Client('localhost', 57120), [])
    const [isSetup, setIsSetup] = useState(false)

    useEffect(() => {
      if (!asemic.current) {
        asemic.current = new Asemic(data => {
          if (!isUndefined(data.pauseAt)) {
            if (pauseAtRef.current !== data.pauseAt) {
              setPauseAt(data.pauseAt)
            }
          }
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
            // Update Rust state when scene changes
            invoke('update_parser_progress', {
              scene: activeScene,
              scrub: data.progress
            }).catch(console.error)
          }
          if (!isUndefined(data.totalLength)) {
            setTotalLength(data.totalLength)
          }
          if (!isUndefined(data.scenes)) {
            setScenes(data.scenes)
          }
          if (!isUndefined(data.sceneMetadata)) {
            // Enrich scene metadata with param values from scene settings
            const enrichedMetadata = data.sceneMetadata.map(
              (metadata, index) => {
                const trimmedSource = scenesSourceRef.current.trim()

                // Handle JSON array format
                if (trimmedSource.startsWith('[')) {
                  try {
                    const sceneObjects = JSON.parse(trimmedSource) as Array<{
                      code: string
                      params?: Record<
                        string,
                        { value?: number; default?: number }
                      >
                      [key: string]: any
                    }>

                    if (index < sceneObjects.length) {
                      const sceneSettings = sceneObjects[index]
                      if (sceneSettings.params) {
                        const params: Record<string, number> = {}
                        for (const [key, config] of Object.entries(
                          sceneSettings.params
                        )) {
                          params[key] = config.value ?? config.default ?? 0
                        }
                        return { ...metadata, params }
                      }
                    }
                  } catch (e) {
                    // Failed to parse JSON array
                  }
                }

                return metadata
              }
            )

            // Sync scene metadata to Rust for scene-relative scrub calculations
            invoke('update_scene_metadata', {
              scenes: enrichedMetadata
            }).catch(console.error)
          }
        })
      }
    }, [asemic])

    useEffect(() => {
      setIsSetup(true)

      // Sync time periodically
      const timeInterval = setInterval(() => {
        const currentTime = performance.now() / 1000
        invoke('update_parser_time', { time: currentTime }).catch(console.error)
      }, 100) // Update every 100ms

      return () => clearInterval(timeInterval)
    }, [])

    // Rust parser animation loop (always active)
    useEffect(() => {
      const animate = async () => {
        try {
          // Get current scene settings
          const sceneSettings: SceneSettings = scenesArray[
            activeSceneRef.current
          ] || {
            length: 0.1,
            offset: 0,
            pause: 0
          }

          // Evaluate OSC expressions if present
          if (sceneSettings.osc && sceneSettings.osc.length > 0) {
            await invoke('update_parser_progress', {
              scene: activeSceneRef.current,
              scrub: progress
            })

            // Send OSC messages - evaluate expressions and transmit
            const oscHost = sceneSettings.oscHost || '127.0.0.1'
            const oscPort = sceneSettings.oscPort || 57120

            await Promise.all(
              sceneSettings.osc.map(async oscMsg => {
                try {
                  if (typeof oscMsg.value === 'string' && oscMsg.value.trim()) {
                    // Evaluate expression and send OSC message
                    await invoke<number>('parser_eval_expression', {
                      expr: oscMsg.value,
                      oscAddress: oscMsg.name,
                      oscHost: oscHost,
                      oscPort: oscPort
                    })
                  } else if (typeof oscMsg.value === 'number') {
                    // For static numbers, still send via same path for consistency
                    await invoke<number>('parser_eval_expression', {
                      expr: oscMsg.value.toString(),
                      oscAddress: oscMsg.name,
                      oscHost: oscHost,
                      oscPort: oscPort
                    })
                  }
                } catch (error) {
                  console.error(`OSC send error for ${oscMsg.name}:`, error)
                }
              })
            )
          }
        } catch (error) {
          console.error('Rust parser error:', error)
        }

        animationFrameRef.current = requestAnimationFrame(animate)
      }

      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current)
      }
      if (isSetup) {
        animationFrameRef.current = requestAnimationFrame(animate)
      }

      return () => {
        if (animationFrameRef.current !== null) {
          cancelAnimationFrame(animationFrameRef.current)
          animationFrameRef.current = null
        }
      }
    }, [isSetup, scenesArray])

    // Separate effect for JS parser setup
    useEffect(() => {
      if (!isSetup) return

      const restart = async () => {
        const preProcess = {
          replacements: {}
        } as Parser['preProcessing']
        const links = scenesSource.match(/\[\[.*?\]\]/)
        if (links) {
          for (let link of links) {
            const fileName = link.substring(2, link.length - 2)
            preProcess.replacements[link] = (await getRequire(fileName)).trim()
          }
        }

        // Extract params from active scene and send to parser
        if (activeScene < scenesArray.length) {
          const sceneSettings = scenesArray[activeScene]
          if (sceneSettings.params) {
            asemic.current?.postMessage({
              params: sceneSettings.params
            })
          }

          // Send the current scene to the parser
          const currentScene: Scene = {
            code: sceneSettings.code || '',
            length: sceneSettings.length,
            offset: sceneSettings.offset,
            pause: sceneSettings.pause,
            params: sceneSettings.params
          }

          console.log('posting', currentScene)
          asemic.current?.postMessage({
            scene: currentScene,
            preProcess
          })
        }
      }
      restart()
    }, [scenesSource, isSetup, activeScene, scenesArray])
  }
  setup()

  const editable = useRef<HTMLTextAreaElement>(null!)

  useEffect(() => {
    if (!editable.current) return
    editable.current.value = scenesSource
  }, [scenesSource])

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
            if (pauseAt) {
              asemic.current?.postMessage({
                play: true
              } as AsemicData)
            }
            return
          }
          // Scrubber keyboard controls
          if (ev.key === 'ArrowLeft' && totalLength > 0) {
            ev.preventDefault()
            const newProgress = Math.max(0, progress - 0.1)
            if (asemic.current) {
              asemic.current.postMessage({
                scrub: newProgress
              } as Partial<AsemicData>)
              invoke('update_parser_progress', {
                scene: activeScene,
                scrub: newProgress
              }).catch(console.error)
            }
            return
          }
          if (ev.key === 'ArrowRight' && totalLength > 0) {
            ev.preventDefault()
            const newProgress = Math.min(totalLength, progress + 0.1)
            if (asemic.current) {
              asemic.current.postMessage({
                scrub: newProgress
              } as AsemicData)
              invoke('update_parser_progress', {
                scene: activeScene,
                scrub: newProgress
              }).catch(console.error)
            }
            return
          }
          if (ev.key === 'Home' && totalLength > 0) {
            ev.preventDefault()
            if (asemic.current) {
              asemic.current.postMessage({
                scrub: 0
              } as AsemicData)
              invoke('update_parser_progress', {
                scene: activeScene,
                scrub: 0
              }).catch(console.error)
            }
            return
          }
          if (ev.key === 'End' && totalLength > 0) {
            ev.preventDefault()
            if (asemic.current) {
              asemic.current.postMessage({
                scrub: totalLength
              } as AsemicData)
              invoke('update_parser_progress', {
                scene: activeScene,
                scrub: totalLength
              }).catch(console.error)
            }
            return
          }
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
  const [showSceneSettings, setShowSceneSettings] = useState(true) // Changed to true by default
  const [activeSceneSettings, setActiveSceneSettings] = useState<SceneSettings>(
    {}
  )

  // Extract current scene code
  const currentSceneCode = useMemo(() => {
    if (activeScene < scenesArray.length) {
      return scenesArray[activeScene].code || ''
    }
    return ''
  }, [scenesArray, activeScene])

  // Update current scene code when editor changes
  const updateCurrentSceneCode = (newCode: string) => {
    const newScenesArray = [...scenesArray]
    if (activeScene < newScenesArray.length) {
      newScenesArray[activeScene] = {
        ...newScenesArray[activeScene],
        code: newCode
      }
      const newSource = JSON.stringify(newScenesArray, null, 2)
      setScenesSource(newSource)
    }
  }

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
              p.value = p.default ?? 0
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
    try {
      const newScenesArray = [...scenesArray]
      if (activeScene < newScenesArray.length) {
        newScenesArray[activeScene] = {
          ...newScenesArray[activeScene],
          ...newSettings
        }
        const newSource = JSON.stringify(newScenesArray, null, 2)
        setScenesSource(newSource)
        // Update editor with code if it changed
        if (newSettings.code !== undefined) {
          editorRef.current?.setValue(newSettings.code)
        }
      }
    } catch (e) {
      // Failed to update scene settings
    }
  }

  // Add new scene after current scene
  const addSceneAfterCurrent = () => {
    const newScenesArray = [...scenesArray]
    // Insert empty scene after current scene
    newScenesArray.splice(activeScene + 1, 0, {})
    const newSource = JSON.stringify(newScenesArray, null, 2)
    setScenesSource(newSource)
  }

  // Delete current scene
  const deleteCurrentScene = () => {
    if (scenesArray.length <= 1) {
      // Don't delete if it's the only scene
      return
    }
    const newScenesArray = [...scenesArray]
    newScenesArray.splice(activeScene, 1)
    const newSource = JSON.stringify(newScenesArray, null, 2)
    setScenesSource(newSource)
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
  const [help, setHelp] = useState(false)
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

  const checkLive: MouseEventHandler<HTMLDivElement> = ev => {
    if (
      ev.target instanceof HTMLButtonElement ||
      (ev.target as Element).closest('button')
    ) {
      return
    }
    if (isLive && editorRef.current) {
      const rect = canvas.current.getBoundingClientRect()
      if (!rect) return
      const x = (ev.clientX - rect.left) / (rect.width || 1080)
      const y = (ev.clientY - rect.top) / (rect.height || 1080)
      const newPoint = `${x.toFixed(2).replace('.00', '')},${y
        .toFixed(2)
        .replace('.00', '')} `
      editorRef.current.insertAtCursor(newPoint)
      ev.stopPropagation()
      ev.preventDefault()
      setScenesSource(editorRef.current.getValue())
    }
  }

  const editorRef = useRef<AsemicEditorRef | null>(null)
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)
  const isScrollingRef = useRef(false)
  const scrollTimeoutRef = useRef<number | null>(null)
  const isDraggingRef = useRef(false)
  const dragStartRef = useRef({ y: 0, scrollTop: 0 })

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    // Ignore scroll events when playback is active (not paused)
    if (!pauseAtRef.current) {
      return
    }

    const target = e.currentTarget
    const scrollPercent =
      target.scrollTop / (target.scrollHeight - target.clientHeight || 1)
    const newProgress = scrollPercent * totalLength

    // Set scrolling flag
    isScrollingRef.current = true

    // Clear previous timeout
    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current)
    }

    // Reset scrolling flag after scroll ends
    scrollTimeoutRef.current = setTimeout(() => {
      isScrollingRef.current = false
    }, 150)

    if (asemic.current) {
      asemic.current.postMessage({
        scrub: newProgress
      } as AsemicData)
      invoke('update_parser_progress', {
        scene: activeScene,
        scrub: newProgress
      }).catch(console.error)
    }
  }

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!scrollContainerRef.current) return
    isDraggingRef.current = true
    dragStartRef.current = {
      y: e.clientY,
      scrollTop: scrollContainerRef.current.scrollTop
    }
    e.preventDefault()
  }

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current || !scrollContainerRef.current) return

    const deltaY = e.clientY - dragStartRef.current.y
    scrollContainerRef.current.scrollTop =
      dragStartRef.current.scrollTop - deltaY
    e.preventDefault()
  }

  const handleMouseUp = () => {
    isDraggingRef.current = false
  }

  const handleMouseLeave = () => {
    isDraggingRef.current = false
  }

  useEffect(() => {
    // Add global mouse up listener to catch mouse up outside the element
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [])

  // Update scroll position when progress changes externally (but not during user scrolling)
  useEffect(() => {
    if (isScrollingRef.current) return // Skip if user is scrolling

    if (scrollContainerRef.current && totalLength > 0) {
      const scrollPercent = progress / totalLength
      const scrollTop =
        scrollPercent *
        (scrollContainerRef.current.scrollHeight -
          scrollContainerRef.current.clientHeight)
      scrollContainerRef.current.scrollTop = scrollTop
    }
  }, [progress, totalLength])

  useEffect(() => {
    const onResize = () => {
      const boundingRect = canvas.current.getBoundingClientRect()
      devicePixelRatio = 2

      // canvas.current.width = boundingRect.width * devicePixelRatio
      // canvas.current.height = boundingRect.height * devicePixelRatio

      const width = (boundingRect.width || 1080) * devicePixelRatio
      const height = (boundingRect.height || 1080) * devicePixelRatio

      // Update Rust state with new dimensions
      invoke('update_parser_dimensions', { width, height }).catch(console.error)

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

        {/* Vertical playbar on the right */}
        <div
          ref={scrollContainerRef}
          className='fixed top-0 right-0 h-full w-12 overflow-y-scroll overflow-x-hidden !z-100 scrollbar-hide cursor-grab active:cursor-grabbing'
          onScroll={handleScroll}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseLeave}
          style={{
            scrollbarWidth: 'none',
            msOverflowStyle: 'none',
            userSelect: 'none'
          }}>
          {/* Scrollable content area - height determines scroll range */}
          <div
            style={{
              height: `calc(${Math.max(200, scenes.length * 100)}vh)`,
              position: 'relative'
            }}>
            {/* Scene markers */}
            {scenes.map((scene, index) => {
              // Position based on scene progress value relative to totalLength
              const scenePercent =
                totalLength > 0 ? (scene / totalLength) * 100 : 0
              return (
                <div
                  key={index}
                  className='absolute w-8 h-1 rounded-lg bg-[#68788f] left-1/2 -translate-x-1/2'
                  style={{
                    top: `${scenePercent}%`
                  }}>
                  <span className='text-[10px] text-white ml-10 whitespace-nowrap'>
                    {index}
                  </span>
                </div>
              )
            })}
            {/* Progress indicator */}
            <div
              className='sticky top-0 left-1/2 -translate-x-1/2 w-10 h-0.5 bg-[#3b82f6] rounded-lg z-10'
              style={{ pointerEvents: 'none' }}
            />
          </div>
        </div>

        <div
          className='fixed top-1 left-1 h-full w-[calc(100%-60px)] flex-col flex !z-100'
          onPointerDownCapture={checkLive}>
          <div className='flex items-center px-0 py-1 z-100'>
            <button
              onClick={() => {
                if (pauseAtRef.current) {
                  asemic.current!.postMessage({
                    play: true
                  } as AsemicData)
                } else {
                  asemic.current!.postMessage({
                    play: { pauseAt: progress }
                  } as AsemicData)
                }
              }}>
              {pauseAt ? <Play {...lucideProps} /> : <Pause {...lucideProps} />}
            </button>
            <button onClick={() => setHelp(!help)}>
              {<Info {...lucideProps} />}
            </button>
            <button onClick={() => setShowSceneSettings(!showSceneSettings)}>
              <Settings2 {...lucideProps} />
            </button>
            <div className='grow' />
            <button onClick={() => setPerform(!perform)}>
              {<Ellipsis {...lucideProps} />}
            </button>
          </div>
          {!perform && (
            <>
              {/* Scene Settings Panel - Now contains the editor */}
              {showSceneSettings && (
                <SceneSettingsPanel
                  activeScene={activeScene}
                  settings={activeSceneSettings}
                  onUpdate={newSettings => {
                    setActiveSceneSettings(newSettings)
                    updateSceneSettings(newSettings)
                  }}
                  onAddScene={addSceneAfterCurrent}
                  onDeleteScene={deleteCurrentScene}
                  onClose={() => setShowSceneSettings(false)}
                />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default function AsemicApp(props: {
  source: string
  save: (source: string, { reload }: { reload: boolean }) => void
  getRequire: (file: string) => Promise<string>
}) {
  return <AsemicAppInner {...props} />
}
