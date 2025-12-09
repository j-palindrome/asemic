import { invoke } from '@tauri-apps/api/core'

export interface SceneMetadata {
  start: number
  length: number
  offset: number
}

export interface ParserState {
  time: number
  scrub: number
  width: number
  height: number
  scene: number
  total_length: number
  scenes: SceneMetadata[]
}

/**
 * Get the current parser state from Rust backend
 */
export async function getParserState(): Promise<ParserState> {
  return await invoke<ParserState>('get_parser_state')
}

/**
 * Update the entire parser state
 */
export async function updateParserState(state: ParserState): Promise<void> {
  await invoke('update_parser_state', { updates: state })
}

/**
 * Update only the time value
 */
export async function updateParserTime(time: number): Promise<void> {
  await invoke('update_parser_time', { time })
}

/**
 * Update scene and scrub position
 */
export async function updateParserProgress(
  scene: number,
  scrub: number
): Promise<void> {
  await invoke('update_parser_progress', { scene, scrub })
}

/**
 * Update canvas dimensions
 */
export async function updateParserDimensions(
  width: number,
  height: number
): Promise<void> {
  await invoke('update_parser_dimensions', { width, height })
}

/**
 * Update scene metadata for scrub calculations
 */
export async function updateSceneMetadata(
  scenes: SceneMetadata[]
): Promise<void> {
  await invoke('update_scene_metadata', { scenes })
}

/**
 * Evaluate an Asemic expression with current parser context
 */
export async function evalExpression(expr: string): Promise<number> {
  return await invoke<number>('parser_eval_expression', { expr })
}
