use std::{collections::HashMap, hash::Hash};

use regex::Regex;
use serde_json::to_string;
use string_replace_all::string_replace_all;

/// Configuration options for tokenization
#[derive(Clone, Debug)]
pub struct TokenizeOptions {
    /// Separate by commas (for point notation)
    pub separate_points: bool,
    /// Separate by underscores (for fragments)
    pub separate_fragments: bool,
    /// Separate by semicolons (for objects)
    pub separate_object: bool,
    /// Stop tokenization at first match outside brackets
    pub stop_at_0: bool,
    /// Custom regex pattern for separation (not used in basic impl)
    pub use_default_regex: bool,
}

impl Default for TokenizeOptions {
    fn default() -> Self {
        Self {
            separate_points: false,
            separate_fragments: false,
            separate_object: false,
            stop_at_0: false,
            use_default_regex: true,
        }
    }
}

/// A tokenizer for parsing Asemic expressions
pub struct Tokenizer {
    tokenize_cache: HashMap<String, Vec<String>>,
    function_cache: HashMap<String, Vec<TextSplitResult>>,
}

#[derive(Clone, Debug)]
pub struct TextSplitResult {
    pub args: String,
    pub operator_type: String,
}

impl Tokenizer {
    /// Create a new tokenizer instance
    pub fn new() -> Self {
        Self {
            tokenize_cache: HashMap::new(),
            function_cache: HashMap::new(),
        }
    }

    /// Check if a character matches the separation pattern
    fn should_separate(c: char, options: &TokenizeOptions) -> bool {
        match c {
            ',' if options.separate_points => true,
            '_' if options.separate_fragments => true,
            ';' if options.separate_object => true,
            ' ' | '\t' | '\n' | '\r' if options.use_default_regex => true,
            _ => false,
        }
    }

    pub fn cache(&mut self, tok: &str) -> Result<Vec<TextSplitResult>, String> {
        if let Some(value) = self.function_cache.get(tok) {
            return Ok(value.clone());
        }
        let regex = Regex::new("(?s)//.*?$|/\\*.*?\\*/").unwrap();
        let token = string_replace_all(tok, &regex, "");
        // this function takes a string and splits it by function calls, regex patterns, and point sequences, and caches the results for faster processing later
        let token_length = token.len();
        let chars: Vec<char> = token.chars().collect();
        let mut i = 0;

        let mut cache: Vec<TextSplitResult> = Vec::new();

        while i < token_length {
            let char = chars[i];
            println!("Processing char '{}' at index {}", char, i);

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

                let end = i;
                let func_call: String = chars[(start + 1)..end].iter().collect();
                cache.push(TextSplitResult {
                    args: func_call,
                    operator_type: "function".to_string(),
                });
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
                print!("Found points: '{}'", content);
                cache.push(TextSplitResult {
                    args: content,
                    operator_type: "points".to_string(),
                });
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

                cache.push(TextSplitResult {
                    args: content,
                    operator_type: "transform".to_string(),
                });

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

                    // if current_char == '{' && (i == 0 || chars[i - 1] != '\\') {
                    //     let nested_start = i;
                    //     let mut nested_brackets = 1;
                    //     i += 1;
                    //     while i < token_length && nested_brackets > 0 {
                    //         if chars[i] == '{' {
                    //             nested_brackets += 1;
                    //         } else if chars[i] == '}' {
                    //             nested_brackets -= 1;
                    //         }
                    //         i += 1;
                    //     }
                    //     let nested_content: String =
                    //         chars[(nested_start + 1)..(i - 1)].iter().collect();
                    //     self.parse_transform(&nested_content);
                    //     i += 1;
                    //     continue;
                    // }

                    string_content.push(current_char);
                    i += 1;
                }

                if i >= token_length {
                    return Err("text: Missing closing \" in string".to_string());
                }

                // process_string(&string_content, add_mode, self)?;
                cache.push(TextSplitResult {
                    args: string_content,
                    operator_type: if add_mode {
                        "string".to_string()
                    } else {
                        "string".to_string()
                    },
                });
                i += 1;
                continue;
            }

