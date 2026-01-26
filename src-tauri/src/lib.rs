mod parser;
use crate::parser::{
    parsing::text::TextMethods, ExpressionEval, ParseSourceResult, SceneMetadata, TextParser,
};
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::arch::aarch64::int16x4x2_t;
use std::fmt::format;
use std::net::UdpSocket;
use std::sync::Mutex;
use std::thread;
use string_replace_all::string_replace_all;
use tauri::Manager;
use tauri::{AppHandle, Emitter};

// CodeMirror syntax tree node structure
#[derive(Debug, Clone, Serialize, Deserialize)]
struct SyntaxNode {
    name: String,
    from: usize,
    to: usize,
    #[serde(default)]
    children: Vec<SyntaxNode>,
}

#[derive(Debug, Serialize, Deserialize)]
struct ParserInput {
    source: String,
    tree: SyntaxNode,
}

#[derive(Debug, Serialize, Deserialize)]
struct ParserSetupResult {
    total_length: f64,
    scene_count: usize,
}

#[derive(Debug, Serialize, Deserialize)]
struct OscMessageStruct {
    name: String,
    value: f64,
}

#[derive(Debug, Serialize, Deserialize)]
struct SceneSettings {
    #[serde(default)]
    length: Option<f64>,
    #[serde(default)]
    offset: Option<f64>,
    #[serde(default)]
    pause: Option<f64>,
    #[serde(default)]
    params: Option<std::collections::HashMap<String, f64>>,
    #[serde(default)]
    osc: Option<Vec<OscMessageStruct>>,
}

#[derive(Debug, Serialize, Deserialize)]
struct DrawInput {
    progress: f64,
    scene_index: usize,
    scene_settings: SceneSettings,
}

#[derive(Debug, Serialize, Deserialize)]
struct DrawOutput {
    groups: Vec<Vec<[f64; 2]>>,
    errors: Vec<String>,
    progress: f64,
}

// App state holding reusable parser instances
struct AppState {
    text_parser: Mutex<TextParser>,
}

