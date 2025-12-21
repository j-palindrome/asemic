use crate::parser::methods::asemic_pt::AsemicPt;
use crate::parser::methods::asemic_pt::BasicPt;
use crate::parser::methods::drawing::DrawingMixin;
pub use crate::parser::methods::expression_eval::ExpressionEval;
use crate::parser::methods::transforms::Transform;
use rosc::{encoder, OscMessage, OscPacket, OscType};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::net::UdpSocket;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SceneMetadata {
    pub scrub: f64,
    pub params: HashMap<String, Vec<f64>>,
}

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
    SampleAndHold {
        value: f64,
        sampling: bool,
    },
    FmSynthesis {
        freq: f64,
        phase: f64,
        fm_curve: Vec<(f64, f64)>,
        freq_phases: Vec<f64>,
    },
}

impl ExpressionParser {
    pub fn eval_point(this_point: &str, basic: bool, default_y: f64) -> Result<BasicPt, String> {
        // Handle BasicPt input
        if basic {
            if let Ok(x) = this_point.parse::<f64>() {
                return Ok(BasicPt::new(x, default_y));
            }
        }

        let mut point = this_point.to_string();

        // Handle reverse transform '<'
        if point == "<" {
            return Ok(BasicPt::new(0.0, 0.0));
        }

        // Handle point constants '(name arg1 arg2...)'
        if point.starts_with('(') && point.ends_with(')') {
            let sliced = &point[1..point.len() - 1];
            // Parse point constant - would call parser.pointConstants[tokens[0]]
            // For now, return error as this requires context
            return Err(format!("Point constants not implemented: {}", sliced));
        }

        // Handle polar notation '@theta,radius'
        if point.starts_with('@') {
            let parts: Vec<&str> = point[1..].split(',').collect();
            if parts.len() >= 2 {
                let theta = parts[0]
                    .parse::<f64>()
                    .map_err(|_| format!("Invalid theta: {}", parts[0]))?;
                let radius = parts[1]
                    .parse::<f64>()
                    .map_err(|_| format!("Invalid radius: {}", parts[1]))?;

                let mut pt = BasicPt::new(radius, 0.0);
                pt.rotate(theta, None);
                return Ok(pt);
            }
        }

        // Handle array notation 'base[idx1,idx2,...]'
        if point.contains('[') {
            let start = point.find('[').unwrap() + 1;
            let end = point.find(']').unwrap();
            let base = &point[..start - 1];
            let indices = &point[start..end];

            let indices_list: Vec<&str> = indices.split(',').collect();
            for idx in indices_list {
                let expanded = format!("{}{}", base, idx);
                return Self::eval_point(&expanded, basic, default_y);
            }
        }

        // Parse comma-separated coordinates
        let parts: Vec<&str> = point.split(',').collect();

        match parts.len() {
            1 => {
                let coord = parts[0]
                    .parse::<f64>()
                    .map_err(|_| format!("Invalid coordinate: {}", parts[0]))?;
                Ok(BasicPt::new(coord, default_y.max(coord)))
            }
            _ => {
                let coords: Result<Vec<f64>, String> = parts
                    .iter()
                    .map(|p| {
                        p.parse::<f64>()
                            .map_err(|_| format!("Invalid coordinate: {}", p))
                    })
                    .collect();

                let coords = coords?;
                match coords.len() {
                    2 => Ok(BasicPt::new(coords[0], coords[1])),
                    _ => Err(format!(
                        "Invalid point format: {} coordinates",
                        coords.len()
                    )),
                }
            }
        }
    }

    pub fn new() -> Self {
        Self {
            operator_split_cache: HashMap::new(),
            curve: 0.0,
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
                scrub: 0.0,
                params: HashMap::new(),
            },
            cache_max_size: 1000, // Limit cache to 1000 entries
            transforms: vec![Transform::new()],
        }
    }

    pub fn set_local_progress(&mut self, curve: f64, letter: f64, point: f64) {
        self.curve = curve;
        self.letter = letter;
        self.point = point;
    }

    pub fn set_indexes(&mut self, indexes: Vec<f64>, count_nums: Vec<f64>) {
        self.indexes = indexes;
        self.count_nums = count_nums;
    }

    pub fn set_scene_metadata(&mut self, scene_metadata: SceneMetadata) {
        self.scene_metadata = scene_metadata;
        // Clear noise table when scene metadata changes to prevent memory leak
        // Noise states are scene-specific, so old entries become stale
        self.noise_table.clear();
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
        let target_addr = format!("{}:{}", host, port);

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
            args: value.iter().map(|v| OscType::Float(*v as f32)).collect(),
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
