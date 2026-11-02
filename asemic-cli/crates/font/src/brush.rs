use std::collections::HashMap;
use std::sync::Arc;

use bytemuck::{NoUninit, Pod, Zeroable};
use glam::{Vec2, Vec4};
#[cfg(target_arch = "wasm32")]
use wasm_bindgen::prelude::*;
#[cfg(target_arch = "wasm32")]
use web_sys::{console, js_sys::Map, window};
use wgpu::Buffer;

use crate::font::{DrawGroup, MappedMut, assemble_params, brush_extra_layout, link_shader};

#[derive(Debug)]
pub struct Curves {
    pub vertices: Vec<Vec2>,
    pub curve_starts: Vec<u32>,
    pub widths: Vec<f32>,
    pub curve_lengths: Vec<u32>,
    pub total_instances: u32,
}

#[repr(C)]
#[derive(Copy, Clone, Pod, Zeroable)]
pub struct Uniforms {
    time: f32,
    aspect_ratio: f32,
    fade: f32,
    width: f32,
    custom: Vec4,
}

pub struct ParticleConfig {
    pub initial_positions: Vec<Vec2>,
    pub particle_shader: Option<String>,
    pub velocity_shader: Option<String>,
    pub acceleration_shader: Option<String>,
    pub position_shader: Option<String>,
    pub params: Option<HashMap<String, f32>>,
    pub readback_texture: Arc<wgpu::Texture>,
    pub readback_texture_view: Arc<wgpu::TextureView>,
}

impl Uniforms {
    pub fn new(time: f32, aspect_ratio: f32, fade: f32, width: f32, custom: Vec4) -> Self {
        Self {
            time,
            aspect_ratio,
            fade,
            width,
            custom,
        }
    }
}

pub struct DrawCommand {
    bind_group: wgpu::BindGroup,
    total_instances: u32,
    total_vertices: u32,
    index_buffer: Option<wgpu::Buffer>,
}

pub struct ParticleSystem {
    /// Compute pipeline for particle updates
    compute_pipeline: wgpu::ComputePipeline,
    /// Bind group for compute shader (particle data)
    compute_bind_group: wgpu::BindGroup,
    /// Base particle positions (uniform buffer, read-only in compute)
    particle_positions_buffer: wgpu::Buffer,
    /// Particle velocities/forces (storage buffer, read-write in compute)
    particle_velocities_buffer: wgpu::Buffer,
    /// Output particle positions after compute (storage buffer, read-write in compute)
    computed_positions_buffer: wgpu::Buffer,
    /// Shared readback texture (1024x1024) for sampling in compute shader
    readback_texture: Arc<wgpu::Texture>,
    /// Shared readback texture view for sampling
    readback_texture_view: Arc<wgpu::TextureView>,
    /// Sampler for the readback texture
    sampler: wgpu::Sampler,
    /// Number of particles
    particle_count: u32,
    /// Final positions buffer (storage buffer, read-write in compute)
    final_positions_buffer: wgpu::Buffer,
    /// Layout used to (re)build the compute bind group, kept around so the
    /// readback texture/view can be swapped out (e.g. on window resize)
    compute_bind_group_layout: wgpu::BindGroupLayout,
}

impl ParticleSystem {
    /// Copy a source texture to the readback texture (512x512)
    /// This is used to readback the canvas for particle sampling
    ///
    pub fn get_readback_texture_view(&self) -> &wgpu::TextureView {
        &self.readback_texture_view
    }

    /// Swap in a new readback texture/view (e.g. after the surface/render
    /// textures were recreated on resize) and rebuild the compute bind group
    /// so the particle compute shader and debug overlay stay in sync with
    /// what is actually being written to each frame.
    pub fn update_readback_texture(
        &mut self,
        device: &wgpu::Device,
        texture: Arc<wgpu::Texture>,
        view: Arc<wgpu::TextureView>,
        uniforms_buffer: &wgpu::Buffer,
    ) {
        self.readback_texture = texture;
        self.readback_texture_view = view;
        self.compute_bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("particle-compute-bind-group"),
            layout: &self.compute_bind_group_layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: self.particle_positions_buffer.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: self.particle_velocities_buffer.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 2,
                    resource: self.computed_positions_buffer.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 3,
                    resource: uniforms_buffer.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 4,
                    resource: wgpu::BindingResource::TextureView(&self.readback_texture_view),
                },
                wgpu::BindGroupEntry {
                    binding: 5,
                    resource: wgpu::BindingResource::Sampler(&self.sampler),
                },
                wgpu::BindGroupEntry {
                    binding: 6,
                    resource: self.final_positions_buffer.as_entire_binding(),
                },
            ],
        });
    }

    /// Rebuild only the compute pipeline (and its shader module) from new
    /// particle/velocity/acceleration/position shader snippets. All buffers
    /// (base positions, velocities, computed/final positions) and the
    /// compute bind group are left untouched, so live shader edits don't
    /// reset the particle simulation.
    pub fn update_shaders(
        &mut self,
        device: &wgpu::Device,
        particle_shader: Option<&str>,
        velocity_shader: Option<&str>,
        acceleration_shader: Option<&str>,
        position_shader: Option<&str>,
        params: Option<&HashMap<String, f32>>,
    ) {
        let formatted_shader = format!(
            "{}\n{}\n{}\n{}",
            assemble_params(params),
            include_str!("./shaders/particle_compute.wgsl"),
            include_str!("./shaders/shared_functions.wgsl"),
            format!(
                "
fn process_position (info: ModifierInfo) -> vec2<f32> {{
    {}
}}

fn process_velocity (info: ModifierInfo) -> vec2<f32> {{
    {}
}}
    
fn process_acceleration (info: ModifierInfo) -> vec2<f32> {{
    {}
}}
    
fn process_final_position (info: ModifierInfo) -> vec2<f32> {{
    {}
}}",
                particle_shader.unwrap_or("return info.position;"),
                velocity_shader.unwrap_or("return info.velocity;"),
                acceleration_shader.unwrap_or("return info.acceleration;"),
                position_shader.unwrap_or("return info.position;")
            )
        );

        let compute_shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("particle-compute-shader"),
            source: wgpu::ShaderSource::Wgsl(std::borrow::Cow::Owned(link_shader(formatted_shader))),
        });

        let compute_pipeline_layout =
            device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                label: Some("particle-compute-pipeline-layout"),
                bind_group_layouts: &[Some(&self.compute_bind_group_layout)],
                immediate_size: 0,
            });

        self.compute_pipeline = device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
            label: Some("particle-compute-pipeline"),
            layout: Some(&compute_pipeline_layout),
            module: &compute_shader,
            entry_point: Some("main"),
            compilation_options: wgpu::PipelineCompilationOptions::default(),
            cache: None,
        });
    }
}

