//! Bounded eager collection editing; ordinary large-file grid opens stay streamed.
use std::collections::HashSet;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use crate::structure_path_extension;

pub const MAX_MERGE_BYTES: usize = 75 * 1024 * 1024;
const MAX_MERGE_PATHS: usize = 64;
const MAX_HEADER_BYTES: usize = 256 * 1024;
static MERGES: Mutex<usize> = Mutex::new(0);

pub struct MergeSlot;
impl MergeSlot {
    pub fn acquire() -> Result<Self, String> {
        let mut active = MERGES.lock().map_err(|error| error.to_string())?;
        if *active >= 2 {
            return Err("Two collection edits are already running. Try again shortly.".into());
        }
        *active += 1;
        Ok(Self)
    }
}
impl Drop for MergeSlot {
    fn drop(&mut self) {
        if let Ok(mut active) = MERGES.lock() {
            *active -= 1;
        }
    }
}

fn size_error() -> String {
    "Collection edits accept at most 75 MiB of input and output; open larger collections directly."
        .into()
}

pub fn read_bounded(path: &Path, limit: usize) -> Result<String, String> {
    let file = fs::File::open(path).map_err(|error| format!("{}: {error}", path.display()))?;
    let metadata = file.metadata().map_err(|error| error.to_string())?;
    if !metadata.is_file() {
        return Err(format!("{} is not a file", path.display()));
    }
    if metadata.len() > limit as u64 {
        return Err(size_error());
    }
    read_utf8_bounded(file, limit).map_err(|error| format!("{}: {error}", path.display()))
}

fn read_utf8_bounded(reader: impl Read, limit: usize) -> Result<String, String> {
    let mut text = String::new();
    reader
        .take(limit as u64 + 1)
        .read_to_string(&mut text)
        .map_err(|error| error.to_string())?;
    if text.len() > limit {
        return Err(size_error());
    }
    Ok(text)
}

fn push(output: &mut String, text: &str) -> Result<(), String> {
    if text.len() > MAX_MERGE_BYTES.saturating_sub(output.len()) {
        return Err(size_error());
    }
    output.push_str(text);
    Ok(())
}

pub fn merge_collection_files(paths: &[String]) -> Result<(String, String), String> {
    if paths.len() > MAX_MERGE_PATHS {
        return Err("Merge at most 64 collection files at once".into());
    }
    let mut seen = HashSet::new();
    let mut sources = Vec::new();
    let mut family = None;
    let mut declared = 0u64;
    // Reject incompatible or oversized requests before reading any contents.
    for path in paths {
        let canonical = PathBuf::from(path)
            .canonicalize()
            .map_err(|error| format!("{path}: {error}"))?;
        if !seen.insert(canonical.clone()) {
            continue;
        }
        let metadata = fs::metadata(&canonical).map_err(|error| error.to_string())?;
        if !metadata.is_file() {
            return Err(format!("{} is not a file", canonical.display()));
        }
        let next = collection_family(&structure_path_extension(&canonical)).ok_or_else(|| {
            format!(
                "{} is not a supported molecule collection",
                canonical.display()
            )
        })?;
        if family.is_some_and(|family| family != next) {
            return Err(
                "Collection merge supports one format family at a time: SDF, SMILES, CSV, or TSV"
                    .into(),
            );
        }
        family = Some(next);
        declared = declared
            .checked_add(metadata.len())
            .ok_or_else(size_error)?;
        if declared > MAX_MERGE_BYTES as u64 {
            return Err(size_error());
        }
        sources.push(canonical);
    }
    if sources.len() < 2 {
        return Err("Drop at least two molecule collections to merge them".into());
    }
    let mut remaining = MAX_MERGE_BYTES;
    let mut texts = Vec::new();
    for path in sources {
        let text = read_bounded(&path, remaining)?;
        remaining -= text.len();
        texts.push(text);
    }
    let family = family.expect("at least two source families were checked");
    let text = merge_collection_text(
        family,
        &texts.iter().map(String::as_str).collect::<Vec<_>>(),
    )?;
    if text.trim().is_empty() {
        return Err("Merged collection is empty".into());
    }
    Ok((family.default_extension().to_string(), text))
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CollectionFamily {
    Sdf,
    Smiles,
    Csv,
    Tsv,
}

impl CollectionFamily {
    fn default_extension(self) -> &'static str {
        match self {
            Self::Sdf => "sdf",
            Self::Smiles => "smi",
            Self::Csv => "csv",
            Self::Tsv => "tsv",
        }
    }
}

pub fn collection_family(extension: &str) -> Option<CollectionFamily> {
    match extension {
        "sd" | "sdf" => Some(CollectionFamily::Sdf),
        "smi" | "smiles" => Some(CollectionFamily::Smiles),
        "csv" => Some(CollectionFamily::Csv),
        "tsv" => Some(CollectionFamily::Tsv),
        _ => None,
    }
}

