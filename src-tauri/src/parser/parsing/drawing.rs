use crate::parser::methods::asemic_pt::{AsemicPt, BasicPt};
use crate::parser::methods::expression_eval::ExpressionEval;
use crate::parser::methods::transforms::Transforms;
use crate::parser::parsing::text::TextMethods;
use crate::parser::TextParser;

/// Drawing mixin trait for ExpressionParser
/// Provides methods to draw geometric primitives using expressions
pub trait DrawingMixin {
    /// Parse a single point expression, returns a Vec of points
    fn parse_point(&mut self, point: &mut &str) -> Result<Vec<AsemicPt>, String>;

    /// Perform Bezier interpolation between multiple points
    fn bezier_interpolate(points: &[BasicPt], t: f64) -> Result<BasicPt, String>;

    /// Draw a circle at a given center with specified width and height
    ///
    /// # Arguments
    /// * `args` - [center_expr, width_height_expr, ...]
    fn circle(&mut self, args: &[&str]) -> Result<(), String>;

    /// Create a new group for organizing curves
    ///
    /// # Arguments
    /// * `args` - Optional group settings as space-separated key=value pairs
    ///   (e.g., ["mode=line", "count=100", "correction=0"])
    fn group(&mut self, args: &[&str]) -> Result<(), String>;

    /// Repeat a callback N times with loop variables
    ///
    /// # Arguments
    /// * `count` - Expression evaluating to the number of repetitions
    /// * `callback` - String expression to execute on each iteration
    ///
    /// # Loop Variables
    /// * `I` - Current iteration index (0-based)
    /// * `N` - Total iteration count
    /// * `i` - Normalized progress (0.0 to 1.0)
    fn repeat(&mut self, count: &str, callback: &str) -> Result<(), String>;

    /// Peek at a point in a curve
    ///
    /// # Arguments
    /// * `point_index` - Index from the end (0 = last point, 1 = second to last, etc.)
    /// * `curve_index` - Index of the curve to peek from. None uses current curve, Some(idx) where idx > 0 gets the previous curve (idx - 1).
    ///                  Negative indices are supported (e.g., -1 = last group)
    fn peek_last_point(
        &self,
        point_index: i32,
        curve_index: Option<i32>,
    ) -> Result<AsemicPt, String>;
}

impl DrawingMixin for TextParser {
    /// Perform quadratic/cubic Bezier interpolation between multiple points
    fn bezier_interpolate(points: &[BasicPt], t: f64) -> Result<BasicPt, String> {
        if points.is_empty() {
            return Err("No points provided for Bezier interpolation".to_string());
        }
        if points.len() == 1 {
            return Ok(points[0].clone());
        }

        // Simple De Casteljau algorithm for Bezier curves
        let mut current = points.to_vec();
        while current.len() > 1 {
            let mut next = Vec::new();
            for i in 0..current.len() - 1 {
                let mut pt = current[i].clone();
                pt.lerp(current[i + 1], t);
                next.push(pt);
            }
            current = next;
        }

        Ok(current[0].clone())
    }

    fn peek_last_point(
        &self,
        point_index: i32,
        curve_index: Option<i32>,
    ) -> Result<AsemicPt, String> {
        // Determine which curve to use
        let curve_to_peek = match curve_index {
            None => {
                if self.current_curve.is_empty() {
                    if let Some(last_group) = self.groups.last() {
                        if let Some(last_curve) = last_group.points.last() {
                            last_curve.clone()
                        } else {
                            return Err("No curves in last group".to_string());
                        }
                    } else {
                        return Err("No curves available".to_string());
                    }
                } else {
                    self.current_curve.clone()
                }
            }
            Some(idx) => {
                // Get the previous curve at the specified index
                let actual_curve_idx = if idx < 0 {
                    (self.groups.len() as i32 + idx) as usize
                } else {
                    idx as usize
                };

                if actual_curve_idx >= self.groups.len() {
                    return Err(format!("No curve at index {}", actual_curve_idx));
                }

                // Get the previous curve (actual_curve_idx - 1)

                if let Some(prev_group) = self.groups.get(actual_curve_idx - 1) {
                    if let Some(prev_curve_pts) = prev_group.points.last() {
                        prev_curve_pts.clone()
                    } else {
                        return Err("Previous group has no curves".to_string());
                    }
                } else {
                    return Err("No previous group available".to_string());
                }
            }
        };

        let len = curve_to_peek.len() as i32;

        if point_index < 0 {
            let idx = len as isize + point_index as isize;
            if idx >= 0 {
                return Ok(curve_to_peek[idx as usize].clone());
            }
        } else if point_index < len {
            let idx = len - 1 - point_index;
            return Ok(curve_to_peek[idx as usize].clone());
        }
        panic!("Index out of bounds in peek_last_point");
        Err("Index out of bounds".to_string())
    }

