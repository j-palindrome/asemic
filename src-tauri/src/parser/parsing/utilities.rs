use crate::parser::parsing::drawing::DrawingMixin;
use crate::parser::parsing::text::TextMethods;
use crate::parser::parsing::text_parser::Group;
use crate::parser::{ExpressionEval, TextParser};

pub trait Utilities {
    fn align(&mut self, coords: &str, align_type: &str, callback: &str) -> Result<(), String>;
    fn get_bounds(group: &Group, from_curve: usize) -> [f64; 4];
}

impl Utilities for TextParser {
    /// Aligns drawn content within a specified bounding box.
    ///
    /// # Arguments
    /// * `parser` - Mutable reference to the parser instance
    /// * `coords` - Center coordinates as a string (e.g., "100,200")
    /// * `align_type` - Alignment type as a string
    /// * `callback` - Function or expression to draw content to be aligned
    fn align(&mut self, coords: &str, align_type: &str, callback: &str) -> Result<(), String> {
        // Parse center coordinates
        let (center_x, center_y) = self.expression_parser.expr_point(&coords)?;

        // Evaluate alignment values
        let (align_x, align_y) = self.expression_parser.expr_point(&align_type)?;

        // Store the starting curve index before executing callback
        let start_curve = self.groups.last().map(|g| g.points.len()).unwrap_or(0);

        // Execute callback to draw content
        self.text(&callback)?;

        // Get bounds of newly added content

        let last_group = &mut self.groups.last_mut().unwrap();
        let [min_x, min_y, max_x, max_y] = Self::get_bounds(last_group, start_curve);

        // Calculate alignment offset
        let width = max_x - min_x;
        let height = max_y - min_y;
        let change_x = width * align_x;
        let change_y = height * align_y;

        // Update all points in added curves
        for curve in last_group.points[start_curve..].iter_mut() {
            for pt in curve.iter_mut() {
                pt.x = center_x + (pt.x - min_x) - change_x;
                pt.y = center_y + (pt.y - min_y) - change_y;
            }
        }

        Ok(())
    }

    /// Get bounds of curves from a start index.
    fn get_bounds(group: &Group, from_curve: usize) -> [f64; 4] {
        let mut min_x = f64::INFINITY;
        let mut min_y = f64::INFINITY;
        let mut max_x = f64::NEG_INFINITY;
        let mut max_y = f64::NEG_INFINITY;

        for curve_group in &group.points[from_curve..] {
            for pt in curve_group {
                if pt.x < min_x {
                    min_x = pt.x;
                }
                if pt.x > max_x {
                    max_x = pt.x;
                }
                if pt.y < min_y {
                    min_y = pt.y;
                }
                if pt.y > max_y {
                    max_y = pt.y;
                }
            }
        }

        [min_x, min_y, max_x, max_y]
    }
}
