import { useCallback, useEffect, useState } from 'react'
import { InputSchema } from '../server/inputSchema'

export const usePresetFader = ({
  schema,
  setSchema
}: {
  schema: InputSchema
  setSchema: (schema: InputSchema) => void
}) => {
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

  useEffect(() => {
    const fadeToPreset = (presetName: string, amount: number) => {
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
    params,
    presets,
    initialParamsForFade,
    setSchema,
    schema
  ])

  return {
    selectedPreset,
    setSelectedPreset,
    presetFadeAmount,
    setPresetFadeAmount
  }
}
