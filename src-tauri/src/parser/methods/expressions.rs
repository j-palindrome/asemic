use std::collections::HashMap;

/// A static expression parser for Asemic expressions.
/// This is a port of the TypeScript expr() function without global state.
/// 
/// Supported operators: &, |, ^, _, +, -, *, /, %, (, )
/// 
/// Supported constants and functions:
/// - Progress: S (scrub), C (curve), L (letter), P (point)
/// - Indexing: N (count), I (index), i (normalized index 0-1)
/// - Time: T [multiplier] (time with optional multiplier)
/// - Dimensions: H [multiplier] (height ratio), px [multiplier] (pixel size)
/// - Math: sin, abs, PHI (golden ratio), fib (fibonacci)
/// - Logic: ! (NOT), ? condition true false (ternary)
/// - Interpolation: > fade val1 val2... (lerp/fade), <> progress [spread] [center] (range mapping)
/// - Selection: choose index val1 val2..., mix val1 val2... (average)
/// - Randomness: # [seed] (hash function)
/// - Special: sah val1 val2 (sample and hold), bell x [sign], peaks position peak1 peak2...
/// - Not fully implemented: ~ (FM synthesis), tangent, table (require additional context)
pub struct ExpressionParser {
    // Cache for operator splits to improve performance
    operator_split_cache: HashMap<String, Vec<SplitResult>>,
    // Parser state for constants
    time: f64,
    width: f64,
    height: f64,
    // Progress state
    scrub: f64,
    curve: f64,
    letter: f64,
    point: f64,
    scene: usize,
    noise_index: usize,
    // Index tracking
    indexes: Vec<f64>,
    count_nums: Vec<f64>,
    // Seeds for hash function
    seeds: Vec<f64>,
    // Noise table for stateful functions
    noise_table: HashMap<String, NoiseState>,
}

#[derive(Debug, Clone)]
struct SplitResult {
    string: String,
    operator_type: String,
}

#[derive(Debug, Clone)]
#[allow(dead_code)]
enum NoiseState {
    SampleAndHold { value: f64, sampling: bool },
    FmSynthesis { freq: f64, phase: f64, fm_curve: Vec<(f64, f64)>, freq_phases: Vec<f64> },
}

impl ExpressionParser {
    pub fn new() -> Self {
        Self {
            operator_split_cache: HashMap::new(),
            time: 0.0,
            width: 1920.0,
            height: 1080.0,
            scrub: 0.0,
            curve: 0.0,
            letter: 0.0,
            point: 0.0,
            scene: 0,
            noise_index: 0,
            indexes: vec![0.0; 3],
            count_nums: vec![0.0; 3],
            seeds: (0..100).map(|i| ((i as f64 * 0.618033988749895) % 1.0)).collect(),
            noise_table: HashMap::new(),
        }
    }

    pub fn with_context(time: f64, width: f64, height: f64) -> Self {
        Self {
            operator_split_cache: HashMap::new(),
            time,
            width,
            height,
            scrub: 0.0,
            curve: 0.0,
            letter: 0.0,
            point: 0.0,
            scene: 0,
            noise_index: 0,
            indexes: vec![0.0; 3],
            count_nums: vec![0.0; 3],
            seeds: (0..100).map(|i| ((i as f64 * 0.618033988749895) % 1.0)).collect(),
            noise_table: HashMap::new(),
        }
    }

    pub fn set_time(&mut self, time: f64) {
        self.time = time;
    }

    pub fn set_dimensions(&mut self, width: f64, height: f64) {
        self.width = width;
        self.height = height;
    }

    pub fn set_progress(&mut self, scrub: f64, curve: f64, letter: f64, point: f64, scene: usize) {
        self.scrub = scrub;
        self.curve = curve;
        self.letter = letter;
        self.point = point;
        self.scene = scene;
    }

    pub fn set_indexes(&mut self, indexes: Vec<f64>, count_nums: Vec<f64>) {
        self.indexes = indexes;
        self.count_nums = count_nums;
    }

