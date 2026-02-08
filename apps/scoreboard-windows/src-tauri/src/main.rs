#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use mdns_sd::{ServiceDaemon, ServiceEvent};
use serde::Serialize;
use std::time::{Duration, Instant};

#[derive(Serialize)]
struct DiscoveryResult {
    host: String,
    port: u16,
}

#[tauri::command]
fn discover_server(timeout_ms: Option<u64>) -> Result<Option<DiscoveryResult>, String> {
    let mdns = ServiceDaemon::new().map_err(|err| err.to_string())?;
    let receiver = mdns
        .browse("_clubscore._tcp.local.")
        .map_err(|err| err.to_string())?;

    let timeout = Duration::from_millis(timeout_ms.unwrap_or(2500));
    let deadline = Instant::now() + timeout;
    let mut found: Option<DiscoveryResult> = None;

    while Instant::now() < deadline {
        match receiver.recv_timeout(Duration::from_millis(300)) {
            Ok(ServiceEvent::ServiceResolved(info)) => {
                let host = info
                    .get_addresses()
                    .iter()
                    .next()
                    .map(|addr| addr.to_string())
                    .unwrap_or_else(|| info.get_hostname().to_string());

                found = Some(DiscoveryResult {
                    host,
                    port: info.get_port(),
                });
                break;
            }
            Ok(_) => {}
            Err(_) => {}
        }
    }

    let _ = mdns.shutdown();
    Ok(found)
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![discover_server])
        .run(tauri::generate_context!())
        .expect("error while running clubscore scoreboard app");
}
