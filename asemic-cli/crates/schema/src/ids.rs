//! Path IDs: the ONE resolver (Python calls it via `crates/ids-py` -> `asemic_py._ids`).
//! Every declared id lives at its block path; refs are paths, never bare globals.
//! Written form: `/a/b/c` (absolute), `b/c` / `./b/c` / `../x` (relative to the calling block).
//! Canonical form = `a/b/c` (Zenoh key chunks, `**`-matchable); block labels are canonical
//! paths too (root = `main` = empty scope), so a block's label is its scope.
//! Field: the last segment's tail from its first `.` / `:` (`a/b/c.value`, `a/b/c:vx`,
//! `a/b.timestretch`), kept verbatim.

/// Path separator of canonical ids.
pub const SEP: char = '/';

/// Block label -> scope segments (`main` = root).
pub fn scope(label: Option<&str>) -> Vec<&str> {
    match label {
        None | Some("") | Some("main") => vec![],
        Some(l) => l.split(SEP).filter(|s| !s.is_empty()).collect(),
    }
}

/// `id` lives in block `label` itself or any block nested under it (`main` = everything).
pub fn under(label: &str, id: &str) -> bool {
    let id = split_field(id).0;
    matches!(label, "" | "main") || id == label || id.strip_prefix(label).is_some_and(|r| r.starts_with(SEP))
}

/// `a/b/c.value` -> (`a/b/c`, `.value`); `a/b/c:vx` -> (`a/b/c`, `:vx`); no field -> "".
pub fn split_field(r: &str) -> (&str, &str) {
    let last = r.rfind(SEP).map_or(0, |i| i + 1);
    match r[last..].find(['.', ':']) {
        Some(i) => r.split_at(last + i),
        None => (r, ""),
    }
}

/// `a/b/c.value` -> (`a/b/c`, `value`), defaulting the field to `default`.
pub fn field<'a>(id: &'a str, default: &'a str) -> (&'a str, &'a str) {
    match split_field(id) {
        (p, "") => (p, default),
        (p, f) => (p, &f[1..]),
    }
}

/// Parent block path (`a/b/c` -> `a/b`; top level -> None).
pub fn parent(id: &str) -> Option<&str> {
    split_field(id).0.rsplit_once(SEP).map(|p| p.0)
}

/// Last path segment (`a/b/c.value` -> `c`).
pub fn name(id: &str) -> &str {
    let p = split_field(id).0;
    p.rsplit(SEP).next().unwrap_or(p)
}

/// `id` itself then every enclosing block path, innermost first (`a/b/c` -> `a/b/c`, `a/b`, `a`).
pub fn ancestors(id: &str) -> impl Iterator<Item = &str> {
    let p = split_field(id).0;
    std::iter::successors(Some(p), |q| q.rsplit_once(SEP).map(|x| x.0))
}

/// Join a block label and a child name (`main`/"" = root).
pub fn join(label: &str, child: &str) -> String {
    match label {
        "" | "main" => child.into(),
        l => format!("{l}{SEP}{child}"),
    }
}

/// Resolve written path `r` from `scope` -> canonical id (+ field tail).
/// Raw Zenoh keys (`asemic/...`) pass through.
pub fn resolve(scope: &[&str], r: &str) -> String {
    if r.starts_with("asemic/") {
        return r.into();
    }
    let (path, tail) = split_field(r);
    let mut out: Vec<&str> = if path.starts_with(SEP) { vec![] } else { scope.to_vec() };
    for seg in path.split(SEP) {
        match seg {
            "" | "." => {}
            ".." => {
                out.pop();
            }
            s => out.push(s),
        }
    }
    format!("{}{tail}", out.join("/"))
}

/// Canonical id -> absolute written path (`a/b/c` -> `/a/b/c`).
pub fn path(id: &str) -> String {
    format!("{SEP}{id}")
}

/// Canonical id / ref -> UI display form (already slash paths: identity).
pub fn display(r: &str) -> String {
    r.into()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves() {
        let s = scope(Some("drawing"));
        assert_eq!(resolve(&s, "ink"), "drawing/ink");
        assert_eq!(resolve(&s, "drawing/word"), "drawing/drawing/word");
        assert_eq!(resolve(&s, "./drawing/word"), "drawing/drawing/word");
        assert_eq!(resolve(&s, "/drawing/drawing/word"), "drawing/drawing/word");
        assert_eq!(resolve(&s, "../controls/gain.value"), "controls/gain.value");
        assert_eq!(resolve(&scope(Some("controls")), "noise/chaos_lfo:x"), "controls/noise/chaos_lfo:x");
        assert_eq!(resolve(&scope(Some("controls/noise")), "../arena.attr.hue"), "controls/arena.attr.hue");
        assert_eq!(resolve(&scope(Some("main")), "gain"), "gain");
        assert_eq!(resolve(&s, "asemic/io/osc/x"), "asemic/io/osc/x");
        assert_eq!(path("drawing/drawing/word"), "/drawing/drawing/word");
    }

    #[test]
    fn fields_and_tree() {
        assert_eq!(field("a/b/c.attr.hue", "value"), ("a/b/c", "attr.hue"));
        assert_eq!(field("a/b/c", "value"), ("a/b/c", "value"));
        assert_eq!(parent("a/b/c.value"), Some("a/b"));
        assert_eq!(parent("a"), None);
        assert_eq!(name("a/b/c.value"), "c");
        assert_eq!(ancestors("a/b/c").collect::<Vec<_>>(), ["a/b/c", "a/b", "a"]);
        assert!(under("a", "a/b/c.value") && !under("a", "ab/c") && under("main", "x"));
        assert_eq!(join("main", "x"), "x");
        assert_eq!(join("a/b", "x"), "a/b/x");
    }
}