pub struct WebGPUBrush {
    render_pipeline: wgpu::RenderPipeline,
    bind_group_layout: wgpu::BindGroupLayout,
    _uniforms: Uniforms,
    uniforms_buffer: wgpu::Buffer,
    particle_system: Option<ParticleSystem>,
    params: Option<HashMap<String, f32>>,
    /// GPU-resident vertex positions (array<vec2f>, STORAGE) bound at binding 0 in place of
    /// the CPU `Curves.vertices` upload; curves then only supply topology/instance counts.
    vertex_source: Option<wgpu::Buffer>,
}

#[derive(Debug, Clone)]
pub struct ShaderModifiers {
    pub width: Option<String>,
    pub alpha: Option<String>,
    pub brightness: Option<String>,
    pub position: Option<String>,
    pub particle: Option<String>,
}

impl WebGPUBrush {
    /// Bind an external GPU vertex buffer (e.g. a compute node's points) instead of uploading
    /// `Curves.vertices`; `None` restores the CPU path. Takes effect on next draw command.
    pub fn set_vertex_source(&mut self, buf: Option<wgpu::Buffer>) {
        self.vertex_source = buf;
    }

    /// Build the WGSL shader module for the main render pipeline, splicing in
    /// the user-provided modifier snippets (width/alpha/position/brightness).
    fn build_shader_module(
        modifiers: &ShaderModifiers,
        shader_desc: &str,
        params: Option<&HashMap<String, f32>>,
    ) -> String {
        format!(
            "{}\n{}\n{}
fn process_width(info: ModifierInfo) -> f32 {{ {} }}
fn process_alpha(info: ModifierInfo) -> f32 {{ {} }}
fn process_position(info: ModifierInfo) -> vec2<f32> {{ {} }}
fn process_brightness(info: ModifierInfo) -> f32 {{ {} }}
                {}",
            assemble_params(params),
            include_str!("./shaders/general.wgsl"),
            include_str!("./shaders/shared_functions.wgsl"),
            modifiers
                .width
                .clone()
                .unwrap_or_else(|| "return 1.0;".to_string()),
            modifiers
                .alpha
                .clone()
                .unwrap_or_else(|| "return 1.0;".to_string()),
            modifiers
                .position
                .clone()
                .unwrap_or_else(|| "return info.position;".to_string()),
            modifiers
                .brightness
                .clone()
                .unwrap_or_else(|| "return 1.0;".to_string()),
            shader_desc
        )
    }

