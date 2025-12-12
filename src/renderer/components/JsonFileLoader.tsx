import { Upload, X, Download } from 'lucide-react'
import { save } from '@tauri-apps/plugin-dialog'
import { useJsonFileLoader, ParsedJsonResult } from '../hooks/useJsonFileLoader'
import { useState } from 'react'
import { SceneSettings } from './SceneParamsEditor'

interface JsonLoaderProps {
  onFileLoaded?: (data: ParsedJsonResult) => void
  className?: string
  sceneList: SceneSettings[]
}

export function JsonFileLoader({
  onFileLoaded,
  className = '',
  sceneList
}: JsonLoaderProps) {
  const {
    isLoading,
    error,
    fileName,
    selectAndLoadJsonFile,
    clearError,
    reset,
    saveJsonFile,
    setFileName
  } = useJsonFileLoader()

  const handleSave = async () => {
    if (!fileName) {
      let defaultFileName = fileName?.endsWith('.json') ? fileName : ''
      if (!defaultFileName) {
        defaultFileName = (await save({
          defaultPath: defaultFileName,
          filters: [{ name: 'JSON', extensions: ['json'] }],
          title: 'Save JSON file'
        })) as string
      }

      if (!defaultFileName) {
        return
      }

      setFileName(defaultFileName)
    }

    const success = await saveJsonFile(fileName!, JSON.stringify(sceneList))
  }

  const handleLoad = async () => {
    const result = await selectAndLoadJsonFile()
    if (result?.success && onFileLoaded) {
      onFileLoaded(result)
      // Store the file path for saving later
    }
  }

  return (
    <div className={`flex flex-col gap-3 ${className}`}>
      <div className='flex gap-2'>
        <button
          onClick={handleLoad}
          disabled={isLoading}
          className='flex items-center gap-2 px-3 py-2 bg-white/10 hover:bg-white/20 disabled:opacity-50 disabled:cursor-not-allowed rounded transition-colors'
          title='Load JSON file'>
          <Upload size={16} />
        </button>
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
