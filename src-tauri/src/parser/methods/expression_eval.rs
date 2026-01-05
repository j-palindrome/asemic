use crate::parser::methods::expressions::{ExpressionParser, SplitResult};

pub trait ExpressionEval {
    /// Main expression evaluation function
    fn expr(&mut self, expr: &str) -> Result<f64, String>;

    /// Evaluate a list of expressions separated by commas
    fn expr_list(&mut self, exprs: &str) -> Result<Vec<f64>, String>;

    /// Fast expression evaluation for single terms
    fn fast_expr(&mut self, string_expr: &str) -> Result<f64, String>;

    /// Evaluate built-in constants and functions
    fn eval_constant(&mut self, expr: &str) -> Result<f64, String>;

    /// Evaluate an expression that returns a point (x, y coordinates)
    fn expr_point(&mut self, expr: &str, default: Option<f64>) -> Result<(f64, f64), String>;

    /// Split expression by operators while respecting precedence
    fn split_by_operators(&self, expr: &str) -> Result<Vec<SplitResult>, String>;

    /// Solve a split result by evaluating operators
    fn solve_split_result(
        &mut self,
        split_result: Vec<SplitResult>,
        original_expr: &str,
    ) -> Result<f64, String>;

    /// Solve expression without parentheses
    fn solve_without_parens(
        &mut self,
        split_result: Vec<SplitResult>,
        original_expr: &str,
    ) -> Result<f64, String>;

    /// Check if a string is a valid number
    fn is_number(s: &str) -> bool;

    /// Check if a string is a number or negative number
    fn is_number_or_negative(s: &str) -> bool;

    fn hash(&mut self, seed: Option<f64>) -> f64;
}

impl ExpressionEval for ExpressionParser {
    fn expr_point(&mut self, expr: &str, default: Option<f64>) -> Result<(f64, f64), String> {
        let values = self.expr_list(expr)?;
        Ok((
            values[0],
            values
                .get(1)
                .copied()
                .unwrap_or(default.unwrap_or(values[0])),
        ))
    }

    fn expr_list(&mut self, exprs: &str) -> Result<Vec<f64>, String> {
        exprs.split(',').map(|expr| self.expr(expr)).collect()
    }