    /// (Re)build the render pipeline for the given shader module + entries,
    /// reusing an existing bind group layout.
    fn build_render_pipeline(
        device: &wgpu::Device,
        format: wgpu::TextureFormat,
        sample_count: u32,
        bind_group_layout: &wgpu::BindGroupLayout,
        shader_mod: &wgpu::ShaderModule,
        vertex_entry: &str,
        fragment_entry: &str,
    ) -> wgpu::RenderPipeline {
        let extra = brush_extra_layout(device);
        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: None,
            bind_group_layouts: &[Some(bind_group_layout), extra.as_ref()][..1 + extra.is_some() as usize],
            immediate_size: 0,
        });
        device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: None,
            layout: Some(&pipeline_layout),
            primitive: wgpu::PrimitiveState::default(),
            depth_stencil: None,
            multisample: wgpu::MultisampleState {
                count: sample_count,
                mask: !0,
                alpha_to_coverage_enabled: false,
            },
            fragment: Some(wgpu::FragmentState {
                module: shader_mod,
                entry_point: Some(fragment_entry),
                targets: &[Some(wgpu::ColorTargetState {
                    format,
                    blend: Some(wgpu::BlendState::ALPHA_BLENDING),
                    write_mask: wgpu::ColorWrites::ALL,
                })],
                compilation_options: wgpu::PipelineCompilationOptions::default(),
            }),
            vertex: wgpu::VertexState {
                module: shader_mod,
                entry_point: Some(vertex_entry),
                buffers: &[],
                compilation_options: wgpu::PipelineCompilationOptions::default(),
            },
            multiview_mask: None,
            cache: None,
        })
    }

    pub fn new(
        device: &wgpu::Device,
        format: wgpu::TextureFormat,
        sample_count: u32,
        aspect_ratio: f32,
        modifiers: ShaderModifiers,
        shader_desc: &str,
        vertex_entry: &str,
        fragment_entry: &str,
        params: Option<HashMap<String, f32>>,
    ) -> Self {
        let shader_mod =
            device.create_shader_module(wgpu::ShaderModuleDescriptor {
                label: None,
                source: wgpu::ShaderSource::Wgsl(std::borrow::Cow::Owned(
                    link_shader(Self::build_shader_module(&modifiers, shader_desc, params.as_ref())),
                )),
            });

        let uniforms = Uniforms::new(0.0, aspect_ratio, 0.0, 1.0, Vec4::ZERO);
        let uniforms_bytes = uniforms_with_params_as_bytes(&uniforms, params.as_ref());

        let usage = wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST;
        let uniforms_buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("uniform-data-transfer"),
            size: uniforms_bytes.len() as u64,
            usage,
            mapped_at_creation: true,
        });
        uniforms_buffer
            .slice(..)
            .get_mapped_range_mut()
            .mapped()
            .copy_from_slice(&uniforms_bytes);
        uniforms_buffer.unmap();

        let bind_group_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: None,
            entries: &[
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
                wgpu::BindGroupLayoutEntry {
                    binding: 2,
                    visibility: wgpu::ShaderStages::VERTEX,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Storage { read_only: true },
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
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
                wgpu::BindGroupLayoutEntry {
                    binding: 4,
                    visibility: wgpu::ShaderStages::VERTEX | wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Uniform,
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
                // Optional particle positions buffer (binding 5)
                // Used if particle system is active, otherwise a dummy buffer is bound
                wgpu::BindGroupLayoutEntry {
                    binding: 5,
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

        let render_pipeline = Self::build_render_pipeline(
            device,
            format,
            sample_count,
            &bind_group_layout,
            &shader_mod,
            vertex_entry,
            fragment_entry,
        );

        Self {
            render_pipeline,
            bind_group_layout,
            _uniforms: uniforms,
            uniforms_buffer,
            particle_system: None,
            vertex_source: None,
            params,
        }
    }

    /// Rebuild just the render pipeline (and its shader module) from a new set
    /// of shader modifiers, reusing the existing bind group layout, uniforms
    /// buffer, and particle system so GPU-resident particle/position data
    /// survives a live shader reload.
    pub fn update_shader_pipeline(
        &mut self,
        device: &wgpu::Device,
        format: wgpu::TextureFormat,
        sample_count: u32,
        modifiers: ShaderModifiers,
        shader_desc: &str,
        vertex_entry: &str,
        fragment_entry: &str,
        params: Option<HashMap<String, f32>>,
    ) {
        if params.is_some() {
            self.params = params;
        }

        let shader_mod =
            device.create_shader_module(wgpu::ShaderModuleDescriptor {
                label: None,
                source: wgpu::ShaderSource::Wgsl(std::borrow::Cow::Owned(
                    link_shader(Self::build_shader_module(&modifiers, shader_desc, self.params.as_ref())),
                )),
            });

        self.render_pipeline = Self::build_render_pipeline(
            device,
            format,
            sample_count,
            &self.bind_group_layout,
            &shader_mod,
            vertex_entry,
            fragment_entry,
        );
    }

    pub fn bind_group_layout(&self) -> &wgpu::BindGroupLayout {
        &self.bind_group_layout
    }

    pub fn uniforms_buffer(&self) -> &wgpu::Buffer {
        &self.uniforms_buffer
    }

    pub fn update_uniforms(&mut self, queue: &wgpu::Queue, uniforms: Uniforms) {
        self._uniforms = uniforms;
        let uniforms_bytes = uniforms_with_params_as_bytes(&self._uniforms, self.params.as_ref());
        queue.write_buffer(&self.uniforms_buffer, 0, &uniforms_bytes);
    }

    pub fn update_params(&mut self, queue: &wgpu::Queue, params: HashMap<String, f32>) {
        self.params = Some(params);
        let uniforms_bytes = uniforms_with_params_as_bytes(&self._uniforms, self.params.as_ref());
        queue.write_buffer(&self.uniforms_buffer, 0, &uniforms_bytes);
    }

    pub fn render_draw_command<'a>(
        &'a self,
        render_pass: &mut wgpu::RenderPass<'a>,
        draw_command: &'a DrawCommand,
    ) {
        render_pass.set_bind_group(0, &draw_command.bind_group, &[]);
        render_pass.set_pipeline(&self.render_pipeline);
        if let Some(index_buffer) = &draw_command.index_buffer {
            render_pass.set_index_buffer(index_buffer.slice(..), wgpu::IndexFormat::Uint32);
            render_pass.draw_indexed(
                0..draw_command.total_vertices,
                0,
                0..draw_command.total_instances,
            );
        } else {
            render_pass.draw(
                0..draw_command.total_vertices,
                0..draw_command.total_instances,
            );
        }
    }
}

pub struct CurveBrush {
    base: WebGPUBrush,
    draw_command: Option<DrawCommand>,
    params: Option<HashMap<String, f32>>,
}

pub struct LineBrush {
    base: WebGPUBrush,
    draw_command: Option<DrawCommand>,
    params: Option<HashMap<String, f32>>,
}

pub trait Drawable {
    fn base(&mut self) -> &mut WebGPUBrush;
    fn base_ref(&self) -> &WebGPUBrush;
    fn draw_command(&self) -> Option<&DrawCommand>;
    fn create_draw_command(&mut self, device: &wgpu::Device, curves: &Curves);
    /// The (wgsl source, vertex entry point, fragment entry point) used to
    /// build this brush's render pipeline. Used by `update_shaders` to
    /// rebuild the pipeline in place on live shader reload.
    fn shader_source(&self) -> (&'static str, &'static str, &'static str);
    fn update_uniforms(&mut self, queue: &wgpu::Queue, uniforms: Uniforms) {
        self.base().update_uniforms(queue, uniforms);
    }
    fn update_params(&mut self, queue: &wgpu::Queue, params: HashMap<String, f32>) {
        self.base().update_params(queue, params);
    }

    /// Rebuild the render pipeline using new shader modifier snippets,
    /// without touching any existing GPU buffers (draw command, particle
    /// positions/velocities). This is the live-reload path: it updates what
    /// the shaders *do* while preserving all particle/position data.
    fn update_shaders(
        &mut self,
        device: &wgpu::Device,
        format: wgpu::TextureFormat,
        sample_count: u32,
        modifiers: ShaderModifiers,
        params: Option<HashMap<String, f32>>,
    ) {
        let (shader_desc, vertex_entry, fragment_entry) = self.shader_source();
        self.base().update_shader_pipeline(
            device,
            format,
            sample_count,
            modifiers,
            shader_desc,
            vertex_entry,
            fragment_entry,
            params,
        );
    }

    /// Rebuild only the particle compute pipeline (if a particle system
    /// exists) using new particle/velocity/acceleration/position shader
    /// snippets, leaving every particle buffer untouched so the running
    /// simulation's position/velocity data survives the reload.
    fn update_particle_shaders(
        &mut self,
        device: &wgpu::Device,
        particle_shader: Option<&str>,
        velocity_shader: Option<&str>,
        acceleration_shader: Option<&str>,
        position_shader: Option<&str>,
        params: Option<&HashMap<String, f32>>,
    ) {
        if let Some(ps) = self.base().particle_system.as_mut() {
            ps.update_shaders(
                device,
                particle_shader,
                velocity_shader,
                acceleration_shader,
                position_shader,
                params,
            );
        }
    }
    fn render<'a>(&'a self, render_pass: &mut wgpu::RenderPass<'a>) {
        if let Some(draw_command) = self.draw_command() {
            self.base_ref()
                .render_draw_command(render_pass, draw_command);
        }
    }

    fn get_uniforms(&self) -> &wgpu::Buffer {
        self.base_ref().uniforms_buffer()
    }

    //     fn assemble_params(&self) -> String {
    //         let mut params_str = String::new();
    //         params_str.push_str(
    //             "
    // ",
    //         );
    //         if let Some(ps) = &self.get_params() {
    //             for (name, value) in self.get_params().unwrap() {
    //                 params_str.push_str(&format!("  {}: f32,\n", name));
    //             }
    //         }
    //         params_str.push_str("}\n");
    //         params_str
    //     }

    fn initialize_particles(&mut self, device: &wgpu::Device, particles: &ParticleConfig) {
        let particle_count = particles.initial_positions.len() as u32;

        // Create particle position buffer (uniform - base positions)
        let positions_bytes = vertices_as_bytes(&particles.initial_positions);
        let particle_positions_buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("particle-base-positions"),
            size: positions_bytes.len() as u64,
            usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: true,
        });
        particle_positions_buffer
            .slice(..)
            .get_mapped_range_mut()
            .mapped()
            .copy_from_slice(positions_bytes);
        particle_positions_buffer.unmap();

        // Create velocity buffer (storage - initialized to zero)
        let velocities = vec![Vec2::ZERO; particles.initial_positions.len()];
        let velocities_bytes = vertices_as_bytes(&velocities);
        let particle_velocities_buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("particle-velocities"),
            size: velocities_bytes.len() as u64,
            usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: true,
        });
        particle_velocities_buffer
            .slice(..)
            .get_mapped_range_mut()
            .mapped()
            .copy_from_slice(velocities_bytes);
        particle_velocities_buffer.unmap();

        // Create computed positions buffer (storage - will hold base_pos + velocity)
        let computed_positions_buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("particle-computed-positions"),
            size: positions_bytes.len() as u64,
            usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_SRC,
            mapped_at_creation: false,
        });

        let final_positions_buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("particle-final-positions"),
            size: positions_bytes.len() as u64,
            usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_SRC,
            mapped_at_creation: false,
        });

        // Use the shared readback texture and view from particles config
        let readback_texture = particles.readback_texture.clone();
        let readback_texture_view = particles.readback_texture_view.clone();

        // Create sampler for texture sampling in compute shader
        let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("particle-readback-sampler"),
            address_mode_u: wgpu::AddressMode::Repeat,
            address_mode_v: wgpu::AddressMode::Repeat,
            address_mode_w: wgpu::AddressMode::Repeat,
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            mipmap_filter: wgpu::MipmapFilterMode::Nearest,
            lod_min_clamp: 0.0,
            lod_max_clamp: 100.0,
            compare: None,
            anisotropy_clamp: 1,
            border_color: None,
        });

        let formatted_shader = format!(
            "{}\n{}\n{}\n{}",
            assemble_params(particles.params.as_ref()),
            include_str!("./shaders/particle_compute.wgsl"),
            include_str!("./shaders/shared_functions.wgsl"),
            format!(
                "
fn process_position (info: ModifierInfo) -> vec2<f32> {{
    {}
}}

fn process_velocity (info: ModifierInfo) -> vec2<f32> {{
    {}
}}
    
fn process_acceleration (info: ModifierInfo) -> vec2<f32> {{
    {}
}}
    
fn process_final_position (info: ModifierInfo) -> vec2<f32> {{
    {}
}}",
                particles
                    .particle_shader
                    .as_deref()
                    .unwrap_or("return info.position;"),
                particles
                    .velocity_shader
                    .as_deref()
                    .unwrap_or("return info.velocity;"),
                particles
                    .acceleration_shader
                    .as_deref()
                    .unwrap_or("return info.acceleration;"),
                particles
                    .position_shader
                    .as_deref()
                    .unwrap_or("return info.position;")
            )
        );

        // Create compute shader
        let compute_shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("particle-compute-shader"),
            source: wgpu::ShaderSource::Wgsl(std::borrow::Cow::Owned(link_shader(formatted_shader))),
        });

        // Create compute bind group layout
        let compute_bind_group_layout =
            device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                label: Some("particle-compute-bind-group-layout"),
                entries: &[
                    // Base positions (uniform, read-only)
                    wgpu::BindGroupLayoutEntry {
                        binding: 0,
                        visibility: wgpu::ShaderStages::COMPUTE,
                        ty: wgpu::BindingType::Buffer {
                            ty: wgpu::BufferBindingType::Storage { read_only: true },
                            has_dynamic_offset: false,
                            min_binding_size: None,
                        },
                        count: None,
                    },
                    // Velocities (storage, read-write)
                    wgpu::BindGroupLayoutEntry {
                        binding: 1,
                        visibility: wgpu::ShaderStages::COMPUTE,
                        ty: wgpu::BindingType::Buffer {
                            ty: wgpu::BufferBindingType::Storage { read_only: false },
                            has_dynamic_offset: false,
                            min_binding_size: None,
                        },
                        count: None,
                    },
                    // Computed positions (storage, read-write)
                    wgpu::BindGroupLayoutEntry {
                        binding: 2,
                        visibility: wgpu::ShaderStages::COMPUTE,
                        ty: wgpu::BindingType::Buffer {
                            ty: wgpu::BufferBindingType::Storage { read_only: false },
                            has_dynamic_offset: false,
                            min_binding_size: None,
                        },
                        count: None,
                    },
                    // Uniforms (time, etc.)
                    wgpu::BindGroupLayoutEntry {
                        binding: 3,
                        visibility: wgpu::ShaderStages::COMPUTE,
                        ty: wgpu::BindingType::Buffer {
                            ty: wgpu::BufferBindingType::Uniform,
                            has_dynamic_offset: false,
                            min_binding_size: None,
                        },
                        count: None,
                    },
                    // Readback texture (sampled)
                    wgpu::BindGroupLayoutEntry {
                        binding: 4,
                        visibility: wgpu::ShaderStages::COMPUTE,
                        ty: wgpu::BindingType::Texture {
                            sample_type: wgpu::TextureSampleType::Float { filterable: true },
                            view_dimension: wgpu::TextureViewDimension::D2,
                            multisampled: false,
                        },
                        count: None,
                    },
                    // Sampler for readback texture
                    wgpu::BindGroupLayoutEntry {
                        binding: 5,
                        visibility: wgpu::ShaderStages::COMPUTE,
                        ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                        count: None,
                    },
                    // readback processed positions
                    wgpu::BindGroupLayoutEntry {
                        binding: 6,
                        visibility: wgpu::ShaderStages::COMPUTE,
                        ty: wgpu::BindingType::Buffer {
                            ty: wgpu::BufferBindingType::Storage { read_only: false },
                            has_dynamic_offset: false,
                            min_binding_size: None,
                        },
                        count: None,
                    },
                ],
            });

        // Create compute bind group
        let compute_bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("particle-compute-bind-group"),
            layout: &compute_bind_group_layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: particle_positions_buffer.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: particle_velocities_buffer.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 2,
                    resource: computed_positions_buffer.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 3,
                    resource: self.get_uniforms().as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 4,
                    resource: wgpu::BindingResource::TextureView(&readback_texture_view),
                },
                wgpu::BindGroupEntry {
                    binding: 5,
                    resource: wgpu::BindingResource::Sampler(&sampler),
                },
                wgpu::BindGroupEntry {
                    binding: 6,
                    resource: final_positions_buffer.as_entire_binding(),
                },
            ],
        });

        // Create compute pipeline
        let compute_pipeline_layout =
            device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                label: Some("particle-compute-pipeline-layout"),
                bind_group_layouts: &[Some(&compute_bind_group_layout)],
                immediate_size: 0,
            });

        let compute_pipeline = device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
            label: Some("particle-compute-pipeline"),
            layout: Some(&compute_pipeline_layout),
            module: &compute_shader,
            entry_point: Some("main"),
            compilation_options: wgpu::PipelineCompilationOptions::default(),
            cache: None,
        });

        self.set_particle_system(ParticleSystem {
            compute_pipeline,
            compute_bind_group,
            particle_positions_buffer,
            particle_velocities_buffer,
            computed_positions_buffer,
            readback_texture,
            readback_texture_view,
            sampler,
            final_positions_buffer,
            particle_count,
            compute_bind_group_layout,
        });
    }

    fn get_particle_system(&self) -> Option<&ParticleSystem>;

    /// Point the particle system's readback texture/view at a new GPU
    /// texture (e.g. after `previous_texture` was recreated on resize) and
    /// rebuild its compute bind group so future frames sample the correct
    /// texture instead of a stale, disconnected one.
    fn update_particle_readback_texture(
        &mut self,
        device: &wgpu::Device,
        texture: Arc<wgpu::Texture>,
        view: Arc<wgpu::TextureView>,
    ) {
        let uniforms_buffer = self.base_ref().uniforms_buffer().clone();
        if let Some(ps) = self.base().particle_system.as_mut() {
            ps.update_readback_texture(device, texture, view, &uniforms_buffer);
        }
    }

    /// Run particle compute shader. Call this before rendering.
    /// Pass in a command encoder that will be used for the compute pass.
    /// Returns true if particles were computed, false if no particle system exists.
    fn compute_particles(
        &self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        readback: bool,
    ) -> Option<Buffer> {
        if let Some(ps) = &self.get_particle_system() {
            let mut encoder = device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("compute encoder"),
            });

            let mut compute_pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
                label: Some("particle-compute-pass"),
                timestamp_writes: None,
            });

            compute_pass.set_pipeline(&ps.compute_pipeline);
            compute_pass.set_bind_group(0, &ps.compute_bind_group, &[]);

            let workgroup_count = (ps.particle_count + 255) / 256; // 256 threads per workgroup
            compute_pass.dispatch_workgroups(workgroup_count, 1, 1);
            drop(compute_pass);
            // Now that the buffer write is complete, we can map and read it

            if readback {
                let readback_buffer = device.create_buffer(&wgpu::BufferDescriptor {
                    label: Some("particle-positions-readback"),
                    size: ps.final_positions_buffer.size(),
                    usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
                    mapped_at_creation: false,
                });

                encoder.copy_buffer_to_buffer(
                    &ps.final_positions_buffer,
                    0,
                    &readback_buffer,
                    0,
                    ps.final_positions_buffer.size(),
                );

                queue.submit(Some(encoder.finish()));

                return Some(readback_buffer);
            } else {
                queue.submit(Some(encoder.finish()));
                None
            }
        } else {
            None
        }
    }

    fn set_particle_system(&mut self, particle_system: ParticleSystem) {
        self.base().particle_system = Some(particle_system);
    }
}

