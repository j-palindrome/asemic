use regex::Regex;
use std::{char, collections::HashMap};
use string_replace_all::string_replace_all;

use super::drawing::DrawingMixin;
use crate::parser::{
    methods::{
        asemic_pt::{AsemicPt, BasicPt},
        transforms::{SolvedTransform, Transform, Transforms},
    },
    parsing::utilities::Utilities,
    ExpressionEval, TextParser, TokenizeOptions,
};

pub trait TextMethods {
    fn text(&mut self, token: &str) -> Result<(), String>;
}

impl TextMethods for TextParser {
    fn text(&mut self, token: &str) -> Result<(), String> {
        fn process_string(
            content: &str,
            add_mode: bool,
            parser: &mut TextParser,
        ) -> Result<(), String> {
            // Process string content with font characters
            let font_name = parser.current_font.clone();

            // Get the font - if it doesn't exist, create an empty one
            if !parser.fonts.contains_key(&font_name) {
                return Err(format!("Font '{}' not found", font_name));
            }

            // Call START character if not in add mode
            if !add_mode {
                let start_handlers: Vec<String> = {
                    if let Some(font) = parser.fonts.get(&font_name) {
                        let mut handlers = Vec::new();
                        if font.has_character("START", false) {
                            if let Some(handler) = font.get_character("START", false) {
                                handlers.push(handler.to_string());
                            }
                        }
                        if font.has_character("START", true) {
                            if let Some(handler) = font.get_character("START", true) {
                                handlers.push(handler.to_string());
                            }
                        }
                        handlers
                    } else {
                        Vec::new()
                    }
                };
                for handler in start_handlers {
                    parser.text(&handler)?;
                }
            }

            let content_len = content.len();
            let chars: Vec<char> = content.chars().collect();
            let mut i = 0;

            while i < content_len {
                let mut this_char = chars[i].to_string();

                // Handle inline expressions in strings: (expr)
                if chars[i] == '(' && (i == 0 || chars[i - 1] != '\\') {
                    let expr_start = i + 1;
                    let expr_end = chars[i..]
                        .iter()
                        .position(|&c| c == ')')
                        .ok_or("text: Missing ) in expression")?;
                    this_char = chars[expr_start..(i + expr_end)].iter().collect();
                    i += expr_end + 1;
                }
                // Handle nested transforms: {content}
                else if chars[i] == '{' && (i == 0 || chars[i - 1] != '\\') {
                    let start = i;
                    let mut brackets = 1;
                    i += 1;
                    while i < content_len && brackets > 0 {
                        if chars[i] == '{' {
                            brackets += 1;
                        } else if chars[i] == '}' {
                            brackets -= 1;
                        }
                        i += 1;
                    }
                    let nested_content: String = chars[(start + 1)..(i - 1)].iter().collect();
                    parser.parse_transform(&nested_content)?;
                    continue;
                } else {
                    this_char = chars[i].to_string();
                    i += 1;
                }

                // Map special characters
                let special_chars: std::collections::HashMap<char, &str> = [
                    ('[', "BOPEN"),
                    (']', "BCLOSE"),
                    ('(', "POPEN"),
                    (')', "PCLOSE"),
                    ('{', "COPEN"),
                    ('}', "CCLOSE"),
                    ('"', "QUOTE"),
                    (',', "COMMA"),
                    (' ', "SPACE"),
                    ('\n', "NEWLINE"),
                    ('=', "EQUAL"),
                ]
                .iter()
                .cloned()
                .collect();

                if let Some(&mapped) = special_chars.get(&this_char.chars().next().unwrap_or('\0'))
                {
                    this_char = mapped.to_string();
                }

                // Handle multi-word characters (dynamic characters with arguments)
                if this_char.contains(' ') {
                    let parts: Vec<&str> = this_char.split(' ').collect();
                    if !parts.is_empty() {
                        let func = parts[0];
                        let words: Vec<String> = parts[1..].iter().map(|s| s.to_string()).collect();

                        let handler_opt = {
                            if let Some(font) = parser.fonts.get(&font_name) {
                                if font.has_character(func, true) {
                                    font.get_character(func, true).map(|s| s.to_string())
                                } else {
                                    None
                                }
                            } else {
                                None
                            }
                        };

                        if let Some(handler) = handler_opt {
                            parser.text(&handler)?;
                        }
                    }
                } else {
                    // Call EACH character if it exists
                    let handlers: Vec<String> = {
                        if let Some(font) = parser.fonts.get(&font_name) {
                            let mut handlers = Vec::new();
                            if this_char != "NEWLINE" && font.has_character("EACH", false) {
                                if let Some(handler) = font.get_character("EACH", false) {
                                    handlers.push(handler.to_string());
                                }
                            }

                            // Call dynamic EACH if exists and not NEWLINE
                            if this_char != "NEWLINE" && font.has_character("EACH", true) {
                                if let Some(handler) = font.get_character("EACH", true) {
                                    handlers.push(handler.to_string());
                                }
                            }

                            // Handle character lookup and execution
                            if font.has_character(&this_char, true) {
                                if let Some(handler) = font.get_character(&this_char, true) {
                                    handlers.push(handler.to_string());
                                }
                            } else if font.has_character(&this_char, false) {
                                if let Some(handler) = font.get_character(&this_char, false) {
                                    handlers.push(handler.to_string());
                                }
                            }
                            handlers
                        } else {
                            Vec::new()
                        }
                    };
                    for handler in handlers {
                        parser.text(&handler)?;
                    }
                }
            }

            // Call END character if not in add mode
            if !add_mode {
                let end_handlers: Vec<String> = {
                    if let Some(font) = parser.fonts.get(&font_name) {
                        let mut handlers = Vec::new();
                        if font.has_character("END", false) {
                            if let Some(handler) = font.get_character("END", false) {
                                handlers.push(handler.to_string());
                            }
                        }
                        if font.has_character("END", true) {
                            if let Some(handler) = font.get_character("END", true) {
                                handlers.push(handler.to_string());
                            }
                        }
                        handlers
                    } else {
                        Vec::new()
                    }
                };
                for handler in end_handlers {
                    parser.text(&handler)?;
                }
            }

            Ok(())
        }

        let token_length = token.len();
        let chars: Vec<char> = token.chars().collect();
        let mut i = 0;

        let cache = self.tokenizer.cache(token)?;
        // eprintln!("Cache for '{}': {:?}", token, cache);
        // return Ok(());

        for i in cache {
            match i.operator_type.as_str() {
                "regex" => {
                    // Handle regex pattern
                    eprintln!("Regex pattern: {}", i.args);
                }
                "function" => {
                    // Handle function call
                    self.parse_function_call(&i.args)?;
                }
                "transform" => {
                    self.parse_transform(&i.args)?;
                }
                "points" => {
                    let points: Vec<String> = self.tokenizer.tokenize_points(&i.args);
                    let point_exprs: Vec<_> = points
                        .iter()
                        .filter(|p| !(p.starts_with('{') && p.ends_with('}')))
                        .collect();
                    let amount_of_points = point_exprs.len();
                    let mut j = 0.0;
                    let mut saved_transform: Option<SolvedTransform> = None;
                    for point in &points {
                        self.expression_parser.point = j / (amount_of_points as f64 - 1.0);
                        if point.starts_with('{') && point.ends_with('}') {
                            // Parse as transform
                            let transform_content = &point[1..point.len() - 1];
                            self.parse_transform(transform_content)?;
                        } else {
                            // Add as point
                            let pts = self.parse_point(&mut point.as_str(), Some(false))?;
                            for pt in pts {
                                self.add_point(pt);
                            }
                            if j == 0.0 && amount_of_points == 2 {
                                saved_transform = Some(
                                    self.expression_parser
                                        .peek_transform()
                                        .solve(&mut self.expression_parser)?,
                                );
                            }
                        }

                        j += 1.0;
                    }
                    if amount_of_points == 2 {
                        let p0 = self
                            .current_curve
                            .first()
                            .ok_or("No first point in curve")?;
                        let p1 = self.current_curve.last().ok_or("No last point in curve")?;
                        self.expression_parser.point = 0.5;
                        let mut lerped = *p0.clone().lerp(*p1, 0.5);
                        let solved_values = saved_transform.ok_or("No saved transform for lerp")?;
                        lerped.h = solved_values.h;
                        lerped.w = solved_values.w;
                        lerped.s = solved_values.s;
                        lerped.l = solved_values.l;
                        self.current_curve.insert(1, lerped);
                    }

                    let last_char = i.args.chars().last().unwrap_or('\0');
                    if last_char == '+' {
                    } else if last_char == '<' {
                        self.end_curve(true)?;
                    } else {
                        self.end_curve(false)?;
                    }
                }
                "string" => {
                    process_string(&i.args, false, self)?;
                }
                _ => {
                    return Err(format!("Unknown operator type: {}", i.operator_type));
                }
            }
        }

        Ok(())
    }
}

