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
import { open, save as saveDialog } from '@tauri-apps/plugin-dialog'
import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs'
import { invoke } from '@tauri-apps/api/core'

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

  const [useRustParser, setUseRustParser] = useState(false)

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
          console.log('Syntax tree:', JSON.stringify(syntaxTree, null, 2))

          if (!syntaxTree) {
            console.warn('No syntax tree available')
            return
          }

          try {
            const parserState = await invoke('parser_setup', {
              input: {
                source: scenesSourceRef.current,
                tree: syntaxTree
              }
            })
            console.log('Rust parser initialized:', parserState)
          } catch (error) {
            console.error('Rust parser setup failed:', error)
          }
        } else {
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
          asemic.current?.postMessage({
            source: scenesSourceRef.current,
            preProcess
          })
        }
      }
      restart()
    }, [scenesSource, isSetup, useRustParser])
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
      console.error('Failed to save file:', error)
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
    const newProgress = (x / (rect.width ?? 1)) * totalLength

    // setProgress(newProgress)
    if (asemic.current) {
      asemic.current.postMessage({
        scrub: newProgress
      } as AsemicData)
    }
  }

  useEffect(() => {
    const onResize = () => {
      const boundingRect = canvas.current.getBoundingClientRect()
      devicePixelRatio = 2

      // canvas.current.width = boundingRect.width * devicePixelRatio
      // canvas.current.height = boundingRect.height * devicePixelRatio

      console.log(boundingRect.width, boundingRect.height)
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

        <div
          className='fixed top-1 left-1 h-full w-[calc(100%-50px)] flex-col flex !z-100'
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
                      className='absolute h-4 w-1 rounded-lg font-mono text-[10px] bg-[#68788f] text-white flex items-center justify-center'
                      style={{
                        left: `${sceneStart.toFixed(1)}%`,
                        top: '50%',
                        transform: 'translateY(-50%)'
                      }}></div>
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