impl LineBrush {
    pub fn new(
        device: &wgpu::Device,
        format: wgpu::TextureFormat,
        sample_count: u32,
        aspect_ratio: f32,
        modifiers: ShaderModifiers,
        params: Option<HashMap<String, f32>>,
    ) -> Self {
        let base = WebGPUBrush::new(
            device,
            format,
            sample_count,
            aspect_ratio,
            modifiers,
            include_str!("./shaders/line.wgsl"),
            "main",
            "mainFrag",
            params,
        );

        Self {
            base,
            draw_command: None,
            params: None,
        }
    }
}

impl Drawable for LineBrush {
    fn shader_source(&self) -> (&'static str, &'static str, &'static str) {
        (include_str!("./shaders/line.wgsl"), "main", "mainFrag")
    }

    fn base_ref(&self) -> &WebGPUBrush {
        &self.base
    }

    fn base(&mut self) -> &mut WebGPUBrush {
        &mut self.base
    }

    fn draw_command(&self) -> Option<&DrawCommand> {
        self.draw_command.as_ref()
    }

    fn get_particle_system(&self) -> Option<&ParticleSystem> {
        self.base.particle_system.as_ref()
    }

    fn create_draw_command(&mut self, device: &wgpu::Device, curves: &Curves) {
        // Validate that we have data before attempting to create buffers
        if curves.vertices.is_empty()
            || curves.widths.is_empty()
            || curves.curve_starts.is_empty()
            || curves.curve_lengths.is_empty()
            || curves.total_instances == 0
        {
            self.draw_command = None;
            return;
        }

        let shared_data = create_shared_draw_data(&self.base, device, &curves);

        let mut indices = Vec::new();
        let mut skipped_indices = 0;
        let mut last_skipped_curve = 0;
        for instance in 0..curves.total_instances {
            if instance + 2 > curves.curve_lengths[last_skipped_curve] {
                skipped_indices += 1;
                last_skipped_curve += 1;
                continue;
            }
            let base_index = instance * 6;
            indices.extend_from_slice(&[
                base_index,
                base_index + 1,
                base_index + 2,
                base_index + 3,
                base_index + 4,
                base_index + 5,
            ]);
        }

        // Only create draw command if we have indices
        if indices.is_empty() {
            self.draw_command = None;
            return;
        }

        let indices_bytes = u32_as_bytes(&indices);
        let index_buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: None,
            size: indices_bytes.len() as u64,
            usage: wgpu::BufferUsages::INDEX,
            mapped_at_creation: true,
        });
        index_buffer
            .slice(..)
            .get_mapped_range_mut()
            .mapped()
            .copy_from_slice(indices_bytes);
        index_buffer.unmap();

        // let test_index_buffer =
        self.draw_command = Some(DrawCommand {
            bind_group: shared_data.bind_group,
            total_vertices: shared_data.vertices_len - skipped_indices * 6,
            total_instances: 1,
            index_buffer: Some(index_buffer),
        });
    }
}

