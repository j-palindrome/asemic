use crate::parser::methods::asemic_pt::AsemicPt;
use crate::parser::methods::expression_eval::ExpressionEval;
use crate::parser::methods::expressions::ExpressionParser;
use crate::parser::methods::transforms::Transforms;
use crate::parser::parsing::text::TextMethods;
use crate::parser::TextParser;

/// Drawing mixin trait for ExpressionParser
/// Provides methods to draw geometric primitives using expressions
pub trait DrawingMixin {
    /// Draw a line from start point to end point
    ///
    /// # Arguments
    /// * `points` - Array of point expressions (e.g., ["0,0", "100,100", "50,50"])
    ///   Supports formats: "x,y", "@theta,radius", or numeric expressions
    ///
    /// # Returns
    /// A vector of `AsemicPt` representing the line vertices
    ///
    /// # Example
    /// ```ignore
    /// parser.line(&["0,0", "100,100"])?;
    /// ```
    fn line(&mut self, points: &[&str]) -> Result<Vec<AsemicPt>, String>;

    /// Draw a 3-point curve (quadratic Bezier-like)
    /// Points: start, control, end
    fn c3(&mut self, args: &[&str]) -> Result<(), String>;

    /// Draw a 4-point curve
    /// Points: start, control1, control2, end with wave distortion
    fn c4(&mut self, args: &[&str]) -> Result<(), String>;

    /// Draw a 5-point curve
    /// Points: start, control1, control2, control3, end with symmetric wave
    fn c5(&mut self, args: &[&str]) -> Result<(), String>;

    /// Draw a 6-point curve
    /// Points: start, control1, control2, control3, control4, end with rectangular wave
    fn c6(&mut self, args: &[&str]) -> Result<(), String>;

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

    /// Protected helper: Map curve points with transformations
    fn map_curve(
        &mut self,
        multiply_points: Vec<AsemicPt>,
        add_points: Vec<AsemicPt>,
        start: AsemicPt,
        end: AsemicPt,
        add: bool,
    ) -> Result<(), String>;

    /// Protected helper: Parse and process curve points
    fn parse_curve(&mut self, args: &[&str], points: &str) -> Result<(), String>;
}

impl DrawingMixin for TextParser {
    fn line(&mut self, points: &[&str]) -> Result<Vec<AsemicPt>, String> {
        let mut result = Vec::new();
        for point in points {
            let mut pt = ExpressionParser::eval_point(point, false, 0.0)?;

            if let Some(transform) = self.expression_parser.transforms.last() {
                let transform_clone = transform.clone();
                result.push(transform_clone.apply_transform(
                    &mut pt,
                    false,
                    &mut self.expression_parser,
                )?);
            }
        }
        Ok(result)
    }

    fn c3(&mut self, args: &[&str]) -> Result<(), String> {
        self.parse_curve(args, "0,0 .5,1 1,0")
    }

    fn c4(&mut self, args: &[&str]) -> Result<(), String> {
        self.parse_curve(args, "0,0 -$W,1 1+$W,1 1,0")
    }

    fn c5(&mut self, args: &[&str]) -> Result<(), String> {
        self.parse_curve(args, "0,0 -$W,0.5 .5,1 1+$W,.5 1,0")
    }

    fn c6(&mut self, args: &[&str]) -> Result<(), String> {
        self.parse_curve(args, "0,0 -$W,0 -$W,1 1+$W,1 1+$W,0 1,0")
    }

    fn circle(&mut self, args: &[&str]) -> Result<(), String> {
        if args.is_empty() {
            return Err("circle requires at least center expression".to_string());
        }

        let center_str = args[0];
        let wh_str = args.get(1).copied().unwrap_or("1");

        // Apply transform: > +center *wh
        // Then draw circle as polygon
        // For now, simplified implementation:
        // A circle is drawn as a polygon approximation
        let circle_points = "[-1,0 -1,-1 1,-1 1,1 -1,1]<";

        self.parse_curve(&[center_str, wh_str, "0"], circle_points)
    }

