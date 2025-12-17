import { X, Download, Upload } from 'lucide-react'
import { save } from '@tauri-apps/plugin-dialog'
import { writeTextFile } from '@tauri-apps/plugin-fs'
import { useState } from 'react'
import { GlobalSettings, SceneSettings } from './SceneSettingsPanel'

interface JsonLoaderProps {
  sceneList: SceneSettings[]
  setSceneList: (newList: SceneSettings[]) => void
  globalSettings: GlobalSettings
  setGlobalSettings: (newSettings: GlobalSettings) => void
}

export function JsonFileLoader({
  sceneList,
  setSceneList,
  globalSettings,
  setGlobalSettings
}: JsonLoaderProps) {
  const [error, setError] = useState<string | null>(null)

  const handleSave = async () => {
    try {
      setError(null)

      const path = await save({
        filters: [
          {
            name: 'JSON',
            extensions: ['json']
          }
        ]
      })

      if (path) {
        await writeTextFile(
          path,
          JSON.stringify(
            {
              settings: globalSettings,
              scenes: sceneList
            },
            null,
            2
          )
        )
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save file')
    }
  }

  const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    try {
      setError(null)
      const file = event.target.files?.[0]

      if (!file) return

      const text = await file.text()
      const parsed = JSON.parse(text)

      let scenesData: SceneSettings[] = parsed.scenes || []
      const settingsData: GlobalSettings = parsed.settings || {}

      setSceneList(scenesData)
      setGlobalSettings(settingsData)

      // Reset file input
      event.target.value = ''
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to parse JSON file')
      event.target.value = ''
    }
  }

  const clearError = () => setError(null)

  return (
    <div className='flex flex-col gap-3'>
      <div className='flex gap-2'>
        <label
          title='Load JSON file'
          className='flex items-center gap-2 px-3 py-2 bg-white/10 hover:bg-white/20 disabled:opacity-50 disabled:cursor-not-allowed rounded transition-colors cursor-pointer'>
          <Upload size={16} />
          <input
            type='file'
            accept='.json,.txt'
            onChange={handleUpload}
            className='hidden'
          />
        </label>
        <button
          onClick={handleSave}
          className='flex items-center gap-2 px-3 py-2 bg-white/10 hover:bg-white/20 disabled:opacity-50 disabled:cursor-not-allowed rounded transition-colors'
          title='Save JSON file'>
          <Download size={16} />
        </button>
      </div>

      {error && (
        <div className='flex items-start gap-2 p-2 bg-red-900/30 border border-red-700 rounded text-red-200 text-xs'>
          <span className='flex-1'>{error}</span>
          <button
            onClick={clearError}
            className='p-1 hover:bg-red-900/50 rounded'>
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  )
}