impl CurveBrush {
    pub fn new(
        device: &wgpu::Device,
        format: wgpu::TextureFormat,
        sample_count: u32,
        aspect_ratio: f32,
        modifiers: ShaderModifiers,
        params: Option<HashMap<String, f32>>,
    ) -> Self {
        let base = WebGPUBrush::new(
            device,
            format,
            sample_count,
            aspect_ratio,
            modifiers,
            include_str!("./shaders/curve.wgsl"),
            "main",
            "mainFrag",
            params.clone(),
        );

        Self {
            base,
            draw_command: None,
            params,
        }
    }
}

impl Drawable for CurveBrush {
    fn shader_source(&self) -> (&'static str, &'static str, &'static str) {
        (include_str!("./shaders/curve.wgsl"), "main", "mainFrag")
    }

    fn get_particle_system(&self) -> Option<&ParticleSystem> {
        self.base.particle_system.as_ref()
    }

    fn base_ref(&self) -> &WebGPUBrush {
        &self.base
    }

    fn base(&mut self) -> &mut WebGPUBrush {
        &mut self.base
    }

    fn draw_command(&self) -> Option<&DrawCommand> {
        self.draw_command.as_ref()
    }

    fn create_draw_command(&mut self, device: &wgpu::Device, curves: &Curves) {
        // Validate that we have data before attempting to create buffers
        if curves.vertices.is_empty()
            || curves.widths.is_empty()
            || curves.curve_starts.is_empty()
            || curves.curve_lengths.is_empty()
            || curves.total_instances == 0
        {
            self.draw_command = None;
            return;
        }

        let shared_data = create_shared_draw_data(&self.base, device, &curves);

        self.draw_command = Some(DrawCommand {
            bind_group: shared_data.bind_group,
            total_instances: curves.total_instances,
            total_vertices: 6 as u32,
            index_buffer: None,
        })
    }
}

