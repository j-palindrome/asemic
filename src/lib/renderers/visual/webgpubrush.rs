use crate::lib::types::Scene;
use std::num::NonZeroU64;
use wgpu::{
    BindGroup, BindGroupLayout, Buffer, BufferUsages, CanvasContext, Device, Queue,
    RenderPassEncoder, RenderPipeline, ShaderModule, Texture, TextureSampler, TextureUsages,
};

/// Represents a group of curves with associated settings
#[derive(Clone, Debug)]
pub struct AsemicGroup {
    pub points: Vec<Vec<Point>>,
    pub settings: CurveSettings,
}

/// A single point in a curve with rendering attributes
#[derive(Clone, Debug)]
pub struct Point {
    pub x: f32,
    pub y: f32,
    pub w: f32,          // width
    pub h: f32,          // hue
    pub s: f32,          // saturation
    pub l: f32,          // lightness
    pub a: f32,          // alpha
    pub attrs: [f32; 4], // additional attributes
}

/// Settings for curve rendering
#[derive(Clone, Debug, Default)]
pub struct CurveSettings {
    // Curve-specific settings can be added here
}

/// Texture support for brush rendering
pub struct BrushTexture {
    pub src: Texture,
    pub image_data: Vec<wgpu::ImageCopyTexture<'static>>,
    pub transform_buffer: Buffer,
}

/// Abstract trait for WebGPU brush implementations
pub trait WebGPUBrushImpl: Send + Sync {
    fn mode(&self) -> &str;
    fn load_index(&self, curves: &AsemicGroup) -> Vec<u32>;
    fn load_pipeline(&self, device: &Device, bind_group_layout: &BindGroupLayout)
        -> RenderPipeline;
}

/// WebGPU Brush for rendering curves
pub struct WebGPUBrush {
    pub ctx: CanvasContext,
    pub device: Device,
    pub queue: Queue,
    pub pipeline: Option<RenderPipeline>,
    pub bind_group: Option<BindGroup>,
    pub shader_module: ShaderModule,

    // GPU Buffers
    pub dimensions: BufferBinding,
    pub time: BufferBinding,
    pub scrub: BufferBinding,
    pub widths: BufferBinding,
    pub curve_starts: CurveStartsBinding,
    pub vertex: BufferBinding,
    pub index: IndexBinding,
    pub colors: BufferBinding,
    pub attrs: BufferBinding,

    // Optional texture
    pub texture: Option<BrushTexture>,

    // Settings
    pub settings: CurveSettings,

    // Implementation
    pub impl_: Box<dyn WebGPUBrushImpl>,
}

/// Wrapper for buffer bindings with size tracking
#[derive(Clone)]
pub struct BufferBinding {
    pub buffer: Buffer,
    pub size: usize,
}

/// Wrapper for index buffer with size
pub struct IndexBinding {
    pub buffer: Buffer,
    pub size: usize,
}

/// Wrapper for curve starts with array copy
pub struct CurveStartsBinding {
    pub buffer: Buffer,
    pub size: usize,
    pub array: Vec<u32>,
}

impl Drop for WebGPUBrush {
    fn drop(&mut self) {
        // GPU resources are automatically cleaned up by wgpu
        // No explicit cleanup needed in Rust
    }
}

impl WebGPUBrush {
    /// Load shader module with optional texture support
    pub fn load_shader(&self, include_texture: bool) -> ShaderModule {
        let shader_code = if include_texture {
            include_str!("./wgsl/brush_shader_with_texture.wgsl")
        } else {
            include_str!("./wgsl/brush_shader.wgsl")
        };

        self.device
            .create_shader_module(wgpu::ShaderModuleDescriptor {
                label: Some("brush_shader"),
                source: wgpu::ShaderSource::Wgsl(shader_code.into()),
            })
    }

