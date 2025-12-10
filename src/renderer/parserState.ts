import { invoke } from '@tauri-apps/api/core'

export interface SceneMetadata {
  start: number
  length: number
  offset: number
  params?: Record<string, number>
}

/**
 * Evaluate an Asemic expression with full scene context
 * All state is passed directly, no global state in Rust
 */
export async function evalExpression(
  expr: string,
  options: {
    oscAddress?: string
    oscHost?: string
    oscPort?: number
    width: number
    height: number
    currentScene: number
    sceneMetadata: SceneMetadata[]
  }
): Promise<number> {
  return await invoke<number>('parser_eval_expression', {
    expr,
    oscAddress: options.oscAddress || '',
    oscHost: options.oscHost || '127.0.0.1',
    oscPort: options.oscPort || 57120,
    width: options.width,
    height: options.height,
    currentScene: options.currentScene,
    sceneMetadata: options.sceneMetadata
  })
}