impl std::ops::Deref for CurveBrush {
    type Target = WebGPUBrush;

    fn deref(&self) -> &Self::Target {
        &self.base
    }
}

impl std::ops::DerefMut for CurveBrush {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.base
    }
}

pub struct DotBrush {
    base: WebGPUBrush,
    draw_command: Option<DrawCommand>,
    params: Option<HashMap<String, f32>>,
}

impl DotBrush {
    pub fn new(
        device: &wgpu::Device,
        format: wgpu::TextureFormat,
        sample_count: u32,
        aspect_ratio: f32,
        modifiers: ShaderModifiers,
        params: Option<HashMap<String, f32>>,
    ) -> Self {
        let base = WebGPUBrush::new(
            device,
            format,
            sample_count,
            aspect_ratio,
            modifiers,
            include_str!("./shaders/dot.wgsl"),
            "main",
            "mainFrag",
            params.clone(),
        );

        Self {
            base,
            draw_command: None,
            params,
        }
    }
}

impl Drawable for DotBrush {
    fn shader_source(&self) -> (&'static str, &'static str, &'static str) {
        (include_str!("./shaders/dot.wgsl"), "main", "mainFrag")
    }

    fn get_particle_system(&self) -> Option<&ParticleSystem> {
        self.base.particle_system.as_ref()
    }