impl TextParser {
    pub fn parse_function_call(&mut self, func_call: &str) -> Result<(), String> {
        let parts = self.tokenizer.tokenize(
            func_call,
            Some(TokenizeOptions {
                ..Default::default()
            }),
        );
        if parts.is_empty() {
            return Ok(());
        }

        let func_name: &str = parts[0].as_str();
        let args: Vec<&str> = parts[1..].iter().map(|s| s.as_str()).collect();

        // Map of supported functions
        match func_name {
            "circle" => self.circle(&args)?,
            "group" => self.group(&args)?,
            "repeat" => {
                if args.len() < 2 {
                    return Err("repeat requires count and callback arguments".to_string());
                }

                self.repeat(args[0], args[1])?
            }
            "align" => self.align(args[0], args[1], args[2])?,
            "choose" => {
                if args.len() < 2 {
                    return Err("choose requires at least 2 arguments".to_string());
                }
                let mut sample = self.expression_parser.expr(args[0])?;
                if sample < 0.0 {
                    sample = 0.0;
                }
                if sample >= 1.0 {
                    sample = 0.9999;
                }
                let index = (sample * (args.len() - 1) as f64).floor() as usize;

                self.text(args[index + 1])?
            }
            "?" => {
                if args.len() < 2 {
                    return Err(
                        "? requires condition, true_case, and false_case arguments".to_string()
                    );
                }
                let condition = self.expression_parser.expr(args[0])?;
                if condition > 0.0 {
                    self.text(args[1])?
                } else if args.get(2).is_some() {
                    self.text(args[2])?
                }
            }
            "remap" => {
                if args.len() < 2 {
                    return Err("remap requires two point arguments".to_string());
                }
                let pt0_vec = self.parse_point(&mut args[0].clone(), Some(false))?;
                let pt0 = pt0_vec.first().ok_or("No first point returned")?;
                let pt1_vec = self.parse_point(&mut args[1].clone(), None)?;
                let pt1 = pt1_vec.first().ok_or("No second point returned")?;

                // Calculate angle and distance
                let dx = pt1.x - pt0.x;
                let dy = pt1.y - pt0.y;
                let distance = (dx * dx + dy * dy).sqrt();
                let angle = dy.atan2(dx) / (std::f64::consts::PI * 2.0);

                self.expression_parser.modify_transform(|t| {
                    t.translate.x = pt0.x;
                    t.translate.y = pt0.y;
                    t.rotation = angle;
                    t.scale = BasicPt::new(distance, distance);
                })?
            }
            "end" => self.end_curve(false)?,
            "linden" => {
                if args.len() < 3 {
                    return Err("linden requires at least 3 arguments".to_string());
                }
                let iter_count = self.expression_parser.expr(args[0])? as usize;

                // Parse remaining arguments into HashMap (key=value pairs)
                let mut params: HashMap<String, String> = HashMap::new();
                let axiom = args.get(1).cloned().unwrap_or("A").to_string();

                for arg in &args[2..] {
                    if let Some(eq_pos) = arg.find('=') {
                        let key = arg[..eq_pos].trim().to_string();
                        let value = arg[eq_pos + 1..].trim().to_string();
                        params.insert(key, value);
                    }
                }

                // Apply L-system iterations
                let mut current = axiom;
                for _ in 0..iter_count {
                    let mut next = String::new();
                    for ch in current.chars() {
                        if let Some(replacement) = params.get(&ch.to_string()) {
                            next.push_str(replacement);
                        } else {
                            next.push(ch);
                        }
                    }
                    current = next;
                }

                // Process the resulting string as drawing commands
                self.text(&format!("\"{}\"", current))?
            }
            _ => {
                return Err(format!(
                    "text: Unknown function {} in {}",
                    func_name, func_call
                ))
            }
        }

        println!("Executed function call: {}", func_call);

        Ok(())
    }