    fn group(&mut self, args: &[&str]) -> Result<(), String> {
        // Parse group settings from arguments
        // Default settings: mode=line, vert=0,0, curve=true, count=100, correction=0, close=false
        let mut mode = "line".to_string();
        let mut vert = "0,0".to_string();
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
                    "vert" => vert = value.to_string(),
                    "curve" => curve_str = value.to_string(),
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
            points: vec![Vec::new()],
            mode,
            texture: None,
            a: None,
            synth: None,
            xy: None,
            wh: None,
            vert,
            curve: curve_str,
            count: count as i32,
            correction,
            close: Some(close),
            blend: None,
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

    fn map_curve(
        &mut self,
        multiply_points: Vec<AsemicPt>,
        add_points: Vec<AsemicPt>,
        start: AsemicPt,
        end: AsemicPt,
        _add: bool,
    ) -> Result<(), String> {
        if multiply_points.is_empty() {
            return Ok(());
        }

        // Calculate angle and distance from start to end
        let end_basic = end.basic_pt();
        let start_basic = start.basic_pt();
        let mut diff = end_basic;
        diff.subtract(start_basic);
        let angle = diff.angle_0_to_1();
        let distance = diff.magnitude();

        // Transform the points
        let mut transformed_points = Vec::new();
        for (i, mut pt) in multiply_points.into_iter().enumerate() {
            // Scale by distance
            pt.x *= distance;

            // Add the corresponding add point
            if i < add_points.len() {
                pt.add(add_points[i]);
            }

            // Rotate by angle and translate
            let mut basic = pt.basic_pt();
            basic.rotate(angle, None);
            basic.add(start_basic);
            pt.x = basic.x;
            pt.y = basic.y;

            transformed_points.push(pt);
        }

        // Update point progress tracking
        let _previous_length = self.expression_parser.point;
        self.expression_parser.point += (transformed_points.len() + 2) as f64;

        // Apply transforms to all points using the transform stack
        let mut final_points = vec![start];
        for pt in transformed_points {
            let mut basic = pt.basic_pt();
            // Apply the current transform from the stack if available
            let transformed = if let Some(transform) = self.expression_parser.peek_transform() {
                // Clone the transform to avoid borrowing issues
                let transform_clone = transform.clone();
                transform_clone.apply_transform(&mut basic, false, &mut self.expression_parser)?
            } else {
                AsemicPt::new(basic.x, basic.y, pt.w, pt.h, pt.s, pt.l, pt.a)
            };
            final_points.push(transformed);
        }
        final_points.push(end);

        // Store the curve in the parser's curve collection
        // Note: This assumes the parser has a field to store curves
        // TODO: Implement curve storage in parser state

        Ok(())
    }

    fn parse_curve(&mut self, args: &[&str], points: &str) -> Result<(), String> {
        // Step 1: Push transform to '>' (shift to relative coordinates)
        // The '>' transform represents a reference frame shift

        self.expression_parser.push_transform();

        // Step 2: Create and apply remap transformation with center, width, height
        // args[0] = center expression
        // args[1] = width expression
        // args[2] = height expression
        // args[3] = wave width (for c4, c5, c6)
        // args[4] = continue flag (if present, don't end the curve)
        // let mut remap_transform = Transform::new();
        // if let Some(center) = args.get(0) {
        //     remap_transform.add = Some(center.to_string());
        // }
        // if let Some(width) = args.get(1) {
        //     remap_transform.w = width.to_string();
        // }
        // if let Some(height) = args.get(2) {
        //     remap_transform.h = height.to_string();
        // }
        // self.expression_parser.modify_transform(f);

        // Step 3: Substitute $W placeholder with the wave width value
        let w_expr = args.get(3).copied().unwrap_or("0");
        let points_expr = points.replace("$W", w_expr);

        // Step 4: Parse the points string into individual point expressions
        // Format: "x1,y1 x2,y2 x3,y3 ..." or with angle notation "@angle,radius"
        let point_strs: Vec<&str> = points_expr.split_whitespace().collect();

        let mut parsed_points = Vec::new();

        for point_str in point_strs {
            // Parse each point - can be "x,y" or "@angle,radius" format
            match ExpressionParser::eval_point(point_str, false, 0.0) {
                Ok(pt) => {
                    parsed_points.push(AsemicPt::new(
                        pt.x, pt.y, 0.0, // w
                        0.0, // h
                        1.0, // s
                        1.0, // l
                        1.0, // a
                    ));
                }
                Err(e) => {
                    return Err(format!("Failed to parse point '{}': {}", point_str, e));
                }
            }
        }

        // Step 5: Apply transforms and add points to curve
        // The chopFirst option determines whether to skip the first point
        // (if the curve already has points, to avoid duplication)
        let chop_first = !parsed_points.is_empty();
        let points_to_add = if chop_first && parsed_points.len() > 1 {
            &parsed_points[1..]
        } else {
            &parsed_points[..]
        };

        for pt in points_to_add {
            // Apply current transform stack to each point
            let mut basic = pt.basic_pt();
            if let Some(transform) = self.expression_parser.peek_transform() {
                // Clone the transform to avoid borrowing issues
                let transform_clone = transform.clone();
                let _transformed = transform_clone.apply_transform(
                    &mut basic,
                    false,
                    &mut self.expression_parser,
                )?;
                // TODO: Add transformed point to current_curve
            } else {
                // TODO: Add point to current_curve
            }
        }

        // Step 6: If args[4] is not provided, finalize the curve
        if args.get(4).is_none() {
            self.end_curve(false)?;
        }

        // Step 7: Pop remap and relative transforms to restore absolute coordinates
        self.expression_parser.pop_transform(); // Pop remap
        self.expression_parser.pop_transform(); // Pop relative ('>')

        Ok(())
    }
}