    fn parse_point(&mut self, point: &mut &str) -> Result<Vec<AsemicPt>, String> {
        let mut adding = false;
        let mut absolute = false;
        if point.starts_with('+') {
            *point = &point[1..];
            adding = true;
        } else if point.starts_with('=') {
            *point = &point[1..];
            absolute = true;
        }

        // Handle point constants '(name arg1 arg2...)'
        if point.starts_with('(') && point.ends_with(')') {
            let sliced = &point[1..point.len() - 1];
            let tokens: Vec<&str> = sliced.split_whitespace().collect();

            if tokens.is_empty() {
                return Err("Empty point constant".to_string());
            }

            let result: AsemicPt = match tokens[0] {
                // '..': Interpolate between previous point and target point
                // Usage: (.. target_point num_points)
                ".." => {
                    if tokens.len() < 3 {
                        return Err("'..' requires target point and number of points".to_string());
                    }

                    let num_points = self.expression_parser.expr(tokens[1])? as usize;
                    let target_expr = tokens[2].to_string();

                    if num_points == 0 {
                        return Err("Number of points must be greater than 0".to_string());
                    }

                    // Get the previous point
                    let prev_pt = self.peek_last_point(-1, None)?;
                    let mut target_expr_str = target_expr.as_str();
                    let arg = self.parse_point(&mut target_expr_str)?;
                    let target_point = *arg.first().ok_or("No target point returned")?;

                    // Generate interpolated points
                    let mut interpolated = Vec::new();
                    for i in 1..=num_points {
                        let t = 0.5;
                        let mut pt = prev_pt.clone().basic_pt();
                        let target_basic = target_point.basic_pt();
                        pt.lerp(target_basic, t);

                        interpolated.push(self.expression_parser.generate_point(&pt)?);
                    }
                    interpolated.push(target_point);

                    return Ok(interpolated);
                }
                ">" => {
                    if tokens.len() < 3 {
                        return Err("'>' requires at least progress and 2 points".to_string());
                    }

                    let progress = self.expression_parser.expr(tokens[1])?;
                    let mut fade = progress;
                    if fade >= 1.0 {
                        fade = 0.999;
                    } else if fade < 0.0 {
                        fade = 0.0;
                    }

                    // Evaluate all point arguments
                    let mut pts: Vec<BasicPt> = Vec::new();
                    for pt_expr in &tokens[2..] {
                        let pt = self.expression_parser.eval_point(pt_expr)?;
                        pts.push(pt);
                    }

                    let mut result = if pts.len() == 2 {
                        let mut res = pts[0].clone();
                        res.lerp(pts[1], fade);
                        res
                    } else {
                        // Quadratic/cubic Bezier for 3+ points
                        TextParser::bezier_interpolate(&pts, fade)?
                    };

                    let transform_clone = self
                        .expression_parser
                        .transforms
                        .last()
                        .ok_or("No transform found")?
                        .clone();

                    transform_clone.apply_transform(
                        &mut result,
                        false,
                        &mut self.expression_parser,
                    )?
                }
                // '<': Reverse transform of a point from a curve
                // Usage: (< pointN [curveN])
                "<" => {
                    if tokens.len() < 2 {
                        return Err("'<' requires at least pointN".to_string());
                    }

                    let progress = self.expression_parser.expr(tokens[1])?;

                    // Determine which curve to use
                    let curve_idx = if tokens.len() > 2 {
                        Some(self.expression_parser.expr(tokens[2])? as i32)
                    } else {
                        None
                    };

                    // Get the curve via peek_last_point to fetch the previous curve if needed
                    let last_curve = if curve_idx == None {
                        if (self.current_curve.is_empty()) {
                            if let Some(last_group) = self.groups.last() {
                                if let Some(last_curve) = last_group.points.last() {
                                    last_curve.clone()
                                } else {
                                    return Err("No curves in last group".to_string());
                                }
                            } else {
                                return Err("No curves available".to_string());
                            }
                        } else {
                            self.current_curve.clone()
                        }
                    } else {
                        if let Some(prev_group) = self.groups.get(self.groups.len() - 1) {
                            if let Some(prev_curve_pts) =
                                prev_group.points.get(if curve_idx.unwrap() < 0 {
                                    (prev_group.points.len() as i32 + curve_idx.unwrap()) as usize
                                } else {
                                    curve_idx.unwrap() as usize
                                })
                            {
                                prev_curve_pts.clone()
                            } else {
                                return Err("Previous group has no curves".to_string());
                            }
                        } else {
                            return Err("No previous group available".to_string());
                        }
                    };

                    // Interpolate point on curve
                    if last_curve.len() < 2 {
                        return Err("Curve has insufficient points for interpolation".to_string());
                    }

                    let mut fade = progress;
                    if fade >= 1.0 {
                        fade = 0.999;
                    } else if fade < 0.0 {
                        fade = 0.0;
                    }

                    let index = (last_curve.len() as f64 - 1.0) * fade;
                    let floor_idx = index.floor() as usize;
                    let local_t = index.fract();

                    if floor_idx >= last_curve.len() - 1 {
                        return Err("Index out of bounds in curve interpolation".to_string());
                    }

                    let mut result = last_curve[floor_idx].clone().basic_pt();
                    result.lerp(last_curve[floor_idx + 1].clone().basic_pt(), local_t);

                    // Reverse transform: undo the current transform
                    let transform_clone = self
                        .expression_parser
                        .transforms
                        .last()
                        .ok_or("No transform found")?
                        .clone()
                        .solve(&mut self.expression_parser)
                        .unwrap();

                    AsemicPt::new(
                        result.x,
                        result.y,
                        transform_clone.w,
                        transform_clone.h,
                        transform_clone.s,
                        transform_clone.l,
                        transform_clone.a,
                    )
                }
                _ => return Err(format!("Unknown point constant: {}", tokens[0])),
            };

            // Convert BasicPt to AsemicPt with transform metadata

            return Ok(vec![result]);
        }

        let mut pt = self.expression_parser.eval_point(point)?;

        if (absolute) {
            return Ok(vec![self.expression_parser.generate_point(&pt)?]);
        }

        let transform_clone = self
            .expression_parser
            .transforms
            .last()
            .ok_or("No transform found")?
            .clone();
        let mut transformed_pt =
            transform_clone.apply_transform(&mut pt, false, &mut self.expression_parser)?;
        if adding {
            let last_pt = self.peek_last_point(-1, None)?;
            transformed_pt.x -= transform_clone.translate.x;
            transformed_pt.y -= transform_clone.translate.y;
            transformed_pt.x += last_pt.x;
            transformed_pt.y += last_pt.y;
        }
        Ok(vec![transformed_pt])
    }