    pub fn parse_transform(&mut self, content: &str) -> Result<(), String> {
        // Check if this is a font definition: {fontname ...}
        // Font names are lowercase words followed by whitespace
        if let Some(space_index) = content.find(|c: char| c.is_whitespace()) {
            let potential_font_name = &content[..space_index];
            // Check if it's a valid font name (all lowercase letters)
            if !potential_font_name.is_empty()
                && potential_font_name.chars().all(|c| c.is_ascii_lowercase())
            {
                // This looks like a font definition
                let font_content = content[space_index..].trim();
                self.parse_font(potential_font_name, font_content)?;
                return Ok(());
            }
        }

        // Tokenize by whitespace
        let tokenized = self.tokenizer.tokenize_points(content);
        let tokens: Vec<&str> = tokenized.iter().map(|x| x.as_str()).collect();

        for token in tokens {
            if token == "<>" {
                self.expression_parser.pop_transform();
                self.expression_parser.push_transform();
                continue;
            }

            // Handle special character prefixes
            if token.starts_with('<') {
                self.expression_parser.pop_transform();
                continue;
            }

            if token.starts_with('>') {
                self.expression_parser.push_transform();
                continue;
            }

            // Handle scale: *value or *[x y]
            if token.starts_with('*') && !token.starts_with("*!") {
                let value_str = &token[1..];
                if let Ok(val) = self.expression_parser.expr_point(&value_str, None) {
                    self.expression_parser.modify_transform(|t| {
                        t.scale.scale(BasicPt::new(val.0, val.1), None);
                    })?;
                }
                continue;
            }

            // Handle rotation: @value
            if token.starts_with('@') && !token.starts_with("@!") {
                let value_str = &token[1..];
                let val = self.expression_parser.expr(&value_str)?;
                self.expression_parser.modify_transform(|t| {
                    t.rotation += val;
                })?;

                continue;
            }

            // Handle translation: +[x y] or +value
            if token.starts_with('+') && !token.starts_with("+!") && !token.starts_with("+=>") {
                let mut value_str = &token[1..];
                let val_pt = self.parse_point(&mut value_str, Some(true))?[0];
                let val = BasicPt::new(val_pt.x, val_pt.y);
                self.expression_parser.modify_transform(|t| {
                    t.translate.add(val);
                })?;

                continue;
            }

            // Handle reset operations
            match token {
                "!" => {
                    // Reset all transformations
                    self.expression_parser.modify_transform(|t| {
                        t.scale = crate::parser::methods::asemic_pt::BasicPt { x: 1.0, y: 1.0 };
                        t.translate = crate::parser::methods::asemic_pt::BasicPt { x: 0.0, y: 0.0 };
                        t.rotation = 0.0;
                        t.add = None;
                        t.rotate = None;
                        t.a = "1".to_string();
                        t.h = "0".to_string();
                        t.s = "0".to_string();
                        t.l = "1".to_string();
                        t.w = "px".to_string();
                    })?;
                }
                "*!" => {
                    // Reset scale
                    self.expression_parser.modify_transform(|t| {
                        t.scale = crate::parser::methods::asemic_pt::BasicPt { x: 1.0, y: 1.0 };
                    })?;
                }
                "@!" => {
                    // Reset rotation
                    self.expression_parser.modify_transform(|t| {
                        t.rotation = 0.0;
                    })?;
                }
                "+!" => {
                    // Reset translation
                    self.expression_parser.modify_transform(|t| {
                        t.translate = crate::parser::methods::asemic_pt::BasicPt { x: 0.0, y: 0.0 };
                    })?;
                }
                _ => {}
            }

            // Handle dynamic transforms: @=> or +=>
            if token.starts_with("+=>") {
                self.expression_parser.modify_transform(|t| {
                    t.add = Some(token[3..].to_string());
                })?;
                continue;
            }

            if token.starts_with("@=>") {
                self.expression_parser.modify_transform(|t| {
                    t.rotate = Some(token[3..].to_string());
                })?;
                continue;
            }

            // Handle key-value pairs: key=value or key=>value
            if token.contains('=') {
                let parts: Vec<&str> = token.splitn(2, '=').collect();
                if parts.len() == 2 {
                    let key = parts[0];
                    let mut value = parts[1].to_string();
                    let mut dynamic = false;
                    if value.starts_with(">") {
                        dynamic = true;
                        value = value[1..].to_string();
                    } else {
                        dynamic = false;
                    }

                    if !dynamic {
                        value = self
                            .expression_parser
                            .expr_list(&value)?
                            .iter()
                            .map(|v| v.to_string())
                            .collect::<Vec<_>>()
                            .join(",");
                    }

                    self.expression_parser.modify_transform(|t| match key {
                        "h" => t.h = value.clone(),
                        "s" => t.s = value.clone(),
                        "l" => t.l = value.clone(),
                        "a" => t.a = value.clone(),
                        "w" => t.w = value.clone(),
                        _ => {
                            t.constants.insert(key.to_string(), value.clone());
                        }
                    })?;
                }
            }
        }

        Ok(())
    }
}
