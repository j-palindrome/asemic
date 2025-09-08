import { AsemicPt } from '../../blocks/AsemicPt'
import { Parser } from '../Parser'

export class DataMethods {
  parser: Parser

  constructor(parser: Parser) {
    this.parser = parser
  }

  /**
   * Load multiple files into the image store
   * @param files - Dictionary of filename to ImageBitmap arrays
   */
  loadFiles(files: Partial<any>) {
    Object.assign(this.parser.images, files)
    return this.parser
  }

  /**
   * Look up a pixel value from a loaded image
   * @param name - The name of the loaded image
   * @param coord - Coordinate string to parse
   * @param channel - Which channel to return: 'r', 'g', 'b', 'a', or 'brightness' (default)
   * @returns Normalized pixel value (0-1)
   */
  table(name: string, coord: string, channel: string = 'brightness'): number {
    const [x, y] = this.parser.evalPoint(coord, { basic: true })

    // First try to get from images cache (ImageBitmap[])
    const bitmaps = this.parser.images[this.parser.resolveName(name)]
    if (!bitmaps) {
      this.parser.error(
        `Data is not available for ${this.parser.resolveName(name)}`
      )
      return 0
    }
    // Use progress or time to select frame for videos
    const frameIndex =
      bitmaps.length > 1
        ? Math.floor(this.parser.progress.scrubTime * 60) % bitmaps.length
        : 0
    const bitmap = bitmaps[frameIndex]

    const normalizedX = Math.max(0, Math.min(1, x))
    const normalizedY = Math.max(0, Math.min(1, y))
    const pixelX = Math.floor(normalizedX * (bitmap.width - 1))
    const pixelY = Math.floor(normalizedY * (bitmap.height - 1))

    const start = pixelY * bitmap.width * 4 + pixelX * 4
    const [r, g, b, a] = bitmap.data
      .subarray(start, start + 4)
      .map((v: number) => v / 255)
    switch (channel) {
      case 'r':
        return r
      case 'g':
        return g
      case 'b':
        return b
      case 'a':
        return a
      case 'brightness':
      default:
        return (0.299 * r + 0.587 * g + 0.114 * b) * a
    }
  }

  processMouse(mouse: NonNullable<any>) {
    this.parser.draw()

    const x = mouse.x / this.parser.preProcessing.width
    const y = mouse.y / this.parser.preProcessing.height
    console.log(x, y)

    // Update the last point in the temporary parser
    const point = new AsemicPt(this.parser, x, y)

    // Optionally, apply the current transform to the mouse position
    this.parser.reverseTransform(point)

    return point
  }

  resolveName(name: string) {
    if (!this.parser.settings.folder.endsWith('/'))
      this.parser.settings.folder += '/'
    return this.parser.settings.folder + name
  }
}
