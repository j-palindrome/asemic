import { invoke } from '@tauri-apps/api/core'

export interface ParserState {
  time: number
  progress: number
  scrub: number
  width: number
  height: number
  scene: number
  total_length: number
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
 * Update progress and scene
 */
export async function updateParserProgress(
  progress: number,
  scene: number
): Promise<void> {
  await invoke('update_parser_progress', { progress, scene })
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
 * Evaluate an Asemic expression with current parser context
 */
export async function evalExpression(expr: string): Promise<number> {
  return await invoke<number>('parser_eval_expression', { expr })
}