    fn circle(&mut self, args: &[&str]) -> Result<(), String> {
        if args.is_empty() {
            return Err("circle requires at least center expression".to_string());
        }

        let mut center_str = args[0];
        let wh_str = args.get(1).copied().unwrap_or("1");

        // Apply transform: > +center *wh
        // Then draw circle as polygon
        // For now, simplified implementation:
        // A circle is drawn as a polygon approximation
        self.expression_parser.push_transform();

        let center_pts = self.parse_point(&mut center_str)?;
        let center_pt = center_pts.first().ok_or("No center point returned")?;
        let _tr = self.expression_parser.peek_transform();
        let wh_pt = self.expression_parser.eval_point(&mut wh_str.to_string())?;

        self.expression_parser.modify_transform(|x| {
            x.translate = BasicPt {
                x: center_pt.x,
                y: center_pt.y,
            };
            x.scale.scale(wh_pt, None);
        })?;

        let circle_points = "-1,0 -1,-1 1,-1 1,1 -1,1 -1,0";
        let points: Vec<String> = self.tokenizer.tokenize_points(&circle_points);
        for point in points {
            let pts = self.parse_point(&mut point.as_str())?;
            for pt in pts {
                self.add_point(pt);
            }
        }
        self.end_curve(false)?;
        self.expression_parser.pop_transform();
        Ok(())
    }

