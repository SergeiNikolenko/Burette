use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

use crate::{is_hidden_path, is_supported_structure_path};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    path: String,
    filename: String,
    relative_path: String,
    score: u32,
    match_indices: Vec<u32>,
}

#[tauri::command]
pub fn search_workspace(
    workspace_root: String,
    query: String,
    limit: Option<u32>,
) -> Result<Vec<SearchResult>, String> {
    let root = PathBuf::from(&workspace_root)
        .canonicalize()
        .map_err(|err| format!("{}: {err}", workspace_root))?;
    let metadata = fs::metadata(&root).map_err(|err| err.to_string())?;
    if !metadata.is_dir() {
        return Err(format!("{} is not a folder", root.display()));
    }

    search_workspace_paths(&root, &query, limit.unwrap_or(50) as usize)
}

fn search_workspace_paths(
    root: &Path,
    query: &str,
    limit: usize,
) -> Result<Vec<SearchResult>, String> {
    let normalized_query = query.trim().to_ascii_lowercase();
    if normalized_query.is_empty() || limit == 0 {
        return Ok(Vec::new());
    }

    let mut paths = Vec::new();
    collect_workspace_search_paths(root, &mut paths)?;

    let mut results: Vec<SearchResult> = paths
        .into_iter()
        .filter_map(|path| search_result_for_path(root, path, &normalized_query))
        .collect();
    results.sort_by(|a, b| {
        b.score
            .cmp(&a.score)
            .then_with(|| a.relative_path.cmp(&b.relative_path))
    });
    results.truncate(limit);
    Ok(results)
}

fn collect_workspace_search_paths(dir: &Path, paths: &mut Vec<PathBuf>) -> Result<(), String> {
    for entry in fs::read_dir(dir).map_err(|err| format!("{}: {err}", dir.display()))? {
        let entry = entry.map_err(|err| err.to_string())?;
        let path = entry.path();
        if is_hidden_path(&path) {
            continue;
        }
        let metadata = entry.metadata().map_err(|err| err.to_string())?;
        if metadata.is_dir() {
            collect_workspace_search_paths(&path, paths)?;
        } else if metadata.is_file() && is_supported_structure_path(&path) {
            paths.push(path);
        }
    }
    Ok(())
}

fn search_result_for_path(root: &Path, path: PathBuf, query: &str) -> Option<SearchResult> {
    let relative_path = path
        .strip_prefix(root)
        .unwrap_or(&path)
        .to_string_lossy()
        .replace('\\', "/");
    let haystack = relative_path.to_ascii_lowercase();
    let (byte_start, char_len) = best_query_match(&haystack, query)?;

    let char_start = haystack[..byte_start].chars().count();
    let filename = path.file_name()?.to_string_lossy().to_string();
    let filename_byte_start = relative_path.rfind('/').map_or(0, |index| index + 1);
    let filename_match_bonus = if byte_start >= filename_byte_start {
        1_000_000
    } else {
        0
    };
    let early_match_bonus = 10_000u32.saturating_sub(char_start as u32);
    let short_path_bonus = 10_000u32.saturating_sub(relative_path.chars().count() as u32);
    let score = filename_match_bonus + early_match_bonus + short_path_bonus;
    let match_indices = (char_start..char_start + char_len)
        .map(|index| index as u32)
        .collect();

    Some(SearchResult {
        path: path.to_string_lossy().to_string(),
        filename,
        relative_path,
        score,
        match_indices,
    })
}

fn best_query_match(haystack: &str, query: &str) -> Option<(usize, usize)> {
    let variants = [
        query.to_string(),
        query.replace(' ', "-"),
        query.replace('-', " "),
    ];
    variants
        .iter()
        .filter(|variant| !variant.is_empty())
        .filter_map(|variant| {
            haystack
                .find(variant)
                .map(|byte_start| (byte_start, variant.chars().count()))
        })
        .min_by_key(|(byte_start, char_len)| (*byte_start, *char_len))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_workspace(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!("burrete-{name}-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).expect("create temp workspace");
        root
    }

    #[test]
    fn search_workspace_paths_returns_matching_supported_files() {
        let root = temp_workspace("search-workspace");
        let nested = root.join("alpha set");
        fs::create_dir_all(&nested).expect("create nested dir");
        fs::write(root.join("notes.txt"), b"ignore").expect("write txt");
        fs::write(root.join(".hidden.pdb"), b"ignore").expect("write hidden");
        fs::write(nested.join("kinase-target.pdb"), b"HEADER\n").expect("write pdb");
        fs::write(nested.join("other.sdf"), b"mol\n").expect("write sdf");

        let results = search_workspace_paths(&root, "kinase target", 10).expect("search workspace");

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].filename, "kinase-target.pdb");
        assert_eq!(results[0].relative_path, "alpha set/kinase-target.pdb");
        assert!(!results[0].match_indices.is_empty());
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn search_workspace_paths_prioritizes_filename_matches() {
        let root = temp_workspace("search-ranking");
        let nested = root.join("target");
        fs::create_dir_all(&nested).expect("create nested dir");
        fs::write(root.join("target.pdb"), b"HEADER\n").expect("write pdb");
        fs::write(nested.join("alpha.pdb"), b"HEADER\n").expect("write pdb");

        let results = search_workspace_paths(&root, "target", 10).expect("search workspace");

        assert_eq!(results[0].relative_path, "target.pdb");
        fs::remove_dir_all(root).ok();
    }
}
