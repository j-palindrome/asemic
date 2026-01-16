import { useEffect, useRef, useCallback, useState } from 'react'

export interface XYPadProps {
  className?: string
  innerClassName?: string
  values: [number, number][]
  onChange: (values: [number, number][], end?: boolean) => void
  min: number
  max: number
  exponent?: number
  color?: string
}

/**
 * XYPad is a multitouch-capable variation of Slider that handles
 * an array of [x, y] coordinates.
 */
export default function XYPad({
  className,
  innerClassName,
  values,
  onChange,
  min,
  max,
  exponent = 1,
  color = '#F0F'
}: XYPadProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const touchMap = useRef<Map<number, number>>(new Map())
  const [, forceUpdate] = useState({}) // Used to trigger re-render for touch indicators

  const getRelativePosition = (clientX: number, clientY: number) => {
    if (!containerRef.current) return { x: 0.5, y: 0.5 }
    const rect = containerRef.current.getBoundingClientRect()
    let x = (clientX - rect.left) / rect.width
    let y = 1 - (clientY - rect.top) / rect.height
    x = Math.max(0, Math.min(1, x))
    y = Math.max(0, Math.min(1, y))
    return { x, y }
  }

  const handleStart = (ev: React.TouchEvent | React.MouseEvent) => {
    const newValues = values.map(v => [...v] as [number, number])
    let changed = false

    if ('changedTouches' in ev) {
      const touchEv = ev as React.TouchEvent
      const changedTouches = Array.from(touchEv.changedTouches)

      changedTouches.forEach(touch => {
        const pos = getRelativePosition(touch.clientX, touch.clientY)
        const denormalized = [
          exponent
            ? pos.x ** exponent * (max - min) + min
            : pos.x * (max - min) + min,
          exponent
            ? pos.y ** exponent * (max - min) + min
            : pos.y * (max - min) + min
        ] as [number, number]

        // Find closest point to this touch to "claim" it
        let closestIdx = -1
        let minDistance = Infinity

        values.forEach((v, idx) => {
          // Check if this point is already being dragged by another touch
          const isBeingDragged = Array.from(touchMap.current.values()).includes(
            idx
          )
          if (isBeingDragged) return

          const dist = Math.sqrt(
            (v[0] - denormalized[0]) ** 2 + (v[1] - denormalized[1]) ** 2
          )
          if (dist < minDistance) {
            minDistance = dist
            closestIdx = idx
          }
        })

        if (closestIdx !== -1) {
          touchMap.current.set(touch.identifier, closestIdx)
          newValues[closestIdx] = denormalized
          changed = true
        }
      })
    } else {
      // Mouse support
      const mouseEv = ev as React.MouseEvent
      const pos = getRelativePosition(mouseEv.clientX, mouseEv.clientY)
      const denormalized = [
        exponent
          ? pos.x ** exponent * (max - min) + min
          : pos.x * (max - min) + min,
        exponent
          ? pos.y ** exponent * (max - min) + min
          : pos.y * (max - min) + min
      ] as [number, number]

      let closestIdx = -1
      let minDistance = Infinity
      values.forEach((v, idx) => {
        const dist = Math.sqrt(
          (v[0] - denormalized[0]) ** 2 + (v[1] - denormalized[1]) ** 2
        )
        if (dist < minDistance) {
          minDistance = dist
          closestIdx = idx
        }
      })

      if (closestIdx !== -1) {
        touchMap.current.set(-1, closestIdx)
        newValues[closestIdx] = denormalized
        changed = true
      }
    }

    if (changed) {
      onChange(newValues)
      forceUpdate({})
    }
  }

  const handleMove = useCallback(
    (ev: TouchEvent | MouseEvent) => {
      const newValues = values.map(v => [...v] as [number, number])
      let changed = false

      if (ev instanceof TouchEvent) {
        Array.from(ev.touches).forEach(touch => {
          const idx = touchMap.current.get(touch.identifier)
          if (idx !== undefined) {
            const pos = getRelativePosition(touch.clientX, touch.clientY)
            newValues[idx] = [
              exponent
                ? pos.x ** exponent * (max - min) + min
                : pos.x * (max - min) + min,
              exponent
                ? pos.y ** exponent * (max - min) + min
                : pos.y * (max - min) + min
            ] as [number, number]
            changed = true
          }
        })
      } else {
        const idx = touchMap.current.get(-1)
        if (idx !== undefined) {
          const pos = getRelativePosition(ev.clientX, ev.clientY)
          newValues[idx] = [
            exponent
              ? pos.x ** exponent * (max - min) + min
              : pos.x * (max - min) + min,
            exponent
              ? pos.y ** exponent * (max - min) + min
              : pos.y * (max - min) + min
          ] as [number, number]
          changed = true
        }
      }

      if (changed) {
        onChange(newValues)
      }
    },
    [values, min, max, exponent, onChange]
  )

  const handleEnd = useCallback(
    (ev: TouchEvent | MouseEvent) => {
      if (ev instanceof TouchEvent) {
        Array.from(ev.changedTouches).forEach(touch => {
          touchMap.current.delete(touch.identifier)
        })
      } else {
        touchMap.current.delete(-1)
      }
      onChange(values, true)
      forceUpdate({})
    },
    [values, onChange]
  )

  useEffect(() => {
    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleEnd)
    window.addEventListener('touchmove', handleMove, { passive: false })
    window.addEventListener('touchend', handleEnd)
    window.addEventListener('touchcancel', handleEnd)
    return () => {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleEnd)
      window.removeEventListener('touchmove', handleMove)
      window.removeEventListener('touchend', handleEnd)
      window.removeEventListener('touchcancel', handleEnd)
    }
  }, [handleMove, handleEnd])

  const activeIndices = Array.from(touchMap.current.values())

  return (
    <div
      ref={containerRef}
      className={`relative bg-black/40 rounded-lg overflow-hidden select-none touch-none aspect-square border border-white/10 ${className}`}
      onMouseDown={handleStart}
      onTouchStart={handleStart}>
      {/* Grid lines */}
      <div className='absolute inset-0 grid grid-cols-4 grid-rows-4 pointer-events-none opacity-20'>
        {[...Array(16)].map((_, i) => (
          <div key={i} className='border-[0.5px] border-white/20' />
        ))}
      </div>

      {values.map((v, i) => {
        const nx = exponent
          ? Math.max(
              0,
              Math.min(1, ((v[0] - min) / (max - min)) ** (1 / exponent))
            )
          : Math.max(0, Math.min(1, (v[0] - min) / (max - min)))
        const ny = exponent
          ? Math.max(
              0,
              Math.min(1, ((v[1] - min) / (max - min)) ** (1 / exponent))
            )
          : Math.max(0, Math.min(1, (v[1] - min) / (max - min)))

        const isActive = activeIndices.includes(i)

        return (
          <div
            key={i}
            className={`absolute w-8 h-8 -ml-4 -mb-4 rounded-full border border-white shadow-xl pointer-events-none flex items-center justify-center transition-transform ${innerClassName}`}
            style={{
              left: `${nx * 100}%`,
              bottom: `${ny * 100}%`,
              backgroundColor: color,
              transform: isActive ? 'scale(1.3)' : 'scale(1)',
              zIndex: isActive ? 10 : 1,
              opacity: isActive ? 1 : 0.8
            }}>
            <span className='text-[12px] text-white font-mono font-bold drop-shadow-md'>
              {i}
            </span>
          </div>
        )
      })}
    </div>
  )
}
