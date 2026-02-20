use crate::parser::methods::asemic_pt::AsemicPt;
use crate::parser::methods::asemic_pt::BasicPt;
pub use crate::parser::methods::expression_eval::ExpressionEval;
use crate::parser::methods::transforms::Transform;
use crate::parser::methods::transforms::Transforms;
use rosc::{encoder, OscMessage, OscPacket, OscType};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::net::UdpSocket;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SceneMetadata {
    pub scrub: f64,
    pub fade: f64,
    pub params: HashMap<String, Vec<f64>>,
    pub width: f64,
    pub height: f64,
    pub id: String,
    pub code: String,
}

// pub struct Scene {
//     pub code: String,
//     pub text: String,
//     pub length: f64,
//     pub offset: f64,
//     pub pause: f64,
//     pub params: HashMap<String, ParamConfig>,
//     pub global_params: HashMap<String, SceneParamConfig>,
//     pub osc_groups: Vec<OscGroup>,
// }

/// A static expression parser for Asemic expressions.
/// This is a port of the TypeScript expr() function without global state.
///
/// Supported operators: &, |, ^, _, +, -, *, /, %, (, )
///
/// Supported constants and functions:
/// - Progress: S (global scrub), s (scene-relative 0-1), C (curve), L (letter), P (point)
/// - Indexing: N (count), I (index), i (normalized index 0-1)
/// - Time: T [multiplier] (current time in seconds with optional multiplier)
/// - Dimensions: H [multiplier] (height ratio), px [multiplier] (pixel size)
/// - Math: sin, abs, PHI (golden ratio), fib (fibonacci)
/// - Logic: ! (NOT), ? condition true false (ternary)
/// - Interpolation: > fade val1 val2... (lerp/fade), <> progress [spread] [center] (range mapping)
/// - Selection: choose index val1 val2..., mix val1 val2... (average)
/// - Randomness: # [seed] (hash function)
/// - Special: sah val1 val2 (sample and hold), bell x [sign], peaks position peak1 peak2...
/// - Not fully implemented: ~ (FM synthesis), tangent, table (require additional context)
pub struct ExpressionParser {
    pub operator_split_cache: HashMap<String, Vec<SplitResult>>,
    // Remove scrub field - use from scene metadata only
    // Remove scene field - no global scene tracking
    // Local parsing state
    pub curve: f64,
    pub letter: f64,
    pub point: f64,
    pub noise_index: usize,
    // Index tracking
    pub indexes: Vec<f64>,
    pub count_nums: Vec<f64>,
    // Seeds for hash function
    pub seeds: Vec<f64>,
    // Noise table for stateful functions
    pub noise_table: HashMap<String, NoiseState>,
    // Scene metadata for scene-relative calculations
    pub scene_metadata: SceneMetadata,
    // Cache size limit to prevent unbounded growth
    pub cache_max_size: usize,
    pub transforms: Vec<Transform>,
}

#[derive(Debug, Clone)]
pub struct SplitResult {
    pub string: String,
    pub operator_type: String,
}

#[derive(Debug, Clone)]
#[allow(dead_code)]
pub enum NoiseState {
    SampleAndHold { value: f64, sampling: bool },
    FmSynthesis { value: f64, phases: Vec<f64> },
    Cycle { value: f64 },
}

impl ExpressionParser {
    pub fn reset(&mut self) {
        self.noise_index = 0;
        self.point = 0.0;
        self.letter = 0.0;
        self.curve = 0.0;
        self.indexes = vec![0.0; 3];
        self.count_nums = vec![0.0; 3];
        self.transforms = vec![Transform::new()];
    }

    pub fn reset_scene(&mut self) {
        self.noise_table.clear();
    }

