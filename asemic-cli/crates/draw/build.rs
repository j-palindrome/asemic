//! syphon-core only sets the Syphon.framework rpath for its own targets; add it for ours.
fn main() {
    let out = std::path::PathBuf::from(std::env::var("OUT_DIR").unwrap());
    let build = out.ancestors().nth(2).unwrap();
    for e in std::fs::read_dir(build).unwrap().flatten() {
        let fw = e.path().join("out/frameworks");
        if e.file_name().to_string_lossy().starts_with("syphon-core-") && fw.join("Syphon.framework").exists() {
            println!("cargo:rustc-link-arg=-Wl,-rpath,{}", fw.display());
        }
    }
    // jack crate dlopens libjack.0.dylib at runtime: add Homebrew's lib dir (brew install jack)
    for lib in ["/opt/homebrew/lib", "/usr/local/lib"] {
        if std::path::Path::new(lib).join("libjack.0.dylib").exists() {
            println!("cargo:rustc-link-arg=-Wl,-rpath,{lib}");
        }
    }
    // re-scan when syphon-core build dirs appear/vanish (else a stale rpath survives a moved/cleaned target)
    println!("cargo:rerun-if-changed={}", build.display());
    println!("cargo:rerun-if-changed=build.rs");
}
