use std::mem::size_of;
use std::slice;

use windows::core::PCWSTR;
use windows::Win32::Foundation::ERROR_SUCCESS;
use windows::Win32::System::Registry::{
    HKEY, HKEY_CURRENT_USER, KEY_SET_VALUE, REG_SZ, RegCloseKey, RegOpenKeyExW, RegSetValueExW,
};

use crate::constants::{SETUP_EXE_NAME, UNINSTALL_REG_KEY, install_dir};

pub fn fix_uninstall_string() {
    unsafe {
        let uninstall_path = install_dir().join(SETUP_EXE_NAME);
        let uninstall_string = format!("\"{}\" --uninstall", uninstall_path.display());

        let mut subkey: Vec<u16> = UNINSTALL_REG_KEY.encode_utf16().collect();
        subkey.push(0);

        let mut value_name: Vec<u16> = "UninstallString".encode_utf16().collect();
        value_name.push(0);

        let mut value_data: Vec<u16> = uninstall_string.encode_utf16().collect();
        value_data.push(0);

        let mut key = HKEY::default();
        let open_status = RegOpenKeyExW(
            HKEY_CURRENT_USER,
            PCWSTR(subkey.as_ptr()),
            Some(0),
            KEY_SET_VALUE,
            &mut key,
        );
        if open_status != ERROR_SUCCESS {
            panic!("failed to open uninstall registry key: {open_status:?}");
        }

        let data_bytes = slice::from_raw_parts(
            value_data.as_ptr() as *const u8,
            value_data.len() * size_of::<u16>(),
        );

        let set_status = RegSetValueExW(
            key,
            PCWSTR(value_name.as_ptr()),
            Some(0),
            REG_SZ,
            Some(data_bytes),
        );
        let _ = RegCloseKey(key);

        if set_status != ERROR_SUCCESS {
            panic!("failed to set UninstallString: {set_status:?}");
        }
    }
}