    /// Reload buffer data from updated curves
    pub fn reload(&mut self, curves: &AsemicGroup) {
        // Prepare vertex data
        let vertices: Vec<f32> = curves
            .points
            .iter()
            .flat_map(|curve| curve.iter().flat_map(|point| vec![point.x, point.y]))
            .collect();

        self.queue
            .write_buffer(&self.vertex.buffer, 0, bytemuck::cast_slice(&vertices));

        // Prepare width data
        let widths: Vec<f32> = curves
            .points
            .iter()
            .flat_map(|curve| curve.iter().map(|point| point.w))
            .collect();

        self.queue
            .write_buffer(&self.widths.buffer, 0, bytemuck::cast_slice(&widths));

        // Prepare color data (HSLA)
        let colors: Vec<f32> = curves
            .points
            .iter()
            .flat_map(|curve| {
                curve
                    .iter()
                    .flat_map(|point| vec![point.h, point.s, point.l, point.a])
            })
            .collect();

        self.queue
            .write_buffer(&self.colors.buffer, 0, bytemuck::cast_slice(&colors));

        // Prepare attributes data
        let attrs: Vec<f32> = curves
            .points
            .iter()
            .flat_map(|curve| curve.iter().flat_map(|point| point.attrs.to_vec()))
            .collect();

        self.queue
            .write_buffer(&self.attrs.buffer, 0, bytemuck::cast_slice(&attrs));

        // Update canvas dimensions
        let canvas_dims = [self.ctx.canvas.width as f32, self.ctx.canvas.height as f32];
        self.queue.write_buffer(
            &self.dimensions.buffer,
            0,
            bytemuck::cast_slice(&canvas_dims),
        );
    }

