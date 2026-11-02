use std::{collections::HashMap, result};

use glam::{vec2, Affine2, Vec2};

use crate::font::{default_chars::default_chars, Curves, Paths};

pub struct TextOptions {
    pub transform: Affine2,
    pub width: f32,
    pub align: Option<Align>,
    pub char_spacing: Option<f32>,
}

pub enum Align {
    Left,
    Center,
    Right,
}

#[derive(Debug, Clone)]
pub struct CharInfo {
    paths: Vec<Vec<Vec2>>,
}

#[derive(Debug, Clone)]
pub struct Font {
    char_map: HashMap<char, CharInfo>,
}

impl Font {
    pub fn new() -> Self {
        Font {
            char_map: Self::create_char_info(default_chars()),
        }
    }

    fn create_char_info(paths: HashMap<char, Vec<Vec<Vec2>>>) -> HashMap<char, CharInfo> {
        paths
            .into_iter()
            .map(|(c, paths)| (c, CharInfo { paths }))
            .collect()
    }

    pub fn add_char(&mut self, c: char, paths: Vec<Vec<Vec2>>) {
        self.char_map.insert(c, CharInfo { paths });
    }

    pub fn add_chars(&mut self, c: char, paths: HashMap<char, Vec<Vec<Vec2>>>) {
        self.char_map
            .extend(paths.into_iter().map(|(c, paths)| (c, CharInfo { paths })));
    }

    pub fn to_paths(&mut self, text: &str, options: TextOptions) -> Paths {
        let mut result = Paths::new();
        let mut x_offset = 0.0;

        // Calculate total text width for alignment
        let spacing = 1. + options.char_spacing.unwrap_or(0.15);
        let mut total_width = 0.0;
        for c in text.chars() {
            if self.char_map.contains_key(&c) {
                total_width += spacing; // Character width + spacing
            }
        }
        total_width -= spacing; // Remove spacing after last character

        // Apply alignment offset
        let align_offset = match options.align {
            Some(Align::Left) => 0.0,
            Some(Align::Center) => -total_width / 2.0,
            Some(Align::Right) => -total_width,
            None => 0.0,
        };

        for c in text.chars() {
            if let Some(paths) = self.char_map.get(&c) {
                for path in paths.paths.iter() {
                    let offset_path: Vec<Vec2> = path
                        .iter()
                        .map(|&point| {
                            let point = point + vec2(x_offset + align_offset, 0.0);
                            options.transform.transform_point2(point)
                        })
                        .collect();

                    result.paths.push(offset_path);
                }
                x_offset += spacing; // Character spacing
            }
        }
        result
    }
}

impl Default for Font {
    fn default() -> Self {
        Self::new()
    }
}
