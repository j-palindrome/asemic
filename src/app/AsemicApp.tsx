import _, { isEqual, isUndefined } from 'lodash'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import invariant from 'tiny-invariant'
import { io, Socket } from 'socket.io-client'
import { Recorder, RecorderStatus } from 'canvas-record'
import { AVC } from 'media-codecs'
import {
  Ellipsis,
  Info,
  LucideProps,
  Maximize2,
  PanelTopClose,
  Pause,
  Play,
  Power,
  Save,
  Speaker,
  Video,
  VideoOff,
  Download,
  Upload
} from 'lucide-react'
import ElRenderer from '../renderers/audio/ElRenderer'
import Asemic from '../Asemic'
import { AsemicData, FlatTransform, Parser } from '../types'
import { useSchema } from '../server/schema'
import './AsemicApp.css'
import { stripComments } from '../utils'
import { inputSchema, WS_PORT } from '../server/constants'

export default function AsemicApp({
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

  const setupAudio = () => {
    // renderer = new CanvasRenderer(offscreenCanvas.getContext('2d')!)
    const audioRenderer = useRef(
      new ElRenderer(
        () => ({}),
        (curves, el, vars) => {
          // const output = el.mul(el.sin(440), 0.5)
          const output = el.in({ channel: 0 })
          return [output, output] as const
        }
      )
    )

    const [audio, setAudio] = useState<boolean>(false)
    useEffect(() => {
      if (audio) {
        audioRenderer.current.start()

        audioRenderer.current.render([])
      } else {
        audioRenderer.current.stop()
      }
    }, [audio])
    return [audio, setAudio, audioRenderer] as const
  }
  const [audio, setAudio, audioRenderer] = setupAudio()

  const useRecording = () => {
    const [isRecording, setIsRecording] = useState(false)
    const recorderRef = useRef<Recorder | null>(null)
    const fileInputRef = useRef<HTMLInputElement>(null)

    const startRecording = async () => {
      if (!canvas.current) return

      try {
        const context = canvas.current.getContext('2d')
        if (!context) return

        recorderRef.current = new Recorder(context, {
          name: `asemic-recording-${new Date()
            .toISOString()
            .slice(0, 19)
            .replace(/:/g, '-')}`,
          encoderOptions: {
            codec: AVC.getCodec({ profile: 'Main', level: '5.2' })
          }
        })

        await recorderRef.current.start()
        setIsRecording(true)

        // Start the recording loop
        const recordingLoop = async () => {
          if (recorderRef.current?.status === RecorderStatus.Recording) {
            await recorderRef.current.step()
            requestAnimationFrame(recordingLoop)
          }
        }
        requestAnimationFrame(recordingLoop)
      } catch (error) {
        console.error('Failed to start recording:', error)
        setIsRecording(false)
      }
    }

    const stopRecording = async () => {
      if (!recorderRef.current) return

      try {
        await recorderRef.current.stop()
        const url = await recorderRef.current.download()
        setIsRecording(false)
        recorderRef.current = null

        // Optional: Show download notification
        console.log('Recording saved:', url)
      } catch (error) {
        console.error('Failed to stop recording:', error)
        setIsRecording(false)
        recorderRef.current = null
      }
    }

    const saveToFile = () => {
      const content = editable.current?.value || scenesSource
      const blob = new Blob([content], { type: 'text/plain' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `asemic-${new Date()
        .toISOString()
        .slice(0, 19)
        .replace(/:/g, '-')}.asemic`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    }

    const openFile = () => {
      fileInputRef.current?.click()
    }

    const handleFileLoad = (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      if (!file) return

      const reader = new FileReader()
      reader.onload = e => {
        const content = e.target?.result as string
        if (content) {
          setScenesSource(content)
          if (editable.current) {
            editable.current.value = content
          }
        }
      }
      reader.readAsText(file)

      // Reset the input so the same file can be loaded again
      event.target.value = ''
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
      handleFileLoad,
      fileInputRef
    ] as const
  }
  const [
    isRecording,
    toggleRecording,
    saveToFile,
    openFile,
    handleFileLoad,
    fileInputRef
  ] = useRecording()

  const setup = () => {
    const socketRef = useRef<Socket | null>(null)

    useEffect(() => {
      socketRef.current = io(`http://localhost:${WS_PORT}`)

      socketRef.current.on('connect', () => {
        console.log('Socket.IO connected')
      })

      socketRef.current.on('disconnect', () => {
        console.log('Socket.IO disconnected')
      })

      return () => {
        if (socketRef.current) {
          socketRef.current.disconnect()
          socketRef.current = null
        }
      }
    }, [])

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
          // if (!isUndefined(data.params)) {
          //   const { params } = inputSchema.parse({ params: data.params })

          //   setParams({ params })
          // }
          if (!isUndefined(data.settings)) {
            setSettings(settings => ({
              ...settingsRef.current,
              ...data.settings
            }))
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
          if (!isUndefined(data.osc)) {
            data.osc.forEach(({ path, args }) => {
              // Send OSC data via Socket.IO instead of WebSocket
              if (!socketRef.current) return
              socketRef.current.emit('osc:message', { address: path, args })
            })
          }
          // if (!isUndefined(data.audio)) {
          //   audioRenderer.render(data.audio)
          // }

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
      keys: [''],
      text: [''],
      index: { type: 'text', value: 0 }
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
          if (ev.key === 'l') {
            setIsLive(!isLive)
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
        } else {
          switch (live.index.type) {
            case 'keys':
              if (ev.key.length === 1 && !ev.metaKey && !ev.ctrlKey) {
                keysPressed.current[ev.key] = performance.now()
              }
              const newKeys = [...live.keys]
              newKeys[live.index.value] = Object.keys(keysPressed.current)
                .sort(x => keysPressed.current[x])
                .join('')

              setLive({ ...live, keys: newKeys })

              break
            case 'text':
              let newText = live.text[live.index.value]
              if (ev.key === 'Backspace') {
                if (ev.metaKey) {
                  newText = ''
                } else if (ev.altKey) {
                  newText = newText.slice(
                    0,
                    newText.includes(' ') ? newText.lastIndexOf(' ') : 0
                  )
                } else {
                  newText = newText.slice(0, -1)
                }
              } else if (ev.key.length === 1 && !ev.metaKey && !ev.ctrlKey) {
                newText += ev.key
              }
              const newTexts = [...live.text]
              newTexts[live.index.value] = newText

              setLive({ ...live, text: newTexts })
              break
          }
        }
      }
      const onKeyUp = (ev: KeyboardEvent) => {
        delete keysPressed.current[ev.key]
        const newKeys = [...live.keys]
        newKeys[live.index.value] = Object.keys(keysPressed.current)
          .sort(x => keysPressed.current[x])
          .join('')
        setLive({ ...live, keys: newKeys })
      }

      if (!isLive) return
      window.addEventListener('keydown', onKeyDown)
      window.addEventListener('keyup', onKeyUp)
      return () => {
        window.removeEventListener('keydown', onKeyDown)
        window.removeEventListener('keyup', onKeyUp)
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

  const [schema, setParams] = useSchema()

  return (
    <div className='asemic-container'>
      <div
        className={`relative w-full bg-black overflow-auto ${
          settings.h === 'window' ? 'h-screen' : 'h-fit max-h-screen'
        } fullscreen:max-h-screen group`}
        ref={frame}
        onClick={ev => {
          if (perform || !editable.current || !ev.altKey) return
          ev.preventDefault()
          ev.stopPropagation()

          const rect = editable.current.getBoundingClientRect()
          // const mouse = new Pt([
          //   (ev.clientX - rect.left) / rect.width,
          //   (ev.clientY - rect.top) / rect.width
          // ])
          // const listenForResponse = (ev: { data: AsemicDataBack }) => {
          //   mouse.rotate2D(lastTransform.current.rotation * Math.PI * 2 * -1)
          //   mouse.divide(lastTransform.current.scale)
          //   mouse.subtract(lastTransform.current.translation)

          //   const scrollSave = editable.current.scrollTop
          //   editable.current.value =
          //     editable.current.value +
          //     ` ${mouse.x.toFixed(2)},${mouse.y.toFixed(2)}`
          //   editable.current.scrollTo({ top: scrollSave })
          // }
          // asemic.current?.postMessage({
          //   source: editable.current.value
          // })
        }}>
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
        {!perform ? (
          <div className='fixed top-1 left-1 h-full w-[calc(100%-50px)] flex-col hidden group-hover:!flex !z-100'>
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
                className={`${isRecording ? '!bg-red-500/60' : ''}`}
                onClick={toggleRecording}
                title={isRecording ? 'Stop Recording' : 'Start Recording'}>
                {isRecording ? (
                  <VideoOff {...lucideProps} />
                ) : (
                  <Video {...lucideProps} />
                )}
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
                  const allScenes = editable.current.value.split('\n---')
                  // Find the line number of the selected scene
                  if (scene >= 0 && scene < allScenes.length) {
                    // Count lines before the target scene
                    let lineCount = 0
                    for (let i = 0; i < scene; i++) {
                      // Add 1 for the "---" separator lines
                      lineCount += allScenes[i].split('\n').length + 1
                    }

                    // Set cursor position
                    editable.current.setSelectionRange(
                      editable.current.value.indexOf(allScenes[scene]),
                      editable.current.value.indexOf(allScenes[scene])
                    )

                    // Scroll to the position
                    const lineHeight = parseInt(
                      getComputedStyle(editable.current).lineHeight
                    )

                    editable.current.scrollTop = lineHeight * lineCount
                  }
                }}></input>
              <div className='font-mono truncate max-w-[33%] flex-none whitespace-nowrap text-blue-500'>
                {live.index.type} {live.index.value + 1}:{' '}
                {live[live.index.type][live.index.value]?.replace('\n', '/ ')}
              </div>
              <div className='grow' />
              <button onClick={() => setHelp(!help)}>
                {<Info {...lucideProps} />}
              </button>

              <button onClick={saveToFile} title='Save to .asemic file'>
                <Download {...lucideProps} />
              </button>

              <button onClick={openFile} title='Open .asemic file'>
                <Upload {...lucideProps} />
              </button>

              <input
                ref={fileInputRef}
                type='file'
                accept='.asemic'
                style={{ display: 'none' }}
                onChange={handleFileLoad}
              />

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
              <div className='w-full px-0 py-1 bg-black bg-opacity-50'>
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
                    className='absolute w-3 h-3 rounded-full bg-blue-500 border-2 border-white shadow'
                    style={{
                      left: `calc(${(progress / totalLength) * 100}% - 6px)`,
                      top: '50%',
                      transform: 'translateY(-50%)'
                    }}
                  />
                </div>
              </div>
            )}

            <div className='flex h-full w-full relative *:flex-none'>
              <textarea
                ref={editable}
                defaultValue={scenesSource}
                className={`editor text-white ${
                  errors.length > 0 ? 'w-2/3' : 'w-full'
                }`}
                onBlur={ev => {
                  ev.preventDefault()
                  ev.stopPropagation()
                }}
                onFocus={ev => {
                  if (isLive) setIsLive(false)
                }}
                onKeyDown={ev => {
                  if (ev.key === 'Enter' && ev.metaKey) {
                    const textBeforeCursor = stripComments(
                      ev.currentTarget.value.substring(
                        0,
                        ev.currentTarget.selectionStart
                      )
                    )
                    const sceneNumber =
                      (textBeforeCursor.match(/\n---/g) || ['']).length - 1
                    asemic.current!.postMessage({
                      play: { scene: sceneNumber }
                    } as AsemicData)
                    setScenesSource(ev.currentTarget.value)
                    window.navigator.clipboard.writeText(ev.currentTarget.value)
                  } else if (ev.key === 'f' && ev.metaKey) {
                    ev.currentTarget.blur()
                  }
                }}></textarea>
              {errors.length > 0 && (
                <div className='editor !text-red-400 w-1/3'>
                  {errors.join('\n---\n')}
                </div>
              )}
            </div>
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
