import { Pt } from 'pts'
import { Parser } from '../src/Parser'
import { AsemicPt } from '../src/blocks/AsemicPt'
let parser: Parser

beforeEach(() => {
  parser = new Parser()
})

// A very basic test just to get started
describe('Parser Basic Tests', () => {
  test('Parser class should exist', () => {
    expect(Parser).toBeDefined()
  })
})

describe('Expression Evaluation', () => {
  test('should evaluate basic numeric expressions', () => {
    expect(parser.evalExpr('5')).toBe(5)
    expect(parser.evalExpr('5.5')).toBe(5.5)
    expect(parser.evalExpr('-10')).toBe(-10)
  })

  test('should evaluate arithmetic operations', () => {
    expect(parser.evalExpr('5+3')).toBe(8)
    expect(parser.evalExpr('5-3')).toBe(2)
    expect(parser.evalExpr('5*3')).toBe(15)
    expect(parser.evalExpr('6/3')).toBe(2)
    expect(parser.evalExpr('7%3')).toBe(1)
    expect(parser.evalExpr('2^3')).toBe(8)
  })

  test('should handle nested operations with parentheses', () => {
    expect(parser.evalExpr('(5+3)*2')).toBe(16)
    expect(parser.evalExpr('2*(5+3)')).toBe(16)
    expect(parser.evalExpr('(2+3)*(4-1)')).toBe(15)
  })

  test('should evaluate special operators', () => {
    // Test hash operator (#) - since it uses Math.random, we'll just check if it returns a number

    const hashResult = parser.evalExpr('#')
    expect(typeof hashResult).toBe('number')
    expect(hashResult).toBeGreaterThanOrEqual(0)
    expect(hashResult).toBeLessThanOrEqual(1)

    // Test floor operator (_)

    expect(parser.evalExpr('5.7_1')).toBe(5)

    expect(parser.evalExpr('5.7_0.5')).toBe(5.5)
  })

  test('should handle interpolation expressions', () => {
    expect(parser.evalExpr('1<0.5>3')).toBe(2)

    expect(parser.evalExpr('0<0.25>4')).toBe(1)

    expect(parser.evalExpr('10<0.75>20')).toBe(17.5)
  })

  test('should evaluate built-in constants', () => {
    // Test time constant

    const timeResult = parser.evalExpr('T')
    expect(typeof timeResult).toBe('number')

    // Test index constant

    parser.progress.index = 5

    expect(parser.evalExpr('I')).toBe(5)

    // Test count constant

    parser.progress.countNum = 10

    expect(parser.evalExpr('N')).toBe(10)
  })
})

describe('Point Parsing', () => {
  test('should parse absolute coordinates', () => {
    // @ts-ignore
    const point = parser.parsePoint('0.5,0.5')
    expect(point[0]).toBe(0.5)
    expect(point[1]).toBe(0.5)
  })

  test('should parse single value as both x and y', () => {
    //@ts-ignore
    const point = parser.parsePoint('0.5')
    expect(point[0]).toBe(0.5)
    expect(point[1]).toBe(0.5)
  })

  test('should parse relative coordinates', () => {
    //@ts-ignore
    parser.lastPoint = new Pt([1, 1])
    //@ts-ignore
    const point = parser.parsePoint('+0.5,0.5')
    expect(point[0]).toBeCloseTo(1.5)
    expect(point[1]).toBeCloseTo(1.5)
  })

  test('should parse polar coordinates', () => {
    parser.lastPoint = new AsemicPt(parser, 1, 1)

    // @ts-ignore
    const point = parser.parsePoint('@0.25,1') // 90 degrees, radius 1
    // At 90° (0.25 turns) and radius 1, should be approximately [1, 2]
    expect(point[0]).toBeCloseTo(1)
    expect(point[1]).toBeCloseTo(2)
  })

  test('should apply transforms to parsed points', () => {
    parser.transform.scale = new Pt([2, 2])

    parser.transform.rotation = 0

    parser.transform.translation = new Pt([1, 1])

    // @ts-ignore
    const point = parser.parsePoint('0.5,0.5')
    // Point (0.5, 0.5) -> scaled by 2 -> (1, 1) -> translated by (1, 1) -> (2, 2)
    expect(point[0]).toBeCloseTo(2)
    expect(point[1]).toBeCloseTo(2)
  })
})

