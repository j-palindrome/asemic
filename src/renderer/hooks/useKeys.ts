import { AsemicData } from '@/lib'
import { useEffect, useRef, useState } from 'react'

export const useKeys = ({ asemic }) => {
  const [live, setLive] = useState({
    keys: ['', '', '', '', '', '', '', '', '', ''],
    index: { value: 0 }
  } as AsemicData['live'])
  const [isLive, setIsLive] = useState(false)

  useEffect(() => {
    asemic.current?.postMessage({
      live
    })
  }, [live])

  let keysPressed = useRef<Record<string, number>>({})
  useEffect(() => {
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.repeat) {
        return
      }

      if (ev.ctrlKey) {
        if (/[0-9]/.test(ev.key)) {
          const index = Number(ev.key)
          setLive({ ...live, index: { ...live.index, value: index } })
        }
        if (ev.key === ' ') {
          ev.preventDefault()
          ev.stopPropagation()
          return
        }
        // Remove End key handling that used totalLength
      } else if (isLive) {
        if (ev.key === 'Escape') {
          setIsLive(false)
        }
        if (ev.key.length === 1 && !ev.metaKey && !ev.ctrlKey) {
          keysPressed.current[String(ev.key)] = performance.now()
        }
        const newKeys = [...live.keys]
        newKeys[live.index.value] = Object.keys(keysPressed.current)
          .sort(x => keysPressed.current[x])
          .join('')

        setLive({ ...live, keys: newKeys })
      }
      const onKeyUp = (ev: KeyboardEvent) => {
        delete keysPressed.current[ev.key]
        const newKeys = [...live.keys]
        newKeys[live.index.value] = Object.keys(keysPressed.current)
          .sort(x => keysPressed.current[x])
          .join('')
        setLive({ ...live, keys: newKeys })
      }

      window.addEventListener('keydown', onKeyDown)
      window.addEventListener('keyup', onKeyUp)
      return () => {
        window.removeEventListener('keydown', onKeyDown)
        window.removeEventListener('keyup', onKeyUp)
      }
    }
  }, [live, isLive])
  return [live, isLive, setIsLive] as const
}
