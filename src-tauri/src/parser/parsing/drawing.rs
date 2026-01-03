use crate::parser::methods::asemic_pt::{AsemicPt, BasicPt};
use crate::parser::methods::expression_eval::ExpressionEval;
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
    fn line(&mut self, points: &str, end: bool) -> Result<(), String>;

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

    /// Protected helper: Parse and process curve points
    fn parse_curve(&mut self, args: &[&str], points: &str) -> Result<(), String>;
}

impl DrawingMixin for TextParser {
    fn line(&mut self, points: &str, end: bool) -> Result<(), String> {
        let tokens: Vec<String> = self.tokenizer.tokenize_points(points);
        for point in tokens {
            let mut pt = self.expression_parser.eval_point(point.as_str())?;

            if let Some(transform) = self.expression_parser.transforms.last() {
                let transform_clone = transform.clone();
                let transformed_pt =
                    transform_clone.apply_transform(&mut pt, false, &mut self.expression_parser)?;
                self.add_point(transformed_pt);
            }
        }
        if end {
            self.end_curve(false)?;
        }
        Ok(())
    }

    fn c3(&mut self, args: &[&str]) -> Result<(), String> {
        self.parse_curve(args, "0,0 .5,$H 1,0")
    }

    fn c4(&mut self, args: &[&str]) -> Result<(), String> {
        self.parse_curve(args, "0,0 -$W,$H 1+$W,$H 1,0")
    }

    fn c5(&mut self, args: &[&str]) -> Result<(), String> {
        self.parse_curve(args, "0,0 -$W,0.5*$H .5,$H $H+$W,.5*$H 1,0")
    }

    fn c6(&mut self, args: &[&str]) -> Result<(), String> {
        self.parse_curve(args, "0,0 -$W,0 -$W,$H 1+$W,$H 1+$W,0 1,0")
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
        let circle_points = "-1,0 -1,-1 1,-1 1,1 -1,1 -1,0";

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
            settings: crate::parser::parsing::text_parser::GroupSettings {
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

    fn parse_curve(&mut self, points: &[&str], template: &str) -> Result<(), String> {
        // Step 1: Push transform to '>' (shift to relative coordinates)
        // The '>' transform represents a reference frame shift

        self.expression_parser.push_transform();
        let should_end_curve = if points.len() >= 5 {
            !points[4].contains('+')
        } else {
            true
        };

        let points: Vec<BasicPt> = points
            .iter()
            .take(3) // Limit to first 3 points
            .map(|x| self.expression_parser.eval_point(x))
            .collect::<Result<Vec<_>, _>>()?;
        assert!(points.len() >= 3, "points must contain at least 3 elements");

        let parsed_points = template
            .replace("$W", &format!("{}", points[2].x))
            .replace("$H", &format!("{}", points[2].y));
        self.line(&parsed_points, should_end_curve)?;

        // Step 7: Pop remap and relative transforms to restore absolute coordinates
        self.expression_parser.pop_transform(); // Pop remap

        Ok(())
    }
}
