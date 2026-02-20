import { useAsemicStore } from '../store/asemicStore'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useRef } from 'react'
import Scroller from './Scrubber'

export default function ScenePicker() {
  const scenesArray = useAsemicStore(state => state.scenesArray)
  const focusedScene = useAsemicStore(state => state.focusedScene)
  const setFocusedScene = useAsemicStore(state => state.setFocusedScene)
  const scrubValues = useAsemicStore(state => state.scrubValues)
  const setScrubValues = useAsemicStore(state => state.setScrubValues)

  const scrollContainerRef = useRef<HTMLDivElement>(null)

  return (
    <div className='flex items-center gap-2 px-2 w-full overflow-x-auto'>
      <div
        ref={scrollContainerRef}
        className='flex gap-1 overflow-x-auto scrollbar-hide'>
        {scenesArray.map((scene, index) => (
          <div
            key={index}
            className={`${index === focusedScene ? 'bg-blue-500 text-white' : ''} px-4 py-2 rounded cursor-pointer border border-white/10  transition-colors text-sm font-mono`}
            onClick={() => setFocusedScene(index)}>
            {index}
            {/* <Scroller
              key={index}
              value={scrubValues[index]?.scrub ?? 0}
              onChange={newValue => {
                setScrubValues(prev => {
                  const newScrubs = [...prev]
                  newScrubs[index] = {
                    ...newScrubs[index],
                    scrub: newValue
                  }
                  return newScrubs
                })
              }}
            /> */}
          </div>
        ))}
      </div>
    </div>
  )
}
