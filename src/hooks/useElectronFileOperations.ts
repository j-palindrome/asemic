import { useCallback } from 'react'

export function useElectronFileOperations() {
  const isElectron = typeof window !== 'undefined' && window.electronAPI

  const saveFile = useCallback(
    async (content: string, defaultFileName?: string) => {
      if (isElectron) {
        try {
          const result = await window.electronAPI.showSaveDialog()
          if (!result.canceled && result.filePath) {
            const saveResult = await window.electronAPI.writeFile(
              result.filePath,
              content
            )
            if (saveResult.success) {
              return { success: true, filePath: result.filePath }
            } else {
              throw new Error(saveResult.error)
            }
          }
          return { success: false, canceled: true }
        } catch (error) {
          console.error('Failed to save file:', error)
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
          }
        }
      } else {
        // Fallback to browser download
        const blob = new Blob([content], { type: 'text/plain' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download =
          defaultFileName ||
          `asemic-${new Date()
            .toISOString()
            .slice(0, 19)
            .replace(/:/g, '-')}.asemic`
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
        return { success: true }
      }
    },
    [isElectron]
  )

  const openFile = useCallback(async () => {
    if (isElectron) {
      try {
        const result = await window.electronAPI.showOpenDialog()
        if (!result.canceled && result.filePaths.length > 0) {
          const filePath = result.filePaths[0]
          const readResult = await window.electronAPI.readFile(filePath)
          if (readResult.success && readResult.content) {
            return { success: true, content: readResult.content, filePath }
          } else {
            throw new Error(readResult.error)
          }
        }
        return { success: false, canceled: true }
      } catch (error) {
        console.error('Failed to open file:', error)
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        }
      }
    } else {
      // Fallback to browser file input
      return new Promise<{
        success: boolean
        content?: string
        canceled?: boolean
        error?: string
      }>(resolve => {
        const input = document.createElement('input')
        input.type = 'file'
        input.accept = '.asemic,.js,.ts'
        input.onchange = e => {
          const file = (e.target as HTMLInputElement).files?.[0]
          if (!file) {
            resolve({ success: false, canceled: true })
            return
          }

          const reader = new FileReader()
          reader.onload = e => {
            const content = e.target?.result as string
            if (content) {
              resolve({ success: true, content })
            } else {
              resolve({ success: false, error: 'Failed to read file' })
            }
          }
          reader.onerror = () => {
            resolve({ success: false, error: 'Failed to read file' })
          }
          reader.readAsText(file)
        }
        input.click()
      })
    }
  }, [isElectron])

  return {
    saveFile,
    openFile,
    isElectron
  }
}
