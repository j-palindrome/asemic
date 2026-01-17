import { useRef, useEffect } from 'react'

export interface ScrollerProps {
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  label?: string
  format?: (value: number) => string
  sensitivity?: number
}

export default function Scroller({
  value,
  onChange,
  min = 0,
  max = 1,
  label = '',
  format = (v: number) => v.toFixed(2),
  sensitivity = 0.001
}: ScrollerProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleScroll = (e: WheelEvent) => {
      e.preventDefault()
      const delta = e.deltaY * -sensitivity // Negative to make scroll up = increase value
      const newValue = Math.max(min, Math.min(max, value + delta))
      onChange(newValue)
    }

    const container = scrollContainerRef.current
    if (container) {
      container.addEventListener('wheel', handleScroll, { passive: false })
      return () => container.removeEventListener('wheel', handleScroll)
    }
  }, [value, min, max, onChange, sensitivity])

  const displayLabel = label || format(value)

  return (
    <div
      ref={scrollContainerRef}
      className='flex items-center justify-center px-2 py-1 w-16 h-8 bg-white/5 hover:bg-white/10 border border-white/10 rounded cursor-ns-resize transition-colors'
      title={`Scroll to adjust${label ? ': ' + label : ''}\n${displayLabel}`}>
      <span className='text-white text-xs opacity-70 font-mono pointer-events-none select-none'>
        {displayLabel}
      </span>
    </div>
  )
}