    fn expr(&mut self, expr: &str) -> Result<f64, String> {
        let expr = expr.trim();

        if expr.is_empty() {
            return Err("Empty expression".to_string());
        }

        if Self::is_number(expr) {
            return expr
                .parse::<f64>()
                .map_err(|_| format!("{} is not a valid number", expr));
        }

        let expr = if expr.contains('`') {
            return Err("Backtick expressions not supported in Rust parser".to_string());
        } else {
            expr.to_string()
        };

        let split_result = if let Some(cached) = self.operator_split_cache.get(&expr) {
            cached.clone()
        } else {
            let splits = self.split_by_operators(&expr)?;
            if self.operator_split_cache.len() >= self.cache_max_size {
                self.operator_split_cache.clear();
            }
            self.operator_split_cache
                .insert(expr.clone(), splits.clone());
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

    fn fast_expr(&mut self, string_expr: &str) -> Result<f64, String> {
        if string_expr.is_empty() {
            return Err("Empty expression".to_string());
        }

        if Self::is_number_or_negative(string_expr) {
            return string_expr
                .parse::<f64>()
                .map_err(|_| format!("{} is NaN", string_expr));
        }

        if string_expr.contains(',') {
            return Err(format!("Vector {} passed, scalar expected", string_expr));
        }

        self.eval_constant(string_expr)
    }

    fn hash(&mut self, seed: Option<f64>) -> f64 {
        let seed_offset = self.seeds.get((self.curve as usize) % 100).unwrap_or(&0.0);
        let seed_val = seed.unwrap_or(self.curve) + seed_offset;
        let bits = seed_val.to_bits() as u64;
        let xor_hash = bits ^ (bits >> 32) ^ (bits >> 16);
        let hash = ((xor_hash as f64) / (u32::MAX as f64)).fract();
        self.curve += 1.0;
        hash
    }

    fn eval_constant(&mut self, expr: &str) -> Result<f64, String> {
        // List of all known function names
        let functions = vec![
            "PHI", "choose", "tangent", "peaks", "sah", "bell", "sin", "abs", "fib", "<>", "~",
            "-", "?", ">", "!", "S", "C", "L", "P", "N", "I", "i", "T", "#", "H", "px", "table",
        ];

        // Find the longest matching function name at the start of expr
        let mut longest_match: Option<&str> = None;
        for func in functions.iter() {
            if expr.starts_with(func) {
                if longest_match.is_none() || func.len() > longest_match.unwrap().len() {
                    longest_match = Some(func);
                }
            }
        }

        let (func_name, remaining) = match longest_match {
            Some(name) => (name, &expr[name.len()..].trim_start()),
            None => {
                if let Some(value) = self.get_param(expr, 0) {
                    return Ok(value);
                } else if let Some(value) = self.get_constant(expr) {
                    return Ok(value);
                } else {
                    return Err(format!("Unknown constant or function: {}", expr));
                }
            }
        };

        let args: Vec<&str> = remaining.split_whitespace().collect();

        match func_name {
            "S" => Ok(self.scene_metadata.scrub),
            "C" => Ok(self.curve),
            "L" => Ok(self.letter),
            "P" => Ok(self.point),
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
            "-" => {
                if args.is_empty() {
                    return Err("- requires an argument".to_string());
                }
                let val = self.expr(args[0])?;
                Ok(-val)
            }
            "T" => {
                let current_time = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_secs_f64();
                if args.is_empty() {
                    Ok(current_time)
                } else {
                    let multiplier = self.expr(args[0])?;
                    Ok(current_time * multiplier)
                }
            }
            "sin" => {
                if args.is_empty() {
                    return Err("sin requires an argument".to_string());
                }
                let val = self.expr(args[0])?;
                Ok((val * std::f64::consts::PI * 2.0).sin())
            }
            "abs" => {
                if args.is_empty() {
                    return Err("abs requires an argument".to_string());
                }
                let val = self.expr(args[0])?;
                Ok(val.abs())
            }
            "!" => {
                if args.is_empty() {
                    return Err("! requires an argument".to_string());
                }
                let val = self.expr(args[0])?;
                Ok(if val != 0.0 { 0.0 } else { 1.0 })
            }
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

                let values: Result<Vec<f64>, String> =
                    args[1..].iter().map(|arg| self.expr(arg)).collect();
                let values = values?;

                if values.len() < 2 {
                    return Err("> requires at least 2 values".to_string());
                }

                let index = (values.len() - 1) as f64 * fade;
                let i = index.floor() as usize;
                let t = index.fract();

                Ok(values[i] * (1.0 - t) + values[i + 1] * t)
            }
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
            "mix" => {
                if args.is_empty() {
                    return Err("mix requires arguments".to_string());
                }
                let sum: Result<f64, String> = args
                    .iter()
                    .map(|arg| self.expr(arg))
                    .try_fold(0.0, |acc, res| res.map(|v| acc + v));
                Ok(sum? / args.len() as f64)
            }
            "PHI" => {
                let exponent = if args.is_empty() {
                    1.0
                } else {
                    self.expr(args[0])?
                };
                Ok(1.6180339887_f64.powf(exponent))
            }
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
            "#" => {
                let seed = if args.is_empty() {
                    self.curve
                } else {
                    self.expr(args[0])?
                };
                let seed_offset = self.seeds.get((self.curve as usize) % 100).unwrap_or(&0.0);
                let hash = (seed * (43758.5453123 + seed_offset)) % 1.0;
                self.curve += 1.0;
                Ok(hash)
            }
            "<>" => {
                if args.is_empty() {
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
            "sah" => {
                if args.len() < 2 {
                    return Err("sah requires 2 arguments".to_string());
                }
                let key = format!("{}", self.noise_index);
                self.noise_index += 1;

                let val1 = self.expr(args[0])?;
                let val2 = self.expr(args[1])?;

                let state = self.noise_table.entry(key.clone()).or_insert(
                    crate::parser::methods::expressions::NoiseState::SampleAndHold {
                        value: 0.0,
                        sampling: false,
                    },
                );

                if let crate::parser::methods::expressions::NoiseState::SampleAndHold {
                    value,
                    sampling,
                } = state
                {
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
            "~" => {
                let hash = self.hash(None);
                let freq = self.expr_point(args[0], Some(hash))?;
                let current_time = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_secs_f64();
                Ok(((current_time * freq.0 + freq.1) * std::f64::consts::PI * 2.0).sin())
            }
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
            "tangent" => Err(
                "tangent requires curve data and is not fully implemented in Rust parser"
                    .to_string(),
            ),
            "peaks" => {
                if args.len() < 2 {
                    return Err("peaks requires at least 2 arguments".to_string());
                }
                let pos = self.expr(args[0])?;

                for peak_str in &args[1..] {
                    let parts: Vec<&str> = peak_str.split(',').collect();
                    if parts.len() >= 2 {
                        let peak_pos = parts[0]
                            .parse::<f64>()
                            .map_err(|_| format!("Invalid peak position: {}", parts[0]))?;
                        let peak_width = parts[1]
                            .parse::<f64>()
                            .map_err(|_| format!("Invalid peak width: {}", parts[1]))?;

                        let diff = (pos - peak_pos).abs();
                        if diff < peak_width {
                            return Ok(1.0 - diff / peak_width);
                        }
                    }
                }
                Ok(0.0)
            }
            "H" => Ok(self.scene_metadata.height / self.scene_metadata.width),
            "px" => Ok(1.0 / self.scene_metadata.width),
            "table" => Err(
                "table requires image data and is not fully implemented in Rust parser".to_string(),
            ),
            _ => {
                if let Some(value) = self.get_param(func_name, 0) {
                    Ok(value)
                } else if let Some(value) = self.get_constant(func_name) {
                    Ok(value)
                } else {
                    Err(format!("Unknown constant or function: {}", func_name))
                }
            }
        }
    }

    fn split_by_operators(&self, expr: &str) -> Result<Vec<SplitResult>, String> {
        let operators = ['&', '|', '^', '_', '+', '-', '*', '/', '%', '(', ')', ' '];
        let mut result = Vec::new();
        let mut operator_positions: Vec<(usize, char)> = Vec::new();

        for (i, ch) in expr.chars().enumerate() {
            if operators.contains(&ch) {
                operator_positions.push((i, ch));
            }
        }

        if operator_positions.is_empty() {
            return Ok(vec![SplitResult {
                string: expr.to_string(),
                operator_type: String::new(),
            }]);
        }

        for (idx, (pos, op)) in operator_positions.iter().enumerate() {
            if idx == 0 {
                let text = expr[..*pos].to_string();
                result.push(SplitResult {
                    string: text,
                    operator_type: String::new(),
                });
            }

            if *op == '-' {
                let is_at_start = *pos == 0;
                let is_after_operator = idx > 0
                    && operator_positions
                        .get(idx - 1)
                        .map(|(prev_pos, _)| prev_pos + 1 == *pos)
                        .unwrap_or(false);

                if is_at_start || is_after_operator {
                    let end = operator_positions
                        .get(idx + 1)
                        .map(|(next_pos, _)| *next_pos)
                        .unwrap_or(expr.len());

                    if let Some(last) = result.last_mut() {
                        last.string.push_str(&expr[*pos..end]);
                    }
                    continue;
                }
            }

            let start = pos + 1;
            let end = operator_positions
                .get(idx + 1)
                .map(|(next_pos, _)| *next_pos)
                .unwrap_or(expr.len());

            result.push(SplitResult {
                string: expr[start..end].to_string(),
                operator_type: op.to_string(),
            });
        }

        Ok(result)
    }

    fn solve_split_result(
        &mut self,
        mut split_result: Vec<SplitResult>,
        original_expr: &str,
    ) -> Result<f64, String> {
        let mut index = split_result.iter().rposition(|x| x.operator_type == "(");

        while let Some(idx) = index {
            let closing_index = split_result
                .iter()
                .position(|x| x.operator_type == ")")
                .filter(|&i| i > idx);

            let closing_index = closing_index
                .ok_or_else(|| format!("Mismatched parentheses in {}", original_expr))?;

            split_result[idx].operator_type = String::new();
            let inner_result = self
                .solve_without_parens(split_result[idx..closing_index].to_vec(), original_expr)?;

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

    fn solve_without_parens(
        &mut self,
        split_result: Vec<SplitResult>,
        original_expr: &str,
    ) -> Result<f64, String> {
        if split_result.iter().any(|x| x.operator_type == " ") {
            let full_expr: String = split_result
                .iter()
                .map(|x| format!("{}{}", x.operator_type, x.string))
                .collect::<String>()
                .trim()
                .to_string();

            return self.eval_constant(&full_expr);
        }

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
                "&" => {
                    if left_val != 0.0 && right_val != 0.0 {
                        1.0
                    } else {
                        0.0
                    }
                }
                "|" => {
                    if left_val != 0.0 || right_val != 0.0 {
                        1.0
                    } else {
                        0.0
                    }
                }
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

    fn is_number(s: &str) -> bool {
        s.chars().all(|c| c.is_ascii_digit() || c == '.')
    }

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
