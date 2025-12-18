use crate::parser::methods::asemic_pt::{AsemicPt, BasicPt};
use crate::parser::methods::expressions::ExpressionParser;

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
}

impl DrawingMixin for ExpressionParser {
    fn line(&mut self, points: &[&str]) -> Result<Vec<AsemicPt>, String> {
        let mut result = Vec::new();
        for point in points {
            let pt = ExpressionParser::eval_point(point, false, 0.0)?;
            result.push(AsemicPt::new(pt.x, pt.y, 0.0, 1.0, 1.0, 1.0, 1.0));
        }
        Ok(result)
    }
}
