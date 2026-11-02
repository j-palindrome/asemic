// Particle system compute shader
// Integrates particle physics: gravity, damping, and position updates
// Each frame: reads base positions + velocities, updates velocities, writes new positions
// Can sample from readback texture to influence particle behavior

@group(0) @binding(0)
var<storage, read> base_positions: array<vec2<f32>>;

@group(0) @binding(1)
var<storage, read_write> velocities: array<vec2<f32>>;

@group(0) @binding(2)
var<storage, read_write> computed_positions: array<vec2<f32>>;

@group(0) @binding(3)
var<uniform> uniforms: Uniforms;

@group(0) @binding(4)
var readback_texture: texture_2d<f32>;

@group(0) @binding(5)
var readback_sampler: sampler;

@group(0) @binding(6)
var<storage, read_write> final_positions: array<vec2<f32>>;

// Constants for particle physics
const GRAVITY = vec2<f32>(0.0, -0.0196);   // Downward gravity (2x)
const DAMPING = 0.85;                      // Velocity damping per frame
const TIME_STEP = 0.016;                   // ~60 FPS
const WORKGROUP_SIZE = 256u;

fn readback(uv: vec2<f32>) -> vec4<f32> {
    return textureSampleLevel(readback_texture, readback_sampler, uv, 0.0);
}

@compute @workgroup_size(WORKGROUP_SIZE, 1, 1)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let particle_idx = global_id.x;
    
    // Bounds check
    if (particle_idx >= arrayLength(&base_positions)) {
        return;
    }

    // Read current state
    var base_pos = base_positions[particle_idx]; // Start with base position + current offset
    var position = computed_positions[particle_idx]; // Current position (offset from base)
    var velocity = velocities[particle_idx]; // Current velocity
    // Sample texture to influence particle behavior
    // Normalize position to [0,1] range for texture sampling

    // let texture_sample = textureSampleLevel(readback_texture, readback_sampler, base_pos, 0.0);
    var info = ModifierInfo(
        f32(global_id.x), f32(global_id.y),
        position,
        velocity,
        vec2<f32>(0.0, 0.0),
        base_pos,
        calculate_uv(base_pos, position)
    );
    info.position = process_position(info);
    // info.position += velocity * TIME_STEP;
    info.velocity = process_velocity(info);
    info.acceleration = process_acceleration(info);
    info.velocity += info.acceleration * TIME_STEP;
    info.position += info.velocity * TIME_STEP;

    let readback_position = process_final_position(info);

    // Update position: base_pos + velocity offset
    // let new_pos = base_pos + velocity;

    // Write updated state back
    velocities[particle_idx] = info.velocity;
    computed_positions[particle_idx] = info.position;
    final_positions[particle_idx] = readback_position;
}
