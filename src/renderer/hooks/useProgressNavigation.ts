import { useEffect, useMemo, useRef, useState } from 'react'
import { SceneSettings } from '../components/SceneSettingsPanel'

export const useProgressNavigation = (scenesArray: SceneSettings[]) => {
  const [progress, setProgress] = useState(0)

  // Calculate scene boundaries from scenesArray for navigation
  const sceneStarts = useMemo(() => {
    let cumulative = 0
    return scenesArray.map((scene, idx) => {
      const start = cumulative
      const length = scene.length || 0.1
      const offset = scene.offset || 0
      const end = start + length
      cumulative += length - offset
      return { start, end }
    })
  }, [scenesArray])

  // Calculate active scene based on current progress
  const activeScene = useMemo(() => {
    if (sceneStarts.length === 0) return 0

    // Find which scene we're currently in
    for (let i = sceneStarts.length - 1; i >= 0; i--) {
      if (progress >= sceneStarts[i].start) {
        return i
      }
    }
    return 0
  }, [progress, sceneStarts])

  const activeSceneRef = useRef(activeScene)
  useEffect(() => {
    activeSceneRef.current = activeScene
  }, [activeScene])

  // Calculate total progress of all scenes
  const totalProgress = useMemo(() => {
    return scenesArray.reduce((sum, scene) => {
      const length = scene.length || 0.1
      const offset = scene.offset || 0
      return sum + (length - offset)
    }, 0)
  }, [scenesArray])

  return {
    progress,
    totalProgress,
    setProgress,
    sceneStarts,
    activeScene,
    activeSceneRef
  }
}