    /// Main expression evaluation function
    /// Evaluates mathematical expressions with operators: &, |, ^, _, +, -, *, /, %, (, )
    /// Also supports function calls with space-separated arguments
    pub fn expr(&mut self, expr: &str) -> Result<f64, String> {
        let expr = expr.trim();
        
        if expr.is_empty() {
            return Err("Empty expression".to_string());
        }

        // Early number check before any processing
        if Self::is_number(expr) {
            return expr.parse::<f64>()
                .map_err(|_| format!("{} is not a valid number", expr));
        }

        // Handle backtick expressions (JavaScript eval)
        // Note: In Rust, we skip this for security. Could be extended with a safe expression evaluator
        let expr = if expr.contains('`') {
            return Err("Backtick expressions not supported in Rust parser".to_string());
        } else {
            expr.to_string()
        };

        // Get or compute operator splits
        let split_result = if let Some(cached) = self.operator_split_cache.get(&expr) {
            cached.clone()
        } else {
            let splits = self.split_by_operators(&expr)?;
            self.operator_split_cache.insert(expr.clone(), splits.clone());
            splits
        };

        if split_result.len() == 1 {
            if split_result[0].string.is_empty() {
                return Err(format!("Empty expression beginning {}", expr));
            }
            return self.fast_expr(&split_result[0].string);
        } else {
            return self.solve_split_result(split_result, &expr);
        }
    }

    /// Fast expression evaluation for single terms (numbers or function calls)
    fn fast_expr(&mut self, string_expr: &str) -> Result<f64, String> {
        if string_expr.is_empty() {
            return Err("Empty expression".to_string());
        }

        // Check if it's a number (including negative)
        if Self::is_number_or_negative(string_expr) {
            return string_expr.parse::<f64>()
                .map_err(|_| format!("{} is NaN", string_expr));
        }

        // Check for vector notation (comma)
        if string_expr.contains(',') {
            return Err(format!("Vector {} passed, scalar expected", string_expr));
        }

        // Check for constants and functions
        self.eval_constant(string_expr)
    }