describe('Transformation Parsing', () => {
  test('should parse scale transformations', () => {
    // @ts-ignore
    parser.parseTransform('{*2,2}')

    expect(parser.transform.scale[0]).toBe(2)

    expect(parser.transform.scale[1]).toBe(2)
  })

  test('should parse rotation transformations', () => {
    // @ts-ignore
    parser.parseTransform('{@0.25}') // 90 degrees

    expect(parser.transform.rotation).toBe(0.25)
  })

  test('should parse translation transformations', () => {
    // @ts-ignore
    parser.parseTransform('{+1,1}')

    expect(parser.transform.translation[0]).toBe(1)

    expect(parser.transform.translation[1]).toBe(1)
  })

  test('should handle transform reset', () => {
    // First set some transforms
    // @ts-ignore

    parser.parseTransform('{*2,2}')

    // @ts-ignore
    parser.parseTransform('{@0.25}')

    // @ts-ignore
    parser.parseTransform('{+1,1}')

    // Then reset all
    // @ts-ignore

    parser.parseTransform('{!}')

    expect(parser.transform.scale[0]).toBe(1)

    expect(parser.transform.scale[1]).toBe(1)

    expect(parser.transform.rotation).toBe(0)

    expect(parser.transform.translation[0]).toBe(0)

    expect(parser.transform.translation[1]).toBe(0)
  })

  test('should handle transform stacking', () => {
    // @ts-ignore
    parser.parseTransform('{>}') // Push current transform
    // @ts-ignore
    parser.parseTransform('{*2,2}') // Scale

    expect(parser.transform.scale[0]).toBe(2)

    // @ts-ignore
    parser.parseTransform('{<}') // Pop back to previous transform

    expect(parser.transform.scale[0]).toBe(1)
  })
})

describe('Curve Generation', () => {
  test('should create a basic line', () => {
    // @ts-ignore
    parser.parse('[0,0 1,1]', { last: true })

    expect(parser.curves.length).toBe(1)

    expect(parser.curves[0].length).toBe(3)

    expect(parser.curves[0][0][0]).toBe(0)

    expect(parser.curves[0][0][1]).toBe(0)

    expect(parser.curves[0][2][0]).toBe(1)

    expect(parser.curves[0][2][1]).toBe(1)
  })

  test('should create multiple curves', () => {
    // @ts-ignore
    parser.parse('[0,0 1,0] [0,1 1,1]', { last: true })

    expect(parser.curves.length).toBe(2)

    expect(parser.curves[0][0][1]).toBe(0) // y of first point of first curve

    expect(parser.curves[1][0][1]).toBe(1) // y of first point of second curve
  })

  test('should handle built-in shapes', () => {
    // @ts-ignore
    parser.parse('(tri 0,0 1,1 0.5)', { last: true })

    expect(parser.curves.length).toBe(1)

    expect(parser.curves[0].length).toBeGreaterThan(2) // Should have multiple points

    // Reset

    parser.curves = []

    // @ts-ignore
    parser.parse('(cir 0.5,0.5 0.5,0.5)', { last: true })

    expect(parser.curves.length).toBe(1)

    expect(parser.curves[0].length).toBeGreaterThan(4) // Circle should have multiple points
  })
})

describe('Text Handling', () => {
  test('should parse simple text', () => {
    // @ts-ignore
    parser.parse('"ABC"', { last: true })
    // Should create curves representing the characters

    expect(parser.curves.length).toBeGreaterThan(0)
  })

  test('should handle font definitions', () => {
    // @ts-ignore
    parser.parse('{{default A=[0,0 1,1]}}', { last: true })

    // @ts-ignore
    parser.parse('"A"', { last: true })
    expect(parser.fonts.default.characters['A']).toEqual(`[0,0 1,1]`)
  })
})

describe('Function Evaluation', () => {
  test('should evaluate sin function', () => {
    const result = parser.evalExpr('sin 0.25') // sin of 90 degrees
    expect(parseFloat(result.toString())).toBeCloseTo(1)
  })

  test('should evaluate repeat function', () => {
    // @ts-ignore
    parser.parse(`(repeat 3 [0,0 1,1])`, { last: true })

    expect(parser.curves.length).toBe(3)
  })
})

describe('Tokenization', () => {
  test('should tokenize simple expressions', () => {
    // @ts-ignore
    const tokens = parser.tokenize('5 + 3')
    expect(tokens).toEqual(['5', '+', '3'])
  })

  test('should handle brackets properly', () => {
    // @ts-ignore
    const tokens = parser.tokenize('[0,0 1,1] [2,2 3,3]')
    expect(tokens).toEqual(['[0,0 1,1]', '[2,2 3,3]'])
  })

  test('should handle quotes properly', () => {
    // @ts-ignore
    const tokens = parser.tokenize('"Hello" "World"')
    expect(tokens).toEqual(['"Hello"', '"World"'])
  })

  test('should handle function calls', () => {
    // @ts-ignore
    const tokens = parser.tokenize('repeat 3 [0,0 1,1] (repeat 10 others)')
    expect(tokens).toEqual(['repeat', '3', '[0,0 1,1]', '(repeat 10 others)'])
  })
})

describe('Scene Processing', () => {
  test('should preprocess scenes correctly', () => {
    parser.setup(`h=2
---
[0,0 1,1]
---
[0,0 1,0]`)

    expect(parser.settings.h).toBe(2)
    expect(parser.scenes.length).toBe(2)
  })
})
