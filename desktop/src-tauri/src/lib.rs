use std::sync::Mutex;
use tauri::Manager;
use tauri_plugin_shell::ShellExt;

struct BackendProcess(Mutex<Option<tauri_plugin_shell::process::CommandChild>>);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_shell::init())
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_notification::init())
    .plugin(tauri_plugin_fs::init())
    .manage(BackendProcess(Mutex::new(None)))
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      // Resolve backend directory using compile-time manifest dir (reliable in dev)
      // CARGO_MANIFEST_DIR points to src-tauri/, so ../../backend reaches the backend
      let manifest_dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
      let backend_dir = manifest_dir.join("../../backend").canonicalize().unwrap_or_else(|_| {
        // Fallback: try current_dir (for bundled app where manifest dir won't exist)
        std::env::current_dir()
          .unwrap_or_default()
          .join("../backend")
      });

      let venv_python = backend_dir.join("venv/bin/python");

      if !venv_python.exists() {
        log::warn!(
          "Backend venv not found at {:?}, skipping sidecar launch",
          venv_python
        );
        return Ok(());
      }

      log::info!("Starting backend from: {:?}", backend_dir);

      let spawn_result = app
        .shell()
        .command(venv_python.to_string_lossy().to_string())
        .args([
          "-m",
          "uvicorn",
          "main:app",
          "--host",
          "127.0.0.1",
          "--port",
          "8000",
        ])
        .current_dir(backend_dir)
        .spawn();

      let (mut rx, child) = match spawn_result {
        Ok(result) => result,
        Err(e) => {
          log::error!("Failed to start backend server: {}", e);
          return Ok(());
        }
      };

      // Log backend output
      tauri::async_runtime::spawn(async move {
        use tauri_plugin_shell::process::CommandEvent;
        while let Some(event) = rx.recv().await {
          match event {
            CommandEvent::Stdout(line) => {
              log::info!("[backend] {}", String::from_utf8_lossy(&line));
            }
            CommandEvent::Stderr(line) => {
              log::info!("[backend] {}", String::from_utf8_lossy(&line));
            }
            CommandEvent::Terminated(status) => {
              log::warn!("[backend] Process terminated: {:?}", status);
              break;
            }
            _ => {}
          }
        }
      });

      // Store child process for cleanup
      let state = app.state::<BackendProcess>();
      *state.0.lock().unwrap() = Some(child);

      Ok(())
    })
    .build(tauri::generate_context!())
    .expect("error while building tauri application")
    .run(|app, event| {
      if let tauri::RunEvent::Exit = event {
        let state = app.state::<BackendProcess>();
        let child = state.0.lock().unwrap().take();
        if let Some(child) = child {
          log::info!("Shutting down backend server...");
          let _ = child.kill();
        }
      }
    });
}
