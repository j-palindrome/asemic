import { InputSchema } from '../../server/inputSchema'

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
  resetParams: false,
  resetPresets: false,
  files: [] as string[]
})
