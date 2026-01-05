use regex::Regex;
use string_replace_all::string_replace_all;

use super::drawing::DrawingMixin;
use crate::parser::{
    methods::{asemic_pt::BasicPt, transforms::Transforms},
    parsing::utilities::Utilities,
    ExpressionEval, TextParser, TokenizeOptions,
};

pub trait TextMethods {
    fn text(&mut self, token: &str) -> Result<(), String>;
}

impl TextMethods for TextParser {
    fn text(&mut self, token: &str) -> Result<(), String> {
        fn parse_function_call(parser: &mut TextParser, func_call: &str) -> Result<(), String> {
            let parts = parser.tokenizer.tokenize(
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
                "circle" => parser.circle(&args)?,
                "group" => parser.group(&args)?,
                "repeat" => {
                    if args.len() < 2 {
                        return Err("repeat requires count and callback arguments".to_string());
                    }

                    parser.repeat(args[0], args[1])?
                }
                "align" => parser.align(args[0], args[1], args[2])?,
                "choose" => {
                    if args.len() < 2 {
                        return Err("choose requires at least 2 arguments".to_string());
                    }
                    let mut sample = parser.expression_parser.expr(args[0])?;
                    if sample < 0.0 {
                        sample = 0.0;
                    }
                    if sample >= 1.0 {
                        sample = 0.9999;
                    }
                    let index = (sample * (args.len() - 1) as f64).floor() as usize;
                    parser.text(args[index + 1])?
                }
                _ => return Err(format!("text: Unknown function: {}", func_name)),
            }

            Ok(())
        }

        fn parse_transform(content: &str, parser: &mut TextParser) -> Result<(), String> {
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
                    parser.parse_font(potential_font_name, font_content)?;
                    return Ok(());
                }
            }

            // Tokenize by whitespace
            let tokenized = parser.tokenizer.tokenize_points(content);
            let tokens: Vec<&str> = tokenized.iter().map(|x| x.as_str()).collect();

            for token in tokens {
                // Handle special character prefixes
                if token.starts_with('<') {
                    parser.expression_parser.pop_transform();
                    continue;
                }

                if token.starts_with('>') {
                    parser.expression_parser.push_transform();
                    continue;
                }

                // Handle scale: *value or *[x y]
                if token.starts_with('*') && !token.starts_with("*!") {
                    let value_str = &token[1..];
                    if let Ok(val) = parser.expression_parser.expr_list(&value_str) {
                        parser.expression_parser.modify_transform(|t| {
                            t.scale.scale(
                                BasicPt::new(val[0], val.get(1).cloned().unwrap_or(val[0])),
                                None,
                            );
                        })?;
                    }
                    continue;
                }

                // Handle rotation: @value
                if token.starts_with('@') && !token.starts_with("@!") {
                    let value_str = &token[1..];
                    if let Ok(val) = value_str.parse::<f64>() {
                        parser.expression_parser.modify_transform(|t| {
                            t.rotation += val;
                        })?;
                    }
                    continue;
                }

                // Handle translation: +[x y] or +value
                if token.starts_with('+') && !token.starts_with("+!") && !token.starts_with("+=>") {
                    let value_str = &token[1..];
                    let mut val = parser.expression_parser.eval_point(&value_str)?;
                    val.scale(parser.expression_parser.peek_transform().scale, None);
                    val.rotate(parser.expression_parser.peek_transform().rotation, None);
                    parser.expression_parser.modify_transform(|t| {
                        t.translate.add(val);
                    })?;

                    continue;
                }

                // Handle reset operations
                match token {
                    "!" => {
                        // Reset all transformations
                        parser.expression_parser.modify_transform(|t| {
                            t.scale = crate::parser::methods::asemic_pt::BasicPt { x: 1.0, y: 1.0 };
                            t.translate =
                                crate::parser::methods::asemic_pt::BasicPt { x: 0.0, y: 0.0 };
                            t.rotation = 0.0;
                            t.add = None;
                            t.rotate = None;
                        })?;
                    }
                    "*!" => {
                        // Reset scale
                        parser.expression_parser.modify_transform(|t| {
                            t.scale = crate::parser::methods::asemic_pt::BasicPt { x: 1.0, y: 1.0 };
                        })?;
                    }
                    "@!" => {
                        // Reset rotation
                        parser.expression_parser.modify_transform(|t| {
                            t.rotation = 0.0;
                        })?;
                    }
                    "+!" => {
                        // Reset translation
                        parser.expression_parser.modify_transform(|t| {
                            t.translate =
                                crate::parser::methods::asemic_pt::BasicPt { x: 0.0, y: 0.0 };
                        })?;
                    }
                    _ => {}
                }

                // Handle dynamic transforms: @=> or +=>
                if token.starts_with("+=>") {
                    parser.expression_parser.modify_transform(|t| {
                        t.add = Some(token[3..].to_string());
                    })?;
                    continue;
                }

                if token.starts_with("@=>") {
                    parser.expression_parser.modify_transform(|t| {
                        t.rotate = Some(token[3..].to_string());
                    })?;
                    continue;
                }

                // Handle key-value pairs: key=value or key=>value
                if token.contains('=') {
                    let parts: Vec<&str> = token.splitn(2, '=').collect();
                    if parts.len() == 2 {
                        let key = parts[0];
                        let mut value = parts[1];
                        let mut dynamic = false;
                        if value.starts_with(">") {
                            dynamic = true;
                            value = &value[1..];
                        } else {
                            dynamic = false;
                        }

                        parser.expression_parser.modify_transform(|t| match key {
                            "h" => t.h = value.to_string(),
                            "s" => t.s = value.to_string(),
                            "l" => t.l = value.to_string(),
                            "a" => t.a = value.to_string(),
                            "w" => t.w = value.to_string(),
                            _ => {
                                t.constants.insert(key.to_string(), value.to_string());
                            }
                        })?;
                    }
                }
            }

