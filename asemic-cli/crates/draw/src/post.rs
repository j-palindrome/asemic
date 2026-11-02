//! Postprocess: asemic-repl's live postprocess (11.7.5), vendored as `shaders/main.wgsl`
//! (was `#[path]`-compiled from ../ipad-drawing, retired). postprocess.wesl stayed behind.
//! scene + previous frame -> output, then output -> previous = feedback trails.

pub struct Post {
    pub scene: wgpu::Texture,
    prev: wgpu::Texture,
    pipeline: wgpu::RenderPipeline,
    bind: wgpu::BindGroup,
}

impl Post {
    pub fn new(device: &wgpu::Device, queue: &wgpu::Queue, w: u32, h: u32) -> Self {
        let (scene, prev) = (crate::target(device, w, h), crate::target(device, w, h));
        crate::clear(device, queue, &prev, wgpu::Color::BLACK);
        let module = device.create_shader_module(wgpu::include_wgsl!("shaders/main.wgsl"));
        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("asemic post"),
            layout: None, // derived from main.wgsl bindings
            vertex: wgpu::VertexState { module: &module, entry_point: Some("vs_main"), buffers: &[], compilation_options: Default::default() },
            fragment: Some(wgpu::FragmentState {
                module: &module,
                entry_point: Some("fs_main"),
                targets: &[Some(wgpu::ColorTargetState { format: crate::FORMAT, blend: Some(wgpu::BlendState::REPLACE), write_mask: wgpu::ColorWrites::ALL })],
                compilation_options: Default::default(),
            }),
            primitive: Default::default(),
            depth_stencil: None,
            multisample: Default::default(),
            multiview_mask: None,
            cache: None,
        });
        let viewport = wgpu::util::DeviceExt::create_buffer_init(device, &wgpu::util::BufferInitDescriptor {
            label: Some("viewport"),
            contents: &[(w as f32).to_le_bytes(), (h as f32).to_le_bytes()].concat(),
            usage: wgpu::BufferUsages::UNIFORM,
        });
        let sampler = crate::linear_sampler(device);
        let view = |t: &wgpu::Texture| t.create_view(&Default::default());
        let (sv, pv) = (view(&scene), view(&prev));
        let bind = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("asemic post"),
            layout: &pipeline.get_bind_group_layout(0),
            entries: &[
                wgpu::BindGroupEntry { binding: 0, resource: wgpu::BindingResource::TextureView(&sv) },
                wgpu::BindGroupEntry { binding: 1, resource: wgpu::BindingResource::Sampler(&sampler) },
                wgpu::BindGroupEntry { binding: 2, resource: wgpu::BindingResource::TextureView(&pv) },
                wgpu::BindGroupEntry { binding: 3, resource: viewport.as_entire_binding() },
            ],
        });
        Self { scene, prev, pipeline, bind }
    }

    /// scene (+ previous) -> out; out -> previous.
    pub fn run(&self, device: &wgpu::Device, queue: &wgpu::Queue, out: &wgpu::Texture) {
        let mut enc = device.create_command_encoder(&Default::default());
        {
            let view = out.create_view(&Default::default());
            let mut pass = enc.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("asemic post"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &view,
                    resolve_target: None,
                    ops: wgpu::Operations { load: wgpu::LoadOp::Clear(wgpu::Color::BLACK), store: wgpu::StoreOp::Store },
                    depth_slice: None,
                })],
                ..Default::default()
            });
            pass.set_pipeline(&self.pipeline);
            pass.set_bind_group(0, &self.bind, &[]);
            pass.draw(0..3, 0..1);
        }
        enc.copy_texture_to_texture(out.as_image_copy(), self.prev.as_image_copy(), out.size());
        queue.submit([enc.finish()]);
    }
}
