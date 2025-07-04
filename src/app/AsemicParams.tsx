import { useSocket } from '../server/schema'
import Slider from '../components/Slider'

export default function AsemicParams() {
  const { socket, params, setParams } = useSocket()

  return (
    <div className='flex w-full h-full'>
      {params &&
        Object.entries(params).map(([key, type]) => {
          const min = type.min
          const max = type.max
          const step = (type.max - type.min) / 100

          return (
            <div key={key} className='flex flex-col items-center h-full w-10'>
              <label>{key}</label>
              <Slider
                className='h-full w-full border border-gray-300 rounded-lg'
                values={{ x: 0, y: (type.value - min) / (max - min) }}
                innerClassName='bottom-0 left-0 w-full bg-white rounded-lg'
                sliderStyle={({ x, y }) => ({
                  height: `${y * 100}%`
                })}
                onChange={({ x, y }, end) => {
                  const newValue = min + y * (max - min)
                  setParams({ ...params, [key]: { ...type, value: newValue } })
                }}
              />
            </div>
          )
        })}
    </div>
  )
}
