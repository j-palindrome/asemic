export const defaultSettings = () => ({
  debug: true as boolean,
  h: 'window' as number | 'window' | 'auto',
  perform: false as boolean,
  scene: 0 as number,
  fullscreen: false,
  folder: '' as string
})

export const splitString = (string: string, at: string | RegExp) => {
  const atExp = string.match(new RegExp(at))
  if (!atExp) {
    return [string, ''] as [string, string]
  }
  let index = atExp.index!
  return [string.slice(0, index), string.slice(index + atExp.length)] as [
    string,
    string
  ]
}

export const splitStringLast = (string: string, at: string) => {
  let index = string.lastIndexOf(at)
  if (index === -1) {
    return [string, ''] as [string, string]
  }
  return [string.slice(0, index), string.slice(index + at.length)] as [
    string,
    string
  ]
}

export const splitStringAt = (string: string, at: number, length: number) => {
  return [string.slice(0, at).trim(), string.slice(at + length).trim()] as [
    string,
    string
  ]
}
