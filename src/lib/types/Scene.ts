export interface Scene {
  code: string
  length?: number
  offset?: number
  pause?: number | false
  params?: Record<string, number[]>
  // Runtime-only properties (not persisted):
  scrub: number
  [key: string]: any
  width: number
  height: number
}
