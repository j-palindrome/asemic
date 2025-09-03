import _, { isEqual, isUndefined, mapValues, range } from 'lodash'
import {
  Download,
  Ellipsis,
  Image as ImageIcon,
  Info,
  LucideProps,
  Maximize2,
  PanelTopClose,
  Pause,
  Play,
  Power,
  Save,
  Speaker,
  Upload,
  Video
} from 'lucide-react'
import {
  MouseEvent,
  MouseEventHandler,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import invariant from 'tiny-invariant'
import Asemic from '../Asemic'
import Slider from '../components/Slider'
import { InputSchema } from '../server/inputSchema'
import { useSocket } from '../server/schema'
import { splitString } from '../settings'
import { AsemicData, FlatTransform } from '../types'
import { stripComments } from '../utils'
import { Parser } from '../parser/Parser'
import { useElectronFileOperations } from '../hooks/useElectronFileOperations'
import AsemicEditor from '../components/Editor'

function AsemicAppInner({
  source,
  save,
  getRequire
}: {
  source: string
  save: (source: string, { reload }: { reload: boolean }) => void
  getRequire: (file: string) => Promise<string>
}) {
  const { socket, schema, setSchema } = useSocket()
  const { saveFile, openFile: openElectronFile } = useElectronFileOperations()
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
  const recordingCanvas = useRef<HTMLCanvasElement>(null!)
  const frame = useRef<HTMLDivElement>(null!)

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

  const lastTransform = useRef<FlatTransform>(null!)

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
    const [isDragging, setIsDragging] = useState(false)

    return [
      progress,
      setProgress,
      totalLength,
      setTotalLength,
      isDragging,
      setIsDragging
    ] as const
  }
  const [
    progress,
    setProgress,
    totalLength,
    setTotalLength,
    isDragging,
    setIsDragging
  ] = useProgress()

  const scrubberRef = useRef<HTMLInputElement>(null)

  // Update scrubber value when progress changes
  useEffect(() => {
    if (scrubberRef.current && !isDragging) {
      scrubberRef.current.value = progress.toString()
    }
  }, [progress, isDragging])

  const useRecording = () => {
    const [isRecording, setIsRecording] = useState(false)
    // const fileInputRef = useRef<HTMLInputElement>(null)
    // const imageInputRef = useRef<HTMLInputElement>(null)
    // const canvasRecorderRef = useRef<Recorder | null>(null) // REMOVE
    const mediaRecorderRef = useRef<MediaRecorder | null>(null) // ADD
    const recordedChunksRef = useRef<BlobPart[]>([])

    const startRecording = async () => {
      try {
        // Setup recording canvas to match main canvas size
        const mainCanvas = canvas.current
        recordingCanvas.current.width = mainCanvas.width
        recordingCanvas.current.height = mainCanvas.height

        // const context = recordingCanvas.current.getContext('bitmaprenderer')! // REMOVE
        // canvasRecorderRef.current = new Recorder(context, { // REMOVE
        //   name: 'asemic-recording', // REMOVE
        //   encoderOptions: { // REMOVE
        //     codec: AVC.getCodec({ profile: 'Main', level: '5.2' }) // REMOVE
        //   }, // REMOVE
        //   rect: [ // REMOVE
        //     0, // REMOVE
        //     0, // REMOVE
        //     recordingCanvas.current.width, // REMOVE
        //     recordingCanvas.current.height // REMOVE
        //   ], // REMOVE
        //   frameRate: 60, // REMOVE
        //   extension: 'mp4', // REMOVE
        //   download: true // REMOVE
        // }) // REMOVE

        // await canvasRecorderRef.current.start() // REMOVE

        // Get MediaStream from canvas
        const stream = recordingCanvas.current.captureStream(60) // ADD

        // Create MediaRecorder
        mediaRecorderRef.current = new MediaRecorder(stream, {
          // ADD
          mimeType: 'video/webm' // ADD
        }) // ADD

        // Reset recorded chunks
        recordedChunksRef.current = [] // ADD

        // Set up data available event
        mediaRecorderRef.current.ondataavailable = (event: BlobEvent) => {
          // ADD
          if (event.data.size > 0) {
            // ADD
            recordedChunksRef.current.push(event.data) // ADD
          } // ADD
        } // ADD

        // Set up stop event
        mediaRecorderRef.current.onstop = () => {
          // ADD
          const blob = new Blob(recordedChunksRef.current, {
            // ADD
            type: 'video/webm' // ADD
          }) // ADD
          saveRecordedVideo(blob) // ADD
        } // ADD

        // Start MediaRecorder
        mediaRecorderRef.current.start() // ADD

        // Start worker recording
        asemic.current!.postMessage({
          startRecording: true
        } as AsemicData)

        setIsRecording(true)
      } catch (error) {
        console.error('Failed to start recording:', error)
        setIsRecording(false)
      }
    }

    const stopRecording = async () => {
      if (!asemic.current) return

      try {
        // Stop worker recording
        asemic.current.postMessage({
          stopRecording: true
        } as AsemicData)

        // Stop canvas recorder
        // if (canvasRecorderRef.current) { // REMOVE
        //   canvasRecorderRef.current.stop() // REMOVE
        //   setIsRecording(false) // REMOVE
        // } // REMOVE

        // Stop MediaRecorder
        if (mediaRecorderRef.current) {
          // ADD
          mediaRecorderRef.current.stop() // ADD
          setIsRecording(false) // ADD
        } // ADD
      } catch (error) {
        console.error('Failed to stop recording:', error)
        setIsRecording(false)
      }
    }

    const stepRecording = async () => {
      // if ( // REMOVE
      //   canvasRecorderRef.current && // REMOVE
      //   canvasRecorderRef.current.status === RecorderStatus.Recording // REMOVE
      // ) { // REMOVE
      //   try { // REMOVE
      //     await canvasRecorderRef.current.step() // REMOVE
      //   } catch (error) { // REMOVE
      //     console.error('Recording step error:', error) // REMOVE
      //   } // REMOVE
      // } // REMOVE
    }

    const saveRecordedVideo = (recordedData: Blob) => {
      try {
        const url = URL.createObjectURL(recordedData)
        const a = document.createElement('a')
        a.href = url
        a.download = `asemic-recording-${new Date()
          .toISOString()
          .slice(0, 19)
          .replace(/:/g, '-')}.webm` // Modified extension
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
        setIsRecording(false)
      } catch (error) {
        console.error('Failed to save recording:', error)
        setIsRecording(false)
      }
    }

    const saveToFile = async () => {
      const content = editable.current?.value || scenesSource
      try {
        const result = await saveFile(
          content,
          `asemic-${new Date()
            .toISOString()
            .slice(0, 19)
            .replace(/:/g, '-')}.asemic`
        )

        if (result.success && !result.canceled) {
          console.log('File saved successfully')
        }
      } catch (error) {
        console.error('Failed to save file:', error)
      }
    }

    const openFile = async () => {
      try {
        const result = await openElectronFile()
        if (result.success && result.content) {
          setScenesSource(result.content)
          if (editable.current) {
            editable.current.value = result.content
          }
        }
      } catch (error) {
        console.error('Failed to open file:', error)
      }
    }

    const toggleRecording = () => {
      if (isRecording) {
        stopRecording()
      } else {
        startRecording()
      }
    }

    return [
      isRecording,
      toggleRecording,
      saveToFile,
      openFile,
      // handleFileLoad,
      // fileInputRef,
      saveRecordedVideo,
      setIsRecording,
      stepRecording
      // handleImageLoad,
      // imageInputRef
    ] as const
  }
  const [
    isRecording,
    toggleRecording,
    saveToFile,
    openFile,
    // handleFileLoad,
    // fileInputRef,
    setIsRecording,
    stepRecording
    // handleImageLoad,
    // imageInputRef
  ] = useRecording()

  const setup = () => {
    useEffect(() => {
      asemic.current?.postMessage({
        params: schema.params
      })
    }, [schema])

    // const client = useMemo(() => new Client('localhost', 57120), [])
    const [isSetup, setIsSetup] = useState(false)
    const onResize = () => {
      if (!canvas.current) return
      const boundingRect = canvas.current.getBoundingClientRect()
      if (!boundingRect.width || !boundingRect.height) return
      devicePixelRatio = 2

      // canvas.current.width = boundingRect.width * devicePixelRatio
      // canvas.current.height = boundingRect.height * devicePixelRatio

      asemic.current!.postMessage({
        preProcess: {
          width: boundingRect.width * devicePixelRatio,
          height: boundingRect.height * devicePixelRatio
        }
      })
    }

    useEffect(() => {
      invariant(canvas.current)
      if (!asemic.current) {
        asemic.current = new Asemic(canvas.current, data => {
          if (data.resetParams === true) {
            socket.emit('params:reset')
          }
          if (!isUndefined(data.params) || !isUndefined(data.presets)) {
            setSchema({
              params: data.params,
              presets: data.presets
            } as InputSchema)
          }
          if (!isUndefined(data.files) && Object.keys(data.files).length > 0) {
            // Send file paths to server for loading
            socket.emit(
              'files:load',
              data.files,
              (loadFiles: Record<string, ImageData[]>) => {
                asemic.current?.postMessage({
                  loadFiles: mapValues(loadFiles, value => {
                    return value.map(value => {
                      const imageData = new ImageData(value.width, value.height)
                      imageData.data.set(new Uint8ClampedArray(value.data))
                      return imageData
                    })
                  })
                })
              }
            )
          }
          if (!isUndefined(data.pauseAt)) {
            if (pauseAtRef.current !== data.pauseAt) {
              setPauseAt(data.pauseAt)
            }
          }
          if (!isUndefined(data.lastTransform)) {
            lastTransform.current = data.lastTransform
          }
          if (!isUndefined(data.eval)) {
            for (let evalString of data.eval) {
              const evalFunction = eval(`({_, sc}) => {
              ${evalString}
            }`)
              evalFunction({ _ })
            }
          }
          if (!isUndefined(data.osc) && data.osc.length > 0) {
            data.osc.forEach(({ path, args }) => {
              // Send OSC data via Socket.IO instead of WebSocket
              if (!socket) return
              socket.emit('osc:message', { address: path, data: args })
            })
          }
          if (!isUndefined(data.sc) && data.sc.length > 0) {
            data.sc.forEach(({ path, value }) => {
              // Send OSC data via Socket.IO instead of WebSocket
              if (!socket) return
              const [synth, param] = splitString(path, '/')
              socket.emit('sc:set', synth, param, value)
            })
          }
          if (
            !isUndefined(data.scSynthDefs) &&
            Object.keys(data.scSynthDefs).length > 0
          ) {
            for (let synth in data.scSynthDefs) {
              debugger
              socket.emit(
                'sc:synth',
                synth,
                `{ 
  var x = NamedControl.kr(\\x, [${range(10)
    .map(x => '0')
    .join(', ')}]);
  var y = NamedControl.kr(\\y, [${range(10)
    .map(x => '0')
    .join(', ')}]);
  ${data.scSynthDefs[synth]}
              }`
              )
            }
          }
          if (!isUndefined(data.recordingStarted)) {
            if (data.recordingStarted) {
              console.log('Recording started')
            } else {
              // setIsRecording(false)
            }
          }
          if (!isUndefined(data.recordingStopped)) {
            // Worker stopped recording, main thread recorder will handle the rest
          }
          if (!isUndefined(data.frameData) && recordingCanvas.current) {
            // Draw transferred frame to recording canvas
            const ctx = recordingCanvas.current.getContext('bitmaprenderer')!
            ctx.transferFromImageBitmap(data.frameData)

            // Step the recorder
            // stepRecording(1)
          }
          if (!isUndefined(data.errors)) {
            setErrors(data.errors)
          }
          if (!isUndefined(data.progress) && !isDragging) {
            setProgress(data.progress)
          }
          if (!isUndefined(data.totalLength)) {
            setTotalLength(data.totalLength)
          }
        })
      }

      const resizeObserver = new ResizeObserver(onResize)
      resizeObserver.observe(canvas.current)

      window.addEventListener('resize', onResize)

      return () => {
        resizeObserver.disconnect()
        window.removeEventListener('resize', onResize)
      }
    }, [asemic])

    // useEffect(() => {
    //   return () => {
    //     asemic.current?.dispose()
    //   }
    // }, [])

    useEffect(() => {
      onResize()
      setIsSetup(true)
    }, [])

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
        asemic.current?.postMessage({
          source: scenesSourceRef.current,
          preProcess
        })
      }
      restart()
    }, [scenesSource, isSetup])
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
            setProgress(newProgress)
            if (asemic.current) {
              asemic.current.postMessage({
                scrub: newProgress
              } as AsemicData)
            }
            return
          }
          if (ev.key === 'ArrowRight' && totalLength > 0) {
            ev.preventDefault()
            const newProgress = Math.min(totalLength, progress + 0.1)
            setProgress(newProgress)
            if (asemic.current) {
              asemic.current.postMessage({
                scrub: newProgress
              } as AsemicData)
            }
            return
          }
          if (ev.key === 'Home' && totalLength > 0) {
            ev.preventDefault()
            setProgress(0)
            if (asemic.current) {
              asemic.current.postMessage({
                scrub: 0
              } as AsemicData)
            }
            return
          }
          if (ev.key === 'End' && totalLength > 0) {
            ev.preventDefault()
            setProgress(totalLength)
            if (asemic.current) {
              asemic.current.postMessage({
                scrub: totalLength
              } as AsemicData)
            }
            return
          }
        } else if (isLive) {
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

  const [perform, setPerform] = useState(settings.perform)
  useEffect(() => {
    setPerform(settings.perform)
  }, [settings.perform])
  const [help, setHelp] = useState(false)

  const requestFullscreen = async () => {
    frame.current.style.setProperty('height', '100vh', 'important')
    await frame.current?.requestFullscreen()
  }
  useEffect(() => {
    if (settings.fullscreen) {
      requestFullscreen()
    }
  }, [settings.fullscreen])

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

  const { params, presets } = schema

  // Helper functions for backwards compatibility
  const setParams = useCallback(
    (newParams: typeof params) => {
      setSchema({ params: newParams })
    },
    [schema, setSchema]
  )

  const [selectedParam, setSelectedParam] = useState(
    undefined as string | undefined
  )

  const [copyNotification, setCopyNotification] = useState('')
  const copyPreset = () => {
    const presetValues = Object.fromEntries(
      Object.entries(params).map(([key, param]) => [
        key,
        param.value.toFixed(2)
      ])
    )
    // Format the preset as 'key1=value1 key2=value2' format
    const formattedPreset = Object.entries(presetValues)
      .map(([key, value]) => `${key}=${value}`)
      .join(' ')

    navigator.clipboard.writeText(formattedPreset)
    setCopyNotification(`Copied preset: ${formattedPreset}`)
    setTimeout(() => setCopyNotification(''), 3000)
  }

  const setupAudio = () => {
    const [audio, setAudio] = useState<boolean>(false)
    useEffect(() => {
      if (audio) {
        socket.emit('sc:on')
      } else {
        socket.emit('sc:off')
      }
    }, [audio])
    return [audio, setAudio] as const
  }
  const [audio, setAudio] = setupAudio()

  const checkLive: MouseEventHandler<HTMLDivElement> = ev => {
    if (ev.altKey) {
      const parser = new Parser()
      parser.setup(scenesSourceRef.current)
      parser.preProcessing.height = editable.current.clientHeight
      parser.preProcessing.width = editable.current.clientWidth

      const point = parser.processMouse({
        x: ev.clientX,
        y: ev.clientY,
        cursorPosition: editable.current.selectionStart
      })
      window.navigator.clipboard.writeText(
        `${point.x.toFixed(2).replace('.00', '')},${point.y
          .toFixed(2)
          .replace('.00', '')}`
      )
    }
  }

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
              settings.h === 'window' ? undefined : `1 / ${settings.h}`
          }}
          ref={canvas}
          height={1080}
          width={1080}></canvas>
        <canvas
          ref={recordingCanvas}
          className='top-0 left-0 !z-100'
          style={{
            position: 'fixed',
            display: isRecording ? 'block' : 'none',
            width: '100%',
            height: settings.h === 'window' ? '100%' : undefined,
            aspectRatio:
              settings.h === 'window' ? undefined : `1 / ${settings.h}`
          }}
          width={1080}
          height={1080}
        />

        {!perform ? (
          <div
            className='fixed top-1 left-1 h-full w-[calc(100%-50px)] flex-col hidden group-hover:!flex !z-100'
            onClick={checkLive}>
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

              <button
                className={`${isRecording ? '!bg-red-500' : ''}`}
                onClick={toggleRecording}
                title={isRecording ? 'Stop Recording' : 'Start Recording'}>
                {<Video {...lucideProps} />}
              </button>

              <button
                onClick={() => {
                  asemic.current!.postMessage({
                    play: true
                  } as AsemicData)
                }}>
                {pauseAt ? (
                  <Play {...lucideProps} />
                ) : (
                  <Pause {...lucideProps} />
                )}
              </button>
              <input
                placeholder='go'
                type='number'
                min={0}
                max={100}
                step={1}
                onKeyDown={ev => {
                  if (ev.key !== 'Enter') return
                  const scene = parseInt(ev.currentTarget.value)
                  asemic.current!.postMessage({
                    play: { scene }
                  } as AsemicData)
                  ev.currentTarget.value = ''
                  ev.currentTarget.blur()
                }}></input>
              <div className='font-mono truncate max-w-[33%] flex-none whitespace-nowrap text-blue-500'>
                {live.index.value}:{' '}
                {live[live.index.value]?.replace('\n', '/ ')}
              </div>
              <div className='grow' />
              <button onClick={() => setHelp(!help)}>
                {<Info {...lucideProps} />}
              </button>

              <button
                className={`${audio ? '!bg-blue-200/40' : ''}`}
                onClick={() => {
                  setAudio(!audio)
                }}>
                {<Speaker {...lucideProps} />}
              </button>

              <button onClick={saveToFile} title='Save to .js file'>
                <Download {...lucideProps} />
              </button>

              <button onClick={openFile} title='Open Asemic file'>
                <Upload {...lucideProps} />
              </button>

              {/* <input
                ref={fileInputRef}
                type='file'
                accept='.js,.ts'
                style={{ display: 'none' }}
                onChange={handleFileLoad}
              />

              <input
                ref={imageInputRef}
                type='file'
                accept='image/*,video/*'
                style={{ display: 'none' }}
                onChange={handleImageLoad}
              /> */}

              <button
                onClick={() => {
                  const currentScene = editable.current.value
                  const newFullSource = currentScene
                  setScenesSource(newFullSource)
                  save(newFullSource, { reload: true })
                }}>
                {<Save {...lucideProps} />}
              </button>
              <button onClick={requestFullscreen}>
                {<Maximize2 {...lucideProps} />}
              </button>

              <button onClick={() => setPerform(true)}>
                {
                  <PanelTopClose
                    color='white'
                    className='py-0.5'
                    opacity={0.5}
                  />
                }
              </button>
            </div>

            {/* Progress Scrubber */}
            {!perform && totalLength > 0 && (
              <div className='w-full px-0 py-1'>
                <div
                  className='w-full h-3 flex items-center cursor-pointer relative'
                  onMouseDown={e => {
                    setIsDragging(true)
                    const rect = e.currentTarget.getBoundingClientRect()
                    const x = e.clientX - rect.left
                    const percent = Math.max(0, Math.min(1, x / rect.width))
                    const newProgress = percent * totalLength
                    setProgress(newProgress)
                    if (asemic.current) {
                      asemic.current.postMessage({
                        scrub: newProgress
                      } as AsemicData)
                    }
                  }}
                  onMouseMove={e => {
                    if (!isDragging) return
                    const rect = e.currentTarget.getBoundingClientRect()
                    const x = e.clientX - rect.left
                    const percent = Math.max(0, Math.min(1, x / rect.width))
                    const newProgress = percent * totalLength
                    setProgress(newProgress)
                    if (asemic.current) {
                      asemic.current.postMessage({
                        scrub: newProgress
                      } as AsemicData)
                    }
                  }}
                  onMouseUp={() => setIsDragging(false)}
                  onMouseLeave={() => setIsDragging(false)}
                  onTouchStart={e => {
                    setIsDragging(true)
                    const rect = e.currentTarget.getBoundingClientRect()
                    const touch = e.touches[0]
                    const x = touch.clientX - rect.left
                    const percent = Math.max(0, Math.min(1, x / rect.width))
                    const newProgress = percent * totalLength
                    setProgress(newProgress)
                    if (asemic.current) {
                      asemic.current.postMessage({
                        scrub: newProgress
                      } as AsemicData)
                    }
                  }}
                  onTouchMove={e => {
                    if (!isDragging) return
                    const rect = e.currentTarget.getBoundingClientRect()
                    const touch = e.touches[0]
                    const x = touch.clientX - rect.left
                    const percent = Math.max(0, Math.min(1, x / rect.width))
                    const newProgress = percent * totalLength
                    setProgress(newProgress)
                    if (asemic.current) {
                      asemic.current.postMessage({
                        scrub: newProgress
                      } as AsemicData)
                    }
                  }}
                  onTouchEnd={() => setIsDragging(false)}>
                  <div
                    className='absolute h-1 rounded-lg'
                    style={{
                      left: 0,
                      top: '50%',
                      transform: 'translateY(-50%)',
                      width: '100%',
                      background: '#4b5563'
                    }}
                  />
                  <div
                    className='absolute h-1 rounded-lg'
                    style={{
                      left: 0,
                      top: '50%',
                      transform: 'translateY(-50%)',
                      width: `${(progress / totalLength) * 100}%`,
                      background: '#3b82f6'
                    }}
                  />
                  <div
                    className='absolute w-3 h-3 rounded-full bg-black border-2 border-white shadow'
                    style={{
                      left: `calc(${(progress / totalLength) * 100}% - 6px)`,
                      top: '50%',
                      transform: 'translateY(-50%)'
                    }}
                  />
                </div>

                <div className='w-full flex'>
                  <select
                    value={selectedParam}
                    onChange={ev => setSelectedParam(ev.target.value)}>
                    <option value={''}></option>
                    {Object.keys(params).map(param => (
                      <option key={param} value={param}>
                        {param}
                      </option>
                    ))}
                  </select>
                  {selectedParam && params[selectedParam] && (
                    <>
                      <Slider
                        values={{ x: params[selectedParam].value, y: 0 }}
                        onChange={({ x }) =>
                          setParams({
                            ...params,
                            [selectedParam]: {
                              ...params[selectedParam],
                              value: x
                            }
                          })
                        }
                        sliderStyle={({ x, y }) => ({
                          width: `${x * 100}%`
                        })}
                        max={params[selectedParam].max}
                        min={params[selectedParam].min}
                        exponent={params[selectedParam].exponent}
                        className='h-8 w-full'
                        innerClassName='bg-white rounded-lg left-0 top-0 h-full'
                      />
                      <div className='text-xs mt-1'>
                        {params[selectedParam].value.toFixed(2)}
                      </div>
                    </>
                  )}
                </div>

                <button
                  onClick={copyPreset}
                  className='ml-2 px-2 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-700'
                  title='Copy current parameter values as preset'>
                  Copy Preset
                </button>

                {copyNotification && (
                  <div className='absolute top-16 left-0 bg-green-600 text-white p-2 rounded text-xs max-w-md z-50'>
                    {copyNotification}
                  </div>
                )}
              </div>
            )}

            <AsemicEditor
              defaultValue={scenesSource}
              onChange={value => {
                setScenesSource(value!)
              }}
              errors={errors}
            />
          </div>
        ) : (
          <div className='fixed top-1 right-10'>
            <button onClick={() => setPerform(false)}>
              <Ellipsis {...lucideProps} />
            </button>
          </div>
        )}
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