    fn base_ref(&self) -> &WebGPUBrush {
        &self.base
    }

    fn base(&mut self) -> &mut WebGPUBrush {
        &mut self.base
    }

    fn draw_command(&self) -> Option<&DrawCommand> {
        self.draw_command.as_ref()
    }

    fn create_draw_command(&mut self, device: &wgpu::Device, curves: &Curves) {
        // Validate that we have data before attempting to create buffers
        if curves.vertices.is_empty() {
            self.draw_command = None;
            return;
        }

        let shared_data = create_shared_draw_data(&self.base, device, &curves);

        // For DotBrush, each vertex becomes one instance (one square)
        self.draw_command = Some(DrawCommand {
            bind_group: shared_data.bind_group,
            total_instances: curves.vertices.len() as u32,
            total_vertices: 6,
            index_buffer: None,
        })
    }
}

impl std::ops::Deref for DotBrush {
    type Target = WebGPUBrush;

    fn deref(&self) -> &Self::Target {
        &self.base
    }
}

impl std::ops::DerefMut for DotBrush {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.base
    }
}

fn vertices_as_bytes(data: &Vec<Vec2>) -> &[u8] {
    bytemuck::cast_slice(data)
}

fn floats_as_bytes(data: &[f32]) -> &[u8] {
    bytemuck::cast_slice(data)
}