    /// Evaluate built-in constants and functions
    fn eval_constant(&mut self, expr: &str) -> Result<f64, String> {
        // Parse function calls: "name" or "name arg1 arg2..."
        let parts: Vec<&str> = expr.split_whitespace().collect();
        if parts.is_empty() {
            return Err("Empty expression".to_string());
        }

        let func_name = parts[0];
        let args = &parts[1..];

        match func_name {
            // Progress constants
            "S" => Ok(self.scrub),
            "C" => Ok(self.curve),
            "L" => Ok(self.letter),
            "P" => Ok(self.point),
            // Index constants
            "N" => {
                let index = if args.is_empty() {
                    0
                } else {
                    self.expr(args[0])? as usize
                };
                if index >= self.count_nums.len() {
                    return Err(format!("N index {} out of range", index));
                }
                Ok(self.count_nums[index])
            }
            "I" => {
                let index = if args.is_empty() {
                    0
                } else {
                    self.expr(args[0])? as usize
                };
                if index >= self.indexes.len() {
                    return Err(format!("I index {} out of range", index));
                }
                Ok(self.indexes[index])
            }
            "i" => {
                let index = if args.is_empty() {
                    0
                } else {
                    self.expr(args[0])?.floor() as usize
                };
                if index >= self.indexes.len() || index >= self.count_nums.len() {
                    return Err(format!("i index {} out of range", index));
                }
                let count = self.count_nums[index] - 1.0;
                if count <= 0.0 {
                    Ok(0.0)
                } else {
                    Ok(self.indexes[index] / count)
                }
            }
            // Negation operator
            "-" => {
                if args.is_empty() {
                    return Err("- requires an argument".to_string());
                }
                let val = self.expr(args[0])?;
                Ok(-val)
            }
            // Time constant
            "T" => {
                if args.is_empty() {
                    Ok(self.time)
                } else {
                    let multiplier = self.expr(args[0])?;
                    Ok(self.time * multiplier)
                }
            }
            // Height-to-width ratio
            "H" => {
                let ratio = self.height / self.width;
                if args.is_empty() {
                    Ok(ratio)
                } else {
                    let multiplier = self.expr(args[0])?;
                    Ok(ratio * multiplier)
                }
            }
            // Pixels
            "px" => {
                let multiplier = if args.is_empty() {
                    1.0
                } else {
                    self.expr(args[0])?
                };
                Ok((1.0 / self.width) * multiplier)
            }
            // Sin wave (0-1 normalized)
            "sin" => {
                if args.is_empty() {
                    return Err("sin requires an argument".to_string());
                }
                let val = self.expr(args[0])?;
                Ok((val * std::f64::consts::PI * 2.0).sin())
            }
            // Absolute value
            "abs" => {
                if args.is_empty() {
                    return Err("abs requires an argument".to_string());
                }
                let val = self.expr(args[0])?;
                Ok(val.abs())
            }
            // NOT operator
            "!" => {
                if args.is_empty() {
                    return Err("! requires an argument".to_string());
                }
                let val = self.expr(args[0])?;
                Ok(if val != 0.0 { 0.0 } else { 1.0 })
            }
            // Ternary operator: ? condition trueVal falseVal
            "?" => {
                if args.len() < 2 {
                    return Err("? requires at least 2 arguments".to_string());
                }
                let condition = self.expr(args[0])?;
                let true_val = self.expr(args[1])?;
                let false_val = if args.len() > 2 {
                    self.expr(args[2])?
                } else {
                    0.0
                };
                Ok(if condition > 0.0 { true_val } else { false_val })
            }
            // Fade/lerp between values
            ">" => {
                if args.len() < 2 {
                    return Err("> requires at least 2 arguments".to_string());
                }
                let mut fade = self.expr(args[0])?;
                if fade >= 1.0 {
                    fade = 0.999;
                } else if fade < 0.0 {
                    fade = 0.0;
                }
                
                let values: Result<Vec<f64>, String> = args[1..].iter()
                    .map(|arg| self.expr(arg))
                    .collect();
                let values = values?;
                
                if values.len() < 2 {
                    return Err("> requires at least 2 values".to_string());
                }
                
                let index = (values.len() - 1) as f64 * fade;
                let i = index.floor() as usize;
                let t = index.fract();
                
                Ok(values[i] * (1.0 - t) + values[i + 1] * t)
            }
            // Choose by index
            "choose" => {
                if args.len() < 2 {
                    return Err("choose requires at least 2 arguments".to_string());
                }
                let index = self.expr(args[0])?.floor() as usize;
                if index >= args.len() - 1 {
                    return Err(format!("choose index {} out of range", index));
                }
                self.expr(args[index + 1])
            }
            // Mix (average)
            "mix" => {
                if args.is_empty() {
                    return Err("mix requires arguments".to_string());
                }
                let sum: Result<f64, String> = args.iter()
                    .map(|arg| self.expr(arg))
                    .try_fold(0.0, |acc, res| res.map(|v| acc + v));
                Ok(sum? / args.len() as f64)
            }
            // Golden ratio
            "PHI" => {
                let exponent = if args.is_empty() {
                    1.0
                } else {
                    self.expr(args[0])?
                };
                Ok(1.6180339887_f64.powf(exponent))
            }
            // Fibonacci
            "fib" => {
                if args.is_empty() {
                    return Err("fib requires an argument".to_string());
                }
                let n = self.expr(args[0])?.floor() as i32;
                if n <= 0 {
                    return Ok(0.0);
                }
                if n == 1 {
                    return Ok(1.0);
                }
                let mut a = 0.0;
                let mut b = 1.0;
                for _ in 2..=n {
                    let temp = a + b;
                    a = b;
                    b = temp;
                }
                Ok(b)
            }
            // Hash function with seed array
            "#" => {
                let seed = if args.is_empty() {
                    self.curve
                } else {
                    self.expr(args[0])?
                };
                let seed_offset = self.seeds.get((self.curve as usize) % 100).unwrap_or(&0.0);
                let hash = (seed * (43758.5453123 + seed_offset)) % 1.0;
                Ok(hash)
            }
            // Range mapping: <> progress spread center
            "<>" => {
                if args.len() < 1 {
                    return Err("<> requires at least 1 argument".to_string());
                }
                let progress = self.expr(args[0])?;
                let spread = if args.len() > 1 {
                    self.expr(args[1])?
                } else {
                    1.0
                };
                let center = if args.len() > 2 {
                    self.expr(args[2])?
                } else {
                    0.0
                };
                let max = center + spread / 2.0;
                let min = center - spread / 2.0;
                Ok(progress * (max - min) + min)
            }
            // Sample and hold
            "sah" => {
                if args.len() < 2 {
                    return Err("sah requires 2 arguments".to_string());
                }
                let key = format!("{}:{}", self.scene, self.noise_index);
                self.noise_index += 1;
                
                let val1 = self.expr(args[0])?;
                let val2 = self.expr(args[1])?;
                
                let state = self.noise_table.entry(key.clone()).or_insert(
                    NoiseState::SampleAndHold { value: 0.0, sampling: false }
                );
                
                if let NoiseState::SampleAndHold { value, sampling } = state {
                    if val2 > 0.5 && !*sampling {
                        *sampling = true;
                        *value = val1;
                    } else if val2 <= 0.5 {
                        *sampling = false;
                    }
                    Ok(*value)
                } else {
                    Err("sah state corrupted".to_string())
                }
            }
            // FM synthesis noise (simplified version - full implementation requires curve parsing)
            "~" => {
                // Note: This is a simplified version. Full implementation would require
                // parsing FM curve parameters which depends on point parsing.
                Err("~ (FM synthesis) not fully implemented in Rust parser".to_string())
            }
            // Bell curve
            "bell" => {
                if args.is_empty() {
                    return Err("bell requires at least 1 argument".to_string());
                }
                let x = self.expr(args[0])?;
                let hash = if args.len() > 1 {
                    self.expr(args[1])?
                } else {
                    self.eval_constant(&format!("# {}", args[0]))?
                };
                Ok((if hash > 0.5 { 1.0 } else { -1.0 }) * x * 0.5 + 0.5)
            }
            // Tangent (requires curve data - not fully implementable without curve context)
            "tangent" => {
                Err("tangent requires curve data and is not fully implemented in Rust parser".to_string())
            }
            // Peaks function
            "peaks" => {
                if args.len() < 2 {
                    return Err("peaks requires at least 2 arguments".to_string());
                }
                let pos = self.expr(args[0])?;
                
                // Note: Full implementation requires point parsing.
                // Simplified version assumes peaks are "x,y" format
                for peak_str in &args[1..] {
                    let parts: Vec<&str> = peak_str.split(',').collect();
                    if parts.len() >= 2 {
                        let peak_pos = parts[0].parse::<f64>()
                            .map_err(|_| format!("Invalid peak position: {}", parts[0]))?;
                        let peak_width = parts[1].parse::<f64>()
                            .map_err(|_| format!("Invalid peak width: {}", parts[1]))?;
                        
                        let diff = (pos - peak_pos).abs();
                        if diff < peak_width {
                            return Ok(1.0 - diff / peak_width);
                        }
                    }
                }
                Ok(0.0)
            }
            // Table lookup (requires image data - not implementable without external data)
            "table" => {
                Err("table requires image data and is not fully implemented in Rust parser".to_string())
            }
            _ => Err(format!("Unknown function or constant: {}", func_name))
        }
    }

