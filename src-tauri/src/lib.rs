use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            // WebView 로드 전에 Mica 효과 적용
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_effects(tauri::utils::config::WindowEffectsConfig {
                    effects: vec![tauri::window::Effect::Mica],
                    state: None,
                    radius: None,
                    color: None,
                });
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
