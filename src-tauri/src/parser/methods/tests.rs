#[cfg(test)]
pub mod tests {
    use crate::parser::methods::{
        expressions::ExpressionParser,
        transforms::{BasicPt, Transform},
    };

    #[test]
    fn test_eval_point_basic() {
        // Test single number coordinate
        let pt = ExpressionParser::eval_point("5", true, 0.0).unwrap();
        assert_eq!(pt.x, 5.0);
        assert_eq!(pt.y, 0.0);

        // Test with default_y
        let pt = ExpressionParser::eval_point("5", true, 3.0).unwrap();
        assert_eq!(pt.x, 5.0);
        assert_eq!(pt.y, 3.0);
    }

    #[test]
    fn test_eval_point_comma_separated() {
        // Test comma-separated coordinates
        let pt = ExpressionParser::eval_point("10,20", true, 0.0).unwrap();
        assert_eq!(pt.x, 10.0);
        assert_eq!(pt.y, 20.0);

        // Test with spaces
        let pt = ExpressionParser::eval_point("3.5,7.2", true, 0.0).unwrap();
        assert_eq!(pt.x, 3.5);
        assert_eq!(pt.y, 7.2);
    }

    #[test]
    fn test_eval_point_negative_coordinates() {
        let pt = ExpressionParser::eval_point("-5,-10", true, 0.0).unwrap();
        assert_eq!(pt.x, -5.0);
        assert_eq!(pt.y, -10.0);

        let pt = ExpressionParser::eval_point("-5", true, 0.0).unwrap();
        assert_eq!(pt.x, -5.0);
        assert_eq!(pt.y, 0.0);
    }

    #[test]
    fn test_eval_point_reverse_transform() {
        // Test reverse transform '<'
        let pt = ExpressionParser::eval_point("<", true, 0.0).unwrap();
        assert_eq!(pt.x, 0.0);
        assert_eq!(pt.y, 0.0);
    }

    #[test]
    fn test_eval_point_polar_notation() {
        // Test polar notation '@theta,radius'
        let pt = ExpressionParser::eval_point("@0,5", true, 0.0).unwrap();
        assert_eq!(pt.x, 5.0);
        assert_eq!(pt.y, 0.0);

        // Test 90 degree rotation (pi/2 ≈ 1.5708)
        let pt = ExpressionParser::eval_point("@0.25,10", true, 0.0).unwrap();
        assert!((pt.x).abs() < 0.1); // Should be close to 0
        assert!((pt.y - 10.0).abs() < 0.1); // Should be close to 10
    }

    #[test]
    fn test_eval_point_polar_invalid() {
        // Test invalid polar notation
        assert!(ExpressionParser::eval_point("@invalid,5", true, 0.0).is_err());
        assert!(ExpressionParser::eval_point("@1.5,invalid", true, 0.0).is_err());
    }

    #[test]
    fn test_eval_point_array_notation() {
        // Test array notation 'base[idx]'
        let pt = ExpressionParser::eval_point("5[1]", true, 0.0).unwrap();
        assert_eq!(pt.x, 51.0); // "5" + "1" = 51
    }

    #[test]
    fn test_eval_point_point_constants() {
        // Test point constants '(name arg1 arg2...)'
        // This should return an error as point constants require context
        assert!(ExpressionParser::eval_point("(midpoint 0,0 10,10)", true, 0.0).is_err());
    }

    #[test]
    fn test_eval_point_float_coordinates() {
        let pt = ExpressionParser::eval_point("1.5,2.7", true, 0.0).unwrap();
        assert_eq!(pt.x, 1.5);
        assert_eq!(pt.y, 2.7);

        let pt = ExpressionParser::eval_point("0.001,999.999", true, 0.0).unwrap();
        assert_eq!(pt.x, 0.001);
        assert_eq!(pt.y, 999.999);
    }

