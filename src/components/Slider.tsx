import { TouchList, useEffect, useRef } from 'react'
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
  exponential = false
}: React.PropsWithChildren & {
  className?: string
  innerClassName?: string
  sliderStyle: ({ x, y }: { x: number; y: number }) => React.CSSProperties
  onChange: ({ x, y }: { x: number; y: number }, end?: boolean) => void
  values: { x: number; y: number }
  exponential?: boolean
}) {
  const slider = useRef<HTMLDivElement>(null!)
  const place = useRef<{ x: number; y: number }>(values)

  useEffect(() => {
    if (!slider.current) return
    place.current = exponential
      ? { x: values.x ** 0.5, y: values.y ** 0.5 }
      : { x: values.x, y: values.y }
    Object.assign(slider.current.style, sliderStyle(place.current))
  }, [values])

  const divRef = useRef<HTMLDivElement>(null)
  let moved = useRef<false | number>(false)
  const updateMouse = (ev: React.MouseEvent | React.TouchEvent) => {
    const rect = divRef.current!.getBoundingClientRect()
    let x: number, y: number

    if (ev.type === 'touchmove') {
      const touch = Array.from(ev.touches).find(
        x =>
          x.clientX > rect.left &&
          x.clientX < rect.right &&
          x.clientY < rect.bottom &&
          x.clientY > rect.top
      )
      if (!touch) return
      x = (touch.clientX - rect.x) / rect.width
      y = 1 - (touch.clientY - rect.y) / rect.height
    } else if (ev.type === 'mousemove') {
      if (!ev.buttons) return
      x = (ev.clientX - rect.x) / rect.width
      y = 1 - (ev.clientY - rect.y) / rect.height
    } else throw new Error()

    place.current = { x, y }
    if (exponential) {
      onChange({ x: x ** 2, y: y ** 2 })
    } else {
      onChange({ x: x, y: y })
    }

    Object.assign(slider.current.style, sliderStyle({ x, y }))
  }

  return (
    <div
      ref={divRef}
      className={`${className} relative flex overflow-hidden`}
      onTouchMove={updateMouse}
      onMouseMove={updateMouse}
      onMouseUp={ev => {
        if (moved.current) {
          return
        }
        const rect = ev.currentTarget.getBoundingClientRect()
        const x =
          ((ev instanceof TouchEvent ? ev.touches[0].clientX : ev.clientX) -
            rect.x) /
          rect.width
        const y =
          1 -
          ((ev instanceof TouchEvent ? ev.touches[0].clientY : ev.clientY) -
            rect.y) /
            rect.height

        const lastY = place.current.y
        place.current = { x, y }

        if (divRef.current!.getBoundingClientRect().bottom < ev.clientY + 30) {
          place.current = { x, y: 0 }
        }

        if (exponential) {
          onChange({ x: place.current.x ** 2, y: place.current.y ** 2 }, true)
        } else {
          onChange({ x: place.current.x, y: place.current.y }, true)
        }
      }}>
      <div className={`${innerClassName} absolute`} ref={slider}></div>
    </div>
  )
}