            i += 1;
        }

        self.function_cache.insert(tok.to_string(), cache.clone());

        Ok(cache)
    }

    /// Tokenize a string of points separated by commas
    pub fn tokenize_points(&mut self, source: &str) -> Vec<String> {
        let mut tokens: Vec<String> = Vec::new();
        let mut current = String::new();
        let mut in_parentheses = 0;
        let mut in_braces = 0;
        let mut is_escaped = false;

        let chars: Vec<char> = source.chars().collect();
        let len = chars.len();

        let mut i = 0;
        while i < len {
            let c = chars[i];

            if is_escaped {
                is_escaped = false;
                current.push(c);
                i += 1;
                continue;
            }

            let mut end = false;
            match c {
                '(' => {
                    in_parentheses += 1;
                    current.push(c);
                }
                ')' => {
                    in_parentheses -= 1;
                    current.push(c);
                }
                '{' => {
                    in_braces += 1;
                    current.push(c);
                }
                '}' => {
                    in_braces -= 1;
                    current.push(c);
                }
                '\\' => {
                    is_escaped = true;
                    current.push(c);
                }
                ' ' | '\t' | '\n' | '\r' if in_parentheses == 0 && in_braces == 0 => {
                    // Split on whitespace when not inside parens or braces
                    if !current.is_empty() {
                        tokens.push(current.clone());
                        current.clear();
                    }
                    end = true;
                }
                _ => {
                    current.push(c);
                }
            }

            i += 1;
        }

        if !current.is_empty() {
            tokens.push(current.clone());
        }

        tokens
    }

    /// Tokenize a source string or number with caching
    pub fn tokenize(&mut self, source: &str, options: Option<TokenizeOptions>) -> Vec<String> {
        let options = options.unwrap_or_default();

        // Generate cache key
        let cache_key = format!(
            "{}:{}:{}:{}:{}",
            source,
            options.separate_points,
            options.separate_fragments,
            options.separate_object,
            options.stop_at_0
        );

        // Check cache
        if let Some(cached) = self.tokenize_cache.get(&cache_key) {
            return cached.clone();
        }

        // Perform tokenization
        let tokens = self.tokenize_internal(source, &options);

        // Cache the result
        self.tokenize_cache.insert(cache_key, tokens.clone());

        tokens
    }

    /// Internal tokenization logic
    fn tokenize_internal(&self, source: &str, options: &TokenizeOptions) -> Vec<String> {
        let mut tokens: Vec<String> = Vec::new();
        let mut current = String::new();
        let mut in_brackets = 0;
        let mut in_parentheses = 0;
        let mut in_braces = 0;
        let mut callback = false;
        let mut is_escaped = false;

        let chars: Vec<char> = source.chars().collect();
        let len = chars.len();

        let mut i = 0;
        while i < len {
            let c = chars[i];

            if is_escaped {
                is_escaped = false;
                current.push(c);
                i += 1;
                continue;
            }

            match c {
                '|' => {
                    if in_brackets == 0 && in_parentheses == 0 && in_braces == 0 {
                        if !current.is_empty() {
                            tokens.push(current.clone());
                            current.clear();
                        }
                        callback = true;
                        i += 1;
                        continue;
                    }
                    current.push(c);
                }
                '[' => {
                    in_brackets += 1;
                    current.push(c);
                }
                ']' => {
                    in_brackets -= 1;
                    current.push(c);
                }
                '(' => {
                    in_parentheses += 1;
                    current.push(c);
                }
                ')' => {
                    in_parentheses -= 1;
                    current.push(c);
                }
                '{' => {
                    in_braces += 1;
                    current.push(c);
                }
                '}' => {
                    in_braces -= 1;
                    current.push(c);
                }
                '\\' => {
                    is_escaped = true;
                    current.push(c);
                }
                '"' | '/'
                    if current.is_empty()
                        && in_brackets == 0
                        && in_parentheses == 0
                        && in_braces == 0 =>
                {
                    // Handle quoted strings and regex patterns
                    current.push(c);
                    let quote_char = c;
                    i += 1;

                    while i < len {
                        let ch = chars[i];
                        current.push(ch);

                        if ch == '\\' && i + 1 < len {
                            i += 1;
                            current.push(chars[i]);
                        }

                        if ch == quote_char {
                            break;
                        }

                        i += 1;
                    }
                }
                _ => {
                    let has_total_brackets =
                        in_braces + in_parentheses + in_brackets > 0 || callback;

                    if options.stop_at_0 && i > 0 && !has_total_brackets {
                        if !current.is_empty() {
                            tokens.push(current);
                        }
                        tokens.push(source[i..].to_string());
                        return tokens;
                    }

                    if !has_total_brackets && Self::should_separate(c, options) {
                        if !current.is_empty() {
                            tokens.push(current.clone());
                            current.clear();
                        }
                    } else {
                        current.push(c);
                    }
                }
            }

            i += 1;
        }

        if !current.is_empty() {
            tokens.push(current);
        }

        tokens
    }

    /// Clear all caches
    pub fn clear_caches(&mut self) {
        self.tokenize_cache.clear();
    }

    /// Get cache statistics
    pub fn get_cache_stats(&self) -> CacheStats {
        CacheStats {
            tokenize_cache_size: self.tokenize_cache.len(),
        }
    }
}