    #[test]
    fn test_eval_point_default_y_logic() {
        // When single coordinate provided, default_y logic: max(defaultY, coord)
        let pt = ExpressionParser::eval_point("5", true, 3.0).unwrap();
        assert_eq!(pt.x, 5.0);
        assert_eq!(pt.y, 3.0); // 3.0 is used as provided

        let pt = ExpressionParser::eval_point("5", true, 10.0).unwrap();
        assert_eq!(pt.x, 5.0);
        assert_eq!(pt.y, 10.0);
    }

    #[test]
    fn test_eval_point_invalid_format() {
        // Test invalid coordinates
        assert!(ExpressionParser::eval_point("abc", true, 0.0).is_err());
        assert!(ExpressionParser::eval_point("1,2,3", true, 0.0).is_err()); // Too many coords
        assert!(ExpressionParser::eval_point("1,abc", true, 0.0).is_err());
    }

    #[test]
    fn test_eval_point_basic_flag() {
        // Test basic=true returns BasicPt
        let pt = ExpressionParser::eval_point("5,10", true, 0.0).unwrap();
        assert_eq!(pt.x, 5.0);
        assert_eq!(pt.y, 10.0);

        // Test basic=false would return AsemicPt (not directly testable in this function)
        // but verifies type system works
        let _pt = ExpressionParser::eval_point("5,10", false, 0.0).unwrap();
    }

    #[test]
    fn test_eval_point_zero_coordinates() {
        let pt = ExpressionParser::eval_point("0,0", true, 0.0).unwrap();
        assert_eq!(pt.x, 0.0);
        assert_eq!(pt.y, 0.0);

        let pt = ExpressionParser::eval_point("0", true, 5.0).unwrap();
        assert_eq!(pt.x, 0.0);
        assert_eq!(pt.y, 5.0);
    }

    #[test]
    fn test_eval_point_large_numbers() {
        let pt = ExpressionParser::eval_point("1000000,2000000", true, 0.0).unwrap();
        assert_eq!(pt.x, 1000000.0);
        assert_eq!(pt.y, 2000000.0);
    }

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
        let mut parser = ExpressionParser::new();