pub fn merge_collection_text(family: CollectionFamily, texts: &[&str]) -> Result<String, String> {
    let total = texts
        .iter()
        .try_fold(0usize, |total, text| total.checked_add(text.len()))
        .ok_or_else(size_error)?;
    if total > MAX_MERGE_BYTES {
        return Err(size_error());
    }
    let mut output = String::new();
    match family {
        CollectionFamily::Sdf => {
            for (index, text) in texts.iter().enumerate() {
                let before = output.len();
                let mut record = String::new();
                for line in text.lines() {
                    if line.trim() == "$$$$" {
                        finish_sdf_record(&mut output, &mut record)?;
                    } else {
                        if !record.is_empty() {
                            push(&mut record, "\n")?;
                        }
                        push(&mut record, line)?;
                    }
                }
                finish_sdf_record(&mut output, &mut record)?;
                if output.len() == before {
                    return Err(format!(
                        "SDF collection source {} does not contain any records",
                        index + 1
                    ));
                }
            }
        }
        CollectionFamily::Smiles => {
            for (index, text) in texts.iter().enumerate() {
                let mut has_record = false;
                for line in text.lines().map(str::trim).filter(|line| !line.is_empty()) {
                    has_record |= !line.starts_with('#');
                    push(&mut output, line)?;
                    push(&mut output, "\n")?;
                }
                if !has_record {
                    return Err(format!(
                        "SMILES collection source {} does not contain any molecule records",
                        index + 1
                    ));
                }
            }
        }
        CollectionFamily::Csv => merge_delimited_collection_text(&mut output, texts, ',', "CSV")?,
        CollectionFamily::Tsv => merge_delimited_collection_text(&mut output, texts, '\t', "TSV")?,
    }
    Ok(output)
}

fn finish_sdf_record(output: &mut String, record: &mut String) -> Result<(), String> {
    let text = record.trim();
    if !text.is_empty() {
        push(output, text)?;
        push(output, "\n$$$$\n")?;
    }
    record.clear();
    Ok(())
}

fn merge_delimited_collection_text(
    output: &mut String,
    texts: &[&str],
    separator: char,
    label: &str,
) -> Result<(), String> {
    let mut expected_header: Option<Vec<String>> = None;
    for (index, text) in texts.iter().enumerate() {
        let mut lines = text.lines().skip_while(|line| line.trim().is_empty());
        let header_line = lines
            .next()
            .ok_or_else(|| format!("{label} collection source {} is empty", index + 1))?
            .trim_start_matches('\u{feff}');
        if header_line.len() > MAX_HEADER_BYTES {
            return Err("Collection header exceeds 256 KiB".into());
        }
        let header = parse_delimited_collection_header(header_line, separator);
        if header.is_empty() || header.iter().all(String::is_empty) {
            return Err(format!(
                "{label} collection source {} has an empty header",
                index + 1
            ));
        }
        if expected_header
            .as_ref()
            .is_some_and(|expected| expected != &header)
        {
            return Err(format!(
                "{label} collection headers must use the same columns in the same order"
            ));
        }
        expected_header.get_or_insert(header);
        if index == 0 {
            push(output, header_line)?;
            push(output, "\n")?;
        }
        let mut data_end = None;
        for line in lines {
            push(output, line)?;
            push(output, "\n")?;
            if !line.trim().is_empty() {
                data_end = Some(output.len());
            }
        }
        let end = data_end.ok_or_else(|| {
            format!(
                "{label} collection source {} does not contain any data rows",
                index + 1
            )
        })?;
        output.truncate(end);
    }
    Ok(())
}

pub fn parse_delimited_collection_header(line: &str, separator: char) -> Vec<String> {
    parse_delimited_collection_cells(line, separator)
        .into_iter()
        .map(|cell| cell.trim().to_lowercase())
        .collect()
}

pub fn parse_delimited_collection_cells(line: &str, separator: char) -> Vec<String> {
    let mut cells = Vec::new();
    let mut current = String::new();
    let mut quoted = false;
    let mut chars = line.chars().peekable();
    while let Some(character) = chars.next() {
        if character == '"' && chars.peek() == Some(&'"') {
            current.push('"');
            chars.next();
        } else if character == '"' {
            quoted = !quoted;
        } else if character == separator && !quoted {
            cells.push(std::mem::take(&mut current));
        } else {
            current.push(character);
        }
    }
    cells.push(current);
    cells
}

struct PendingOutput {
    path: PathBuf,
    keep: bool,
}
impl Drop for PendingOutput {
    fn drop(&mut self) {
        if !self.keep {
            let _ = fs::remove_dir_all(&self.path);
        }
    }
}

pub fn with_generated_output<T>(
    directory: &Path,
    extension: &str,
    text: &str,
    open: impl FnOnce(PathBuf) -> Result<T, String>,
) -> Result<T, String> {
    if text.len() > MAX_MERGE_BYTES {
        return Err(size_error());
    }
    if let Some(parent) = directory.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    fs::create_dir(directory).map_err(|error| error.to_string())?;
    let mut pending = PendingOutput {
        path: directory.into(),
        keep: false,
    };
    let path = pending.path.join(format!("merged-collection.{extension}"));
    fs::write(&path, text).map_err(|error| error.to_string())?;
    let result = open(path)?;
    pending.keep = true;
    Ok(result)
}

#[cfg(test)]
#[path = "collection_merge_tests.rs"]
mod tests;