#[tauri::command]
async fn parser_eval_expression(
    expr: String,
    osc_address: String,
    osc_host: String,
    osc_port: u16,
    scene_metadata: SceneMetadata,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<f64>, String> {
    let mut parser = state
        .text_parser
        .lock()
        .map_err(|_| "Failed to lock text_parser".to_string())?;

    if let Some(param) = scene_metadata.params.get(&expr) {
        parser
            .expression_parser
            .send_osc(&osc_address, param.to_vec(), &osc_host, osc_port)?;
        return Ok(param.clone());
    }

    // Set scene metadata if available
    parser.expression_parser.set_scene_metadata(scene_metadata);

    if expr.contains(",") {
        let results = parser.expression_parser.expr_list(&expr)?;
        parser
            .expression_parser
            .send_osc(&osc_address, results.clone(), &osc_host, osc_port)?;
        return Ok(results);
    }

    // Evaluate expression
    let result = parser.expression_parser.expr(&expr)?;
    // println!("Evaluated expression '{}' to {:?}", expr, result);

    // Send OSC message

    parser
        .expression_parser
        .send_osc(&osc_address, vec![result], &osc_host, osc_port)?;

    Ok(vec![result])
}

// Tauri command for parsing and evaluating Asemic source code
#[tauri::command]
async fn parse_asemic_source(
    source: String,
    scene: SceneMetadata,
    state: tauri::State<'_, AppState>,
) -> Result<ParseSourceResult, String> {
    let mut parser = state
        .text_parser
        .lock()
        .map_err(|_| "failed to lock parser".to_string())?;

    // Load the default font
    parser.load_default_font()?;
    parser.expression_parser.set_scene_metadata(scene);

    let regex = Regex::new("(?s)//.*?$|/\\*.*?\\*/").unwrap();
    let token = string_replace_all(&source, &regex, "");
    // let start = std::time::Instant::now();
    // Parse the source code
    parser.reset();
    parser.text(&token)?;
    // let duration = start.elapsed();
    // eprintln!("Parsing took: {:?}", duration);

    Ok(ParseSourceResult {
        groups: parser.groups.clone(),
        errors: parser.errors.clone(),
    })
}

#[tauri::command]
async fn emit_osc_event(
    target_addr: String,
    event_name: String,
    data: String,
) -> Result<String, String> {
    let msg = rosc::OscMessage {
        addr: event_name.to_string(),
        args: vec![rosc::OscType::String(data)],
    };

    let packet = rosc::OscPacket::Message(msg);
    let msg_buf = rosc::encoder::encode(&packet)
        .map_err(|e| format!("Failed to encode OSC message: {}", e))?;

    let socket =
        UdpSocket::bind("0.0.0.0:0").map_err(|e| format!("Failed to bind socket: {}", e))?;
    socket
        .send_to(&msg_buf, &format!("{}", target_addr))
        .map_err(|e| format!("Failed to send OSC message: {}", e))?;

    Ok(format!("Osc message {} {}", target_addr, event_name))
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ParsedJsonResult {
    pub success: bool,
    pub data: Option<serde_json::Value>,
    pub error: Option<String>,
    pub file_name: String,
    pub preview: Option<String>,
}

fn start_osc_listener(app_handle: tauri::AppHandle<tauri::Wry>) {
    thread::spawn(move || {
        // Bind to OSC default port (9000)
        let osc_port = 9000u16;
        match UdpSocket::bind(format!("0.0.0.0:{}", osc_port)) {
            Ok(socket) => {
                eprintln!("OSC Listener started on port {}", osc_port);
                let mut buf = [0u8; 4096];

                loop {
                    match socket.recv(&mut buf) {
                        Ok(size) => {
                            // Decode OSC packet
                            match rosc::decoder::decode_udp(&buf[..size]) {
                                Ok((_, packet)) => {
                                    match packet {
                                        rosc::OscPacket::Message(msg) => {
                                            // Check if this is a /progress message
                                            if msg.addr == "/progress" {
                                                // Extract JSON string from the message arguments
                                                if let Some(rosc::OscType::String(json_str)) =
                                                    msg.args.first()
                                                {
                                                    let _ = app_handle.emit("progress", json_str);
                                                    eprintln!(
                                                        "Emitted progress event: {:?}",
                                                        json_str
                                                    );
                                                }
                                            }

                                            // Check if this is a /params message
                                            if msg.addr == "/params" {
                                                // Expect a JSON string with params data
                                                if let Some(rosc::OscType::String(json_str)) =
                                                    msg.args.first()
                                                {
                                                    let _ = app_handle.emit("params", json_str);
                                                    eprintln!(
                                                        "Emitted params event: {:?}",
                                                        json_str
                                                    );
                                                }
                                            }
                                        }
                                        rosc::OscPacket::Bundle(bundle) => {
                                            eprintln!(
                                                "Received OSC bundle with {} contents",
                                                bundle.content.len()
                                            );
                                        }
                                    }
                                }
                                Err(e) => {
                                    eprintln!("Failed to decode OSC packet: {}", e);
                                }
                            }
                        }
                        Err(e) => {
                            eprintln!("Error receiving OSC packet: {}", e);
                        }
                    }
                }
            }
            Err(e) => {
                eprintln!("Failed to bind to OSC port {}: {}", osc_port, e);
            }
        }
    });
}

#[tauri::command]
async fn parser_reset(state: tauri::State<'_, AppState>) -> Result<(), String> {
    let mut parser = state
        .text_parser
        .lock()
        .map_err(|_| "Failed to lock text_parser".to_string())?;
    parser.reset_scene();
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut text_parser = TextParser::new();
    // Initialize text parser with default font at startup
    if let Err(e) = text_parser.load_default_font() {
        eprintln!("Warning: Failed to load default font: {}", e);
    }

    let app_state = AppState {
        text_parser: Mutex::new(text_parser),
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_websocket::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            parser_eval_expression,
            parse_asemic_source,
            emit_osc_event,
            parser_reset
        ])
        .setup(|app| {
            // Start OSC listener in background thread
            start_osc_listener(app.handle().clone());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
