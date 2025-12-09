import Asemic from '@/lib/Asemic'
import { Parser } from '@/lib/parser/Parser'
import { AsemicData } from '@/lib/types'
import _, { isEqual, isUndefined } from 'lodash'
import {
  Download,
  Ellipsis,
  Eye,
  EyeOff,
  FoldVertical,
  Info,
  LucideProps,
  Maximize2,
  Music,
  Pause,
  Play,
  Plus,
  Power,
  RefreshCw,
  Save,
  Upload
} from 'lucide-react'
import { MouseEventHandler, useEffect, useMemo, useRef, useState } from 'react'
import invariant from 'tiny-invariant'
import AsemicEditor, { AsemicEditorRef } from '../components/Editor'
import SceneSettingsPanel from '../components/SceneParamsEditor'
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

  const [useRustParser, setUseRustParser] = useState(false)
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
          }
          if (!isUndefined(data.totalLength)) {
            setTotalLength(data.totalLength)
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

    useEffect(() => {
      if (!isSetup) return
      const restart = async () => {
        if (useRustParser) {
          // Rust parser path
          const syntaxTree = editorRef.current?.getSyntaxTree()

          if (!syntaxTree) {
            return
          }

          try {
            const parserState = await invoke('parser_setup', {
              input: {
                source: scenesSourceRef.current,
                tree: syntaxTree
              }
            })

            // Start animation loop for Rust parser
            const animate = async () => {
              if (!useRustParser) return

              try {
                // Get current scene settings
                const lines = scenesSourceRef.current.split('\n#')
                const sceneSettings: {
                  length: number
                  offset: number
                  pause: number | false
                  params?: Record<
                    string,
                    {
                      default: number
                      max: number
                      min: number
                      exponent: number
                    }
                  >
                  osc?: Array<{ name: string; value: number | string }>
                } = { length: 0.1, offset: 0, pause: 0 }

                if (activeScene < lines.length) {
                  const sceneText = lines[activeScene]
                  const firstLine = sceneText?.split('\n')[0]
                  const jsonMatch = firstLine?.match(/\{.+\}/)
                  if (jsonMatch) {
                    try {
                      Object.assign(sceneSettings, JSON.parse(jsonMatch[0]))
                    } catch (e) {}
                  }
                }

                // Evaluate OSC expressions if present
                if (sceneSettings.osc && sceneSettings.osc.length > 0) {
                  const evaluatedOsc = await Promise.all(
                    sceneSettings.osc.map(async oscMsg => {
                      try {
                        // If value is a string expression, evaluate it
                        if (typeof oscMsg.value === 'string') {
                          const result = await invoke<number>(
                            'parser_eval_expression',
                            { expr: oscMsg.value }
                          )
                          console.log(`OSC ${oscMsg.name}: ${result}`)
                          return { name: oscMsg.name, value: result }
                        }
                        // If already a number, keep it
                        console.log(`OSC ${oscMsg.name}: ${oscMsg.value}`)
                        return oscMsg
                      } catch (error) {
                        console.error(error)
                        // If evaluation fails, default to 0
                        return { name: oscMsg.name, value: 0 }
                      }
                    })
                  )
                  sceneSettings.osc = evaluatedOsc
                }

                // Call Rust parser_draw with current state
                const drawOutput = await invoke('parser_draw', {
                  input: {
                    progress,
                    scene_index: activeScene,
                    scene_settings: sceneSettings
                  }
                })

                // TODO: Handle drawOutput (render groups, update errors, etc.)
              } catch (error) {
                // Rust parser_draw failed
              }

              animationFrameRef.current = requestAnimationFrame(animate)
            }

            // Cancel any existing animation frame
            if (animationFrameRef.current) {
              cancelAnimationFrame(animationFrameRef.current)
            }

            // Start animation loop
            animationFrameRef.current = requestAnimationFrame(animate)
          } catch (error) {
            // Rust parser setup failed
          }
        } else {
          // Cancel Rust parser animation loop if disabled
          if (animationFrameRef.current) {
            cancelAnimationFrame(animationFrameRef.current)
            animationFrameRef.current = null
          }

          // Original JS parser path
          const preProcess = {
            replacements: {}
          } as Parser['preProcessing']
          const links = scenesSource.match(/\[\[.*?\]\]/)
          if (links) {
            for (let link of links) {
              const fileName = link.substring(2, link.length - 2)
              preProcess.replacements[link] = (
                await getRequire(fileName)
              ).trim()
            }
          }

          // Extract params from active scene and send to parser
          const lines = scenesSource.split('\n#')
          if (activeScene < lines.length) {
            const sceneText = lines[activeScene]
            const firstLine = sceneText?.split('\n')[0]
            const jsonMatch = firstLine?.match(/\{.+\}/)
            if (jsonMatch) {
              try {
                const settings = JSON.parse(jsonMatch[0])
                if (settings.params) {
                  asemic.current?.postMessage({
                    params: settings.params
                  })
                }
              } catch (e) {}
            }
          }

          asemic.current?.postMessage({
            source: scenesSourceRef.current,
            preProcess
          })
        }
      }
      restart()

      // Cleanup: cancel animation frame on unmount or when dependencies change
      return () => {
        if (animationFrameRef.current) {
          cancelAnimationFrame(animationFrameRef.current)
        }
      }
    }, [scenesSource, isSetup, useRustParser, progress, activeScene])
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
            }
            return
          }
          if (ev.key === 'Home' && totalLength > 0) {
            ev.preventDefault()
            if (asemic.current) {
              asemic.current.postMessage({
                scrub: 0
              } as AsemicData)
            }
            return
          }
          if (ev.key === 'End' && totalLength > 0) {
            ev.preventDefault()
            if (asemic.current) {
              asemic.current.postMessage({
                scrub: totalLength
              } as AsemicData)
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
  const [showSceneSettings, setShowSceneSettings] = useState(false)
  const [activeSceneSettings, setActiveSceneSettings] = useState<{
    length?: number
    offset?: number
    pause?: number | false
    params?: Record<
      string,
      { default: number; max: number; min: number; exponent: number }
    >
    osc?: Array<{ name: string; value: number }>
    audioTrack?: string
  }>({})

  // Extract settings from active scene
  useEffect(() => {
    try {
      const lines = scenesSource.split('\n#')
      if (activeScene < lines.length) {
        const sceneText = lines[activeScene]
        const firstLine = sceneText?.split('\n')[0]
        const jsonMatch = firstLine?.match(/\{.+\}/)
        if (jsonMatch) {
          try {
            const settings = JSON.parse(jsonMatch[0])
            setActiveSceneSettings(settings)
          } catch (e) {
            setActiveSceneSettings({})
          }
        } else {
          setActiveSceneSettings({})
        }
      }
    } catch (e) {
      setActiveSceneSettings({})
    }
  }, [scenesSource, activeScene])

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
      const lines = scenesSource.split('\n#')
      if (activeScene < lines.length) {
        const sceneLines = lines[activeScene].split('\n')
        const firstLine = sceneLines[0]
        const jsonMatch = firstLine?.match(/\{.+\}/)

        // Create new settings JSON
        const settingsJson = JSON.stringify(newSettings)

        if (jsonMatch) {
          // Replace existing settings
          sceneLines[0] = firstLine.replace(/\{.+\}/, settingsJson)
        } else {
          // Add settings to first line
          sceneLines[0] = settingsJson + (firstLine ? '\n' + firstLine : '')
        }

        lines[activeScene] = sceneLines.join('\n')
        const newSource = lines.join('\n#')
        setScenesSource(newSource)
        editorRef.current?.setValue(newSource)
      }
    } catch (e) {
      // Failed to update scene settings
    }
  }

  const currentFilePathRef = useRef<string | null>(null)

  const saveToFile = async () => {
    const content = editable.current?.value || scenesSource

    try {
      let filePath = currentFilePathRef.current

      if (!filePath) {
        // First save - show save dialog
        const timestamp = new Date()
          .toISOString()
          .slice(0, 10)
          .replace(/:/g, '')
        const suggestedName =
          localStorage.getItem('filename') || `${timestamp}.asemic`

        filePath = await saveDialog({
          defaultPath: suggestedName,
          filters: [
            {
              name: 'Asemic files',
              extensions: ['asemic']
            }
          ]
        })

        if (!filePath) {
          // User cancelled
          return
        }

        currentFilePathRef.current = filePath
        const fileName = filePath.split(/[/\\]/).pop() || suggestedName
        localStorage.setItem('filename', fileName)
      }

      // Write to file
      await writeTextFile(filePath, content)
    } catch (error) {
      // Failed to save file
    }
  }

  const openFile = async () => {
    try {
      const filePath = await open({
        multiple: false,
        directory: false,
        pickerMode: 'document'
        // filters: [
        //   {
        //     name: 'Asemic files',
        //     extensions: ['.asemic', '.txt']
        //   }
        // ]
      })

      if (!filePath) {
        // User cancelled
        return
      }

      const content = await readTextFile(filePath as string)
      setScenesSource(content)
      editorRef.current?.setValue(content)
      currentFilePathRef.current = filePath as string
      const fileName =
        (filePath as string).split(/[/\\]/).pop() || 'untitled.asemic'
      localStorage.setItem('filename', fileName)
    } catch (error) {
      console.error('Failed to open file:', error)
    }
  }

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
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null)
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

      asemic.current!.postMessage({
        preProcess: {
          width: (boundingRect.width || 1080) * devicePixelRatio,
          height: (boundingRect.height || 1080) * devicePixelRatio
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
            <div className='grow' />
            <button onClick={() => setPerform(!perform)}>
              {<Ellipsis {...lucideProps} />}
            </button>
          </div>
          {!perform && (
            <>
              <div className='w-full flex !text-xs *:!text-xs h-fit *:!h-[26px]'>
                <button
                  className={`${isLive ? '!bg-blue-200/40' : ''}`}
                  onClick={ev => {
                    ev.preventDefault()
                    ev.stopPropagation()
                    const activeElement = document.activeElement as HTMLElement
                    activeElement.blur()
                    setIsLive(!isLive)
                  }}>
                  <Power {...lucideProps} />
                </button>
                <button onClick={() => editorRef.current?.toggleFoldAll()}>
                  <FoldVertical {...lucideProps} />
                </button>

                <button
                  onClick={() => {
                    const scene = editorRef.current?.getScene()
                    if (scene !== undefined) {
                      if (asemic.current) {
                        asemic.current.postMessage({
                          scrub: scenes[scene]
                        } as Partial<AsemicData>)
                      }
                    }
                    setScenesSource(editorRef.current?.getValue() ?? '')
                  }}
                  title={'Set Value'}>
                  {<RefreshCw {...lucideProps} />}
                </button>
                <div className='grow' />
                <button
                  onClick={() => setShowCanvas(!showCanvas)}
                  title='Toggle Canvas'>
                  {showCanvas ? (
                    <Eye {...lucideProps} />
                  ) : (
                    <EyeOff {...lucideProps} />
                  )}
                </button>
                <button onClick={() => setHelp(!help)}>
                  {<Info {...lucideProps} />}
                </button>

                <button
                  onClick={() => setShowSceneSettings(!showSceneSettings)}
                  className={`${showSceneSettings ? '!bg-blue-200/40' : ''}`}
                  title='Scene Settings'>
                  <Save {...lucideProps} />
                </button>

                {/* <button
                className={`${audio ? '!bg-blue-200/40' : ''}`}
                onClick={() => {
                  setAudio(!audio)
                }}>
                {<Speaker {...lucideProps} />}
              </button> */}

                <button onClick={saveToFile} title='Save to .js file'>
                  <Download {...lucideProps} />
                </button>

                <button
                  onClick={() => {
                    currentFilePathRef.current = null
                    saveToFile()
                  }}
                  title='New File'>
                  <Plus {...lucideProps} />
                </button>

                <button onClick={openFile} title='Open Asemic file'>
                  <Upload {...lucideProps} />
                </button>

                <button onClick={loadAudioFolder} title='Load Audio Folder'>
                  <Music {...lucideProps} />
                </button>

                {/* <input
                ref={fileInputRef}
                type='file'
                accept='.js,.ts'
                style={{ display: 'none' }}
                onChange={handleFileLoad}
              /> */}

                {/*<input
                ref={imageInputRef}
                type='file'
                accept='image/*,video/*'
                style={{ display: 'none' }}
                onChange={handleImageLoad}
              /> */}

                {/* <button onClick={() => setPerform(true)}>
                {
                  <PanelTopClose
                    color='white'
                    className='py-0.5'
                    opacity={0.5}
                  />
                }
              </button> */}
                <button
                  className={`${useRustParser ? '!bg-green-200/40' : ''}`}
                  onClick={() => setUseRustParser(!useRustParser)}
                  title='Toggle Rust Parser'>
                  {useRustParser ? '🦀' : 'JS'}
                </button>
              </div>
              <AsemicEditor
                ref={editorRef}
                defaultValue={scenesSource}
                onChange={value => {
                  setScenesSource(value!)
                }}
                errors={errors}
                help={help}
                setHelp={setHelp}
                activeScene={activeScene}
              />

              {/* Scene Settings Panel */}
              {showSceneSettings && (
                <SceneSettingsPanel
                  activeScene={activeScene}
                  settings={activeSceneSettings}
                  onUpdate={newSettings => {
                    setActiveSceneSettings(newSettings)
                    updateSceneSettings(newSettings)
                  }}
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
