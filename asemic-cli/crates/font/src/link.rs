use std::{borrow::Cow, cell::RefCell};

use wesl::{
    CompileOptions,
    syntax::ModulePath,
    resolver::{FileResolver, Router, VirtualResolver},
};

pub const LYGIA: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../vendor/lygia");

thread_local! {
    /// Last link error on this thread (draw reads it to fail the brush/phase).
    pub static LINK_ERROR: RefCell<Option<String>> = const { RefCell::new(None) };
    /// Dim names of the point multiarray the next `link_shader` brush reads (`with_dims`).
    static DIMS: RefCell<Vec<String>> = RefCell::new(vec!["x".into(), "y".into()]);
}

/// Run `f` (a brush build: upstream calls `link_shader`) with the point dims it links against.
pub fn with_dims<T>(dims: &[String], f: impl FnOnce() -> T) -> T {
    let old = DIMS.with(|d| std::mem::replace(&mut *d.borrow_mut(), dims.to_vec()));
    let out = f();
    DIMS.with(|d| *d.borrow_mut() = old);
    out
}

/// Generated WESL module `package::dims` for a D-dim point layout (names resolve to dim
/// indices here, once): `const DIM_N`, `const DIM_<name>: u32 = k`, `struct Point` (one f32
/// field per dim = sugar over `array<f32, D>`), `fn to_point(a) / fn to_dims(p)`. `store`
/// (group, binding of `array<f32>` stride D + binding+1 `array<vec2u>` line table
/// (first point, count)) adds `fn dim_count()` (points), `fn dim_at(p, k)`, `fn dim_line(line, t, k)` (t 0..1 along
/// the line, linear between neighbours), `fn point_at(p) -> Point`.
pub fn dims_module(dims: &[String], store: Option<(u32, u32, &str)>) -> String {
    let n = dims.len();
    let mut s = format!("const DIM_N: u32 = {n}u;\n");
    for (k, d) in dims.iter().enumerate() {
        s += &format!("const DIM_{d}: u32 = {k}u;\n");
    }
    s += &format!("struct Point {{ {} }}\n", dims.iter().map(|d| format!("{d}: f32")).collect::<Vec<_>>().join(", "));
    let fields = |f: &dyn Fn(usize, &str) -> String| dims.iter().enumerate().map(|(k, d)| f(k, d)).collect::<Vec<_>>().join(", ");
    s += &format!("fn to_point(a: array<f32, {n}>) -> Point {{ return Point({}); }}\n", fields(&|k, _| format!("a[{k}]")));
    s += &format!("fn to_dims(p: Point) -> array<f32, {n}> {{ return array<f32, {n}>({}); }}\n", fields(&|_, d| format!("p.{d}")));
    if let Some((g, b, var)) = store {
        s += &format!(
            "@group({g}) @binding({b}) var<storage, read> {var}_dims: array<f32>;
@group({g}) @binding({}) var<storage, read> {var}_lines: array<vec2u>;
fn dim_count() -> u32 {{ let l = {var}_lines[arrayLength(&{var}_lines) - 1u]; return l.x + l.y; }}
fn dim_at(p: u32, k: u32) -> f32 {{ return {var}_dims[min(p, max(dim_count(), 1u) - 1u) * DIM_N + k]; }}
fn dim_line(line: u32, t: f32, k: u32) -> f32 {{
    let l = {var}_lines[min(line, arrayLength(&{var}_lines) - 1u)];
    let f = clamp(t, 0.0, 1.0) * f32(max(l.y, 1u) - 1u);
    let i = u32(f);
    return mix(dim_at(l.x + i, k), dim_at(l.x + min(i + 1u, max(l.y, 1u) - 1u), k), fract(f));
}}
fn point_at(p: u32) -> Point {{ return Point({}); }}
",
            b + 1,
            fields(&|k, _| format!("dim_at(p, {k}u)"))
        );
    }
    s
}

/// Names `dims_module` exports (explicit WESL import list).
pub fn dims_exports(dims: &[String], store: bool) -> Vec<String> {
    let mut v: Vec<String> = ["DIM_N", "Point", "to_point", "to_dims"].iter().map(|s| s.to_string()).collect();
    v.extend(dims.iter().map(|d| format!("DIM_{d}")));
    if store {
        v.extend(["dim_count", "dim_at", "dim_line", "point_at"].iter().map(|s| s.to_string()));
    }
    v
}

/// `import package::dims::{..};` line for `src` using the generated module.
pub fn dims_import(dims: &[String], store: bool) -> String {
    format!("import package::dims::{{{}}};\n", dims_exports(dims, store).join(", "))
}

/// Link WESL -> WGSL; `features` drive `@if(...)`. Keeps all main-module decls.
pub fn link(src: &str, features: &[(&str, bool)]) -> Result<String, wesl::Error> {
    link_with(src, features, None)
}

