import { InputSchema } from '@/renderer/inputSchema'

export const defaultOutput = () => ({
  curves: [],
  errors: [] as string[],
  pauseAt: false as string | false,
  eval: [] as string[],
  presets: undefined as InputSchema['presets'] | undefined,
  resetPresets: undefined as boolean | undefined,
  files: undefined as string[] | undefined,
  ready: undefined as boolean | undefined,
  frameReady: undefined as boolean | undefined,
  totalLength: undefined as number | undefined,
  scenes: undefined as number[] | undefined,
  progress: undefined as number | undefined
})
