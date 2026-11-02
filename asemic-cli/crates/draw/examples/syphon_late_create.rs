//! Main parks in its run loop first; a worker creates the Syphon server later (= outputs
//! created at runtime by tokio). Is the late server discoverable?
fn main() -> anyhow::Result<()> {
    std::thread::spawn(|| -> anyhow::Result<()> {
        std::thread::sleep(std::time::Duration::from_millis(500));
        let (device, queue) = asemic_draw::device()?;
        let mut out = syphon_wgpu::SyphonWgpuOutput::new("asemic:late", &device, &queue, 64, 64)?;
        let tex = asemic_draw::target(&device, 64, 64);
        loop {
            asemic_draw::clear(&device, &queue, &tex, wgpu::Color::GREEN);
            out.publish(&tex, &device, &queue);
            std::thread::sleep(std::time::Duration::from_millis(16));
        }
    });
    asemic_draw::park_main_in_run_loop();
    Ok(())
}

