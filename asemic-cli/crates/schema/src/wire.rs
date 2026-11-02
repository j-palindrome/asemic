//! Terminal-frame wire format (`asemic/preview/<out>`, plan §6.4/§8.4.2): downsampled RGBA preview.
//! Mirrored in generated `asemic_py/_wire.py` (`F_HEAD`; regen: `UPDATE_WIRE=1 cargo test -p
//! asemic-schema`, see `tests/gen_python_wire.rs`) and built by hand in `crates/draw/src/host.rs`
//! (`preview`); see [`crate::multi`] for the point-array format (`ASP1`).

/// `<4sIHH` = magic, frame, w, h; then w*h RGBA8.
pub const FRAME_MAGIC: &[u8; 4] = b"ASF1";
/// Header size (magic + frame + w + h: 4+4+2+2).
pub const FRAME_HEAD_LEN: usize = 12;
/// Text frame (ascii texture nodes): same header, then h rows of w chars, UTF-8, '\n'-joined
/// (= the node's own ramp glyph per cell).
pub const TEXT_MAGIC: &[u8; 4] = b"AST1";