    /// Split expression by operators while respecting precedence
    fn split_by_operators(&self, expr: &str) -> Result<Vec<SplitResult>, String> {
        let operators = ['&', '|', '^', '_', '+', '-', '*', '/', '%', '(', ')', ' '];
        let mut result = Vec::new();
        let mut operator_positions: Vec<(usize, char)> = Vec::new();

        // Find all operator positions
        for (i, ch) in expr.chars().enumerate() {
            if operators.contains(&ch) {
                operator_positions.push((i, ch));
            }
        }

        if operator_positions.is_empty() {
            // No operators found
            return Ok(vec![SplitResult {
                string: expr.to_string(),
                operator_type: String::new(),
            }]);
        }

        // Build split result
        for (idx, (pos, op)) in operator_positions.iter().enumerate() {
            // Add text before first operator
            if idx == 0 {
                let text = expr[..*pos].to_string();
                result.push(SplitResult {
                    string: text,
                    operator_type: String::new(),
                });
            }

            // Handle negative sign merging
            if *op == '-' {
                let is_at_start = *pos == 0;
                let is_after_operator = idx > 0 && 
                    operator_positions.get(idx - 1)
                        .map(|(prev_pos, _)| prev_pos + 1 == *pos)
                        .unwrap_or(false);

                if is_at_start || is_after_operator {
                    // Merge negative sign with the following text
                    let end = operator_positions.get(idx + 1)
                        .map(|(next_pos, _)| *next_pos)
                        .unwrap_or(expr.len());
                    
                    if let Some(last) = result.last_mut() {
                        last.string.push_str(&expr[*pos..end]);
                    }
                    continue;
                }
            }

            // Add text after this operator
            let start = pos + 1;
            let end = operator_positions.get(idx + 1)
                .map(|(next_pos, _)| *next_pos)
                .unwrap_or(expr.len());
            
            result.push(SplitResult {
                string: expr[start..end].to_string(),
                operator_type: op.to_string(),
            });
        }

        Ok(result)
    }

