import { range } from 'lodash'
import { AsemicGroup } from 'src/AsemicPt'
import invariant from 'tiny-invariant'

export default class NewLineBrush {
  ctx: GPUCanvasContext
  device: GPUDevice

  async render(curves: AsemicGroup[]) {
    // Create vertex shader
    // Define the vertex data
    // Define the vertex data - just 4 corners of the line
    const vertices = new Float32Array(curves[0].flatMap(x => [x.x, x.y]))
    // console.log(vertices, 'vertices')

    // Create a buffer to store vertex data
    const vertexBuffer = this.device.createBuffer({
      size: vertices.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true
    })

    // Write data to the buffer
    new Float32Array(vertexBuffer.getMappedRange()).set(vertices)
    vertexBuffer.unmap()

    const widths = new Float32Array(curves[0].map(x => x.width))
    // Create an index buffer
    const widthsBuffer = this.device.createBuffer({
      size: widths.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true
    })
    new Float32Array(widthsBuffer.getMappedRange()).set(widths)
    widthsBuffer.unmap()

    // Define indices to form two triangles
    const indices = new Uint16Array(
      range(curves[0].length - 1).flatMap(x => [
        x * 2,
        x * 2 + 1,
        x * 2 + 2,
        x * 2 + 1,
        x * 2 + 2,
        x * 2 + 3
      ])
    )

    // Create an index buffer
    const indexBuffer = this.device.createBuffer({
      size: indices.byteLength,
      usage: GPUBufferUsage.INDEX,
      mappedAtCreation: true
    })

    // Write index data
    new Uint16Array(indexBuffer.getMappedRange()).set(indices)
    indexBuffer.unmap()

    // Define curve start indices
    const curveStarts = new Uint16Array([0, 0])

    // Create a buffer for curve starts
    const curveStartsBuffer = this.device.createBuffer({
      size: curveStarts.byteLength,
      usage: GPUBufferUsage.STORAGE,
      mappedAtCreation: true
    })

    // Write curve starts data
    new Uint16Array(curveStartsBuffer.getMappedRange()).set(curveStarts)
    curveStartsBuffer.unmap()

    // Create a buffer for canvas dimensions
    const canvasDimensions = new Float32Array([
      this.ctx.canvas.width,
      this.ctx.canvas.height
    ])

    const dimensionsBuffer = this.device.createBuffer({
      size: canvasDimensions.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true
    })

    new Float32Array(dimensionsBuffer.getMappedRange()).set(canvasDimensions)
    dimensionsBuffer.unmap()

    // Update bind group layout to include dimensions uniform
    const bindGroupLayout = this.device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX,
          buffer: { type: 'read-only-storage' }
        },
        {
          binding: 1,
          visibility: GPUShaderStage.VERTEX,
          buffer: { type: 'read-only-storage' }
        },
        {
          binding: 2,
          visibility: GPUShaderStage.VERTEX,
          buffer: { type: 'uniform' }
        }
      ]
    })

    const bindGroup = this.device.createBindGroup({
      layout: bindGroupLayout,
      entries: [
        {
          binding: 0,
          resource: { buffer: vertexBuffer }
        },
        {
          binding: 1,
          resource: { buffer: widthsBuffer }
        },
        {
          binding: 2,
          resource: { buffer: dimensionsBuffer }
        }
      ]
    })

    const shaderModule = this.device.createShaderModule({
      code: /*wgsl*/ `
      struct VertexOutput {
        @builtin(position) position: vec4<f32>,
      };
      
      @group(0) @binding(0)
      var<storage, read> vertices: array<vec2<f32>>;

      @group(0) @binding(1)
      var<storage, read> widths: array<f32>;

      @group(0) @binding(2)
      var<uniform> canvasDimensions: vec2<f32>;

      fn normalCoords(position: vec2<f32>) -> vec2<f32> {
        // Convert coordinates from [0, 1] to [-1, 1] on x
        let x = position.x * 2.0 - 1.0;
        // Convert coordinates from [0, 1] to [-(height/width), -(height/width)] on y
        let aspectRatio = canvasDimensions.y / canvasDimensions.x;
        let y = (1.0 - position.y * 2.0) / aspectRatio;
        return vec2<f32>(x, y);
      }

      @vertex
      fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
        var output: VertexOutput;
        let vertex = vertexIndex / 2u;
        let side = vertexIndex % 2u;
        let width = widths[vertex] / canvasDimensions.x;
        var position = normalCoords(vertices[vertex]);
        var nextPosition: vec2<f32>;
        var backwards = false;
        const PI = 3.14159265358979323846;
        
        // Check if vertex + 1u is within the bounds of the vertices array
        if (vertex + 1u < arrayLength(&vertices)) {
          nextPosition = normalCoords(vertices[vertex + 1u]);
        } else {
          // Use previous position if next one doesn't exist
          nextPosition = normalCoords(vertices[vertex - 1u]);
          backwards = true;
        }

        let direction = select(
          vec2<f32>(nextPosition.x - position.x, nextPosition.y - position.y), 
          vec2<f32>(position.x - nextPosition.x, position.y - nextPosition.y), 
          backwards);
        
        // Normalize the direction vector
        let normalizedDir = normalize(direction);
        
        // Create perpendicular vector by rotating 90 degrees
        let perpVector = vec2<f32>(-normalizedDir.y, normalizedDir.x) * width;

        if (side != 0u) {
          // Apply offset for the second vertex of the triangle
          position = position + perpVector;
        }
        output.position = vec4<f32>(position, 0.0, 1.0);
        return output;
      }

      @fragment
      fn fragmentMain() -> @location(0) vec4<f32> {
        return vec4<f32>(1.0, 1.0, 1.0, 1.0); // White color
      }
      `
    })

    const computeLayout = this.device.createComputePipeline({
      layout: this.device.createPipelineLayout({
        bindGroupLayouts: [bindGroupLayout]
      }),
      compute: {
        module: shaderModule,
        entryPoint: 'computeMain'
      }
    })

    const pipeline = this.device.createRenderPipeline({
      layout: this.device.createPipelineLayout({
        bindGroupLayouts: [bindGroupLayout]
      }),
      vertex: {
        module: shaderModule,
        entryPoint: 'vertexMain'
      },
      fragment: {
        module: shaderModule,
        entryPoint: 'fragmentMain',
        targets: [{ format: navigator.gpu.getPreferredCanvasFormat() }]
      },
      primitive: {
        topology: 'triangle-list', // Using triangles instead of lines
        cullMode: 'none' // Disables face culling to render both sides
      },
      multisample: {
        count: 1
      }
    })

    // Create a method to render the line
    const commandEncoder = this.device.createCommandEncoder()
    const renderPass = commandEncoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.ctx.getCurrentTexture().createView(),
          loadOp: 'clear',
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          storeOp: 'store'
        }
      ]
    })
    // Set the bind group for rendering
    renderPass.setBindGroup(0, bindGroup)
    renderPass.setPipeline(pipeline)

    // Set the index buffer and draw indexed
    renderPass.setIndexBuffer(indexBuffer, 'uint16')
    renderPass.drawIndexed(indices.length) // Draw 6 indices (2 triangles)

    renderPass.end()
    console.log('finishing')

    this.device.queue.submit([commandEncoder.finish()])
  }

  async init() {
    const adapter = await navigator.gpu.requestAdapter({
      featureLevel: 'compatibility'
    })
    invariant(adapter)
    const device = await adapter.requestDevice()
    invariant(device)
    this.device = device
    this.ctx.configure({
      device,
      format: navigator.gpu.getPreferredCanvasFormat()
    })
  }

  constructor(ctx: GPUCanvasContext) {
    this.ctx = ctx
  }
}