    fn group(&mut self, args: &[&str]) -> Result<(), String> {
        // Parse group settings from arguments
        // Default settings: mode=line, vert=0,0, curve=true, count=100, correction=0, close=false
        let mut mode = "line".to_string();
        let mut vert = "0,0".to_string();
        let mut a = None;
        let mut curve_str = "true".to_string();
        let mut count = 100;
        let mut correction = 0.0;
        let mut close = false;

        // Parse key=value pairs from arguments
        for arg in args {
            if let Some(eq_pos) = arg.find('=') {
                let key = &arg[..eq_pos];
                let value = &arg[eq_pos + 1..];

                match key {
                    "mode" => mode = value.to_string(),
                    "vert" => vert = value.to_string().replace("\"", ""),
                    "curve" => curve_str = value.to_string(),
                    "a" => a = Some(value.to_string().replace("\"", "")),
                    "count" => {
                        if let Ok(n) = value.parse::<usize>() {
                            count = n;
                        }
                    }
                    "correction" => {
                        if let Ok(n) = value.parse::<f64>() {
                            correction = n;
                        }
                    }
                    "close" => close = value.parse::<bool>().unwrap_or(false),
                    _ => {} // Ignore unknown keys
                }
            }
        }

        // Create new group with the parsed settings
        let new_group = crate::parser::parsing::text_parser::Group {
            points: vec![],
            settings: crate::parser::parsing::text_parser::GroupSettings {
                mode,
                texture: None,
                a,
                synth: None,
                xy: None,
                wh: None,
                vert,
                curve: curve_str,
                count: count as i32,
                correction,
                close: Some(close),
                blend: None,
            },
        };

        self.groups.push(new_group);

        Ok(())
    }

    fn repeat(&mut self, count: &str, callback: &str) -> Result<(), String> {
        // Evaluate the count expression to determine number of iterations
        let count_value = self.expression_parser.expr(count)?;
        let num_iterations = count_value.max(0.0) as usize;

        // Save the current iteration state to restore later
        let saved_indexes = self.expression_parser.indexes.clone();
        let saved_count_nums = self.expression_parser.count_nums.clone();

        // Ensure vectors are large enough for the loop
        while self.expression_parser.indexes.len() < 3 {
            self.expression_parser.indexes.push(0.0);
        }
        while self.expression_parser.count_nums.len() < 3 {
            self.expression_parser.count_nums.push(0.0);
        }

        // Store the iteration count at index 0
        self.expression_parser.count_nums[0] = num_iterations as f64;

        // Perform iterations
        for i in 0..num_iterations {
            // Set loop variable: I = current iteration index (0-based)
            self.expression_parser.indexes[0] = i as f64;

            // Execute the callback (in a real implementation, this would evaluate the callback expression)
            // For now, this is a placeholder - would need integration with text parsing
            self.text(callback)?;
        }

        // Restore the iteration state
        self.expression_parser.indexes = saved_indexes;
        self.expression_parser.count_nums = saved_count_nums;

        Ok(())
    }
}
