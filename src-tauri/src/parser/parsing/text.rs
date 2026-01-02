use super::drawing::DrawingMixin;
use crate::parser::{
    methods::{asemic_pt::BasicPt, transforms::Transforms},
    ExpressionEval, TextParser,
};

pub trait TextMethods {
    fn text(&mut self, token: &str) -> Result<(), String>;
}

impl TextMethods for TextParser {
    fn text(&mut self, token: &str) -> Result<(), String> {
        fn tokenize(input: &str) -> Vec<String> {
            let mut tokens = Vec::new();
            let mut current_group = String::new();
            let mut in_group = false;

            for word in input.split_whitespace() {
                if word.contains('|') {
                    // Toggle group mode
                    in_group = !in_group;

                    // Handle cases like "word|" or "|word"
                    let parts: Vec<&str> = word.split('|').collect();
                    for (i, part) in parts.iter().enumerate() {
                        if !part.is_empty() {
                            if in_group {
                                current_group.push_str(part);
                            } else {
                                if !current_group.is_empty() {
                                    tokens.push(current_group.clone());
                                    current_group.clear();
                                }
                                tokens.push(part.to_string());
                            }
                        }

                        // Add space between non-empty parts within a group
                        if i < parts.len() - 1 && in_group && !part.is_empty() {
                            current_group.push(' ');
                        }
                    }
                } else {
                    if in_group {
                        if !current_group.is_empty() {
                            current_group.push(' ');
                        }
                        current_group.push_str(word);
                    } else {
                        tokens.push(word.to_string());
                    }
                }
            }

            // Push any remaining grouped content
            if !current_group.is_empty() {
                tokens.push(current_group);
            }

            tokens
        }
        fn parse_function_call(parser: &mut TextParser, func_call: &str) -> Result<(), String> {
            let parts = tokenize(func_call);
            println!("Function call parts: {:?}", parts);
            if parts.is_empty() {
                return Ok(());
            }

            let func_name: &str = parts[0].as_str();
            let args: Vec<&str> = parts[1..].iter().map(|s| s.as_str()).collect();

            // Map of supported functions
            match func_name {
                "c3" => parser.c3(&args)?,
                "c4" => parser.c4(&args)?,
                "c5" => parser.c5(&args)?,
                "c6" => parser.c6(&args)?,
                "circle" => parser.circle(&args)?,
                "group" => parser.group(&args)?,
                "repeat" => {
                    if args.len() < 2 {
                        return Err("repeat requires count and callback arguments".to_string());
                    }

                    parser.repeat(args[0], args[1])?
                }
                _ => return Err(format!("text: Unknown function: {}", func_name)),
            }

            Ok(())
        }

        fn parse_transform(content: &str, parser: &mut TextParser) -> Result<(), String> {
            // Tokenize by whitespace
            let tokens: Vec<&str> = content.split_whitespace().collect();

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
                    if let Ok(val) = parser.expression_parser.expr_list(&value_str) {
                        parser.expression_parser.modify_transform(|t| {
                            t.translate =
                                BasicPt::new(val[0], val.get(1).cloned().unwrap_or(val[0]));
                        })?;
                    }
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
                        let value = parts[1];

                        parser.expression_parser.modify_transform(|t| {
                            match key {
                                "h" => t.h = value.to_string(),
                                "s" => t.s = value.to_string(),
                                "l" => t.l = value.to_string(),
                                "a" => t.a = value.to_string(),
                                "w" => t.w = value.to_string(),
                                _ => {} // Custom constants would be handled here
                            }
                        })?;
                    }
                }
            }

            Ok(())
        }

        fn process_string(_content: &str, _add_mode: bool) -> Result<(), String> {
            // Process string content with font characters
            // TODO: Implement string processing with font characters
            Ok(())
        }

        let token_without_comments = token.replace(r"//.*", "");
        let token_length = token.len();
        let chars: Vec<char> = token.chars().collect();
        let mut i = 0;
        println!("Processing token: {}", token);

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

                let tokens: Vec<&str> = content.split_whitespace().collect();

                if tokens.is_empty() {
                    return Ok(());
                }

                let line = self.line(&tokens)?;
                line.iter().for_each(|pt| {
                    self.add_point(*pt);
                });

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

                process_string(&string_content, add_mode)?;
                i += 1;
                continue;
            }

            i += 1;
        }

        Ok(())
    }
}
