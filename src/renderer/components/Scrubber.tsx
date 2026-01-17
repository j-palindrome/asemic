import { useRef, useEffect } from 'react'
import { ScrubSettings } from '../app/AsemicApp'
import { SceneSettings } from '@/lib/types'

export interface ScrubberProps {
  scrubValue: number
  onScrubChange: (value: number) => void
  sceneSettings: SceneSettings | undefined
}

export default function Scrubber({
  scrubValue,
  onScrubChange,
  sceneSettings
}: ScrubberProps) {
  const maxScrub = (sceneSettings?.length || 0.1) - (sceneSettings?.offset || 0)
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleScroll = (e: WheelEvent) => {
      e.preventDefault()
      const delta = e.deltaY * -0.001 // Negative to make scroll up = increase scrub
      const newScrub = Math.max(0, Math.min(maxScrub, scrubValue + delta))
      onScrubChange(newScrub)
    }

    const container = scrollContainerRef.current
    if (container) {
      container.addEventListener('wheel', handleScroll, { passive: false })
      return () => container.removeEventListener('wheel', handleScroll)
    }
  }, [scrubValue, maxScrub, onScrubChange])

  return (
    <div
      ref={scrollContainerRef}
      className='flex items-center justify-center px-2 py-1 w-16 h-8 bg-white/5 hover:bg-white/10 border border-white/10 rounded cursor-ns-resize transition-colors'
      title={`Scroll to scrub\n${(scrubValue || 0).toFixed(2)}s`}>
      <span className='text-white text-xs opacity-70 font-mono pointer-events-none select-none'>
        {(scrubValue || 0).toFixed(2)}s
      </span>
    </div>
  )
}
