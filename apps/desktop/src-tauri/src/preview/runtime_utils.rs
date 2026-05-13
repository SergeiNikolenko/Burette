use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::Path;

pub(crate) fn asset_url(path: &Path) -> String {
    #[cfg(target_os = "windows")]
    {
        format!("http://asset.localhost/{}", percent_encode_path(path))
    }
    #[cfg(not(target_os = "windows"))]
    {
        format!("asset://localhost/{}", percent_encode_path(path))
    }
}

fn percent_encode_path(path: &Path) -> String {
    path.to_string_lossy()
        .as_bytes()
        .iter()
        .map(|byte| match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                (*byte as char).to_string()
            }
            _ => format!("%{byte:02X}"),
        })
        .collect()
}

pub(crate) fn normalized_lines(text: &str) -> Vec<String> {
    text.replace("\r\n", "\n")
        .replace('\r', "\n")
        .split('\n')
        .map(str::to_string)
        .collect()
}

pub(crate) fn decode_text(data: &[u8]) -> String {
    String::from_utf8_lossy(data).into_owned()
}

pub(crate) fn clipped(value: &str, limit: usize) -> String {
    if value.chars().count() <= limit {
        return value.to_string();
    }
    let keep = limit.saturating_sub(3);
    value.chars().take(keep).collect::<String>() + "..."
}

pub(crate) fn file_title(path: &Path) -> String {
    path.file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("structure")
        .to_string()
}

pub(crate) fn stable_id(path: &Path) -> String {
    let mut hasher = DefaultHasher::new();
    path.hash(&mut hasher);
    format!("{:x}", hasher.finish())
}

pub(crate) fn prune_runtime_dirs(base: &Path) {
    let Ok(entries) = fs::read_dir(base) else {
        return;
    };
    let mut runtimes: Vec<_> = entries
        .filter_map(Result::ok)
        .filter(|entry| entry.file_name() != "assets")
        .filter_map(|entry| {
            let modified = entry.metadata().ok()?.modified().ok()?;
            Some((entry.path(), modified))
        })
        .collect();
    runtimes.sort_by_key(|(_, modified)| *modified);
    let overflow = runtimes.len().saturating_sub(24);
    for (path, _) in runtimes.into_iter().take(overflow) {
        let _ = fs::remove_dir_all(path);
    }
}

pub(crate) fn escape_html(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}
