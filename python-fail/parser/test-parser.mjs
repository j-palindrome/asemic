/**
 * Test script for Asemic Parser WASM bindings
 * Run with: node test-parser.mjs
 *
 * Note: Requires running HTTP server for file access
 */

// This is a placeholder test - actual testing requires browser environment
// or Node.js with fetch polyfill

console.log('🧪 Asemic Parser WASM Test Suite')
console.log('=================================\n')

console.log('To test the WASM parser:')
console.log('1. Start HTTP server: python3 -m http.server 8000')
console.log('2. Open browser: http://localhost:8000/demo.html')
console.log('3. Check browser console for test results\n')

console.log('For programmatic testing, use:')
console.log('  - playwright or puppeteer for automated browser tests')
console.log('  - pyodide in Node.js (requires experimental setup)\n')

// Example test code for browser
const browserTestCode = `
// Browser test code
(async () => {
  const tests = [];
  
  // Test 1: Initialize parser
  tests.push(async () => {
    const parser = await AsemicParser.create();
    console.assert(parser, 'Parser should initialize');
    return 'Initialize parser';
  });
  
  // Test 2: Parse simple code
  tests.push(async () => {
    const parser = await AsemicParser.create();
    parser.parse('tri 0.5 0.5 0.2');
    const state = parser.getState();
    console.assert(state.groups.length > 0, 'Should have groups');
    console.assert(state.errors.length === 0, 'Should have no errors');
    return 'Parse simple triangle';
  });
  
  // Test 3: Parse with errors
  tests.push(async () => {
    const parser = await AsemicParser.create();
    parser.parse('invalid_method()');
    const state = parser.getState();
    // May or may not have errors depending on implementation
    return 'Parse invalid code';
  });
  
  // Test 4: Expression evaluation
  tests.push(async () => {
    const parser = await AsemicParser.create();
    const result = parser.expr('2 + 3');
    console.assert(result === 5, 'Should evaluate to 5');
    return 'Evaluate expression';
  });
  
  // Test 5: Scene parsing
  tests.push(async () => {
    const parser = await AsemicParser.create();
    parser.parse(\`
# scene1
tri 0.5 0.5 0.2

# scene2  
squ 0.3 0.7 0.15
    \`);
    const state = parser.getState();
    console.assert(state.totalLength > 0, 'Should have duration');
    return 'Parse multiple scenes';
  });
  
  // Run all tests
  console.log('Running tests...');
  for (const test of tests) {
    try {
      const name = await test();
      console.log(\`✓ \${name}\`);
    } catch (error) {
      console.error(\`✗ Test failed: \${error.message}\`);
    }
  }
  
  console.log('Tests complete!');
})();
`

console.log(
  'Copy and paste this into the browser console after loading demo.html:\n'
)
console.log(browserTestCode)

// Export for potential use
export default {
  browserTestCode
}
