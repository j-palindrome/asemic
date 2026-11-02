//! Server created on the main thread, which then parks in CFRunLoop::run_current
//! (event-driven); rendering + publish on a worker thread that only sleeps.
fn main() -> anyhow::Result<()> {
    let (device, queue) = asemic_draw::device()?;
    let out = std::sync::Arc::new(std::sync::Mutex::new(
        syphon_wgpu::SyphonWgpuOutput::new("asemic:nopump", &device, &queue, 64, 64)?,
    ));
    let o = out.clone();
    std::thread::spawn(move || loop {
        let tex = asemic_draw::target(&device, 64, 64);
        asemic_draw::clear(&device, &queue, &tex, wgpu::Color::RED);
        o.lock().unwrap().publish(&tex, &device, &queue);
        std::thread::sleep(std::time::Duration::from_millis(16));
    });
    asemic_draw::park_main_in_run_loop();
    eprintln!("main run loop exited");
    Ok(())
}
