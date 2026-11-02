//! `asemic_py._ids`: the one id resolver (`asemic_schema::ids`) exposed to Python, so the
//! brain (Zenoh side) and the Python REPL/UI never carry two copies of path resolution.
use asemic_schema::ids;
use pyo3::prelude::*;

/// Resolve written path `r` from block `label` -> canonical id (+ field tail).
#[pyfunction]
#[pyo3(signature = (label, r))]
fn resolve(label: Option<&str>, r: &str) -> String {
    ids::resolve(&ids::scope(label), r)
}

/// `id` lives in block `label` or any block nested under it (`main` = everything).
#[pyfunction]
fn under(label: &str, id: &str) -> bool {
    ids::under(label, id)
}

/// Canonical id -> absolute written path.
#[pyfunction]
fn path(id: &str) -> String {
    ids::path(id)
}

/// Canonical id / route ref -> UI display form.
#[pyfunction]
fn display(r: &str) -> String {
    ids::display(r)
}

/// `a/b/c.attr.hue` -> (`a/b/c`, `attr.hue`); no field -> `default`.
#[pyfunction]
#[pyo3(signature = (id, default = "value"))]
fn field(id: &str, default: &str) -> (String, String) {
    let (p, f) = ids::field(id, default);
    (p.into(), f.into())
}

/// `a/b/c.value` -> (`a/b/c`, `.value`): path + verbatim field tail ("" if none).
#[pyfunction]
fn split_field(r: &str) -> (String, String) {
    let (p, f) = ids::split_field(r);
    (p.into(), f.into())
}

/// Parent block path, None at top level.
#[pyfunction]
fn parent(id: &str) -> Option<String> {
    ids::parent(id).map(Into::into)
}

/// Last path segment.
#[pyfunction]
fn name(id: &str) -> String {
    ids::name(id).into()
}

/// `id` then each enclosing block path, innermost first.
#[pyfunction]
fn ancestors(id: &str) -> Vec<String> {
    ids::ancestors(id).map(Into::into).collect()
}

/// Block label + child name (`main` = root).
#[pyfunction]
fn join(label: &str, child: &str) -> String {
    ids::join(label, child)
}


/// Key builders: `asemic_schema::keys` (the one keyspace definition).
mod key {
    use asemic_schema::keys;
    use pyo3::prelude::*;
    #[pyfunction]
    pub fn component(id: &str) -> String {
        keys::component(id)
    }
    #[pyfunction]
    pub fn preview(id: &str) -> String {
        keys::preview(id)
    }
    #[pyfunction]
    pub fn preview_kind(id: &str) -> String {
        keys::preview_kind(id)
    }
    #[pyfunction]
    pub fn preview_size(id: &str) -> String {
        keys::preview_size(id)
    }
    #[pyfunction]
    pub fn props(id: &str) -> String {
        keys::props(id)
    }
    #[pyfunction]
    pub fn attrs(id: &str) -> String {
        keys::attrs(id)
    }
    #[pyfunction]
    pub fn block_timestretch(id: &str) -> String {
        keys::block_timestretch(id)
    }
    #[pyfunction]
    pub fn block_length(id: &str) -> String {
        keys::block_length(id)
    }
    #[pyfunction]
    pub fn block_loop(id: &str) -> String {
        keys::block_loop(id)
    }
    #[pyfunction]
    pub fn block_step(id: &str) -> String {
        keys::block_step(id)
    }
    #[pyfunction]
    pub fn block_cook(id: &str) -> String {
        keys::block_cook(id)
    }
    #[pyfunction]
    pub fn block_time(id: &str) -> String {
        keys::block_time(id)
    }
    #[pyfunction]
    pub fn py_call(id: &str) -> String {
        keys::py(id)
    }
    #[pyfunction]
    pub fn py_out(id: &str) -> String {
        keys::py_out(id)
    }
    #[pyfunction]
    pub fn pause(id: &str) -> String {
        keys::pause(id)
    }
    #[pyfunction]
    pub fn param(id: &str, k: &str) -> String {
        keys::param(id, k)
    }
    #[pyfunction]
    pub fn value(id: &str, k: &str) -> String {
        keys::value(id, k)
    }
    #[pyfunction]
    pub fn tex_param(id: &str, k: &str) -> String {
        keys::tex_param(id, k)
    }
    /// Id of `key` in keyspace `prefix<id>suffix`, else None.
    #[pyfunction]
    pub fn id_of(key: &str, prefix: &str, suffix: &str) -> Option<String> {
        keys::id_of(key, prefix, suffix).map(Into::into)
    }
}

