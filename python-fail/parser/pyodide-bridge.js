/**
 * Pyodide Bridge for Asemic Parser
 *
 * This module provides a JavaScript interface to the Python Asemic Parser
 * using Pyodide (Python compiled to WebAssembly).
 *
 * Usage:
 *   import { AsemicParser } from './pyodide-bridge.js';
 *
 *   const parser = await AsemicParser.create();
 *   const result = parser.parse('# scene1\ntri 0.5 0.5 0.2');
 *   console.log(result.groups);
 */

let pyodideInstance = null
let parserModule = null

/**
 * Initialize Pyodide and load the Parser module
 */
async function initPyodide() {
  if (pyodideInstance) {
    return pyodideInstance
  }

  // Load Pyodide from CDN
  const pyodide = await loadPyodide({
    indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.24.1/full/'
  })

  // Load the parser module
  const parserCode = await fetch('./parser.py').then(r => r.text())

  // Load the parser into Pyodide
  await pyodide.runPythonAsync(parserCode)

  pyodideInstance = pyodide
  return pyodide
}

/**
 * JavaScript wrapper for the Python Parser class
 */
export class AsemicParser {
  constructor(pyodide, parserInstance) {
    this.pyodide = pyodide
    this.parser = parserInstance
  }

  /**
   * Create a new AsemicParser instance
   * @returns {Promise<AsemicParser>}
   */
  static async create() {
    const pyodide = await initPyodide()

    // Create parser instance
    const parserInstance = pyodide.runPython(`
from parser import Parser
parser_instance = Parser()
parser_instance
    `)

    return new AsemicParser(pyodide, parserInstance)
  }

  /**
   * Parse Asemic source code
   * @param {string} source - Asemic source code
   * @returns {Object} Parser state with groups, errors, etc.
   */
  parse(source) {
    this.pyodide.runPython(`
parser_instance.setup(${JSON.stringify(source)})
parser_instance.draw()
    `)

    return this.getState()
  }

  /**
   * Get current parser state
   * @returns {Object}
   */
  getState() {
    const state = this.pyodide.runPython(`
import json

# Convert parser state to JSON-serializable format
def point_to_dict(pt):
    return {'x': pt.x, 'y': pt.y}

def curve_to_list(curve):
    return [point_to_dict(pt) for pt in curve]

state = {
    'groups': [[curve_to_list(curve) for curve in group] for group in parser_instance.groups],
    'errors': parser_instance.output.errors,
    'osc': parser_instance.output.osc,
    'sc': parser_instance.output.sc,
    'progress': parser_instance.progress.progress,
    'totalLength': parser_instance.total_length,
    'params': parser_instance.params,
    'presets': parser_instance.presets
}

json.dumps(state)
    `)

    return JSON.parse(state)
  }

  /**
   * Evaluate an expression
   * @param {string} expression - Expression to evaluate
   * @returns {number}
   */
  expr(expression) {
    return this.pyodide.runPython(`
parser_instance.expr(${JSON.stringify(expression)})
    `)
  }

  /**
   * Set a parameter value
   * @param {string} name - Parameter name
   * @param {number} value - Parameter value
   */
  setParam(name, value) {
    this.pyodide.runPython(`
if ${JSON.stringify(name)} in parser_instance.params:
    parser_instance.params[${JSON.stringify(name)}]['value'] = ${value}
    `)
  }

  /**
   * Get a parameter value
   * @param {string} name - Parameter name
   * @returns {number}
   */
  getParam(name) {
    return this.pyodide.runPython(`
parser_instance.params.get(${JSON.stringify(name)}, {}).get('value', 0)
    `)
  }

  /**
   * Scrub to a specific time
   * @param {number} time - Time in seconds
   */
  scrub(time) {
    this.pyodide.runPython(`
parser_instance.scrub(${time})
parser_instance.draw()
    `)
  }

  /**
   * Reset the parser
   */
  reset() {
    this.pyodide.runPython(`
parser_instance.reset()
    `)
  }

  /**
   * Get current groups (curves)
   * @returns {Array}
   */
  getGroups() {
    const state = this.getState()
    return state.groups
  }

  /**
   * Get errors
   * @returns {Array<string>}
   */
  getErrors() {
    const state = this.getState()
    return state.errors
  }
}

/**
 * Standalone function to quickly parse Asemic code
 * @param {string} source - Asemic source code
 * @returns {Promise<Object>} Parser state
 */
export async function parseAsemic(source) {
  const parser = await AsemicParser.create()
  parser.parse(source)
  return parser.getState()
}

// Export for use in browser or Node.js
if (typeof window !== 'undefined') {
  window.AsemicParser = AsemicParser
  window.parseAsemic = parseAsemic
}
