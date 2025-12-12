import { open } from '@tauri-apps/plugin-dialog'
import { invoke } from '@tauri-apps/api/core'
import { useState, useCallback } from 'react'

export interface JsonFileData {
  content: string
  file_name: string
}

export interface ParsedJsonResult {
  success: boolean
  data?: Record<string, any> | any[]
  error?: string
  file_name: string
  preview?: string
}

export interface JsonLoadState {
  isLoading: boolean
  error?: string
  fileName?: string
  data?: ParsedJsonResult
}

/**
 * Hook for loading and parsing JSON files using Tauri
 * @returns Object with loading state and functions to load/parse JSON
 */
export const useJsonFileLoader = () => {
  const [state, setState] = useState<JsonLoadState>({
    isLoading: false
  })

  const selectAndLoadJsonFile =
    useCallback(async (): Promise<ParsedJsonResult | null> => {
      try {
        setState({ isLoading: true })

        // Open file dialog
        const filePath = await open({
          multiple: false,
          filters: [
            {
              name: 'JSON Files',
              extensions: ['json']
            },
            {
              name: 'All Files',
              extensions: ['*']
            }
          ]
        })

        if (!filePath) {
          setState({ isLoading: false })
          return null
        }

        // Load the file using Tauri command
        const fileData = await invoke<JsonFileData>('load_json_file', {
          filePath
        })

        // Parse the JSON
        const parsed = await invoke<ParsedJsonResult>('parse_json_file', {
          jsonContent: fileData.content,
          fileName: fileData.file_name
        })

        setState({
          isLoading: false,
          fileName: fileData.file_name,
          data: parsed
        })

        return parsed
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err)
        setState({
          isLoading: false,
          error: errorMessage
        })
        return null
      }
    }, [])

  const clearError = useCallback(() => {
    setState(prev => ({
      ...prev,
      error: undefined
    }))
  }, [])

  const reset = useCallback(() => {
    setState({
      isLoading: false
    })
  }, [])

  const saveJsonFile = useCallback(
    async (filePath: string, jsonContent: string): Promise<boolean> => {
      try {
        setState(prev => ({ ...prev, isLoading: true }))

        await invoke<string>('save_json_file', {
          filePath,
          jsonContent
        })

        setState(prev => ({
          ...prev,
          isLoading: false,
          error: undefined
        }))
        return true
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err)
        setState(prev => ({
          ...prev,
          isLoading: false,
          error: errorMessage
        }))
        return false
      }
    },
    []
  )

  return {
    ...state,
    selectAndLoadJsonFile,
    clearError,
    reset,
    saveJsonFile,
    setFileName: (fileName: string) => {
      setState(prev => ({
        ...prev,
        fileName
      }))
    }
  }
}