        // Test time constant - just verify it returns a positive number
        assert!(parser.expr("T").unwrap() > 0.0);

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
    fn test_progress_constants() {
        let mut parser = ExpressionParser::new();

        // Test local progress constants
        parser.set_local_progress(10.0, 5.0, 3.0);
        assert_eq!(parser.expr("C").unwrap(), 10.0);
        assert_eq!(parser.expr("L").unwrap(), 5.0);
        assert_eq!(parser.expr("P").unwrap(), 3.0);

        // Test index constants
        parser.set_indexes(vec![0.0, 5.0, 10.0], vec![1.0, 10.0, 20.0]);
        assert_eq!(parser.expr("N").unwrap(), 1.0);
        assert_eq!(parser.expr("N 1").unwrap(), 10.0);
        assert_eq!(parser.expr("I").unwrap(), 0.0);
        assert_eq!(parser.expr("I 1").unwrap(), 5.0);
        assert!((parser.expr("i 1").unwrap() - 5.0 / 9.0).abs() < 0.001);

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

    #[test]
    fn test_transform_new() {
        let transform = Transform::new();
        assert_eq!(transform.scale.x, 1.0);
        assert_eq!(transform.scale.y, 1.0);
        assert_eq!(transform.translate.x, 0.0);
        assert_eq!(transform.translate.y, 0.0);
        assert_eq!(transform.rotation, 0.0);
        assert_eq!(transform.w, "1.0");
        assert_eq!(transform.h, "1.0");
        assert_eq!(transform.s, "1.0");
        assert_eq!(transform.l, "1.0");
        assert_eq!(transform.a, "0.0");
        assert!(transform.add.is_none());
        assert!(transform.rotate.is_none());
    }

    #[test]
    fn test_transform_default() {
        let transform = Transform::default();
        assert_eq!(transform.scale.x, 1.0);
        assert_eq!(transform.scale.y, 1.0);
    }

    #[test]
    fn test_solved_transform_basic() {
        let transform = Transform::new();
        let mut parser = ExpressionParser::new();
        let solved = transform.solve(&mut parser).unwrap();

        assert_eq!(solved.scale.x, 1.0);
        assert_eq!(solved.scale.y, 1.0);
        assert_eq!(solved.translate.x, 0.0);
        assert_eq!(solved.translate.y, 0.0);
        assert_eq!(solved.rotation, 0.0);
        assert_eq!(solved.w, 1.0);
        assert_eq!(solved.h, 1.0);
        assert_eq!(solved.s, 1.0);
        assert_eq!(solved.l, 1.0);
        assert_eq!(solved.a, 0.0);
    }

    #[test]
    fn test_transform_with_expressions() {
        let mut transform = Transform::new();
        transform.w = "2+3".to_string();
        transform.h = "10/2".to_string();
        transform.s = "3*2".to_string();
        transform.l = "8-1".to_string();
        transform.a = "45".to_string();

        let mut parser = ExpressionParser::new();
        let solved = transform.solve(&mut parser).unwrap();

        assert_eq!(solved.w, 5.0);
        assert_eq!(solved.h, 5.0);
        assert_eq!(solved.s, 6.0);
        assert_eq!(solved.l, 7.0);
        assert_eq!(solved.a, 45.0);
    }

    #[test]
    fn test_transform_with_scale() {
        let mut transform = Transform::new();
        transform.scale = BasicPt { x: 2.5, y: 1.5 };

        let mut parser = ExpressionParser::new();
        let solved = transform.solve(&mut parser).unwrap();

        assert_eq!(solved.scale.x, 2.5);
        assert_eq!(solved.scale.y, 1.5);
    }

    #[test]
    fn test_transform_with_translate() {
        let mut transform = Transform::new();
        transform.translate = BasicPt { x: 10.5, y: -5.0 };

        let mut parser = ExpressionParser::new();
        let solved = transform.solve(&mut parser).unwrap();

        assert_eq!(solved.translate.x, 10.5);
        assert_eq!(solved.translate.y, -5.0);
    }

    #[test]
    fn test_transform_with_rotation() {
        let mut transform = Transform::new();
        transform.rotation = 1.5708; // ~90 degrees

        let mut parser = ExpressionParser::new();
        let solved = transform.solve(&mut parser).unwrap();

        assert!((solved.rotation - 1.5708).abs() < 0.0001);
    }

    #[test]
    fn test_transform_with_add_rotate() {
        let mut transform = Transform::new();
        transform.add = Some("5".to_string());
        transform.rotate = Some("90".to_string());

        let mut parser = ExpressionParser::new();
        let solved = transform.solve(&mut parser).unwrap();

        assert_eq!(solved.add, Some("5".to_string()));
        assert_eq!(solved.rotate, Some("90".to_string()));
    }

    #[test]
    fn test_basic_pt_clone() {
        let pt = BasicPt { x: 5.0, y: 10.0 };
        let pt_clone = pt.clone();
        assert_eq!(pt_clone.x, 5.0);
        assert_eq!(pt_clone.y, 10.0);
    }

    #[test]
    fn test_transform_fallback_to_default() {
        let mut transform = Transform::new();
        transform.w = "not_a_number".to_string();
        transform.h = "also_invalid".to_string();

        let mut parser = ExpressionParser::new();
        let solved = transform.solve(&mut parser).unwrap();

        assert_eq!(solved.w, 1.0); // Falls back to default
        assert_eq!(solved.h, 1.0);
    }

    #[test]
    fn test_transform_complex_expressions() {
        let mut transform = Transform::new();
        transform.w = "(2+3)*4".to_string();
        transform.h = "100/2-10".to_string();

        let mut parser = ExpressionParser::new();
        let solved = transform.solve(&mut parser).unwrap();

        assert_eq!(solved.w, 20.0);
        assert_eq!(solved.h, 40.0);
    }
}