    /// Solve a split result by evaluating operators
    fn solve_split_result(&mut self, mut split_result: Vec<SplitResult>, original_expr: &str) -> Result<f64, String> {
        // Handle parentheses first
        let mut index = split_result.iter().rposition(|x| x.operator_type == "(");
        
        while let Some(idx) = index {
            let closing_index = split_result.iter()
                .position(|x| x.operator_type == ")")
                .filter(|&i| i > idx);

            let closing_index = closing_index
                .ok_or_else(|| format!("Mismatched parentheses in {}", original_expr))?;

            // Solve the inner expression
            split_result[idx].operator_type = String::new();
            let inner_result = self.solve_without_parens(
                split_result[idx..closing_index].to_vec(),
                original_expr
            )?;

            // Replace the parenthesized section with the result
            let before = if idx > 0 {
                split_result[..idx - 1].to_vec()
            } else {
                Vec::new()
            };
            
            let middle = if idx > 0 {
                vec![SplitResult {
                    string: format!("{:.4}", inner_result),
                    operator_type: split_result[idx - 1].operator_type.clone(),
                }]
            } else {
                vec![SplitResult {
                    string: format!("{:.4}", inner_result),
                    operator_type: String::new(),
                }]
            };

            let after = if closing_index + 1 < split_result.len() {
                split_result[closing_index + 1..].to_vec()
            } else {
                Vec::new()
            };

            split_result = [before, middle, after].concat();
            index = split_result.iter().rposition(|x| x.operator_type == "(");
        }

        self.solve_without_parens(split_result, original_expr)
    }

