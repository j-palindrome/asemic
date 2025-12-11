import { Upload, X, Download } from 'lucide-react'
import { useJsonFileLoader, ParsedJsonResult } from '../hooks/useJsonFileLoader'
import { useState } from 'react'

interface JsonLoaderProps {
  onFileLoaded?: (data: ParsedJsonResult) => void
  className?: string
}

export function JsonFileLoader({
  onFileLoaded,
  className = ''
}: JsonLoaderProps) {
  const {
    isLoading,
    error,
    fileName,
    data,
    selectAndLoadJsonFile,
    clearError,
    reset,
    saveJsonFile
  } = useJsonFileLoader()

  const [lastSavedPath, setLastSavedPath] = useState<string | null>(null)
  const [saveSuccess, setSaveSuccess] = useState(false)

  const handleSave = async () => {
    if (!data?.data || !lastSavedPath) return

    const jsonContent = JSON.stringify(data.data, null, 2)
    const success = await saveJsonFile(lastSavedPath, jsonContent)

    if (success) {
      setSaveSuccess(true)
      setTimeout(() => setSaveSuccess(false), 2000)
    }
  }

  const handleLoad = async () => {
    const result = await selectAndLoadJsonFile()
    if (result?.success && onFileLoaded) {
      onFileLoaded(result)
      // Store the file path for saving later
      setLastSavedPath((result as any).filePath || null)
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
          disabled={isLoading || !data?.success}
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

      {data?.success && (
        <div className='flex flex-col gap-2 p-2 bg-green-900/20 border border-green-700 rounded'>
          <div className='flex items-center justify-between'>
            <span className='text-green-200 text-xs font-semibold'>
              ✓ {data.file_name}
            </span>
            <button
              onClick={reset}
              className='p-1 hover:bg-green-900/50 rounded'>
              <X size={14} />
            </button>
          </div>
          {data.preview && (
            <div className='text-green-300 text-xs opacity-70'>
              {data.preview}
            </div>
          )}
        </div>
      )}

      {saveSuccess && (
        <div className='flex items-start gap-2 p-2 bg-blue-900/30 border border-blue-700 rounded text-blue-200 text-xs'>
          <span className='flex-1'>✓ File saved successfully</span>
        </div>
      )}
    </div>
  )
}
