use tauri::Manager;

const KEYCHAIN_SERVICE: &str = "org.venrescate.coordinator";
const KEYCHAIN_USER: &str = "coordinator-seed";

#[tauri::command]
fn get_platform() -> String {
    std::env::consts::OS.to_string()
}

/// Store the coordinator's Ed25519 seed in the OS keychain
/// (macOS Keychain / Windows Credential Manager / Linux SecretService).
#[tauri::command]
fn keychain_set(seed: String) -> Result<(), String> {
    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_USER).map_err(|e| e.to_string())?;
    entry.set_password(&seed).map_err(|e| e.to_string())
}

#[tauri::command]
fn keychain_get() -> Result<Option<String>, String> {
    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_USER).map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(seed) => Ok(Some(seed)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .invoke_handler(tauri::generate_handler![get_platform, keychain_set, keychain_get])
        .setup(|app| {
            let _window = app.get_webview_window("main").unwrap();
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