    /// Load curve data into GPU buffers
    pub fn load(&mut self, group: &AsemicGroup) {
        println!("loading curves");

        // Calculate total vertex count
        let total_vertex_count: usize = group.points.iter().map(|curve| curve.len()).sum();

        // Create vertex buffer
        let vertex_buffer = self.device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("vertex_buffer"),
            size: (total_vertex_count * 2 * std::mem::size_of::<f32>()) as u64,
            usage: BufferUsages::STORAGE | BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        // Create widths buffer
        let widths_buffer = self.device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("widths_buffer"),
            size: (total_vertex_count * std::mem::size_of::<f32>()) as u64,
            usage: BufferUsages::STORAGE | BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        // Create colors buffer (HSLA per vertex)
        let colors_buffer = self.device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("colors_buffer"),
            size: (total_vertex_count * 4 * std::mem::size_of::<f32>()) as u64,
            usage: BufferUsages::STORAGE | BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        // Create attributes buffer
        let attrs_buffer = self.device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("attrs_buffer"),
            size: (total_vertex_count * 4 * std::mem::size_of::<f32>()) as u64,
            usage: BufferUsages::STORAGE | BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        // Load indices from implementation
        let indices = self.impl_.load_index(group);

        // Create index buffer
        let index_buffer = self
            .device
            .create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some("index_buffer"),
                contents: bytemuck::cast_slice(&indices),
                usage: BufferUsages::INDEX | BufferUsages::COPY_DST,
            });

        // Calculate curve starts
        let mut curve_starts = Vec::with_capacity(group.points.len() + 1);
        let mut total = 0u32;
        for curve in &group.points {
            curve_starts.push(total);
            total += curve.len() as u32;
        }
        curve_starts.push(total);

        // Create curve starts buffer
        let curve_starts_buffer =
            self.device
                .create_buffer_init(&wgpu::util::BufferInitDescriptor {
                    label: Some("curve_starts_buffer"),
                    contents: bytemuck::cast_slice(&curve_starts),
                    usage: BufferUsages::STORAGE | BufferUsages::COPY_DST,
                });

        // Create dimensions buffer
        let dimensions_buffer = self.device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("dimensions_buffer"),
            size: (2 * std::mem::size_of::<f32>()) as u64,
            usage: BufferUsages::UNIFORM | BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        // Create time buffer
        let time_buffer = self.device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("time_buffer"),
            size: std::mem::size_of::<f32>() as u64,
            usage: BufferUsages::UNIFORM | BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        // Create scrub buffer
        let scrub_buffer = self.device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("scrub_buffer"),
            size: (2 * std::mem::size_of::<f32>()) as u64,
            usage: BufferUsages::UNIFORM | BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        // Create bind group layout
        let bind_group_layout =
            self.device
                .create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                    label: Some("brush_bind_group_layout"),
                    entries: &[
                        // Vertices (binding 0)
                        wgpu::BindGroupLayoutEntry {
                            binding: 0,
                            visibility: wgpu::ShaderStages::VERTEX,
                            ty: wgpu::BindingType::Buffer {
                                ty: wgpu::BufferBindingType::Storage { read_only: true },
                                has_dynamic_offset: false,
                                min_binding_size: None,
                            },
                            count: None,
                        },
                        // Widths (binding 1)
                        wgpu::BindGroupLayoutEntry {
                            binding: 1,
                            visibility: wgpu::ShaderStages::VERTEX,
                            ty: wgpu::BindingType::Buffer {
                                ty: wgpu::BufferBindingType::Storage { read_only: true },
                                has_dynamic_offset: false,
                                min_binding_size: None,
                            },
                            count: None,
                        },
                        // Dimensions (binding 2)
                        wgpu::BindGroupLayoutEntry {
                            binding: 2,
                            visibility: wgpu::ShaderStages::VERTEX | wgpu::ShaderStages::FRAGMENT,
                            ty: wgpu::BindingType::Buffer {
                                ty: wgpu::BufferBindingType::Uniform,
                                has_dynamic_offset: false,
                                min_binding_size: None,
                            },
                            count: None,
                        },
                        // Curve starts (binding 3)
                        wgpu::BindGroupLayoutEntry {
                            binding: 3,
                            visibility: wgpu::ShaderStages::VERTEX,
                            ty: wgpu::BindingType::Buffer {
                                ty: wgpu::BufferBindingType::Storage { read_only: true },
                                has_dynamic_offset: false,
                                min_binding_size: None,
                            },
                            count: None,
                        },
                        // Colors (binding 4)
                        wgpu::BindGroupLayoutEntry {
                            binding: 4,
                            visibility: wgpu::ShaderStages::VERTEX,
                            ty: wgpu::BindingType::Buffer {
                                ty: wgpu::BufferBindingType::Storage { read_only: true },
                                has_dynamic_offset: false,
                                min_binding_size: None,
                            },
                            count: None,
                        },
                        // Time (binding 5)
                        wgpu::BindGroupLayoutEntry {
                            binding: 5,
                            visibility: wgpu::ShaderStages::VERTEX | wgpu::ShaderStages::FRAGMENT,
                            ty: wgpu::BindingType::Buffer {
                                ty: wgpu::BufferBindingType::Uniform,
                                has_dynamic_offset: false,
                                min_binding_size: None,
                            },
                            count: None,
                        },
                        // Scrub (binding 6)
                        wgpu::BindGroupLayoutEntry {
                            binding: 6,
                            visibility: wgpu::ShaderStages::VERTEX | wgpu::ShaderStages::FRAGMENT,
                            ty: wgpu::BindingType::Buffer {
                                ty: wgpu::BufferBindingType::Uniform,
                                has_dynamic_offset: false,
                                min_binding_size: None,
                            },
                            count: None,
                        },
                        // Attributes (binding 7)
                        wgpu::BindGroupLayoutEntry {
                            binding: 7,
                            visibility: wgpu::ShaderStages::VERTEX,
                            ty: wgpu::BindingType::Buffer {
                                ty: wgpu::BufferBindingType::Storage { read_only: true },
                                has_dynamic_offset: false,
                                min_binding_size: None,
                            },
                            count: None,
                        },
                    ],
                });

        // Create bind group
        let bind_group = self.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("brush_bind_group"),
            layout: &bind_group_layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: vertex_buffer.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: widths_buffer.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 2,
                    resource: dimensions_buffer.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 3,
                    resource: curve_starts_buffer.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 4,
                    resource: colors_buffer.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 5,
                    resource: time_buffer.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 6,
                    resource: scrub_buffer.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 7,
                    resource: attrs_buffer.as_entire_binding(),
                },
            ],
        });

        // Load pipeline from implementation
        let pipeline = self.impl_.load_pipeline(&self.device, &bind_group_layout);

        // Clean up old resources
        if let Some(old_index) = self.index.take() {
            // wgpu handles cleanup automatically
        }

        // Update instance state
        self.colors = BufferBinding {
            buffer: colors_buffer,
            size: total_vertex_count * 4,
        };
        self.attrs = BufferBinding {
            buffer: attrs_buffer,
            size: total_vertex_count * 4,
        };
        self.index = Some(IndexBinding {
            buffer: index_buffer,
            size: indices.len(),
        });
        self.dimensions = BufferBinding {
            buffer: dimensions_buffer,
            size: 2,
        };
        self.time = BufferBinding {
            buffer: time_buffer,
            size: 1,
        };
        self.scrub = BufferBinding {
            buffer: scrub_buffer,
            size: 2,
        };
        self.widths = BufferBinding {
            buffer: widths_buffer,
            size: total_vertex_count,
        };
        self.curve_starts = CurveStartsBinding {
            buffer: curve_starts_buffer,
            size: curve_starts.len(),
            array: curve_starts,
        };
        self.vertex = BufferBinding {
            buffer: vertex_buffer,
            size: total_vertex_count * 2,
        };

        self.pipeline = Some(pipeline);
        self.bind_group = Some(bind_group);
    }

    /// Render the curves
    pub fn render(
        &mut self,
        curves: &AsemicGroup,
        render_pass: &mut RenderPassEncoder,
        scene: &Scene,
    ) {
        // Early exit if no curves
        if curves.points.is_empty() || (curves.points.len() < 2 && curves.points[0].len() < 2) {
            return;
        }

        // Load or reload buffers if needed
        if self.vertex.buffer.size() == 0 {
            self.load(curves);
        } else if self.curve_starts.size != curves.points.len() + 1 {
            self.load(curves);
        } else {
            // Check if curve sizes have changed
            let mut total = 0u32;
            let mut needs_reload = false;
            for (i, curve) in curves.points.iter().enumerate() {
                if self.curve_starts.array[i] != total {
                    needs_reload = true;
                    break;
                }
                total += curve.len() as u32;
            }
            if needs_reload {
                self.load(curves);
            }
        }

        self.reload(curves);

        // Update time uniform
        let time = (std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs_f64()
            * 1000.0) as f32
            / 1000.0;
        self.queue
            .write_buffer(&self.time.buffer, 0, bytemuck::cast_slice(&[time]));

        // Update scrub uniform
        self.queue.write_buffer(
            &self.scrub.buffer,
            0,
            bytemuck::cast_slice(&[scene.scrub, scene.fade]),
        );

        // Set bind group and pipeline
        if let Some(ref bind_group) = self.bind_group {
            render_pass.set_bind_group(0, bind_group, &[]);
        }
        if let Some(ref pipeline) = self.pipeline {
            render_pass.set_pipeline(pipeline);
        }
        if let Some(ref index) = self.index {
            render_pass.set_index_buffer(index.buffer.slice(..), wgpu::IndexFormat::Uint32);
            render_pass.draw_indexed(0..index.size as u32, 0, 0..1);
        }
    }
}

// Helper extension to make Option handling easier
impl IndexBinding {
    fn take(&mut self) -> Option<IndexBinding> {
        // This would need manual implementation
        None
    }
}
