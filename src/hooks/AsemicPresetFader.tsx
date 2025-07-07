import { useCallback, useEffect, useRef, useState } from 'react'
import { InputSchema } from '../server/inputSchema'
import { useSocket } from '../server/schema'
import Slider from '../components/Slider'

const usePresetFader = () => {
  const { schema, setSchema } = useSocket()
  const { params, presets } = schema
  const [selectedPreset, setSelectedPresetState] = useState<
    string | undefined
  >()
  const [presetFadeAmount, setPresetFadeAmount] = useState(0)
  const [initialParamsForFade, setInitialParamsForFade] = useState<
    typeof params | null
  >(null)

  const setSelectedPreset = useCallback((presetName: string | undefined) => {
    setPresetFadeAmount(0)
    setSelectedPresetState(presetName)
  }, [])

  const paramsRef = useRef(params)
  useEffect(() => {
    paramsRef.current = params
  }, [params])

  useEffect(() => {
    const fadeToPreset = (presetName: string, amount: number) => {
      const params = paramsRef.current
      if (!presets[presetName]) return

      // Save initial params when starting a fade (amount goes from 0 to > 0)
      if (amount > 0 && initialParamsForFade === null) {
        setInitialParamsForFade({ ...params })
        return
      }

      // Clear saved params when fade is reset to 0
      if (amount === 0 && initialParamsForFade !== null) {
        setInitialParamsForFade(null)
        return
      }

      // Use saved initial params if available, otherwise current params
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
      setSchema({ ...schema, params: updatedParams })
    }
    if (selectedPreset && presetFadeAmount >= 0) {
      fadeToPreset(selectedPreset, presetFadeAmount)
    }
  }, [
    presetFadeAmount,
    selectedPreset,
    presets,
    initialParamsForFade,
    setSchema,
    schema
  ])

  return {
    selectedPreset,
    setSelectedPreset,
    presetFadeAmount,
    setPresetFadeAmount,
    presets
  }
}

export const AsemicPresetFader = () => {
  const {
    selectedPreset,
    setSelectedPreset,
    presetFadeAmount,
    setPresetFadeAmount,
    presets
  } = usePresetFader()

  return (
    <div className='flex mt-2 select-none p-2 w-full'>
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
            onChange={({ x }) => setPresetFadeAmount(x)}
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
  )
}
