#!/bin/bash

# Build script for creating a custom Pyodide bundle with Asemic Parser
# This creates a smaller, optimized WASM bundle for production use

set -e

echo "🔨 Building Asemic Parser for WebAssembly"
echo "=========================================="

# Check if pyodide-build is installed
if ! command -v pyodide &> /dev/null; then
    echo "❌ pyodide-build not found. Installing..."
    pip install pyodide-build
fi

# Create build directory
BUILD_DIR="./build"
DIST_DIR="./dist"

mkdir -p "$BUILD_DIR"
mkdir -p "$DIST_DIR"

echo "✓ Build directories created"

# Copy parser to build directory
cp parser.py "$BUILD_DIR/"
echo "✓ Copied parser.py"

# Create a minimal setup.py for the parser
cat > "$BUILD_DIR/setup.py" << EOF
from setuptools import setup

setup(
    name="asemic-parser",
    version="1.0.0",
    py_modules=["parser"],
    install_requires=[],
)
EOF
echo "✓ Created setup.py"

# Create pyodide config
cat > "$BUILD_DIR/pyodide-config.json" << EOF
{
  "packages": {
    "asemic-parser": {
      "name": "asemic-parser",
      "version": "1.0.0",
      "file_name": "asemic-parser-1.0.0.tar.gz",
      "install_dir": "site",
      "sha256": "",
      "depends": [],
      "imports": ["parser"],
      "unvendored_tests": false
    }
  }
}
EOF
echo "✓ Created Pyodide config"

# Create optimized loader
cat > "$DIST_DIR/asemic-parser-loader.js" << 'EOF'
/**
 * Optimized Asemic Parser Loader for Pyodide
 * 
 * This loader provides a streamlined interface for loading the Asemic Parser
 * with minimal overhead.
 */

const PYODIDE_VERSION = '0.24.1';
const PYODIDE_CDN = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;

let pyodideInstance = null;
let parserReady = false;

/**
 * Initialize Pyodide with the Asemic Parser
 * @param {Object} options - Configuration options
 * @param {string} options.parserUrl - URL to parser.py (default: './parser.py')
 * @param {string} options.pyodideUrl - URL to Pyodide (default: CDN)
 * @param {Function} options.onProgress - Progress callback
 * @returns {Promise<Object>} Pyodide instance with parser loaded
 */
export async function initAsemicParser(options = {}) {
  const {
    parserUrl = './parser.py',
    pyodideUrl = PYODIDE_CDN,
    onProgress = () => {}
  } = options;

  if (parserReady) {
    return pyodideInstance;
  }

  try {
    // Load Pyodide
    onProgress({ stage: 'pyodide', progress: 0 });
    
    const pyodide = await loadPyodide({
      indexURL: pyodideUrl,
      fullStdLib: false // Use minimal stdlib
    });
    
    onProgress({ stage: 'pyodide', progress: 100 });
    
    // Load parser
    onProgress({ stage: 'parser', progress: 0 });
    
    const parserCode = await fetch(parserUrl).then(r => r.text());
    await pyodide.runPythonAsync(parserCode);
    
    onProgress({ stage: 'parser', progress: 100 });
    onProgress({ stage: 'complete', progress: 100 });
    
    pyodideInstance = pyodide;
    parserReady = true;
    
    return pyodide;
  } catch (error) {
    throw new Error(`Failed to initialize Asemic Parser: ${error.message}`);
  }
}

/**
 * Create a parser instance
 * @returns {Promise<Object>} Parser proxy object
 */
export async function createParser() {
  if (!parserReady) {
    await initAsemicParser();
  }

  const parser = pyodideInstance.runPython(`
from parser import Parser
Parser()
  `);

  return new ParserProxy(parser);
}

/**
 * Proxy class for Python Parser with JavaScript-friendly interface
 */
class ParserProxy {
  constructor(pythonParser) {
    this._parser = pythonParser;
    this._pyodide = pyodideInstance;
  }

  /**
   * Parse source and return results
   */
  parse(source) {
    const result = this._pyodide.runPython(`
import json

_parser.setup(${JSON.stringify(source)})
_parser.draw()

def _pt_to_dict(pt):
    return {'x': float(pt.x), 'y': float(pt.y)}

def _curve_to_list(curve):
    return [_pt_to_dict(pt) for pt in curve]

_result = {
    'groups': [[_curve_to_list(curve) for curve in group] for group in _parser.groups],
    'errors': _parser.output.errors,
    'osc': _parser.output.osc,
    'progress': float(_parser.progress.progress),
    'totalLength': float(_parser.total_length),
}

json.dumps(_result)
    `.replace(/_parser/g, 'parser'));

    return JSON.parse(result);
  }

  /**
   * Evaluate expression
   */
  expr(expression) {
    return this._parser.expr(expression);
  }

  /**
   * Clean up resources
   */
  destroy() {
    this._parser.destroy();
  }
}

export { ParserProxy };
EOF
echo "✓ Created optimized loader"

# Create production example
cat > "$DIST_DIR/example.html" << 'EOF'
<!DOCTYPE html>
<html>
<head>
    <title>Asemic Parser - Production Build</title>
    <style>
        body { font-family: monospace; padding: 20px; background: #1e1e1e; color: #fff; }
        #progress { margin: 20px 0; }
        .bar { height: 20px; background: #0e639c; transition: width 0.3s; }
    </style>
</head>
<body>
    <h1>Asemic Parser - Optimized Build</h1>
    <div id="progress">
        <div class="bar" style="width: 0%"></div>
    </div>
    <div id="status">Loading...</div>
    
    <script src="https://cdn.jsdelivr.net/pyodide/v0.24.1/full/pyodide.js"></script>
    <script type="module">
        import { createParser } from './asemic-parser-loader.js';
        
        const status = document.getElementById('status');
        const bar = document.querySelector('.bar');
        
        // Initialize with progress tracking
        const parser = await createParser({
            onProgress: ({ stage, progress }) => {
                status.textContent = `Loading ${stage}: ${progress}%`;
                bar.style.width = `${progress}%`;
            }
        });
        
        status.textContent = 'Ready!';
        
        // Parse some code
        const result = parser.parse('tri 0.5 0.5 0.2');
        console.log(result);
    </script>
</body>
</html>
EOF
echo "✓ Created production example"

# Create package info
cat > "$DIST_DIR/package.json" << EOF
{
  "name": "asemic-parser-wasm",
  "version": "1.0.0",
  "description": "Asemic Parser compiled to WebAssembly via Pyodide",
  "type": "module",
  "main": "asemic-parser-loader.js",
  "files": [
    "asemic-parser-loader.js",
    "../parser.py"
  ],
  "keywords": ["asemic", "parser", "wasm", "pyodide"],
  "author": "",
  "license": "ISC"
}
EOF
echo "✓ Created package.json"

echo ""
echo "✅ Build complete!"
echo ""
echo "📦 Distribution files created in: $DIST_DIR"
echo ""
echo "Next steps:"
echo "  1. Test the build: python -m http.server 8000"
echo "  2. Open: http://localhost:8000/$DIST_DIR/example.html"
echo "  3. Deploy the dist/ folder to your web server"
echo ""
echo "Files to deploy:"
echo "  - dist/asemic-parser-loader.js"
echo "  - parser.py"
echo "  - (Pyodide will load from CDN)"
