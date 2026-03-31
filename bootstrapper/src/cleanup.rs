use std::fs;
use std::path::{Component, Path, PathBuf};

use crate::constants::{default_notes_dir, install_dir, roaming_app_dir, settings_path};

#[derive(Clone, Debug)]
pub struct CleanupPlan {
    pub delete_user_data: bool,
    pub notes_dir: Option<PathBuf>,
    pub roaming_dir: PathBuf,
    pub install_dir: PathBuf,
}

pub fn build_cleanup_plan(delete_user_data: bool) -> CleanupPlan {
    CleanupPlan {
        delete_user_data,
        notes_dir: delete_user_data.then(resolve_notes_dir).flatten(),
        roaming_dir: roaming_app_dir(),
        install_dir: install_dir(),
    }
}

pub fn run_cleanup(plan: &CleanupPlan) -> Result<(), String> {
    let mut failures = Vec::new();

    if plan.delete_user_data {
        if let Some(notes_dir) = &plan.notes_dir {
            if let Err(error) =
                remove_notes_dir_if_safe(notes_dir, &[&plan.roaming_dir, &plan.install_dir])
            {
                failures.push(error);
            }
        }

        if let Err(error) = remove_dir_if_safe(&plan.roaming_dir, &[&plan.install_dir]) {
            failures.push(error);
        }
    }

    if failures.is_empty() {
        Ok(())
    } else {
        Err(failures.join("\n"))
    }
}

fn resolve_notes_dir() -> Option<PathBuf> {
    let configured = read_notes_directory_setting().unwrap_or_default();
    let configured = configured.trim();
    if configured.is_empty() {
        Some(default_notes_dir())
    } else {
        let path = PathBuf::from(configured);
        path.is_absolute().then_some(path)
    }
}

fn read_notes_directory_setting() -> Option<String> {
    let raw = fs::read_to_string(settings_path()).ok()?;
    extract_json_string(&raw, "notesDirectory")
}

fn remove_dir_if_safe(path: &Path, additional_blocked: &[&Path]) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }

    let resolved = canonical_dir(path)?;
    validate_delete_path(&resolved, additional_blocked)?;
    fs::remove_dir_all(&resolved)
        .map_err(|error| format!("failed to remove {}: {error}", resolved.display()))
}

fn remove_notes_dir_if_safe(path: &Path, additional_blocked: &[&Path]) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }

    let resolved = canonical_dir(path)?;
    validate_delete_path(&resolved, additional_blocked)?;

    let default_notes = normalize_existing_or_raw(&default_notes_dir());
    let is_default_notes = normalize_path(&resolved) == default_notes;
    if !is_default_notes && !resolved.join("manifest.json").is_file() {
        return Err(format!(
            "refusing to delete custom notes directory without manifest.json: {}",
            resolved.display()
        ));
    }

    fs::remove_dir_all(&resolved)
        .map_err(|error| format!("failed to remove {}: {error}", resolved.display()))
}

fn validate_delete_path(path: &Path, additional_blocked: &[&Path]) -> Result<(), String> {
    if !path.is_absolute() {
        return Err(format!(
            "refusing to delete non-absolute path: {}",
            path.display()
        ));
    }

    let rendered = path.as_os_str().to_string_lossy().trim().to_string();
    if rendered.is_empty() {
        return Err("cleanup target is empty".to_string());
    }

    let components: Vec<Component<'_>> = path.components().collect();
    if components.is_empty() || path.parent().is_none() || components.len() <= 1 {
        return Err(format!("refusing to delete root path: {}", path.display()));
    }

    let protected = [
        std::env::var("APPDATA").ok().map(PathBuf::from),
        std::env::var("LOCALAPPDATA").ok().map(PathBuf::from),
        std::env::var("USERPROFILE").ok().map(PathBuf::from),
    ];

    for blocked in protected.into_iter().flatten().chain(
        additional_blocked
            .iter()
            .map(|path| normalize_existing_or_raw(path).into()),
    ) {
        if same_path(path, blocked.as_path()) {
            return Err(format!(
                "refusing to delete protected path: {}",
                path.display()
            ));
        }
    }

    Ok(())
}

fn same_path(left: &Path, right: &Path) -> bool {
    normalize_path(left) == normalize_path(right)
}

fn normalize_path(path: &Path) -> String {
    path.to_string_lossy()
        .replace('/', "\\")
        .trim_end_matches('\\')
        .to_ascii_lowercase()
}

fn canonical_dir(path: &Path) -> Result<PathBuf, String> {
    fs::canonicalize(path).map_err(|error| format!("failed to resolve {}: {error}", path.display()))
}

fn normalize_existing_or_raw(path: &Path) -> String {
    match fs::canonicalize(path) {
        Ok(resolved) => normalize_path(&resolved),
        Err(_) => normalize_path(path),
    }
}

fn extract_json_string(raw: &str, key: &str) -> Option<String> {
    let needle = format!("\"{key}\"");
    let key_index = raw.find(&needle)?;
    let after_key = &raw[key_index + needle.len()..];
    let colon_index = after_key.find(':')?;
    let mut chars = after_key[colon_index + 1..].chars().peekable();

    while matches!(chars.peek(), Some(ch) if ch.is_whitespace()) {
        chars.next();
    }
    if chars.next()? != '"' {
        return None;
    }

    let mut escaped = false;
    let mut value = String::new();
    for ch in chars {
        if escaped {
            value.push(match ch {
                '"' => '"',
                '\\' => '\\',
                '/' => '/',
                'b' => '\u{0008}',
                'f' => '\u{000C}',
                'n' => '\n',
                'r' => '\r',
                't' => '\t',
                other => other,
            });
            escaped = false;
            continue;
        }

        if ch == '\\' {
            escaped = true;
            continue;
        }

        if ch == '"' {
            return Some(value);
        }

        value.push(ch);
    }

    None
}
