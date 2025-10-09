import { InputSchema } from '@/renderer/inputSchema'

export const defaultOutput = () => ({
  osc: [] as { path: string; args: (string | number | [number, number])[] }[],
  sc: [] as { path: string; value: number | number[] }[],
  scSynthDefs: {} as Record<string, string>,
  curves: [],
  errors: [] as string[],
  pauseAt: false as string | false,
  eval: [] as string[],
  params: undefined as InputSchema['params'] | undefined,
  presets: undefined as InputSchema['presets'] | undefined,
  resetParams: undefined as boolean | undefined,
  resetPresets: undefined as boolean | undefined,
  files: undefined as string[] | undefined,
  ready: undefined as boolean | undefined,
  frameReady: undefined as boolean | undefined,
  totalLength: undefined as number | undefined,
  scenes: undefined as number[] | undefined,
  progress: undefined as number | undefined
})
