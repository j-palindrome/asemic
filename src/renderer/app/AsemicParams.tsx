import { useSocket } from '../schema'
import Slider from '../components/Slider'
import { useCallback, useEffect, useState, useRef } from 'react'
import { cloneDeep } from 'lodash'

export default function AsemicParams() {
  const { socket, schema, setSchema } = useSocket()
  const { params, presets } = schema

  const [selectedPreset, setSelectedPresetState] = useState(
    undefined as string | undefined
  )
  const setSelectedPreset = useCallback((presetName: string | undefined) => {
    setPresetFadeAmount(0)
    initialParamsForFade.current = null
    setSelectedPresetState(presetName)
  }, [])
  const [presetFadeAmount, setPresetFadeAmount] = useState(0)
  const initialParamsForFade = useRef<typeof params | null>(null)

  const fadeToPreset = (presetName: string, amount: number) => {
    if (!presets[presetName]) return

    // Save initial params when starting a fade (amount goes from 0 to > 0)
    if (initialParamsForFade.current === null) {
      initialParamsForFade.current = cloneDeep(params)
    }

    // Use saved initial params if available, otherwise current params
    const baseParams = initialParamsForFade.current
    const updatedParams = { ...params }

    for (let paramName of Object.keys(presets[presetName])) {
      if (updatedParams[paramName] && baseParams[paramName]) {
        const targetValue = presets[presetName][paramName].value
        const initialValue = baseParams[paramName].value
        updatedParams[paramName].value =
          initialValue + (targetValue - initialValue) * amount
      }
    }
    setSchema({ params: updatedParams })
  }

  return (
    <>
      <div className='h-[200px]'></div>
      <div className='flex w-screen h-screen flex-col space-x-2'>
        <div className='w-full flex mt-2 select-none'>
          <select
            value={selectedPreset}
            onChange={ev => setSelectedPreset(ev.target.value)}>
            <option value={''}>Select Preset</option>
            {Object.keys(presets).map(preset => (
              <option key={preset} value={preset}>
                {preset}
              </option>
            ))}
          </select>
          {selectedPreset && (
            <>
              <Slider
                values={{ x: presetFadeAmount, y: 0 }}
                onChange={({ x }) => {
                  setPresetFadeAmount(x)
                  fadeToPreset(selectedPreset, x)
                }}
                sliderStyle={({ x, y }) => ({
                  width: `${x * 100}%`
                })}
                max={1}
                min={0}
                exponent={1}
                className='h-8 w-full'
                innerClassName='bg-blue-500 rounded-lg left-0 top-0 h-full'
              />
              <div className='text-xs mt-1'>{presetFadeAmount.toFixed(2)}</div>
            </>
          )}
        </div>
        <div className='flex h-full w-screen'>
          {params &&
            Object.entries(params).map(([key, type]) => {
              return (
                <div
                  key={key}
                  className='flex flex-col items-center h-full w-[60px] mr-2'>
                  <label>{key}</label>
                  <Slider
                    max={type.max}
                    min={type.min}
                    className='h-full w-full border border-gray-300 rounded-lg'
                    values={{ x: 0, y: type.value }}
                    exponent={type.exponent}
                    innerClassName='bottom-0 left-0 w-full bg-white rounded-lg'
                    sliderStyle={({ x, y }) => ({
                      height: `${y * 100}%`
                    })}
                    onChange={({ x, y }, end) => {
                      setSchema({
                        params: { ...params, [key]: { ...type, value: y } }
                      })
                    }}
                  />
                  <div className='text-xs mt-1'>{type.value.toFixed(2)}</div>
                </div>
              )
            })}
        </div>
      </div>
    </>
  )
}
