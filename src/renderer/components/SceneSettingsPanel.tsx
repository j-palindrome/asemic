import { useState, useRef, useEffect } from 'react'
import AsemicExpressionEditor from './AsemicExpressionEditor'
import Slider from './Slider'
import AsemicEditor, { AsemicEditorRef } from './Editor'
import { ScrubSettings } from '../app/AsemicApp'
import { isEqual, uniq } from 'lodash'

type ParamConfig = {
  max: number
  min: number
  exponent: number
  dimension: number
  default: number[]
  oscPath?: string
}

type SceneParamConfig = Omit<ParamConfig, 'dimension'>

export interface GlobalSettings {
  supercolliderHost?: string
  supercolliderPort?: number
  params: Record<string, ParamConfig>
}

export interface SceneSettings {
  code?: string
  text?: string
  length?: number
  offset?: number
  pause?: number | false
  params: Record<string, ParamConfig>
  globalParams?: Record<string, SceneParamConfig>
  oscGroups?: Array<{
    osc?: Array<{
      name: string
      value: number | string
      play: 'once' | 'always'
    }>
    oscHost?: string
    oscPort?: number
  }>
}

interface SceneSettingsPanelProps {
  activeScene: number
  scrubSettings: ScrubSettings
  onUpdate: (settings: SceneSettings) => void
  onUpdateScrub: (settings: ScrubSettings) => void
  onAddScene: () => void
  onDeleteScene: () => void
  sceneList: Array<SceneSettings>
  globalSettings: GlobalSettings
  setGlobalSettings: (settings: GlobalSettings) => void
  errors?: string[]
}