/// Statistics about tokenizer caches
#[derive(Debug, Clone)]
pub struct CacheStats {
    pub tokenize_cache_size: usize,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_basic_tokenization() {
        let mut tokenizer = Tokenizer::new();
        let result = tokenizer.tokenize("hello world test", None);
        assert_eq!(result, vec!["hello", "world", "test"]);
    }

    #[test]
    fn test_tokenize_with_brackets() {
        let mut tokenizer = Tokenizer::new();
        let result = tokenizer.tokenize("func[a b] c d", None);
        assert_eq!(result, vec!["func[a", "b]", "c", "d"]);
    }

    #[test]
    fn test_tokenize_points() {
        let mut tokenizer = Tokenizer::new();
        let mut opts = TokenizeOptions::default();
        opts.separate_points = true;
        let result = tokenizer.tokenize("1,2,3", Some(opts));
        assert_eq!(result, vec!["1", "2", "3"]);
    }

    #[test]
    fn test_tokenize_fragments() {
        let mut tokenizer = Tokenizer::new();
        let mut opts = TokenizeOptions::default();
        opts.separate_fragments = true;
        let result = tokenizer.tokenize("frag1_frag2_frag3", Some(opts));
        assert_eq!(result, vec!["frag1", "frag2", "frag3"]);
    }

    #[test]
    fn test_quoted_strings() {
        let mut tokenizer = Tokenizer::new();
        let result = tokenizer.tokenize(r#""hello world" test"#, None);
        assert_eq!(result, vec![r#""hello world""#, "test"]);
    }

    #[test]
    fn test_escaped_characters() {
        let mut tokenizer = Tokenizer::new();
        let result = tokenizer.tokenize(r"hello\ world test", None);
        assert_eq!(result, vec![r"hello\ world", "test"]);
    }

    #[test]
    fn test_cache() {
        let mut tokenizer = Tokenizer::new();
        let source = "hello world test";

        // First call
        let result1 = tokenizer.tokenize(source, None);
        let stats1 = tokenizer.get_cache_stats();

        // Second call (should use cache)
        let result2 = tokenizer.tokenize(source, None);
        let stats2 = tokenizer.get_cache_stats();

        assert_eq!(result1, result2);
        assert_eq!(stats1.tokenize_cache_size, stats2.tokenize_cache_size);
    }

    #[test]
    fn test_stop_at_zero() {
        let mut tokenizer = Tokenizer::new();
        let mut opts = TokenizeOptions::default();
        opts.stop_at_0 = true;
        let result = tokenizer.tokenize("first second third", Some(opts));
        assert_eq!(result, vec!["first", "second third"]);
    }
}
