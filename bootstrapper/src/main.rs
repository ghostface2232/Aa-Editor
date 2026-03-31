#![allow(dead_code)]

use std::os::windows::process::CommandExt;
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};

use windows::Win32::System::Threading::CREATE_NO_WINDOW;
use windows::Win32::UI::HiDpi::{
    DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2, SetProcessDpiAwarenessContext,
};

mod cleanup;
mod constants;
mod installer;
mod registry;
mod splash;
use constants::install_dir;
use splash::{CompletionAction, SplashConfig};

fn main() {
    let _ = unsafe { SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2) };

    let args: Vec<String> = std::env::args().collect();

    if args.iter().any(|a| a == "--uninstall") {
        println!("[noten-setup] Running uninstall...");
        let uninstall_succeeded = Arc::new(AtomicBool::new(false));
        let uninstall_succeeded_for_work = Arc::clone(&uninstall_succeeded);
        let _splash_outcome = splash::run_splash(
            SplashConfig {
                status_ko: "제거 중...",
                status_en: "Removing...",
                completed_status_ko: "제거 완료",
                completed_status_en: "Removed",
                failed_status_ko: "제거 실패",
                failed_status_en: "Removal failed",
                ready_status_ko: Some("제거 옵션을 확인하세요"),
                ready_status_en: Some("Review the uninstall option"),
                primary_button_label_ko: "닫기",
                primary_button_label_en: "Close",
                ready_button_label_ko: Some("제거"),
                ready_button_label_en: Some("Remove"),
                secondary_button_label_ko: Some("취소"),
                secondary_button_label_en: Some("Cancel"),
                completion_action: CompletionAction::CloseWindow,
                auto_start: false,
                checkbox_label_ko: Some("노트 및 설정 데이터도 삭제"),
                checkbox_label_en: Some("Also delete notes and settings data"),
                checkbox_checked: false,
            },
            move |delete_user_data| {
                installer::run_uninstall()?;
                uninstall_succeeded_for_work.store(true, Ordering::SeqCst);
                let cleanup_plan = cleanup::build_cleanup_plan(delete_user_data);
                cleanup::run_cleanup(&cleanup_plan)?;
                Ok(())
            },
        );

        if uninstall_succeeded.load(Ordering::SeqCst) {
            schedule_self_delete(&install_dir());
        }
    } else {
        println!("[noten-setup] Running install...");
        let _ = splash::run_splash(
            SplashConfig {
                status_ko: "설치 중...",
                status_en: "Installing...",
                completed_status_ko: "완료",
                completed_status_en: "Complete",
                failed_status_ko: "설치 실패",
                failed_status_en: "Installation failed",
                ready_status_ko: None,
                ready_status_en: None,
                primary_button_label_ko: "앱 실행",
                primary_button_label_en: "Launch App",
                ready_button_label_ko: None,
                ready_button_label_en: None,
                secondary_button_label_ko: None,
                secondary_button_label_en: None,
                completion_action: CompletionAction::LaunchApp,
                auto_start: true,
                checkbox_label_ko: None,
                checkbox_label_en: None,
                checkbox_checked: false,
            },
            |_| {
                installer::extract_and_run_nsis()?;
                installer::copy_bootstrapper_to_install_dir()?;
                registry::fix_uninstall_string()?;
                Ok(())
            },
        );
    }
}

fn schedule_self_delete(install_dir: &std::path::Path) {
    let exe_path = std::env::current_exe().expect("failed to resolve current executable");
    let command = format!(
        "timeout /t 3 /nobreak >nul & del /f /q \"{}\" >nul 2>&1 & rmdir /s /q \"{}\" >nul 2>&1",
        exe_path.display(),
        install_dir.display()
    );

    let _ = std::process::Command::new("cmd")
        .creation_flags(CREATE_NO_WINDOW.0)
        .current_dir(std::env::temp_dir())
        .args(["/c", &command])
        .spawn();
}
