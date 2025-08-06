export const defaultSettings = () => ({
  debug: true as boolean,
  h: 'window' as number | 'window' | 'auto',
  perform: false as boolean,
  scene: 0 as number,
  fullscreen: false
})

export const splitString = (string: string, at: string) => {
  let index = string.indexOf(at)
  if (index === -1) {
    return [string, ''] as [string, string]
  }
  return [string.slice(0, index), string.slice(index + at.length)] as [
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

export const splitStringAt = (string: string, at: number) => {
  return [string.slice(0, at), string.slice(at + 1)] as [string, string]
}
