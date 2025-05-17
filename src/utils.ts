export const defaultPreProcess = () =>
  ({ replacements: {}, width: 1, height: 1 } as {
    replacements: Record<string, string>
    width: number
    height: number
  })

export const splitArgs = (argsStr: string) => {
  const split = argsStr.split(' ').filter(Boolean)

  let args: string[] = []
  let currentArg = ''
  let inString: string | null = null

  for (let i = 0; i < split.length; i++) {
    const token = split[i]

    if (inString) {
      currentArg += ' ' + token
      if (token.endsWith(inString)) {
        args.push(currentArg.substring(1, currentArg.length - 1))
        currentArg = ''
        inString = null
      }
    } else {
      if (token.startsWith('"')) {
        inString = token[0]
        currentArg = token
        if (token.endsWith(inString) && token.length > 1) {
          args.push(currentArg.substring(1, currentArg.length - 1))
          currentArg = ''
          inString = null
        }
      } else {
        args.push(token)
      }
    }
  }

  return args
}

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
