import { useSocket } from '../server/schema'
import Slider from '../components/Slider'
import { useCallback, useEffect, useState } from 'react'

export default function AsemicParams() {
  const { socket, schema, setSchema } = useSocket()
  const { params, presets } = schema

  const setParams = (newParams: typeof params) => {
    setSchema({ ...schema, params: newParams })
  }

  const [selectedPreset, setSelectedPresetState] = useState<string | undefined>(
    undefined
  )
  const setSelectedPreset = useCallback((presetName: string | undefined) => {
    setPresetFadeAmount(0)
    setSelectedPresetState(presetName)
  }, [])
  const [presetFadeAmount, setPresetFadeAmount] = useState(0)
  const [initialParamsForFade, setInitialParamsForFade] = useState<
    typeof params | null
  >(null)

  useEffect(() => {
    const fadeToPreset = (presetName: string, amount: number) => {
      if (!presets[presetName]) return

      if (amount > 0 && initialParamsForFade === null) {
        setInitialParamsForFade({ ...params })
        return
      }

      if (amount === 0 && initialParamsForFade !== null) {
        setInitialParamsForFade(null)
        return
      }

      const baseParams = initialParamsForFade || params
      const updatedParams = { ...params }

      for (let paramName of Object.keys(presets[presetName])) {
        if (updatedParams[paramName] && baseParams[paramName]) {
          const targetValue = presets[presetName][paramName].value
          const initialValue = baseParams[paramName].value
          updatedParams[paramName].value =
            initialValue + (targetValue - initialValue) * amount
        }
      }
      setParams(updatedParams)
    }
    if (selectedPreset && presetFadeAmount >= 0) {
      fadeToPreset(selectedPreset, presetFadeAmount)
    }
  }, [presetFadeAmount, selectedPreset, params, presets, initialParamsForFade])

  return (
    <>
      <div className='h-[200px]'></div>
      <div className='fixed top-0 left-0 w-full bg-gray-800 p-2 z-10'>
        <div className='w-full flex items-center select-none text-white'>
          <select
            value={selectedPreset}
            onChange={ev => setSelectedPreset(ev.target.value)}
            className='bg-gray-700 text-white p-1 rounded'>
            <option value={''}>Select Preset</option>
            {presets &&
              Object.keys(presets).map(preset => (
                <option key={preset} value={preset}>
                  {preset}
                </option>
              ))}
          </select>
          {selectedPreset && (
            <>
              <Slider
                values={{ x: presetFadeAmount, y: 0 }}
                onChange={({ x }) => setPresetFadeAmount(x)}
                sliderStyle={({ x, y }) => ({
                  width: `${x * 100}%`
                })}
                max={1}
                min={0}
                exponent={1}
                className='h-8 w-full mx-2'
                innerClassName='bg-blue-500 rounded-lg left-0 top-0 h-full'
              />
              <div className='text-xs w-10 text-right'>
                {presetFadeAmount.toFixed(2)}
              </div>
            </>
          )}
        </div>
      </div>
      <div className='flex w-screen h-screen space-x-2'>
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
                    setParams({ ...params, [key]: { ...type, value: y } })
                  }}
                />
                <div className='text-xs mt-1'>{type.value.toFixed(2)}</div>
              </div>
            )
          })}
      </div>
    </>
  )
}
