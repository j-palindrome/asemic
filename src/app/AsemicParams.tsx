import { useSocket } from '../server/schema'
import Slider from '../components/Slider'

export default function AsemicParams() {
  const { socket, params, setParams } = useSocket()

  return (
    <>
      <div className='h-[200px]'></div>
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