/// `link` + an extra virtual module `package::dims` (generated, `dims_module`).
pub fn link_with(src: &str, features: &[(&str, bool)], dims: Option<String>) -> Result<String, wesl::Error> {
    let main: ModulePath = "package::main".parse().expect("static path");
    let mut virt = VirtualResolver::new();
    virt.add_module(main.clone(), Cow::Owned(src.to_owned()));
    if let Some(d) = dims {
        virt.add_module("package::dims".parse().expect("static path"), Cow::Owned(d));
    }
    let mut router = Router::new();
    router.mount_resolver("lygia".parse().expect("static path"), FileResolver::new(LYGIA));
    router.mount_fallback_resolver(virt);
    let mut opts = CompileOptions { keep_main: true, validate: false, visibility: false, ..Default::default() };
    for (k, v) in features {
        opts.features.flags.insert((*k).to_string(), (*v).into());
    }
    Ok(wesl::compile(&main, &opts, &router)?.to_string())
}

/// Texture-node slots a brush can sample: `tex0(uv)`..`tex3(uv)` (@group(1), vertex + fragment).
pub const BRUSH_SLOTS: u32 = 4;

/// @group(1) bindings of the point dims buffer (stride D) + line table (`dims_module`).
pub const BRUSH_DIMS: u32 = BRUSH_SLOTS + 1;

/// Shadows upstream `util::brush_extra_layout`: @group(1) = sampler + BRUSH_SLOTS textures
/// + point dims / line table storage (BRUSH_DIMS, +1).
pub fn brush_extra_layout(device: &wgpu::Device) -> Option<wgpu::BindGroupLayout> {
    let vis = wgpu::ShaderStages::VERTEX_FRAGMENT;
    let mut entries = vec![wgpu::BindGroupLayoutEntry { binding: 0, visibility: vis, ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering), count: None }];
    entries.extend((1..=BRUSH_SLOTS).map(|b| wgpu::BindGroupLayoutEntry {
        binding: b,
        visibility: vis,
        ty: wgpu::BindingType::Texture { sample_type: wgpu::TextureSampleType::Float { filterable: true }, view_dimension: wgpu::TextureViewDimension::D2, multisampled: false },
        count: None,
    }));
    entries.extend((BRUSH_DIMS..BRUSH_DIMS + 2).map(|b| wgpu::BindGroupLayoutEntry {
        binding: b,
        visibility: vis,
        ty: wgpu::BindingType::Buffer { ty: wgpu::BufferBindingType::Storage { read_only: true }, has_dynamic_offset: false, min_binding_size: None },
        count: None,
    }));
    Some(device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor { label: Some("asemic brush nodes"), entries: &entries }))
}

/// Brush additions: texture slots + `attr(info, k)` = dim k of the drawn point at
/// (`info.line`, `info.point` 0..1), k = `DIM_<name>` (generated `package::dims`).
fn brush_preamble(dims: &[String]) -> String {
    let mut s = format!("\n{}fn attr(info: ModifierInfo, k: u32) -> f32 {{ return dim_line(u32(info.line), info.point, k); }}\n", dims_import(dims, true));
    s += "@group(1) @binding(0) var asemic_samp: sampler;\n";
    for k in 0..BRUSH_SLOTS {
        s += &format!("@group(1) @binding({}) var asemic_t{k}: texture_2d<f32>;\nfn tex{k}(uv: vec2f) -> vec4f {{ return textureSampleLevel(asemic_t{k}, asemic_samp, uv, 0.0); }}\n", k + 1);
    }
    s
}

/// Upstream hook (brush WGSL only): + texture-node slots, WESL link; on error keep source
/// (wgpu error scope reports) + record error.
pub fn link_shader(src: String) -> String {
    let dims = DIMS.with(|d| d.borrow().clone());
    // imports must lead the module
    let pre = brush_preamble(&dims);
    let (imp, rest) = pre.trim_start().split_once('\n').expect("import line");
    let src = format!("{imp}\n{src}\n{rest}");
    match link_with(&src, &[], Some(dims_module(&dims, Some((1, BRUSH_DIMS, "asemic"))))) {
        Ok(out) => out,
        Err(e) => {
            LINK_ERROR.with(|l| *l.borrow_mut() = Some(e.to_string()));
            src
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plain_wgsl_passes() {
        let out = link("@fragment fn fs() -> @location(0) vec4f { return vec4f(1.0); }", &[]).unwrap();
        assert!(out.contains("fn fs"));
    }

    #[test]
    fn lygia_import_links() {
        let src = "import lygia::math::consts::PI;\n@fragment fn fs() -> @location(0) vec4f { return vec4f(PI); }";
        let out = link(src, &[]).unwrap();
        assert!(out.contains("3.14"), "{out}");
    }

    #[test]
    fn dims_module_links_and_validates() {
        let dims: Vec<String> = ["x", "y", "hue"].iter().map(|s| s.to_string()).collect();
        let src = format!("{}@fragment fn fs() -> @location(0) vec4f {{ let p = point_at(0u); return vec4f(p.hue, dim_line(0u, 0.5, DIM_hue), to_dims(p)[DIM_x], f32(DIM_N)); }}", dims_import(&dims, true));
        let out = link_with(&src, &[], Some(dims_module(&dims, Some((1, 5, "asemic"))))).unwrap();
        let m = naga::front::wgsl::parse_str(&out).unwrap_or_else(|e| panic!("{}\n{out}", e.emit_to_string(&out)));
        naga::valid::Validator::new(Default::default(), naga::valid::Capabilities::all()).validate(&m).unwrap();
    }
}
