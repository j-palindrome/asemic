import { useSchema } from '../server/schema'
import './AsemicApp.css'
export default function AsemicParams() {
  const [schema, setParam] = useSchema()

  return (
    <div className='flex w-full h-full'>
      {schema &&
        Object.entries(schema.params).map(([key, type]) => {
          const min = type.min
          const max = type.max
          const step = (type.max - type.min) / 100

          return (
            <div key={key} className='flex flex-col items-center'>
              <label>{key}</label>
              <input
                type='range'
                min={min}
                max={max}
                step={step}
                onChange={e => {
                  setParam(key, parseFloat(e.target.value))
                }}
              />
            </div>
          )
        })}
    </div>
  )
}
