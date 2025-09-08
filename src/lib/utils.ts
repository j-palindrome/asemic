export const defaultPreProcess = () =>
  ({ replacements: {}, width: 1, height: 1, directory: '' } as {
    replacements: Record<string, string>
    width: number
    height: number
    directory: string
  })

export const lerp = (a: number, b: number, t: number) => {
  const max = Math.max(a, b)
  const min = Math.min(a, b)
  return min + (max - min) * (a <= b ? t : 1 - t)
}

export const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value))

export const mapRange = (
  value: number,
  inMin: number,
  inMax: number,
  outMin: number,
  outMax: number
) => {
  const t = (value - inMin) / (inMax - inMin)
  return outMin + t * (outMax - outMin)
}
export const mapRangeClamp = (
  value: number,
  inMin: number,
  inMax: number,
  outMin: number,
  outMax: number
) => {
  const t = (value - inMin) / (inMax - inMin)
  return clamp(outMin + t * (outMax - outMin), outMin, outMax)
}

export const stripComments = (str: string) => {
  return str.replace(/\/\/(?:.|\n)*?\/\//g, '')
}
