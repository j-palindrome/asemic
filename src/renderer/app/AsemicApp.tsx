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
  RefreshCw,
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
import Asemic from '@/lib/Asemic'
import Slider from '../components/Slider'
import { InputSchema } from '../inputSchema'
import { useSocket } from '../schema'
import { splitString } from '@/lib/settings'
import { AsemicData, FlatTransform } from '@/lib/types'
import { Parser } from '@/lib/parser/Parser'
import { useElectronFileOperations } from '../hooks/useElectronFileOperations'
import AsemicEditor, { AsemicEditorRef } from '../components/Editor'

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

  const setup = () => {
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
          // if (data.resetParams === true) {
          //   socket?.emit('params:reset')
          // }
          // if (!isUndefined(data.params) || !isUndefined(data.presets)) {
          //   setSchema({
          //     params: data.params,
          //     presets: data.presets
          //   } as InputSchema)
          // }
          // if (!isUndefined(data.files) && Object.keys(data.files).length > 0) {
          //   // Send file paths to server for loading
          //   socket?.emit(
          //     'files:load',
          //     data.files,
          //     (loadFiles: Record<string, ImageData[]>) => {
          //       asemic.current?.postMessage({
          //         loadFiles: mapValues(loadFiles, value => {
          //           return value.map(value => {
          //             const imageData = new ImageData(value.width, value.height)
          //             imageData.data.set(new Uint8ClampedArray(value.data))
          //             return imageData
          //           })
          //         })
          //       })
          //     }
          //   )
          // }

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
          // if (!isUndefined(data.osc) && data.osc.length > 0) {
          //   data.osc.forEach(({ path, args }) => {
          //     // Send OSC data via Socket.IO instead of WebSocket
          //     if (!socket) return
          //     socket?.emit('osc:message', { address: path, data: args })
          //   })
          // }
          // if (!isUndefined(data.sc) && data.sc.length > 0) {
          //   data.sc.forEach(({ path, value }) => {
          //     // Send OSC data via Socket.IO instead of WebSocket
          //     if (!socket) return
          //     const [synth, param] = splitString(path, '/')
          //     socket?.emit('sc:set', synth, param, value)
          //   })
          // }
          // if (
          //   !isUndefined(data.scSynthDefs) &&
          //   Object.keys(data.scSynthDefs).length > 0
          // ) {
          //   for (let synth in data.scSynthDefs) {
          //     socket?.emit('sc:synth', synth, `${data.scSynthDefs[synth]}`)
          //   }
          // }
          if (!isUndefined(data.recordingStarted)) {
            if (data.recordingStarted) {
              console.log('Recording started')
            } else {
              // setIsRecording(false)
            }
          }
          // if (!isUndefined(data.frameData) && recordingCanvas.current) {
          //   // Draw transferred frame to recording canvas
          //   const ctx = recordingCanvas.current.getContext('bitmaprenderer')!
          //   ctx.transferFromImageBitmap(data.frameData)

          //   // Step the recorder
          //   // stepRecording(1)
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

  const [perform, setPerform] = useState(settings.perform)
  useEffect(() => {
    setPerform(settings.perform)
  }, [settings.perform])
  const [help, setHelp] = useState(false)

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
      const x = (ev.clientX - rect.left) / rect.width
      const y = (ev.clientY - rect.top) / rect.height
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
        {/* <canvas
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
        /> */}

        {!perform ? (
          <div
            className='fixed top-1 left-1 h-full w-[calc(100%-50px)] flex-col flex !z-100'
            onPointerDownCapture={checkLive}>
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
                onClick={() => {
                  setScenesSource(editorRef.current?.getValue() ?? '')
                }}
                title={'Set Value'}>
                {<RefreshCw {...lucideProps} />}
              </button>

              {/* <button
                className={`${isRecording ? '!bg-red-500' : ''}`}
                onClick={toggleRecording}
                title={isRecording ? 'Stop Recording' : 'Start Recording'}>
                {<Video {...lucideProps} />}
              </button> */}

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

              {/* <button
                className={`${audio ? '!bg-blue-200/40' : ''}`}
                onClick={() => {
                  setAudio(!audio)
                }}>
                {<Speaker {...lucideProps} />}
              </button> */}

              {/* <button onClick={saveToFile} title='Save to .js file'>
                <Download {...lucideProps} />
              </button>

              <button onClick={openFile} title='Open Asemic file'>
                <Upload {...lucideProps} />
              </button> */}

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
              <button onClick={() => setPerform(true)}>
                {<Maximize2 {...lucideProps} />}
              </button>

              {/* <button onClick={() => setPerform(true)}>
                {
                  <PanelTopClose
                    color='white'
                    className='py-0.5'
                    opacity={0.5}
                  />
                }
              </button> */}
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

                {/* <div className='w-full flex'>
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
                )} */}
              </div>
            )}

            <AsemicEditor
              ref={editorRef}
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
