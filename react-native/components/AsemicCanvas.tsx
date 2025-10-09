/**
 * React Native Canvas Renderer for Asemic
 *
 * Renders Asemic curves to react-native-canvas
 */

import React, { useEffect, useRef } from 'react'
import { View, StyleSheet } from 'react-native'
import Canvas from 'react-native-canvas'
import { Parser } from '../../src/lib/parser/Parser'
import { AsemicGroup } from '../../src/lib/parser/core/AsemicGroup'

export interface AsemicCanvasProps {
  source: string
  width: number
  height: number
  backgroundColor?: string
  strokeColor?: string
  strokeWidth?: number
  onError?: (error: Error) => void
  onReady?: () => void
}

export const AsemicCanvas: React.FC<AsemicCanvasProps> = ({
  source,
  width,
  height,
  backgroundColor = 'white',
  strokeColor = 'black',
  strokeWidth = 2,
  onError,
  onReady
}) => {
  const canvasRef = useRef<Canvas>(null)
  const parserRef = useRef<Parser>(new Parser())

  useEffect(() => {
    if (!canvasRef.current) return

    const canvas = canvasRef.current
    const parser = parserRef.current

    const render = async () => {
      try {
        // Parse source
        parser.setup(source)
        parser.draw()

        // Get canvas context
        const ctx = canvas.getContext('2d')
        if (!ctx) return

        // Set canvas size
        canvas.width = width
        canvas.height = height

        // Clear canvas
        ctx.fillStyle = backgroundColor
        ctx.fillRect(0, 0, width, height)

        // Set drawing style
        ctx.strokeStyle = strokeColor
        ctx.lineWidth = strokeWidth
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'

        // Render all groups
        for (const group of parser.groups) {
          for (const curve of group) {
            if (curve.length < 2) continue

            ctx.beginPath()

            // Move to first point
            const first = curve[0]
            ctx.moveTo(first.x * width, first.y * height)

            // Draw quadratic bezier through points
            for (let i = 0; i < curve.length - 2; i += 2) {
              const p1 = curve[i]
              const cp = curve[i + 1]
              const p2 = curve[i + 2]

              if (!p2) {
                // Not enough points for bezier, draw line
                ctx.lineTo(cp.x * width, cp.y * height)
                break
              }

              ctx.quadraticCurveTo(
                cp.x * width,
                cp.y * height,
                p2.x * width,
                p2.y * height
              )
            }

            ctx.stroke()
          }
        }

        onReady?.()
      } catch (error) {
        onError?.(error as Error)
      }
    }

    render()
  }, [source, width, height, backgroundColor, strokeColor, strokeWidth])

  return (
    <View style={[styles.container, { width, height }]}>
      <Canvas ref={canvasRef} style={styles.canvas} />
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden'
  },
  canvas: {
    flex: 1
  }
})
