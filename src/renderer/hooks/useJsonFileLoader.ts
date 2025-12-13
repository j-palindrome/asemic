import { open } from '@tauri-apps/plugin-dialog'
import { invoke } from '@tauri-apps/api/core'
import { readTextFile } from '@tauri-apps/plugin-fs'
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

        const selectedPath = Array.isArray(filePath) ? filePath[0] : filePath
        if (!selectedPath) {
          setState({ isLoading: false })
          return null
        }

        const fileContents = await readTextFile(selectedPath)
        const parsed = JSON.parse(fileContents)
        const fileName = selectedPath.split(/[\\/]/).pop() ?? 'untitled.json'
        const preview = fileContents.slice(0, 200)

        const parsedResult: ParsedJsonResult = {
          success: true,
          data: parsed,
          file_name: fileName,
          preview
        }

        setState({
          isLoading: false,
          fileName,
          data: parsedResult
        })

        return parsedResult
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

  return {
    ...state,
    selectAndLoadJsonFile,
    clearError,
    reset,
    setFileName: (fileName: string) => {
      setState(prev => ({
        ...prev,
        fileName
      }))
    }
  }
}
