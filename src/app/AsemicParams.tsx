import { useSocket } from '../server/schema'
import Slider from '../components/Slider'
import { useState } from 'react'
import { AsemicPresetFader } from '../hooks/AsemicPresetFader'

export default function AsemicParams() {
  const { socket, schema, setSchema } = useSocket()
  const { params, presets } = schema

  const [copyNotification, setCopyNotification] = useState('')

  const copyPreset = () => {
    if (!params) return
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

  return (
    <>
      <div className='h-[200px]'></div>
      {/* Preset Controls */}
      <div className='h-screen w-screen flex flex-col'>
        {copyNotification && (
          <div className='absolute top-16 left-0 bg-green-600 text-white p-2 rounded text-xs max-w-md z-50'>
            {copyNotification}
          </div>
        )}
        <AsemicPresetFader />
        <div className='flex w-full h-full space-x-2'>
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
                        params: {
                          ...params,
                          [key]: {
                            ...type,
                            value: y
                          }
                        }
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
