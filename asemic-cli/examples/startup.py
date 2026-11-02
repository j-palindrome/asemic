# asemic demo — Enter on a block's row to eval it, Ctrl+R for everything
# Startup evaluates blocks with timestretch 0; use ▶ to start a block.
# Ids are scoped by block path (crates/schema/src/ids.rs): `../x` = sibling block, `/x/y` = absolute.
# Loaded by default (`asemic` / `j asemic`). Full guide + example index: `:guide`.


with block("demo", timestretch=0.0, loop="loop"):
    # Hierarchical block nesting & scoped parameter demo (za to fold/peek)
    param("demo_gain", 0, 1, default=0.5)
    with block("inner"):
        param("inner_amt", 0, 1, default=0.122)