    pub fn eval_point(&mut self, this_point: &str) -> Result<BasicPt, String> {
        let mut point = this_point.to_string();

        // .map_err(|_| format!("Invalid coordinate: {} from {}", point, this_point))?;

        // Handle array notation 'base[idx1,idx2,...]'
        if point.contains('[') {
            let start = point.find('[').unwrap() + 1;
            let end = point.find(']').unwrap();
            let base = &point[..start - 1];
            let indices = &point[start..end];

            let indices_list: Vec<&str> = indices.split(',').collect();
            return self.eval_point(&format!(
                "{}{},{}{}",
                base, indices_list[0], base, indices_list[1]
            ));
        }

        // Handle polar notation '@theta,radius'
        if point.starts_with('@') {
            let parts = self.expr_point(&point[1..], None).map_err(|_| {
                format!(
                    "eval_point: Failed to evaluate polar expression '{}'",
                    this_point
                )
            })?;
            let theta = parts.0;
            let radius = parts.1;

            let mut pt = BasicPt::new(radius, 0.0);
            pt.rotate(theta, None);
            return Ok(pt);
        }

        let parts = self.expr_point(&point, None).map_err(|e| {
            format!(
                "eval_point: Failed to evaluate point expression '{}': {}",
                this_point, e
            )
        })?;
        Ok(BasicPt::new(parts.0, parts.1))
    }

    pub fn generate_point(&mut self, pt: &BasicPt) -> Result<AsemicPt, String> {
        let solved = self.peek_transform().solve(self)?;
        Ok(AsemicPt::new(
            pt.x,
            pt.y,
            solved.w,
            solved.h,
            solved.s,
            solved.l,
            solved.a,
            solved.attrs,
        ))
    }

    pub fn new() -> Self {
        Self {
            operator_split_cache: HashMap::new(),
            curve: 1.0,
            letter: 0.0,
            point: 0.0,
            noise_index: 0,
            indexes: vec![0.0; 3],
            count_nums: vec![0.0; 3],
            seeds: (0..100)
                .map(|i| (((i as f64 + 1.0) * 0.618033988749895) % 1.0))
                .collect(),
            noise_table: HashMap::new(),
            scene_metadata: SceneMetadata {
                id: "0".to_string(),
                scrub: 0.0,
                fade: 0.0,
                params: HashMap::new(),
                width: 1080.0,
                height: 1080.0,
                code: "".to_string(),
            },
            cache_max_size: 10000, // Limit cache to 1000 entries
            transforms: vec![Transform::new()],
        }
    }

    pub fn set_scene_metadata(&mut self, scene_metadata: SceneMetadata) {
        self.scene_metadata = scene_metadata;
    }

    /// Get a parameter value from the current scene's metadata
    pub fn get_param(&self, name: &str, index: usize) -> Option<f64> {
        return self
            .scene_metadata
            .params
            .get(name)
            .and_then(|v| v.get(index))
            .copied();
    }
    pub fn get_constant(&mut self, name: &str) -> Option<(String, String)> {
        let transform = self.peek_transform();
        // Search for the longest matching prefix
        transform
            .constants
            .iter()
            .filter(|(key, _)| name.starts_with(key.as_str()))
            .max_by_key(|(key, _)| key.len())
            .map(|(key, value)| (key.clone(), value.clone()))
    }

    /// Main expression evaluation function
    /// Evaluates mathematical expressions with operators: &, |, ^, _, +, -, *, /, %, (, )
    /// Also supports function calls with space-separated arguments
    ///
    /// Can be called by Transform.solve() or other types that need expression evaluation.

    /// Send an OSC message with the evaluated expression result
    pub fn send_osc(
        &self,
        address: &str,
        value: Vec<f64>,
        host: &str,
        port: u16,
    ) -> Result<(), String> {
        let resolved_host = if host == "localhost" {
            "127.0.0.1"
        } else {
            host
        };

        let target_addr = format!("{}:{}", resolved_host, port);

        // Bind to any available port on localhost
        let socket = UdpSocket::bind("0.0.0.0:0")
            .map_err(|e| format!("Failed to bind UDP socket: {}", e))?;

        // Set timeout to prevent blocking indefinitely
        socket
            .set_write_timeout(Some(std::time::Duration::from_secs(1)))
            .map_err(|e| format!("Failed to set socket timeout: {}", e))?;

        // Create OSC message
        let msg = OscMessage {
            addr: address.to_string(),
            args: value.iter().map(|&v| OscType::Float(v as f32)).collect(),
        };

        // Encode message to bytes
        let packet = OscPacket::Message(msg);
        let msg_buf =
            encoder::encode(&packet).map_err(|e| format!("Failed to encode OSC message: {}", e))?;

        // Send the message
        socket
            .send_to(&msg_buf, &target_addr)
            .map_err(|e| format!("Failed to send OSC message to {}: {}", target_addr, e))?;

        Ok(())
    }
}

impl Default for ExpressionParser {
    fn default() -> Self {
        Self::new()
    }
}
