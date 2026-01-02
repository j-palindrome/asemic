use std::collections::HashMap;

/// AsemicFont manages character definitions and dynamic characters for the parser.
/// Characters can be simple (single character mapped to a handler) or multi (comma-separated).
/// For multi-character mappings, each character gets wrapped with progress tracking.
pub struct AsemicFont {
    /// Static character handlers
    characters: HashMap<String, String>,
    /// Dynamic character handlers
    dynamic_characters: HashMap<String, String>,
    /// Stored defaults to enable reset functionality
    default_characters: HashMap<String, String>,
    /// Stored defaults for dynamic characters
    default_dynamic_characters: HashMap<String, String>,
}

impl AsemicFont {
    /// Creates a new AsemicFont instance with given character definitions.
    ///
    /// # Arguments
    /// * `characters` - HashMap of character names to their handlers
    /// * `dynamic_characters` - HashMap of dynamic character names to their handlers
    pub fn new(
        characters: HashMap<String, String>,
        dynamic_characters: HashMap<String, String>,
    ) -> Self {
        let mut font = AsemicFont {
            characters: HashMap::new(),
            dynamic_characters: HashMap::new(),
            default_characters: HashMap::new(),
            default_dynamic_characters: HashMap::new(),
        };

        font.parse_characters(characters, false);
        font.parse_characters(dynamic_characters, true);

        // Store defaults
        font.default_characters = font
            .characters
            .iter()
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect();
        font.default_dynamic_characters = font
            .dynamic_characters
            .iter()
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect();

        font
    }

    /// Parses character definitions and stores them in the appropriate dictionary.
    /// Handles comma-separated character names by creating individual entries for each.
    ///
    /// # Arguments
    /// * `chars` - HashMap of character names to handlers
    /// * `dynamic` - If true, stores in dynamic_characters; otherwise in characters
    fn parse_characters(&mut self, chars: HashMap<String, String>, dynamic: bool) {
        let dict = if dynamic {
            &mut self.dynamic_characters
        } else {
            &mut self.characters
        };

        for (name, handler) in chars {
            if name.contains(',') {
                // Handle multi-character mapping (comma-separated)
                let multiple_chars: Vec<&str> = name.split(',').collect();
                let count_num = multiple_chars.len();

                for (j, &char_name) in multiple_chars.iter().enumerate() {
                    dict.insert(char_name.to_string(), handler.clone());
                }
            } else {
                dict.insert(name, handler);
            }
        }
    }

    /// Resets all characters to their default state.
    pub fn reset(&mut self) {
        self.characters.clear();
        self.characters.extend(
            self.default_characters
                .iter()
                .map(|(k, v)| (k.clone(), v.clone())),
        );

        self.dynamic_characters.clear();
        self.dynamic_characters.extend(
            self.default_dynamic_characters
                .iter()
                .map(|(k, v)| (k.clone(), v.clone())),
        );
    }

    /// Resets a single character to its default state.
    ///
    /// # Arguments
    /// * `char_name` - The character to reset
    /// * `dynamic` - If true, resets dynamic character; otherwise resets static character
    pub fn reset_character(&mut self, char_name: &str, dynamic: bool) {
        if dynamic {
            if self.default_dynamic_characters.contains_key(char_name) {
                self.dynamic_characters.insert(
                    char_name.to_string(),
                    self.default_dynamic_characters[char_name].clone(),
                );
            }
        } else {
            if self.default_characters.contains_key(char_name) {
                self.characters.insert(
                    char_name.to_string(),
                    self.default_characters[char_name].clone(),
                );
            }
        }
    }

    /// Gets a character handler if it exists.
    ///
    /// # Arguments
    /// * `char_name` - The character to look up
    /// * `dynamic` - If true, looks in dynamic_characters; otherwise in characters
    pub fn get_character(&self, char_name: &str, dynamic: bool) -> Option<&String> {
        if dynamic {
            self.dynamic_characters.get(char_name)
        } else {
            self.characters.get(char_name)
        }
    }

    /// Checks if a character is defined.
    ///
    /// # Arguments
    /// * `char_name` - The character to check
    /// * `dynamic` - If true, checks dynamic_characters; otherwise checks characters
    pub fn has_character(&self, char_name: &str, dynamic: bool) -> bool {
        if dynamic {
            self.dynamic_characters.contains_key(char_name)
        } else {
            self.characters.contains_key(char_name)
        }
    }

    /// Adds or updates a character handler.
    ///
    /// # Arguments
    /// * `char_name` - The character to add/update
    /// * `handler` - The handler function
    /// * `dynamic` - If true, adds to dynamic_characters; otherwise to characters
    pub fn set_character(&mut self, char_name: String, handler: String, dynamic: bool) {
        if dynamic {
            self.dynamic_characters.insert(char_name, handler);
        } else {
            self.characters.insert(char_name, handler);
        }
    }
}