fn u32_as_bytes(data: &[u32]) -> &[u8] {
    bytemuck::cast_slice(data)
}

fn uniforms_with_params_as_bytes(
    uniforms: &Uniforms,
    params: Option<&HashMap<String, f32>>,
) -> Vec<u8> {
    let mut buffer = Vec::new();
    // Add uniforms data
    buffer.extend_from_slice(bytemuck::cast_slice(std::slice::from_ref(uniforms)));
    // Add params data. Must match the field order used in `assemble_params`
    // (sorted by name), since that's the order the WGSL struct fields are
    // declared in.
    if let Some(params) = params {
        let mut sorted_params: Vec<_> = params.iter().collect();
        sorted_params.sort_by_key(|(name, _)| *name);
        for (_, value) in sorted_params {
            buffer.extend_from_slice(bytemuck::cast_slice(std::slice::from_ref(value)));
        }
    }
    // Pad buffer to next multiple of 16 bytes (WGPU uniform buffer requirement)
    let remainder = buffer.len() % 16;
    if remainder != 0 {
        buffer.resize(buffer.len() + (16 - remainder), 0);
    }
    buffer
}

struct SharedDrawData {
    bind_group: wgpu::BindGroup,
    vertices_len: u32,
    // Store buffers to keep them alive
    _vertex_buffer: wgpu::Buffer,
    _widths_buffer: wgpu::Buffer,
    _curve_starts_buffer: wgpu::Buffer,
    _curve_lengths_buffer: wgpu::Buffer,
}

fn create_shared_draw_data(
    base: &WebGPUBrush,
    device: &wgpu::Device,
    curves: &Curves,
) -> SharedDrawData {
    let vertices_bytes = vertices_as_bytes(&curves.vertices);
    let usage = wgpu::BufferUsages::STORAGE;
    let vertex_buffer = device.create_buffer(&wgpu::BufferDescriptor {
        label: None,
        size: vertices_bytes.len() as u64,
        usage,
        mapped_at_creation: true,
    });
    vertex_buffer
        .slice(..)
        .get_mapped_range_mut()
        .mapped()
        .copy_from_slice(vertices_bytes);
    vertex_buffer.unmap();

    let widths_bytes = floats_as_bytes(&curves.widths);
    let widths_buffer = device.create_buffer(&wgpu::BufferDescriptor {
        label: None,
        size: widths_bytes.len() as u64,
        usage,
        mapped_at_creation: true,
    });
    widths_buffer
        .slice(..)
        .get_mapped_range_mut()
        .mapped()
        .copy_from_slice(widths_bytes);
    widths_buffer.unmap();

    let curve_starts_bytes = u32_as_bytes(&curves.curve_starts);
    let curve_starts_buffer = device.create_buffer(&wgpu::BufferDescriptor {
        label: None,
        size: curve_starts_bytes.len() as u64,
        usage,
        mapped_at_creation: true,
    });
    curve_starts_buffer
        .slice(..)
        .get_mapped_range_mut()
        .mapped()
        .copy_from_slice(curve_starts_bytes);
    curve_starts_buffer.unmap();

    let curve_lengths_bytes = u32_as_bytes(&curves.curve_lengths);
    let curve_lengths_buffer = device.create_buffer(&wgpu::BufferDescriptor {
        label: None,
        size: curve_lengths_bytes.len() as u64,
        usage,
        mapped_at_creation: true,
    });
    curve_lengths_buffer
        .slice(..)
        .get_mapped_range_mut()
        .mapped()
        .copy_from_slice(curve_lengths_bytes);
    curve_lengths_buffer.unmap();

    // For binding 5 (computed positions), use particle system buffer if available,
    // otherwise use the vertex buffer as a placeholder (won't be used in shader)
    let particle_positions_ref = if let Some(ps) = &base.particle_system {
        &ps.computed_positions_buffer
    } else {
        &vertex_buffer
    };

    let bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
        label: None,
        layout: base.bind_group_layout(),
        entries: &[
            wgpu::BindGroupEntry {
                binding: 0,
                resource: base.vertex_source.as_ref().unwrap_or(&vertex_buffer).as_entire_binding(),
            },
            wgpu::BindGroupEntry {
                binding: 1,
                resource: widths_buffer.as_entire_binding(),
            },
            wgpu::BindGroupEntry {
                binding: 2,
                resource: curve_starts_buffer.as_entire_binding(),
            },
            wgpu::BindGroupEntry {
                binding: 3,
                resource: curve_lengths_buffer.as_entire_binding(),
            },
            wgpu::BindGroupEntry {
                binding: 4,
                resource: base.uniforms_buffer().as_entire_binding(),
            },
            wgpu::BindGroupEntry {
                binding: 5,
                resource: particle_positions_ref.as_entire_binding(),
            },
        ],
    });

    SharedDrawData {
        bind_group,
        vertices_len: curves.total_instances * 6,
        _vertex_buffer: vertex_buffer,
        _widths_buffer: widths_buffer,
        _curve_starts_buffer: curve_starts_buffer,
        _curve_lengths_buffer: curve_lengths_buffer,
    }
}