    /// Solve expression without parentheses
    fn solve_without_parens(&mut self, split_result: Vec<SplitResult>, original_expr: &str) -> Result<f64, String> {
        // Check if this is a function call (has space operator)
        if split_result.iter().any(|x| x.operator_type == " ") {
            // Function call with space-separated arguments - reconstruct and eval
            let full_expr: String = split_result.iter()
                .map(|x| format!("{}{}", x.operator_type, x.string))
                .collect::<String>()
                .trim()
                .to_string();
            
            return self.eval_constant(&full_expr);
        }

        // Evaluate left-to-right with operators
        let mut left_val = self.fast_expr(&split_result[0].string)?;

        for i in 1..split_result.len() {
            let result = &split_result[i];
            if result.string.is_empty() {
                return Err(format!(
                    "Empty expression after operator {} in {}",
                    result.operator_type, original_expr
                ));
            }

            let right_val = self.fast_expr(&result.string)?;

            left_val = match result.operator_type.as_str() {
                "&" => if left_val != 0.0 && right_val != 0.0 { 1.0 } else { 0.0 },
                "|" => if left_val != 0.0 || right_val != 0.0 { 1.0 } else { 0.0 },
                "^" => left_val.powf(right_val),
                "_" => (left_val / right_val).floor() * right_val,
                "+" => left_val + right_val,
                "-" => left_val - right_val,
                "*" => left_val * right_val,
                "/" => left_val / right_val,
                "%" => left_val % right_val,
                _ => return Err(format!("Unknown operator: {}", result.operator_type)),
            };
        }

        Ok(left_val)
    }

    /// Check if a string is a valid number
    fn is_number(s: &str) -> bool {
        s.chars().all(|c| c.is_ascii_digit() || c == '.')
    }

    /// Check if a string is a number or negative number
    fn is_number_or_negative(s: &str) -> bool {
        if s.is_empty() {
            return false;
        }
        if s.starts_with('-') {
            Self::is_number(&s[1..])
        } else {
            Self::is_number(s)
        }
    }
}

impl Default for ExpressionParser {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_simple_numbers() {
        let mut parser = ExpressionParser::new();
        assert_eq!(parser.expr("42").unwrap(), 42.0);
        assert_eq!(parser.expr("3.14").unwrap(), 3.14);
        assert_eq!(parser.expr("-5").unwrap(), -5.0);
    }

    #[test]
    fn test_basic_arithmetic() {
        let mut parser = ExpressionParser::new();
        assert_eq!(parser.expr("2+3").unwrap(), 5.0);
        assert_eq!(parser.expr("10-4").unwrap(), 6.0);
        assert_eq!(parser.expr("6*7").unwrap(), 42.0);
        assert_eq!(parser.expr("15/3").unwrap(), 5.0);
        assert_eq!(parser.expr("17%5").unwrap(), 2.0);
    }

    #[test]
    fn test_operator_precedence() {
        let mut parser = ExpressionParser::new();
        // Note: This parser evaluates left-to-right without precedence rules
        assert_eq!(parser.expr("2+3*4").unwrap(), 20.0); // (2+3)*4 in left-to-right
    }

    #[test]
    fn test_parentheses() {
        let mut parser = ExpressionParser::new();
        assert_eq!(parser.expr("(2+3)*4").unwrap(), 20.0);
        assert_eq!(parser.expr("2*(3+4)").unwrap(), 14.0);
    }

    #[test]
    fn test_power_operator() {
        let mut parser = ExpressionParser::new();
        assert_eq!(parser.expr("2^3").unwrap(), 8.0);
        assert_eq!(parser.expr("5^2").unwrap(), 25.0);
    }

    #[test]
    fn test_logical_operators() {
        let mut parser = ExpressionParser::new();
        assert_eq!(parser.expr("1&1").unwrap(), 1.0);
        assert_eq!(parser.expr("1&0").unwrap(), 0.0);
        assert_eq!(parser.expr("0|1").unwrap(), 1.0);
        assert_eq!(parser.expr("0|0").unwrap(), 0.0);
    }

    #[test]
    fn test_negative_numbers() {
        let mut parser = ExpressionParser::new();
        assert_eq!(parser.expr("5+-3").unwrap(), 2.0);
        assert_eq!(parser.expr("-5+3").unwrap(), -2.0);
    }

