use std::env;
use std::fs;
use std::process::Command;

use crate::constants::{APP_EXE_NAME, NSIS_TEMP_NAME, SETUP_EXE_NAME, install_dir};

const NSIS_BYTES: &[u8] = include_bytes!("../assets/nsis-payload.exe");

pub fn run_install() {
    extract_and_run_nsis();
    copy_bootstrapper_to_install_dir();
}

pub fn extract_and_run_nsis() {
    let temp_path = env::temp_dir().join(NSIS_TEMP_NAME);
    fs::write(&temp_path, NSIS_BYTES).expect("failed to write NSIS payload");

    let status = Command::new(&temp_path)
        .arg("/S")
        .status()
        .expect("failed to run NSIS payload");

    let _ = fs::remove_file(&temp_path);

    if !status.success() {
        panic!("NSIS payload failed with status: {status}");
    }
}

pub fn run_uninstall() {
    let uninstall_path = install_dir().join("uninstall.exe");
    if !uninstall_path.exists() {
        return;
    }

    let status = Command::new(uninstall_path)
        .arg("/S")
        .status()
        .expect("failed to run uninstall.exe");

    if !status.success() {
        panic!("uninstall.exe failed with status: {status}");
    }
}

pub fn copy_bootstrapper_to_install_dir() {
    let current_exe = env::current_exe().expect("failed to resolve current executable");
    let target_dir = install_dir();
    fs::create_dir_all(&target_dir).expect("failed to create install directory");

    let target_path = target_dir.join(SETUP_EXE_NAME);
    fs::copy(current_exe, target_path).expect("failed to copy bootstrapper");
}

pub fn launch_app() {
    let app_path = install_dir().join(APP_EXE_NAME);
    let _ = Command::new(app_path).spawn();
}
