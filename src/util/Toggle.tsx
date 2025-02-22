import { ReactNode, useState } from 'react'

export default function Toggle({
  label,
  cb,
  className
}: {
  label: (state: boolean) => ReactNode
  cb: (state: boolean) => void
  className?: string
}) {
  const [state, setState] = useState(false)
  return (
    <button
      className={`rounded-lg p-2 transition-colors duration-500 ${
        state ? 'bg-yellow-500 text-black' : 'bg-black text-white'
      } ${className ?? ''}`}
      onClick={() => {
        setState(!state)
        cb(!state)
      }}>
      {label(state)}
    </button>
  )
}
