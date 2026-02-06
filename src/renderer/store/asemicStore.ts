import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import { SceneSettings } from '../components/SceneSettingsPanel'
import { ScrubSettings } from '../app/AsemicApp'

interface AsemicStore {
  scenesArray: SceneSettings[]
  scrubValues: ScrubSettings[]
  focusedScene: number
  setScenesArray: (scenes: SceneSettings[]) => void
  setScrubValues: (
    scrubs: ScrubSettings[] | ((prev: ScrubSettings[]) => ScrubSettings[])
  ) => void
  setActiveScene: (scene: number) => void
  setFocusedScene: (scene: number) => void
}

export const useAsemicStore = create<AsemicStore>()(
  devtools(
    set => ({
      scenesArray: [
        {
          code: '',
          length: 0.1,
          offset: 0,
          params: {}
        }
      ],
      scrubValues: [{ params: {}, sent: {}, scrub: 0 }],
      focusedScene: 0,
      activeScenes: [],
      setScenesArray: scenes => {
        set(state => {
          // Adjust scrubValues array to match scenesArray length
          let newScrubValues = [...state.scrubValues]
          if (scenes.length !== state.scrubValues.length) {
            newScrubValues = new Array(scenes.length).fill(null).map(() => ({
              params: {},
              sent: {},
              scrub: 0
            }))
            // Copy over what we can from existing scrubValues
            for (
              let i = 0;
              i < Math.min(state.scrubValues.length, scenes.length);
              i++
            ) {
              newScrubValues[i] = state.scrubValues[i]
            }
          }

          // Save to localStorage
          localStorage.setItem('scenesArray', JSON.stringify(scenes))

          return {
            scenesArray: scenes,
            scrubValues: newScrubValues
          }
        })
      },
      setScrubValues: scrubs => {
        set(state => ({
          scrubValues:
            typeof scrubs === 'function' ? scrubs(state.scrubValues) : scrubs
        }))
      },
      setActiveScene: scene => set({ focusedScene: scene }),
      setFocusedScene: scene => set({ focusedScene: scene })
    }),
    { name: 'AsemicStore' }
  )
)
