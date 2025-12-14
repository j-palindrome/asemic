import { TouchList, useEffect, useRef, useState } from 'react'
import invariant from 'tiny-invariant'

/**
 * onChange returns style which is applied to the slider
 */
export default function Slider({
  className,
  innerClassName,
  onChange,
  values,
  sliderStyle,
  max,
  min,
  exponent = 1
}: React.PropsWithChildren & {
  max: number
  min: number
  className?: string
  innerClassName?: string
  sliderStyle: ({ x, y }: { x: number; y: number }) => React.CSSProperties
  onChange: ({ x, y }: { x: number; y: number }, end?: boolean) => void
  values: { x: number; y: number }
  exponent: number
}) {
  const slider = useRef<HTMLDivElement>(null!)
  const place = useRef<{ x: number; y: number }>(values)
  const [isDragging, setIsDragging] = useState(false)
  const [touchId, setTouchId] = useState<number | null>(null)

  useEffect(() => {
    if (!slider.current) return
    place.current = {
      x: exponent
        ? ((values.x - min) / (max - min)) ** (1 / exponent)
        : (values.x - min) / (max - min),
      y: exponent
        ? ((values.y - min) / (max - min)) ** (1 / exponent)
        : (values.y - min) / (max - min)
    }
    Object.assign(slider.current.style, sliderStyle(place.current))
  }, [values])

  const divRef = useRef<HTMLDivElement>(null)
  const updateMouse = (ev: MouseEvent | TouchEvent) => {
    const rect = divRef.current!.getBoundingClientRect()
    let x: number, y: number

    if (ev.type.includes('touch')) {
      const touchEv = ev as TouchEvent
      const touch = Array.from(touchEv.touches).find(
        t => t.identifier === touchId
      )
      if (!touch) return
      x = (touch.clientX - rect.x) / rect.width
      y = 1 - (touch.clientY - rect.y) / rect.height
    } else if (ev.type.includes('mouse')) {
      const mouseEv = ev as MouseEvent
      x = (mouseEv.clientX - rect.x) / rect.width
      y = 1 - (mouseEv.clientY - rect.y) / rect.height
    } else return

    // Clamp to bounds
    x = Math.max(0, Math.min(1, x))
    y = Math.max(0, Math.min(1, y))

    place.current = { x, y }
    const newX = exponent
      ? place.current.x ** exponent * (max - min) + min
      : place.current.x * (max - min) + min
    const newY = exponent
      ? place.current.y ** exponent * (max - min) + min
      : place.current.y * (max - min) + min
    onChange({
      x: newX,
      y: newY
    })

    Object.assign(slider.current.style, sliderStyle(place.current))
  }

  const handleStart = (ev: React.MouseEvent | React.TouchEvent) => {
    if (ev.type === 'touchstart') {
      const touchEv = ev as React.TouchEvent
      const touch = touchEv.touches[0]
      setTouchId(touch.identifier)
    }
    setIsDragging(true)
    updateMouse(ev.nativeEvent)
  }

  const handleEnd = () => {
    setIsDragging(false)
    setTouchId(null)

    const edgeThreshold = 0.01
    let { x, y } = place.current

    if (x < edgeThreshold) x = 0
    if (y < edgeThreshold) y = 0

    if (x > 1 - edgeThreshold) x = 1
    if (y > 1 - edgeThreshold) y = 1

    place.current = { x, y }

    onChange(
      {
        x: exponent
          ? place.current.x ** exponent * (max - min) + min
          : place.current.x * (max - min) + min,
        y: exponent
          ? place.current.y ** exponent * (max - min) + min
          : place.current.y * (max - min) + min
      },
      true
    )

    Object.assign(slider.current.style, sliderStyle(place.current))
  }

  useEffect(() => {
    if (!isDragging) return

    const handleMouseMove = (ev: MouseEvent) => updateMouse(ev)
    const handleTouchMove = (ev: TouchEvent) => updateMouse(ev)
    const handleMouseUp = () => handleEnd()
    const handleTouchEnd = (ev: TouchEvent) => {
      if (
        touchId !== null &&
        Array.from(ev.changedTouches).some(t => t.identifier === touchId)
      ) {
        handleEnd()
      }
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('touchmove', handleTouchMove)
    window.addEventListener('mouseup', handleMouseUp)
    window.addEventListener('touchend', handleTouchEnd)

    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('touchmove', handleTouchMove)
      window.removeEventListener('mouseup', handleMouseUp)
      window.removeEventListener('touchend', handleTouchEnd)
    }
  }, [isDragging, touchId])

  return (
    <div
      ref={divRef}
      className={`${className} relative flex overflow-hidden`}
      style={{ touchAction: 'none' }}
      onTouchStart={handleStart}
      onMouseDown={handleStart}>
      <div className={`${innerClassName} absolute`} ref={slider}></div>
    </div>
  )
}
