import Asemic from '@/lib/Asemic'
import { Parser } from '@/lib/parser/Parser'
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
  Power,
  RefreshCw,
  Save,
  Upload
} from 'lucide-react'
import { MouseEventHandler, useEffect, useMemo, useRef, useState } from 'react'
import invariant from 'tiny-invariant'
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

      const resizeObserver = new ResizeObserver(onResize)
      resizeObserver.observe(canvas.current)

      window.addEventListener('resize', onResize)

      return () => {
        resizeObserver.disconnect()
        window.removeEventListener('resize', onResize)
      }
    }, [asemic])

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
              } as Partial<AsemicData>)
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

  const saveToFile = async () => {
    const content = editable.current?.value || scenesSource
    const timestamp = new Date().toISOString().slice(0, 10).replace(/:/g, '')
    const filename = `asemic-${timestamp}.asemic`

    try {
      if ('showSaveFilePicker' in window) {
        // Modern browsers with File System Access API
        // @ts-ignore
        const fileHandle = await window.showSaveFilePicker({
          suggestedName: filename,
          types: [
            {
              description: 'Asemic files',
              accept: {
                'text/plain': ['.asemic']
              }
            }
          ]
        })
        const writable = await fileHandle.createWritable()
        await writable.write(content)
        await writable.close()
        console.log('File saved successfully')
      } else {
        // Fallback for iPadOS and other browsers
        const blob = new Blob([content], { type: 'text/plain' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = filename
        a.style.display = 'none'
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
        console.log('File downloaded successfully')
      }
    } catch (error) {
      if (error.name !== 'AbortError') {
        console.error('Failed to save file:', error)
      }
    }
  }

  const openFile = async () => {
    try {
      if ('showOpenFilePicker' in window) {
        // Modern browsers with File System Access API
        // @ts-ignore
        const [fileHandle] = await window.showOpenFilePicker({
          types: [
            {
              description: 'Asemic files',
              accept: {
                'text/plain': ['.asemic']
              }
            }
          ]
        })
        const file = await fileHandle.getFile()
        const content = await file.text()
        setScenesSource(content)
        editorRef.current?.setValue(content)
      } else {
        // Fallback for iPadOS and other browsers
        const input = document.createElement('input')
        input.type = 'file'
        input.accept = '.asemic'
        input.style.display = 'none'

        input.onchange = async e => {
          const file = (e.target as HTMLInputElement).files?.[0]
          if (file) {
            try {
              const content = await file.text()
              setScenesSource(content)
              editorRef.current?.setValue(content)
              console.log('File loaded successfully')
            } catch (error) {
              console.error('Failed to read file:', error)
            }
          }
          document.body.removeChild(input)
        }

        input.oncancel = () => {
          document.body.removeChild(input)
        }

        document.body.appendChild(input)
        input.click()
      }
    } catch (error) {
      if (error.name !== 'AbortError') {
        console.error('Failed to open file:', error)
      }
    }
  }

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

  const updatePosition = (e: React.MouseEvent | React.TouchEvent) => {
    // Check if it's a mouse event with button pressed
    if ('buttons' in e && e.buttons !== 1) {
      return
    }

    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect()

    // Get x position from either mouse or touch event
    const clientX =
      'touches' in e && e.touches.length > 0
        ? e.touches[0].clientX
        : 'clientX' in e
        ? e.clientX
        : 0

    const x = clientX - rect.left
    const newProgress = (x / rect.width) * totalLength

    setProgress(newProgress)
    if (asemic.current) {
      asemic.current.postMessage({
        scrub: newProgress
      } as AsemicData)
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

        <div
          className='fixed top-1 left-1 h-full w-[calc(100%-50px)] flex-col flex !z-100'
          onPointerDownCapture={checkLive}>
          <div className='flex items-center px-0 py-1 z-100'>
            <button
              onClick={() => {
                asemic.current!.postMessage({
                  play: true
                } as AsemicData)
              }}>
              {pauseAt ? <Play {...lucideProps} /> : <Pause {...lucideProps} />}
            </button>
            <div
              className='w-full h-5 flex items-center cursor-pointer relative select-none'
              onMouseMove={updatePosition}
              onMouseDown={updatePosition}
              onTouchMove={updatePosition}
              onTouchStart={updatePosition}>
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
                  border: '1 white'
                }}
              />
              <div
                className='absolute h-full w-2 rounded-lg'
                style={{
                  top: '50%',
                  transform: 'translateY(-50%)',
                  left: `${(progress / totalLength) * 100}%`,
                  background: '#3b82f6'
                }}
              />
              <div className='absolute top-0 left-0 w-full h-full pointer-events-none'>
                {scenes.map((scene, index) => {
                  const sceneStart = (scene / totalLength) * 100
                  return (
                    <div
                      key={index}
                      className='absolute h-4 w-4 rounded-full font-mono text-[10px] bg-black text-white flex items-center justify-center'
                      style={{
                        left: `${sceneStart.toFixed(1)}%`,
                        top: '50%',
                        transform: 'translateY(-50%)'
                      }}>
                      {index}
                    </div>
                  )
                })}
              </div>
            </div>
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

                <button
                  onClick={() => {
                    setScenesSource(editorRef.current?.getValue() ?? '')
                  }}
                  title={'Set Value'}>
                  {<RefreshCw {...lucideProps} />}
                </button>
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
              />
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
