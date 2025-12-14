use sorceress::server::Server;
use std::sync::Mutex;
use once_cell::sync::Lazy;

pub static SC: Lazy<Mutex<SuperCollider>> = Lazy::new(|| {
    Mutex::new(SuperCollider {
        server: None,
    })
});

/// SuperCollider manager class
pub struct SuperCollider {
    pub server: Option<Server>,
}

impl SuperCollider {
    pub fn new() -> Self {
        SuperCollider {
            server: None,
        }
    }
    
    pub fn connect(&mut self, host: &str) -> Result<(), String> {
        let server = Server::connect(host)
            .map_err(|e| format!("Failed to connect to SuperCollider server at {}: {}", host, e))?;
        println!("Connected to SuperCollider server at {}", host);
        self.server = Some(server);
        Ok(())
    }

    
    
    /// Disconnects from the SuperCollider server
    pub fn disconnect(&mut self) {
        self.server = None;
    }
}
