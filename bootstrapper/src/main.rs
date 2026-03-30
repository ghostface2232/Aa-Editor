#![allow(dead_code)]

use windows::Win32::UI::HiDpi::{
    DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2, SetProcessDpiAwarenessContext,
};

mod constants;
mod installer;
mod registry;
mod splash;

fn main() {
    let _ = unsafe { SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2) };

    let args: Vec<String> = std::env::args().collect();

    if args.iter().any(|a| a == "--uninstall") {
        println!("[noten-setup] Running uninstall...");
        splash::run_splash("제거 중...", "Removing...", || {
            installer::run_uninstall();
        });
        schedule_self_delete();
    } else {
        println!("[noten-setup] Running install...");
        splash::run_splash("설치 중...", "Installing...", || {
            installer::extract_and_run_nsis();
            installer::copy_bootstrapper_to_install_dir();
            registry::fix_uninstall_string();
        });
    }
}

fn schedule_self_delete() {
    let exe_path = std::env::current_exe().expect("failed to resolve current executable");
    let command = format!(
        "timeout /t 3 /nobreak >nul & del \"{}\"",
        exe_path.display()
    );

    let _ = std::process::Command::new("cmd")
        .args(["/c", &command])
        .spawn();
}
