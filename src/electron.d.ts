export interface IElectronAPI {
  readFile: (
    filePath: string
  ) => Promise<{ success: boolean; content?: string; error?: string }>
  writeFile: (
    filePath: string,
    content: string
  ) => Promise<{ success: boolean; error?: string }>
  showOpenDialog: () => Promise<{ canceled: boolean; filePaths: string[] }>
  showSaveDialog: () => Promise<{ canceled: boolean; filePath?: string }>
}

declare global {
  interface Window {
    electronAPI: IElectronAPI
    ipcRenderer: {
      on: (
        channel: string,
        listener: (event: any, ...args: any[]) => void
      ) => void
      off: (channel: string, listener?: (...args: any[]) => void) => void
      send: (channel: string, ...args: any[]) => void
      invoke: (channel: string, ...args: any[]) => Promise<any>
    }
  }
}