    #[test]
    fn test_empty_expression() {
        let mut parser = ExpressionParser::new();
        assert!(parser.expr("").is_err());
        assert!(parser.expr("   ").is_err());
    }

    #[test]
    fn test_nested_parentheses() {
        let mut parser = ExpressionParser::new();
        assert_eq!(parser.expr("((2+3)*4)").unwrap(), 20.0);
        assert_eq!(parser.expr("(2+(3*4))").unwrap(), 14.0);
    }

    #[test]
    fn test_constants() {
        let mut parser = ExpressionParser::with_context(1.0, 1920.0, 1080.0);
        
        // Test time constant
        assert_eq!(parser.expr("T").unwrap(), 1.0);
        assert_eq!(parser.expr("T 2").unwrap(), 2.0);
        
        // Test height ratio
        let h_ratio = 1080.0 / 1920.0;
        assert!((parser.expr("H").unwrap() - h_ratio).abs() < 0.001);
        
        // Test sin
        assert!((parser.expr("sin 0.25").unwrap() - 1.0).abs() < 0.001);
        
        // Test abs
        assert_eq!(parser.expr("abs -5").unwrap(), 5.0);
        
        // Test NOT
        assert_eq!(parser.expr("! 0").unwrap(), 1.0);
        assert_eq!(parser.expr("! 1").unwrap(), 0.0);
        
        // Test ternary
        assert_eq!(parser.expr("? 1 5 10").unwrap(), 5.0);
        assert_eq!(parser.expr("? 0 5 10").unwrap(), 10.0);
    }
    
    #[test]
    fn test_new_constants() {
        let mut parser = ExpressionParser::new();
        
        // Test progress constants
        parser.set_progress(0.5, 10.0, 5.0, 3.0, 2);
        assert_eq!(parser.expr("S").unwrap(), 0.5);
        assert_eq!(parser.expr("C").unwrap(), 10.0);
        assert_eq!(parser.expr("L").unwrap(), 5.0);
        assert_eq!(parser.expr("P").unwrap(), 3.0);
        
        // Test index constants
        parser.set_indexes(vec![0.0, 5.0, 10.0], vec![1.0, 10.0, 20.0]);
        assert_eq!(parser.expr("N").unwrap(), 1.0);
        assert_eq!(parser.expr("N 1").unwrap(), 10.0);
        assert_eq!(parser.expr("I").unwrap(), 0.0);
        assert_eq!(parser.expr("I 1").unwrap(), 5.0);
        assert!((parser.expr("i 1").unwrap() - 5.0/9.0).abs() < 0.001);
        
        // Test negation
        assert_eq!(parser.expr("- 5").unwrap(), -5.0);
        
        // Test bell
        assert!((parser.expr("bell 0.5 0.3").unwrap() - 0.25).abs() < 0.1);
    }

    #[test]
    fn test_functions() {
        let mut parser = ExpressionParser::new();
        
        // Test mix
        assert_eq!(parser.expr("mix 1 2 3").unwrap(), 2.0);
        
        // Test choose
        assert_eq!(parser.expr("choose 0 10 20 30").unwrap(), 10.0);
        assert_eq!(parser.expr("choose 1 10 20 30").unwrap(), 20.0);
        
        // Test fib
        assert_eq!(parser.expr("fib 5").unwrap(), 5.0);
        assert_eq!(parser.expr("fib 6").unwrap(), 8.0);
        
        // Test PHI
        assert!((parser.expr("PHI").unwrap() - 1.6180339887).abs() < 0.0001);
    }

    #[test]
    fn test_fade() {
        let mut parser = ExpressionParser::new();
        
        // Test > (fade between values)
        assert_eq!(parser.expr("> 0 10 20").unwrap(), 10.0);
        assert!((parser.expr("> 1 10 20").unwrap() - 20.0).abs() < 0.01);
        assert!((parser.expr("> 0.5 10 20").unwrap() - 15.0).abs() < 0.001);
    }
}
