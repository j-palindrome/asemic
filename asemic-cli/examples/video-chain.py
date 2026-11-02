# video-chain — Syphon-in -> edge-filter shader -> Syphon-out, for OBS capture.
# Pipeline: external app (TouchDesigner/Resolume/etc, or a webcam) -> tex("in") -> tex("shader")
# -> output("obs"). In OBS (macOS): Sources -> + -> "Syphon Client" -> pick server "asemic:obs"
# (plugin: obs-syphon; "Add Syphon Client from the + for sources, choose <server> from the
# server list" per https://synapserack.com/en/docs/obs/, corroborated by
# https://community.troikatronix.com/topic/8586/syphon-virtual-camera-not-sending-picture-to-obs-virtual-camera
# -- OBS has no native Syphon support, the obs-syphon plugin adds the "Syphon Client" source).
#
# Edge filter: lygia ships `filter/edge/prewitt` and `filter/sharpen/{adaptive,fast}` as .wesl;
# their fns take raw `(texture_2d<f32>, sampler, uv, ...)` args, so shader/compute nodes expose
# `tex0..tex7: texture_2d<f32>` + shared `samp: sampler` raw bindings alongside the `in0(uv)`
# helpers (graph.rs `Inputs::preamble`) — `edgePrewitt(tex0, samp, uv, offset)` below.

with block("src"):
    # Default: Syphon input. Replace "TouchDesigner" with your server name (texs()/outputs()
    # list what's live). To use a webcam instead (needs asemic-draw built with --features
    # camera; first use triggers a macOS camera-permission prompt), swap the line below for:
    #   tex("cam", "in", adapter="camera:0", w=1280, h=720)
    tex("cam", "in", adapter="syphon:TouchDesigner", w=1280, h=720)

with block("fx"):
    # lygia edgePrewitt over the raw tex0/samp bindings (published below via output("obs"),
    # not publish= here, to avoid opening two Syphon servers for the same node).
    tex("fx", "shader", inputs=["../src/cam"], wesl="""
    import lygia::filter::edge::prewitt::edgePrewitt;
    fn shade(uv: vec2f) -> vec4f {
        return vec4f(edgePrewitt(tex0, samp, uv, 1.0 / info.size), 1.0);
    }
    """)

with block("obs"):
    # Opens a named Syphon output OBS's "Syphon Client" source can pick up as "asemic:obs"
    # (node= publishes the "fx" texture node, not a drawn src gen id).
    output("obs", "syphon", node="../fx/fx", w=1280, h=720)