            Ok(())
        }

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
                    parse_transform(&nested_content, parser)?;
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

        let regex = Regex::new("//.*").unwrap();
        let token = string_replace_all(token, &regex, "");

        let token_length = token.len();
        let chars: Vec<char> = token.chars().collect();
        let mut i = 0;

        while i < token_length {
            let char = chars[i];

            // Handle regex patterns: /pattern/
            if char == '/' && (i == 0 || chars[i - 1] != '\\') {
                i += 1;
                let start = i;

                while i < token_length && (chars[i] != '/' || (i > 0 && chars[i - 1] == '\\')) {
                    i += 1;
                }

                if i >= token_length {
                    return Err("text: Missing / in regex pattern".to_string());
                }

                // TODO: handle
                i += 1;
                continue;
            }

            // Handle function calls: (funcName arg1 arg2)
            if char == '(' && (i == 0 || chars[i - 1] != '\\') {
                let start = i;
                let mut parentheses = 1;
                i += 1;
                println!("Found function call starting at index {}", start);

                while i < token_length && parentheses > 0 {
                    if chars[i] == '(' {
                        parentheses += 1;
                    } else if chars[i] == ')' {
                        parentheses -= 1;
                    } else if chars[i] == '"' {
                        i += 1;
                        while i < token_length
                            && (chars[i] != '"' || (i > 0 && chars[i - 1] == '\\'))
                        {
                            i += 1;
                        }
                    }
                    if parentheses > 0 {
                        i += 1;
                    }
                }

                if parentheses > 0 {
                    return Err("text: Missing ) in function call".to_string());
                }

                println!("Evaluating function: {}", token);
                let end = i;
                let func_call: String = chars[(start + 1)..end].iter().collect();
                parse_function_call(self, &func_call)?;
                i += 1;
                continue;
            }

            // Handle point sequences: [x y z ...]
            if char == '[' && (i == 0 || chars[i - 1] != '\\') {
                let start = i;
                let mut count = 1;
                i += 1;

                while i < token_length && count > 0 {
                    if chars[i] == '[' {
                        count += 1;
                    } else if chars[i] == ']' {
                        count -= 1;
                    }
                    if count > 0 {
                        i += 1;
                    }
                }

                if count > 0 {
                    return Err("text: Missing ] in point sequence".to_string());
                }

                let end = i;
                let content: String = chars[(start + 1)..end].iter().collect();

                // Process each point - check if it's a transform or a point
                let points: Vec<String> = self.tokenizer.tokenize_points(&content.as_str());
                for point in points {
                    if point.starts_with('{') && point.ends_with('}') {
                        // Parse as transform
                        let transform_content = &point[1..point.len() - 1];
                        parse_transform(transform_content, self)?;
                    } else {
                        // Add as point
                        let mut pt = self.parse_point(&mut point.as_str())?;
                        self.add_point(pt);
                    }
                }

                // Handle operators after bracket
                i += 1;

                if i < token_length {
                    if chars[i] == '+' {
                    } else if chars[i] == '<' {
                        self.end_curve(true)?;
                    } else {
                        self.end_curve(false)?;
                    }
                    i += 1; // Always increment past the ]
                } else {
                    self.end_curve(false)?;
                    i += 1;
                }

                continue;
            }

            // Handle nested content: {content}
            if char == '{' && (i == 0 || chars[i - 1] != '\\') {
                let start = i;
                let mut brackets = 1;
                i += 1;

                while i < token_length && brackets > 0 {
                    if chars[i] == '{' {
                        brackets += 1;
                    } else if chars[i] == '}' {
                        brackets -= 1;
                    }
                    if brackets > 0 {
                        i += 1;
                    }
                }

                if brackets > 0 {
                    return Err("text: Missing } in nested content".to_string());
                }

                let end = i;
                let content: String = chars[(start + 1)..end].iter().collect();

                parse_transform(&content, self)?;

                i += 1;

                continue;
            }

            // Handle string literals: "content"
            if char == '"' {
                let add_mode = i > 0 && chars[i - 1] == '+';
                i += 1;
                let mut string_content = String::new();

                while i < token_length && (chars[i] != '"' || (i > 0 && chars[i - 1] == '\\')) {
                    let current_char = chars[i];

                    // Handle inline expressions in strings: (expr)
                    if current_char == '(' && (i == 0 || chars[i - 1] != '\\') {
                        let expr_start = i + 1;
                        let expr_end = chars[i..]
                            .iter()
                            .position(|&c| c == ')')
                            .ok_or("text: Missing ) in expression")?;
                        let expr: String = chars[expr_start..(i + expr_end)].iter().collect();
                        string_content.push_str(&expr);
                        i += expr_end + 1;
                        continue;
                    }

                    if current_char == '{' && (i == 0 || chars[i - 1] != '\\') {
                        let nested_start = i;
                        let mut nested_brackets = 1;
                        i += 1;
                        while i < token_length && nested_brackets > 0 {
                            if chars[i] == '{' {
                                nested_brackets += 1;
                            } else if chars[i] == '}' {
                                nested_brackets -= 1;
                            }
                            i += 1;
                        }
                        let nested_content: String =
                            chars[(nested_start + 1)..(i - 1)].iter().collect();
                        parse_transform(&nested_content, self);
                        i += 1;
                        continue;
                    }

                    string_content.push(current_char);
                    i += 1;
                }

                if i >= token_length {
                    return Err("text: Missing closing \" in string".to_string());
                }

                process_string(&string_content, add_mode, self)?;
                i += 1;
                continue;
            }

            i += 1;
        }

        Ok(())
    }
}
