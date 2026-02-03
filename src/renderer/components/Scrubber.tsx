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
  const touchStateRef = useRef<{ active: boolean; lastY: number }>({
    active: false,
    lastY: 0
  })

  useEffect(() => {
    const handleScroll = (e: WheelEvent) => {
      e.preventDefault()
      const delta = e.deltaY * -sensitivity // Negative to make scroll up = increase value
      const newValue = Math.max(min, Math.min(max, value + delta))
      onChange(newValue)
    }

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 0) return
      touchStateRef.current.active = true
      touchStateRef.current.lastY = e.touches[0].clientY
    }

    const handleTouchMove = (e: TouchEvent) => {
      if (!touchStateRef.current.active || e.touches.length === 0) return
      e.preventDefault()
      const currentY = e.touches[0].clientY
      const delta = (currentY - touchStateRef.current.lastY) * sensitivity
      touchStateRef.current.lastY = currentY
      const newValue = Math.max(min, Math.min(max, value + delta))
      onChange(newValue)
    }

    const handleTouchEnd = () => {
      touchStateRef.current.active = false
    }

    const container = scrollContainerRef.current
    if (container) {
      container.addEventListener('wheel', handleScroll, { passive: false })
      container.addEventListener('touchstart', handleTouchStart, {
        passive: true
      })
      container.addEventListener('touchmove', handleTouchMove, {
        passive: false
      })
      container.addEventListener('touchend', handleTouchEnd)
      container.addEventListener('touchcancel', handleTouchEnd)
      return () => {
        container.removeEventListener('wheel', handleScroll)
        container.removeEventListener('touchstart', handleTouchStart)
        container.removeEventListener('touchmove', handleTouchMove)
        container.removeEventListener('touchend', handleTouchEnd)
        container.removeEventListener('touchcancel', handleTouchEnd)
      }
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