export default function SceneSettingsPanel({
  activeScene,
  onUpdate,
  onAddScene,
  onDeleteScene,
  onUpdateScrub,
  scrubSettings,
  sceneList,
  globalSettings,
  errors
}: SceneSettingsPanelProps) {
  const [showAddParam, setShowAddParam] = useState(false)
  const [newParamName, setNewParamName] = useState('')
  const [codeExpanded, setCodeExpanded] = useState(true)
  const [notesExpanded, setNotesExpanded] = useState(true)
  const [renamingParam, setRenamingParam] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [editAllMode, setEditAllMode] = useState<Set<string>>(new Set())
  const editorRef = useRef<AsemicEditorRef | null>(null)
  const textEditorRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    if (!textEditorRef.current) return
    textEditorRef.current.value = sceneList[activeScene]?.text || ''
  }, [sceneList, activeScene])

  const handleAddParam = () => {
    if (newParamName.trim()) {
      const existingParam = sceneList
        .flatMap(scene => Object.entries(scene.params || {}))
        .find(([key]) => key === newParamName.trim())?.[1]

      onUpdate({
        ...sceneList[activeScene],
        params: {
          ...sceneList[activeScene].params,
          [newParamName.trim()]: existingParam || {
            max: 1,
            min: 0,
            exponent: 1,
            dimension: 1,
            default: [1]
          }
        }
      })
      setNewParamName('')
      setShowAddParam(false)
    }
  }

  const handleDeleteParam = (key: string) => {
    const newParams = { ...sceneList[activeScene].params }
    delete newParams[key]
    onUpdate({ ...sceneList[activeScene], params: newParams })
  }

  const handleRenameParam = (oldKey: string) => {
    if (!renameValue.trim() || renameValue === oldKey) {
      setRenamingParam(null)
      setRenameValue('')
      return
    }

    const newKey = renameValue.trim()
    const newParams = { ...sceneList[activeScene].params }
    newParams[newKey] = newParams[oldKey]
    delete newParams[oldKey]

    const newScrubParams = { ...scrubSettings.params }
    newScrubParams[newKey] = newScrubParams[oldKey]
    delete newScrubParams[oldKey]

    onUpdate({ ...sceneList[activeScene], params: newParams })
    onUpdateScrub({ ...scrubSettings, params: newScrubParams })
    setRenamingParam(null)
    setRenameValue('')
  }

  const handleUpdateParam = (key: string, value: number[]) => {
    onUpdateScrub({
      ...scrubSettings,
      params: {
        ...scrubSettings.params,
        [key]: value
      }
    })
  }

  const toggleEditAllMode = (key: string) => {
    const newSet = new Set(editAllMode)
    if (newSet.has(key)) {
      newSet.delete(key)
    } else {
      newSet.add(key)
    }
    setEditAllMode(newSet)
  }

  if (!scrubSettings || !sceneList[activeScene]) {
    return null
  }

  return (
    <div className='absolute bottom-0 left-0 right-0 border-t border-white/20 z-50 flex flex-col h-[calc(100vh-60px)]'>
      {/* Header */}
      <div className='flex items-center gap-2 p-3 border-b border-white/20'>
        <span className='text-white text-sm font-semibold'>
          Scene {activeScene} Settings
        </span>
        <button
          onClick={onAddScene}
          className='text-white/50 hover:text-white text-xs px-2 py-0.5 bg-white/10 rounded'
          title='Add scene after this one'>
          +
        </button>
        <button
          onClick={onDeleteScene}
          className='text-white/50 hover:text-red-400 text-xs px-2 py-0.5 bg-white/10 rounded'
          title='Delete current scene'>
          Delete
        </button>
      </div>

      {/* Settings Panel - Scrollable */}
      <div className='overflow-y-auto p-3 border-t border-white/20'>
        {/* Code Section */}
        <div className='mb-3'>
          <div className='flex items-center gap-2 mb-2'>
            <button
              onClick={() => setCodeExpanded(!codeExpanded)}
              className='text-white/50 hover:text-white text-xs w-7'>
              {codeExpanded ? '▼' : '▶'}
            </button>
            <span className='text-white/70 text-sm font-semibold'>Code</span>
            {codeExpanded && (
              <>
                <button
                  onClick={() => {
                    const currentCode = editorRef.current?.getValue()
                    if (currentCode !== undefined) {
                      onUpdate({ ...sceneList[activeScene], code: currentCode })
                    }
                  }}
                  className='text-white/50 hover:text-white text-xs px-2 py-0.5 bg-white/10 rounded'>
                  Update Code
                </button>
                <span className='text-white/50 text-[10px] ml-auto'>
                  Cmd+Enter to update
                </span>
              </>
            )}
          </div>

          {codeExpanded && (
            <AsemicEditor
              ref={editorRef}
              defaultValue={sceneList[activeScene].code || ''}
              errors={errors || []}
            />
          )}

          {/* Error Display */}
          {codeExpanded && errors && errors.length > 0 && (
            <div className='mt-2 p-2 bg-red-900/30 border border-red-500/50 rounded'>
              <div className='text-red-400 text-xs space-y-1'>
                {errors.map((error, idx) => (
                  <div key={idx} className='flex items-start gap-2'>
                    <span className='text-red-500 mt-0.5'>•</span>
                    <span className='break-words'>{error}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Notes Section */}
        <div className='mb-3'>
          <div className='flex items-center gap-2 mb-2'>
            <button
              onClick={() => setNotesExpanded(!notesExpanded)}
              className='text-white/50 hover:text-white text-xs w-7'>
              {notesExpanded ? '▼' : '▶'}
            </button>
            <label className='text-xs text-white/50'>Notes</label>
            {notesExpanded && (
              <button
                onClick={() => {
                  const currentCode = textEditorRef.current?.value
                  if (currentCode !== undefined) {
                    onUpdate({ ...sceneList[activeScene], text: currentCode })
                  }
                }}
                className='text-white/50 hover:text-white text-xs px-2 py-0.5 bg-white/10 rounded'>
                Update Code
              </button>
            )}
          </div>
          {notesExpanded && (
            <div
              className='text-editor'
              style={{ fontFamily: 'EB Garamond, serif' }}>
              <textarea
                ref={textEditorRef as any}
                defaultValue={sceneList[activeScene].text || ''}
                className='w-full h-[100px] bg-transparent hover:backdrop-blur focus:backdrop-blur relative outline-none text-white px-3 py-2 rounded border border-white/20 text-sm font-serif resize-y'
                spellCheck='false'
              />
            </div>
          )}
        </div>

        {/* Basic Settings */}
        <div className='grid grid-cols-3 gap-3 text-xs'>
          <div>
            <label className='text-white/70 block mb-1'>Length</label>
            <input
              type='number'
              step='0.01'
              value={sceneList[activeScene].length ?? 0.1}
              onChange={e => {
                if (document.activeElement !== e.target) return
                onUpdate({
                  ...sceneList[activeScene],
                  length: parseFloat(e.target.value)
                })
              }}
              className='w-full bg-white/10 text-white px-2 py-1 rounded'
            />
          </div>
          <div>
            <label className='text-white/70 block mb-1'>Offset</label>
            <input
              type='number'
              step='0.1'
              value={sceneList[activeScene].offset ?? 0}
              onChange={e =>
                document.activeElement !== e.target &&
                onUpdate({
                  ...sceneList[activeScene],
                  offset: parseFloat(e.target.value)
                })
              }
              className='w-full bg-white/10 text-white px-2 py-1 rounded'
            />
          </div>
          <div>
            <label className='text-white/70 block mb-1'>Pause</label>
            <input
              type='number'
              step='0.1'
              value={
                sceneList[activeScene].pause === false
                  ? -1
                  : sceneList[activeScene].pause ?? 0
              }
              onChange={e => {
                const val = parseFloat(e.target.value)
                document.activeElement !== e.target &&
                  onUpdate({
                    ...sceneList[activeScene],
                    pause: (val < 0 ? false : val) as number | false
                  })
              }}
              className='w-full bg-white/10 text-white px-2 py-1 rounded'
            />
            <span className='text-white/50 text-[10px]'>(-1 for false)</span>
          </div>
        </div>

        {/* Global Params Section */}
        {Object.keys(globalSettings.params).length > 0 && (
          <div className='mt-3 border-t border-white/10 pt-3'>
            <label className='text-white/70 text-sm font-semibold block mb-2'>
              Global Params
            </label>
            <div className='space-y-2'>
              {Object.entries(globalSettings.params)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([paramId, paramConfig]) => (
                  <div
                    key={paramId}
                    className='bg-white/5 p-2 rounded border border-white/10 hover:backdrop-blur-sm relative'>
                    <div className='flex items-center gap-2 mb-2'>
                      <span className='text-white/70 text-xs font-medium flex-1'>
                        {paramId}
                      </span>
                      {(() => {
                        const currentValues = scrubSettings.params[paramId]
                        const defaultValues =
                          sceneList[activeScene].globalParams?.[paramId]
                            ?.default ?? paramConfig.default
                        const isDifferent =
                          currentValues &&
                          currentValues.some((x, i) => x !== defaultValues[i])

                        return isDifferent ? (
                          <>
                            <button
                              onClick={() => {
                                onUpdate({
                                  ...sceneList[activeScene],
                                  globalParams: {
                                    ...sceneList[activeScene].globalParams,
                                    [paramId]: {
                                      ...sceneList[activeScene].globalParams?.[
                                        paramId
                                      ],
                                      default: currentValues
                                    }
                                  } as any
                                })
                              }}
                              className='text-white/50 hover:text-white text-xs px-2 bg-white/10 rounded'
                              title='Save current slider values as defaults'>
                              {sceneList[activeScene].globalParams?.[paramId]
                                ?.default
                                ? 'Save'
                                : 'Set'}
                            </button>
                            {sceneList[activeScene].globalParams?.[paramId] && (
                              <button
                                onClick={() => {
                                  const newParams = {
                                    ...sceneList[activeScene].globalParams
                                  }
                                  delete newParams[paramId]
                                  onUpdate({
                                    ...sceneList[activeScene],
                                    globalParams: newParams
                                  })
                                }}
                                className='text-white/50 hover:text-red-400 text-xs px-2 bg-white/10 rounded'
                                title='Unset defaults'>
                                Unset
                              </button>
                            )}
                          </>
                        ) : null
                      })()}
                    </div>

                    <div className='space-y-1'>
                      {Array.from({ length: paramConfig.dimension }).map(
                        (_, dimIndex) => (
                          <div
                            key={dimIndex}
                            className='flex items-center gap-2'>
                            <span className='text-white/50 text-xs w-6'>
                              [{dimIndex}]
                            </span>
                            <div className='relative flex-1 h-6 bg-white/5 rounded'>
                              <Slider
                                className='w-full h-full'
                                innerClassName=''
                                min={paramConfig.min}
                                max={paramConfig.max}
                                exponent={paramConfig.exponent}
                                values={{
                                  x:
                                    scrubSettings.params[paramId]?.[dimIndex] ??
                                    paramConfig.default?.[dimIndex] ??
                                    paramConfig.min,
                                  y: 0
                                }}
                                sliderStyle={({ x }) => ({
                                  left: `${x * 100}%`,
                                  top: '50%',
                                  transform: 'translate(-50%, -50%)',
                                  width: '12px',
                                  height: '12px',
                                  borderRadius: '50%',
                                  backgroundColor: 'white',
                                  position: 'absolute',
                                  pointerEvents: 'none'
                                })}
                                onChange={({ x }) => {
                                  const currentValues =
                                    scrubSettings.params[paramId] || []
                                  const newValues = [...currentValues]
                                  newValues[dimIndex] = x
                                  onUpdateScrub({
                                    ...scrubSettings,
                                    params: {
                                      ...scrubSettings.params,
                                      [paramId]: newValues
                                    }
                                  })
                                }}
                              />
                            </div>
                            <span className='text-white/70 text-xs w-12 text-right'>
                              {(
                                scrubSettings.params[paramId]?.[dimIndex] ??
                                paramConfig.default?.[dimIndex] ??
                                paramConfig.min
                              ).toFixed(3)}
                            </span>
                          </div>
                        )
                      )}
                    </div>
                  </div>
                ))}
            </div>
          </div>
        )}

        {/* Params Section */}
        <div className='mt-3 border-t border-white/10 pt-3'>
          <div className='flex items-center gap-2 mb-2'>
            <label className='text-white/70 text-sm font-semibold'>
              Params (Global)
            </label>
            <button
              onClick={e => {
                e.preventDefault()
                e.stopPropagation()
                setShowAddParam(true)
              }}
              className='text-white/50 hover:text-white text-xs px-2 py-0.5 bg-white/10 rounded'>
              + Add
            </button>
          </div>

          {/* Add Param Input */}
          {showAddParam && (
            <div className='mb-3 p-2 bg-white/5 rounded border border-white/20'>
              <div className='flex items-center gap-2'>
                <input
                  type='text'
                  placeholder='Parameter name'
                  value={newParamName}
                  onChange={e => setNewParamName(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && newParamName.trim()) {
                      handleAddParam()
                    } else if (e.key === 'Escape') {
                      setNewParamName('')
                      setShowAddParam(false)
                    }
                  }}
                  list='param-names'
                  autoFocus
                  className='flex-1 bg-white/10 text-white px-2 py-1 rounded text-xs'
                />
                <datalist id='param-names'>
                  {uniq(
                    sceneList.flatMap(scene => Object.keys(scene.params || {}))
                  )
                    .sort()
                    .map(name => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                </datalist>
                <button
                  onClick={handleAddParam}
                  className='text-white bg-blue-500 hover:bg-blue-600 px-2 py-1 rounded text-xs'>
                  Add
                </button>
                <button
                  onClick={() => {
                    setNewParamName('')
                    setShowAddParam(false)
                  }}
                  className='text-white/50 hover:text-white text-xs'>
                  ✕
                </button>
              </div>
            </div>
          )}

          <div className='space-y-3 pr-1'>
            {Object.entries(sceneList[activeScene].params || {}).map(
              ([key, paramConfig]) => (
                <div
                  key={key}
                  className='bg-white/5 p-2 rounded border border-white/10'>
                  {/* Title and Controls Row */}
                  <div className='flex items-end gap-2 mb-2'>
                    <div className='flex-1 min-w-[80px]'>
                      <label className='text-white/50 text-xs block mb-1'>
                        Name
                      </label>
                      <div className='text-white/90 text-sm font-medium'>
                        {key}
                      </div>
                    </div>
                    <div>
                      <label className='text-white/50 text-xs block mb-1'>
                        Dim
                      </label>
                      <input
                        type='number'
                        min='1'
                        step='1'
                        value={paramConfig.dimension}
                        onChange={e => {
                          const newDim = Math.max(1, parseInt(e.target.value))
                          document.activeElement !== e.target &&
                            onUpdate({
                              ...sceneList[activeScene],
                              params: {
                                ...sceneList[activeScene].params,
                                [key]: {
                                  ...sceneList[activeScene].params[key],
                                  dimension: newDim
                                }
                              }
                            })
                          const currentValues = scrubSettings.params[key] || []
                          if (currentValues.length !== newDim) {
                            const newValues = Array(newDim).fill(
                              paramConfig.min
                            )
                            currentValues.forEach((v, i) => {
                              if (i < newDim) newValues[i] = v
                            })
                            handleUpdateParam(key, newValues)
                          }
                        }}
                        className='w-12 bg-white/10 text-white px-1 py-0.5 rounded text-xs'
                      />
                    </div>
                    <div>
                      <label className='text-white/50 text-xs block mb-1'>
                        Min
                      </label>
                      <input
                        type='number'
                        step='0.01'
                        value={paramConfig.min}
                        onChange={e =>
                          document.activeElement !== e.target &&
                          onUpdate({
                            ...sceneList[activeScene],
                            params: {
                              ...sceneList[activeScene].params,
                              [key]: {
                                ...sceneList[activeScene].params[key],
                                min: parseFloat(e.target.value)
                              }
                            }
                          })
                        }
                        className='w-16 bg-white/10 text-white px-1 py-0.5 rounded text-xs'
                      />
                    </div>
                    <div>
                      <label className='text-white/50 text-xs block mb-1'>
                        Max
                      </label>
                      <input
                        type='number'
                        step='0.01'
                        value={paramConfig.max}
                        onChange={e =>
                          onUpdate({
                            ...sceneList[activeScene],
                            params: {
                              ...sceneList[activeScene].params,
                              [key]: {
                                ...sceneList[activeScene].params[key],
                                max: parseFloat(e.target.value)
                              }
                            }
                          })
                        }
                        className='w-16 bg-white/10 text-white px-1 py-0.5 rounded text-xs'
                      />
                    </div>
                    <div>
                      <label className='text-white/50 text-xs block mb-1'>
                        Exp
                      </label>
                      <input
                        type='number'
                        step='0.1'
                        value={paramConfig.exponent}
                        onChange={e =>
                          document.activeElement !== e.target &&
                          onUpdate({
                            ...sceneList[activeScene],
                            params: {
                              ...sceneList[activeScene].params,
                              [key]: {
                                ...sceneList[activeScene].params[key],
                                exponent: parseFloat(e.target.value)
                              }
                            }
                          })
                        }
                        className='w-14 bg-white/10 text-white px-1 py-0.5 rounded text-xs'
                      />
                    </div>
                    <button
                      onClick={() => {
                        const currentValues = scrubSettings.params[key] || []
                        onUpdate({
                          ...sceneList[activeScene],
                          params: {
                            ...sceneList[activeScene].params,
                            [key]: {
                              ...sceneList[activeScene].params[key],
                              default: currentValues
                            }
                          }
                        })
                      }}
                      className='text-white/50 hover:text-white text-xs px-2 py-0.5 bg-white/10 rounded'
                      title='Save current slider values as defaults'>
                      Save Defaults
                    </button>
                    <button
                      onClick={() => toggleEditAllMode(key)}
                      className={`text-xs px-2 py-0.5 rounded ${
                        editAllMode.has(key)
                          ? 'text-white bg-blue-500'
                          : 'text-white/50 hover:text-white bg-white/10'
                      }`}
                      title='Edit all dimensions with one slider'>
                      Edit All
                    </button>
                    <button
                      onClick={() => {
                        setRenamingParam(key)
                        setRenameValue(key)
                      }}
                      className='text-white/50 hover:text-white text-xs px-2 py-0.5 bg-white/10 rounded'
                      title='Rename parameter'>
                      Rename
                    </button>
                    <button
                      onClick={() => handleDeleteParam(key)}
                      className='text-white/50 hover:text-red-400 text-xs pb-1'>
                      ✕
                    </button>
                  </div>

                  {/* Rename Param Dialog */}
                  {renamingParam === key && (
                    <div className='mb-2 p-2 bg-white/10 rounded border border-white/30'>
                      <div className='flex items-center gap-2'>
                        <span className='text-white/70 text-xs'>
                          Rename to:
                        </span>
                        <input
                          type='text'
                          placeholder='New parameter name'
                          value={renameValue}
                          onChange={e => setRenameValue(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') {
                              handleRenameParam(key)
                            } else if (e.key === 'Escape') {
                              setRenamingParam(null)
                              setRenameValue('')
                            }
                          }}
                          autoFocus
                          className='flex-1 bg-white/10 text-white px-2 py-1 rounded text-xs border border-white/20'
                        />
                        <button
                          onClick={() => handleRenameParam(key)}
                          className='text-white bg-blue-500 hover:bg-blue-600 px-2 py-1 rounded text-xs'>
                          Rename
                        </button>
                        <button
                          onClick={() => {
                            setRenamingParam(null)
                            setRenameValue('')
                          }}
                          className='text-white/50 hover:text-white text-xs'>
                          ✕
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Edit All Mode - Single Slider */}
                  {editAllMode.has(key) && (
                    <div className='mb-2 p-2 bg-white/10 rounded border border-white/20'>
                      <div className='flex items-center gap-2'>
                        <span className='text-white/70 text-xs'>
                          All Values:
                        </span>
                        <div className='relative flex-1 h-6 bg-white/5 rounded'>
                          <Slider
                            className='w-full h-full'
                            innerClassName=''
                            min={paramConfig.min}
                            max={paramConfig.max}
                            exponent={paramConfig.exponent}
                            values={{
                              x:
                                scrubSettings.params[key]?.[0] ??
                                paramConfig.default[0] ??
                                paramConfig.min,
                              y: 0
                            }}
                            sliderStyle={({ x }) => ({
                              left: `${x * 100}%`,
                              top: '50%',
                              transform: 'translate(-50%, -50%)',
                              width: '12px',
                              height: '12px',
                              borderRadius: '50%',
                              backgroundColor: 'white',
                              position: 'absolute',
                              pointerEvents: 'none'
                            })}
                            onChange={({ x }) => {
                              const newValues = Array(
                                paramConfig.dimension
                              ).fill(x)
                              handleUpdateParam(key, newValues)
                            }}
                          />
                        </div>
                        <span className='text-white/70 text-xs w-12 text-right'>
                          {(
                            scrubSettings.params[key]?.[0] ??
                            paramConfig.default[0] ??
                            paramConfig.min
                          ).toFixed(3)}
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Value Sliders Row */}
                  {!editAllMode.has(key) && (
                    <div className='space-y-1'>
                      {Array.from({ length: paramConfig.dimension }).map(
                        (_, dimIndex) => (
                          <div
                            key={dimIndex}
                            className='flex items-center gap-2'>
                            <span className='text-white/50 text-xs w-6'>
                              [{dimIndex}]
                            </span>
                            <div className='relative flex-1 h-6 bg-white/5 rounded'>
                              <Slider
                                className='w-full h-full'
                                innerClassName=''
                                min={paramConfig.min}
                                max={paramConfig.max}
                                exponent={paramConfig.exponent}
                                values={{
                                  x:
                                    scrubSettings.params[key]?.[dimIndex] ??
                                    paramConfig.default[dimIndex] ??
                                    paramConfig.min,
                                  y: 0
                                }}
                                sliderStyle={({ x }) => ({
                                  left: `${x * 100}%`,
                                  top: '50%',
                                  transform: 'translate(-50%, -50%)',
                                  width: '12px',
                                  height: '12px',
                                  borderRadius: '50%',
                                  backgroundColor: 'white',
                                  position: 'absolute',
                                  pointerEvents: 'none'
                                })}
                                onChange={({ x }) => {
                                  const currentValues =
                                    scrubSettings.params[key] || []
                                  const newValues = [...currentValues]
                                  newValues[dimIndex] = x
                                  handleUpdateParam(key, newValues)
                                }}
                              />
                            </div>
                            <span className='text-white/70 text-xs w-12 text-right'>
                              {(
                                scrubSettings.params[key]?.[dimIndex] ??
                                paramConfig.default[dimIndex] ??
                                paramConfig.min
                              ).toFixed(3)}
                            </span>
                          </div>
                        )
                      )}
                    </div>
                  )}
                </div>
              )
            )}
          </div>
          {(!sceneList[activeScene].params ||
            Object.keys(sceneList[activeScene].params).length === 0) && (
            <p className='text-white/40 text-xs italic'>No params defined</p>
          )}
        </div>

        {/* OSC Messages Section */}
        <div className='mt-3 border-t border-white/10 pt-3'>
          <div className='flex items-center gap-2 mb-2'>
            <label className='text-white/70 text-sm font-semibold'>
              OSC Groups
            </label>
            <button
              onClick={e => {
                e.preventDefault()
                e.stopPropagation()
                onUpdate({
                  ...sceneList[activeScene],
                  oscGroups: [
                    ...(sceneList[activeScene].oscGroups || []),
                    {
                      oscHost: 'localhost',
                      oscPort: 57120,
                      osc: []
                    }
                  ]
                })
              }}
              className='text-white/50 hover:text-white text-xs px-2 py-0.5 bg-white/10 rounded'>
              + Add Group
            </button>
          </div>

          <div className='space-y-3'>
            {(sceneList[activeScene].oscGroups || []).map(
              (group, groupIndex) => (
                <div
                  key={groupIndex}
                  className='bg-white/5 p-2 rounded border border-white/10'>
                  {/* Group Header */}
                  <div className='flex items-center gap-2 mb-2'>
                    <span className='text-white/70 text-xs font-semibold'>
                      Group {groupIndex + 1}
                    </span>
                    <input
                      type='text'
                      placeholder='Host (localhost)'
                      value={group.oscHost || 'localhost'}
                      onChange={e => {
                        const newGroups = [
                          ...(sceneList[activeScene].oscGroups || [])
                        ]
                        newGroups[groupIndex] = {
                          ...newGroups[groupIndex],
                          oscHost: e.target.value
                        }
                        document.activeElement !== e.target &&
                          onUpdate({
                            ...sceneList[activeScene],
                            oscGroups: newGroups
                          })
                      }}
                      className='w-24 bg-white/10 text-white px-2 py-0.5 rounded text-xs'
                    />
                    <input
                      type='number'
                      placeholder='Port'
                      value={group.oscPort || 57120}
                      onChange={e => {
                        const newGroups = [
                          ...(sceneList[activeScene].oscGroups || [])
                        ]
                        newGroups[groupIndex] = {
                          ...newGroups[groupIndex],
                          oscPort: parseInt(e.target.value) || 57120
                        }
                        onUpdate({
                          ...sceneList[activeScene],
                          oscGroups: newGroups
                        })
                      }}
                      className='w-16 bg-white/10 text-white px-2 py-0.5 rounded text-xs'
                    />
                    <button
                      onClick={e => {
                        e.preventDefault()
                        e.stopPropagation()
                        const newGroups = [
                          ...(sceneList[activeScene].oscGroups || [])
                        ]
                        newGroups[groupIndex] = {
                          ...newGroups[groupIndex],
                          osc: [
                            ...(newGroups[groupIndex].osc || []),
                            { name: '', value: 0, play: 'always' }
                          ]
                        }
                        onUpdate({
                          ...sceneList[activeScene],
                          oscGroups: newGroups
                        })
                      }}
                      className='text-white/50 hover:text-white text-xs px-2 py-0.5 bg-white/10 rounded'>
                      + Add Message
                    </button>
                    <button
                      onClick={() => {
                        const newGroups = [
                          ...(sceneList[activeScene].oscGroups || [])
                        ]
                        newGroups[groupIndex].osc = (
                          newGroups[groupIndex].osc || []
                        ).sort((a, b) => a.name.localeCompare(b.name))
                        onUpdate({
                          ...sceneList[activeScene],
                          oscGroups: newGroups
                        })
                      }}
                      className='text-white/50 hover:text-white text-xs px-2 py-0.5 bg-white/10 rounded'
                      title='Sort messages by name'>
                      Sort
                    </button>
                    <button
                      onClick={() => {
                        const newGroups = [
                          ...(sceneList[activeScene].oscGroups || [])
                        ]
                        newGroups.splice(groupIndex, 1)
                        onUpdate({
                          ...sceneList[activeScene],
                          oscGroups: newGroups
                        })
                      }}
                      className='text-white/50 hover:text-red-400 text-xs ml-auto'>
                      ✕
                    </button>
                  </div>

                  {/* Messages in Group */}
                  <div className='space-y-1 ml-2'>
                    {(group.osc || []).map((osc, msgIndex) => (
                      <div key={msgIndex} className='flex items-center gap-2'>
                        <input
                          type='text'
                          placeholder='OSC path'
                          value={osc.name}
                          onChange={e => {
                            const newGroups = [
                              ...(sceneList[activeScene].oscGroups || [])
                            ]
                            newGroups[groupIndex].osc![msgIndex] = {
                              ...newGroups[groupIndex].osc![msgIndex],
                              name: e.target.value
                            }
                            document.activeElement !== e.target &&
                              onUpdate({
                                ...sceneList[activeScene],
                                oscGroups: newGroups
                              })
                          }}
                          list={`osc-paths-${groupIndex}-${msgIndex}`}
                          className='flex-1 bg-white/10 text-white px-2 py-1 rounded text-xs'
                        />
                        <datalist id={`osc-paths-${groupIndex}-${msgIndex}`}>
                          {[
                            ...new Set(
                              sceneList.flatMap(
                                scene =>
                                  scene.oscGroups?.flatMap(
                                    g => g.osc?.map(oscMsg => oscMsg.name) || []
                                  ) || []
                              )
                            )
                          ]
                            .sort()
                            .map(x => (
                              <option key={x} value={x}>
                                {x}
                              </option>
                            ))}
                        </datalist>
                        <input
                          type='text'
                          placeholder='Expression or value'
                          value={osc.value.toString()}
                          onChange={e => {
                            const newGroups = [
                              ...(sceneList[activeScene].oscGroups || [])
                            ]
                            newGroups[groupIndex].osc![msgIndex] = {
                              ...newGroups[groupIndex].osc![msgIndex],
                              value: e.target.value as any
                            }
                            onUpdate({
                              ...sceneList[activeScene],
                              oscGroups: newGroups
                            })
                          }}
                          className='flex-1 bg-white/10 text-white px-2 py-1 rounded text-xs'
                        />
                        <select
                          value={osc.play}
                          onChange={e => {
                            const newGroups = [
                              ...(sceneList[activeScene].oscGroups || [])
                            ]
                            newGroups[groupIndex].osc![msgIndex] = {
                              ...newGroups[groupIndex].osc![msgIndex],
                              play: e.target.value as 'once' | 'always'
                            }
                            onUpdate({
                              ...sceneList[activeScene],
                              oscGroups: newGroups
                            })
                          }}
                          className='bg-white/10 text-white px-2 py-1 rounded text-xs'>
                          <option value='always'>always</option>
                          <option value='once'>once</option>
                        </select>
                        <button
                          onClick={() => {
                            const newGroups = [
                              ...(sceneList[activeScene].oscGroups || [])
                            ]
                            newGroups[groupIndex].osc!.splice(msgIndex, 1)
                            onUpdate({
                              ...sceneList[activeScene],
                              oscGroups: newGroups
                            })
                          }}
                          className='text-white/50 hover:text-red-400 text-xs'>
                          ✕
                        </button>
                      </div>
                    ))}
                    {(!group.osc || group.osc.length === 0) && (
                      <p className='text-white/40 text-xs italic'>
                        No messages in this group
                      </p>
                    )}
                  </div>
                </div>
              )
            )}
          </div>

          <div className='text-white/50 text-[10px] mt-2'>
            Values support Asemic expressions (e.g., T, I, ~, etc.)
          </div>
          {(!sceneList[activeScene].oscGroups ||
            sceneList[activeScene].oscGroups.length === 0) && (
            <p className='text-white/40 text-xs italic mt-2'>
              No OSC groups defined
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