#[pymodule]
fn _ids(m: &Bound<'_, PyModule>) -> PyResult<()> {
    m.add_function(wrap_pyfunction!(resolve, m)?)?;
    m.add_function(wrap_pyfunction!(under, m)?)?;
    m.add_function(wrap_pyfunction!(path, m)?)?;
    m.add_function(wrap_pyfunction!(display, m)?)?;
    for f in [wrap_pyfunction!(field, m)?, wrap_pyfunction!(split_field, m)?, wrap_pyfunction!(parent, m)?,
              wrap_pyfunction!(name, m)?, wrap_pyfunction!(ancestors, m)?, wrap_pyfunction!(join, m)?] {
        m.add_function(f)?;
    }
    m.add("SEP", ids::SEP.to_string())?;
    m.add_function(wrap_pyfunction!(key::component, m)?)?;
    m.add_function(wrap_pyfunction!(key::preview, m)?)?;
    m.add_function(wrap_pyfunction!(key::preview_size, m)?)?;
    m.add_function(wrap_pyfunction!(key::preview_kind, m)?)?;
    m.add_function(wrap_pyfunction!(key::props, m)?)?;
    m.add_function(wrap_pyfunction!(key::attrs, m)?)?;
    m.add_function(wrap_pyfunction!(key::block_timestretch, m)?)?;
    m.add_function(wrap_pyfunction!(key::block_length, m)?)?;
    m.add_function(wrap_pyfunction!(key::block_loop, m)?)?;
    m.add_function(wrap_pyfunction!(key::block_step, m)?)?;
    m.add_function(wrap_pyfunction!(key::block_cook, m)?)?;
    m.add_function(wrap_pyfunction!(key::block_time, m)?)?;
    m.add_function(wrap_pyfunction!(key::py_call, m)?)?;
    m.add_function(wrap_pyfunction!(key::py_out, m)?)?;
    m.add_function(wrap_pyfunction!(key::pause, m)?)?;
    m.add_function(wrap_pyfunction!(key::param, m)?)?;
    m.add_function(wrap_pyfunction!(key::value, m)?)?;
    m.add_function(wrap_pyfunction!(key::tex_param, m)?)?;
    m.add_function(wrap_pyfunction!(key::id_of, m)?)?;
    m.add("BLOCK_PREFIX", asemic_schema::keys::BLOCK_PREFIX)?;
    m.add("BLOCK_TIME_PREFIX", asemic_schema::keys::BLOCK_TIME_PREFIX)?;
    m.add("TIMESTRETCH_SUFFIX", asemic_schema::keys::TIMESTRETCH_SUFFIX)?;
    m.add("BLOCK_LENGTH_SUFFIX", asemic_schema::keys::BLOCK_LENGTH_SUFFIX)?;
    m.add("BLOCK_LOOP_SUFFIX", asemic_schema::keys::BLOCK_LOOP_SUFFIX)?;
    m.add("BLOCK_TIME_SUFFIX", asemic_schema::keys::BLOCK_TIME_SUFFIX)?;
    m.add("BLOCK_TIMESTRETCH", asemic_schema::keys::BLOCK_TIMESTRETCH)?;
    m.add("PREVIEW_PREFIX", asemic_schema::keys::PREVIEW_PREFIX)?;
    m.add("PREVIEW_SIZE_SUFFIX", asemic_schema::keys::PREVIEW_SIZE_SUFFIX)?;
    m.add("PARAM_PREFIX", asemic_schema::keys::PARAM_PREFIX)?;
    m.add("GEN_PREFIX", asemic_schema::keys::GEN_PREFIX)?;
    Ok(())
}
