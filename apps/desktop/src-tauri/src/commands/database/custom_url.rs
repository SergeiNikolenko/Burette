//! "Retrieve From URL": open a collection published anywhere on the web.
//!
//! The address comes from the user rather than from a provider Burette chose, so
//! this is the one entry point where the SSRF guard, the download ceiling and the
//! decompression ceiling all earn their keep on the same request.

use std::io::Read;

use super::http::{fetch, DatabaseRequest};
use super::DatabasePayload;

/// The download ceiling. A collection larger than this would not survive being
/// built in memory and handed to the grid in one piece either.
pub(crate) const MAX_DOWNLOAD_BYTES: u64 = 64 * 1024 * 1024;
/// The decompression ceiling, checked while inflating rather than after: a small
/// gzip file can otherwise expand until the process runs out of memory.
pub(crate) const MAX_INFLATED_BYTES: u64 = 192 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum RetrievedFormat {
    Csv,
    Tsv,
    Sdf,
    Smiles,
}

impl RetrievedFormat {
    pub(crate) fn extension(self) -> &'static str {
        match self {
            Self::Csv => "csv",
            Self::Tsv => "tsv",
            Self::Sdf => "sdf",
            Self::Smiles => "smi",
        }
    }
}

pub(crate) fn retrieve(url: &str, limit: usize) -> Result<DatabasePayload, String> {
    let parsed = super::http::validate_request_url(url)?;
    let file_name = url_file_name(&parsed);
    let bytes = fetch(
        &DatabaseRequest::get(parsed.to_string())
            .with_timeout(180)
            .with_max_bytes(MAX_DOWNLOAD_BYTES),
    )?;
    if bytes.is_empty() {
        return Err("The URL answered with an empty document".to_string());
    }
    let (bytes, compressed) = if is_gzip(&bytes) {
        (inflate(&bytes)?, true)
    } else {
        (bytes, false)
    };
    let text = String::from_utf8(bytes)
        .map_err(|_| "The retrieved document is not UTF-8 text".to_string())?;
    let format = detect_format(&file_name, compressed, &text).ok_or_else(|| {
        "The URL does not point at a CSV, TSV, SMILES or SDF collection".to_string()
    })?;
    let (text, record_count, truncated) = truncate_to_limit(format, &text, limit);
    let mut warnings = Vec::new();
    if truncated {
        warnings.push(format!(
            "The document holds more than {limit} records; the first {record_count} were kept"
        ));
    }
    if record_count == 0 {
        return Err("The retrieved document holds no records".to_string());
    }
    Ok(DatabasePayload {
        extension: format.extension(),
        text,
        record_count,
        warnings,
    })
}

fn url_file_name(url: &url::Url) -> String {
    url.path_segments()
        .and_then(|mut segments| segments.rfind(|segment| !segment.is_empty()))
        .unwrap_or("")
        .to_lowercase()
}

fn is_gzip(bytes: &[u8]) -> bool {
    bytes.len() >= 2 && bytes[0] == 0x1f && bytes[1] == 0x8b
}

fn inflate(bytes: &[u8]) -> Result<Vec<u8>, String> {
    let mut decoder = flate2::read::MultiGzDecoder::new(bytes).take(MAX_INFLATED_BYTES + 1);
    let mut inflated = Vec::new();
    decoder
        .read_to_end(&mut inflated)
        .map_err(|error| format!("The retrieved archive could not be read: {error}"))?;
    if inflated.len() as u64 > MAX_INFLATED_BYTES {
        return Err("The retrieved archive expands beyond the size Burette accepts".to_string());
    }
    Ok(inflated)
}

/// The file name decides when it can, because a server's content type is often
/// "application/octet-stream" for exactly these files. When the name says
/// nothing, the text does: an SDF record ends in `$$$$`, and a delimited file is
/// named by whichever separator its header actually uses.
pub(crate) fn detect_format(
    file_name: &str,
    compressed: bool,
    text: &str,
) -> Option<RetrievedFormat> {
    let name = file_name.trim().to_lowercase();
    let stem = if compressed {
        name.strip_suffix(".gz").unwrap_or(&name)
    } else {
        &name
    };
    if stem.ends_with(".csv") {
        return Some(RetrievedFormat::Csv);
    }
    if stem.ends_with(".tsv") || stem.ends_with(".tab") {
        return Some(RetrievedFormat::Tsv);
    }
    if stem.ends_with(".sdf") || stem.ends_with(".sd") {
        return Some(RetrievedFormat::Sdf);
    }
    if stem.ends_with(".smi") || stem.ends_with(".smiles") {
        return Some(RetrievedFormat::Smiles);
    }
    let head: String = text.lines().take(64).collect::<Vec<_>>().join("\n");
    if head.contains("$$$$") || head.contains("M  END") || text.contains("\n$$$$") {
        return Some(RetrievedFormat::Sdf);
    }
    let first_line = text.lines().find(|line| !line.trim().is_empty())?;
    if first_line.contains('\t') {
        return Some(RetrievedFormat::Tsv);
    }
    if first_line.contains(',') {
        return Some(RetrievedFormat::Csv);
    }
    None
}

/// Applies the dialog's row limit to the document itself, so a 300 MB catalogue
/// costs one download rather than a collection nobody asked for.
fn truncate_to_limit(format: RetrievedFormat, text: &str, limit: usize) -> (String, usize, bool) {
    match format {
        RetrievedFormat::Sdf => {
            let mut kept = String::new();
            let mut records = 0usize;
            for record in text.split_inclusive("$$$$") {
                if !record.contains("$$$$") {
                    break;
                }
                if records == limit {
                    return (kept, records, true);
                }
                kept.push_str(record);
                if !kept.ends_with('\n') {
                    kept.push('\n');
                }
                records += 1;
            }
            let complete = records;
            (kept, complete, false)
        }
        RetrievedFormat::Csv | RetrievedFormat::Tsv => {
            let mut lines = text.lines();
            let Some(header) = lines.next() else {
                return (String::new(), 0, false);
            };
            let mut kept = String::from(header);
            kept.push('\n');
            let mut records = 0usize;
            for line in lines {
                if line.trim().is_empty() {
                    continue;
                }
                if records == limit {
                    return (kept, records, true);
                }
                kept.push_str(line);
                kept.push('\n');
                records += 1;
            }
            (kept, records, false)
        }
        RetrievedFormat::Smiles => {
            let mut kept = String::new();
            let mut records = 0usize;
            for line in text.lines() {
                if line.trim().is_empty() {
                    continue;
                }
                if records == limit {
                    return (kept, records, true);
                }
                kept.push_str(line);
                kept.push('\n');
                records += 1;
            }
            (kept, records, false)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn the_file_name_decides_the_format_when_it_can() {
        assert_eq!(
            detect_format("set.csv", false, ""),
            Some(RetrievedFormat::Csv)
        );
        assert_eq!(
            detect_format("set.TSV", false, ""),
            Some(RetrievedFormat::Tsv)
        );
        assert_eq!(
            detect_format("set.tab", false, ""),
            Some(RetrievedFormat::Tsv)
        );
        assert_eq!(
            detect_format("set.sdf", false, ""),
            Some(RetrievedFormat::Sdf)
        );
        assert_eq!(
            detect_format("set.sd", false, ""),
            Some(RetrievedFormat::Sdf)
        );
        assert_eq!(
            detect_format("set.smiles", false, ""),
            Some(RetrievedFormat::Smiles)
        );
        // ".sdf.gz" is the name after the archive suffix is taken off.
        assert_eq!(
            detect_format("catalogue.sdf.gz", true, ""),
            Some(RetrievedFormat::Sdf)
        );
    }

    #[test]
    fn a_nameless_url_is_read_from_the_document_itself() {
        assert_eq!(
            detect_format("download", false, "ID,SMILES\n1,CCO\n"),
            Some(RetrievedFormat::Csv)
        );
        assert_eq!(
            detect_format("download", false, "ID\tSMILES\n1\tCCO\n"),
            Some(RetrievedFormat::Tsv)
        );
        assert_eq!(
            detect_format(
                "download",
                false,
                "aspirin\n  Mrv  \n\n  1  0\nM  END\n$$$$\n"
            ),
            Some(RetrievedFormat::Sdf)
        );
        assert_eq!(detect_format("download", false, "nothing here"), None);
        assert_eq!(detect_format("", false, ""), None);
    }

    #[test]
    fn delimited_documents_keep_their_header_when_the_limit_bites() {
        let text = "ID,SMILES\n1,CCO\n2,CCN\n3,CCC\n";
        let (kept, records, truncated) = truncate_to_limit(RetrievedFormat::Csv, text, 2);
        assert_eq!(kept, "ID,SMILES\n1,CCO\n2,CCN\n");
        assert_eq!(records, 2);
        assert!(truncated);

        let (kept, records, truncated) = truncate_to_limit(RetrievedFormat::Csv, text, 10);
        assert_eq!(kept, text);
        assert_eq!(records, 3);
        assert!(!truncated);
    }

    #[test]
    fn sdf_documents_are_cut_on_a_record_boundary() {
        let text = "one\n\n\nM  END\n$$$$\ntwo\n\n\nM  END\n$$$$\nthree\n\n\nM  END\n$$$$\n";
        let (kept, records, truncated) = truncate_to_limit(RetrievedFormat::Sdf, text, 2);
        assert_eq!(records, 2);
        assert!(truncated);
        assert_eq!(kept.matches("$$$$").count(), 2);
        assert!(kept.ends_with("$$$$\n"));
        assert!(!kept.contains("three"));
    }

    #[test]
    fn a_trailing_partial_record_is_not_counted() {
        let text = "one\nM  END\n$$$$\ntwo-without-terminator\n";
        let (kept, records, truncated) = truncate_to_limit(RetrievedFormat::Sdf, text, 10);
        assert_eq!(records, 1);
        assert!(!truncated);
        assert!(!kept.contains("two-without-terminator"));
    }

    #[test]
    fn gzip_is_recognised_and_inflated_within_the_ceiling() {
        let mut encoder = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
        encoder
            .write_all(b"ID,SMILES\n1,CCO\n")
            .expect("gzip write");
        let compressed = encoder.finish().expect("gzip finish");
        assert!(is_gzip(&compressed));
        assert!(!is_gzip(b"ID,SMILES"));
        assert_eq!(inflate(&compressed).unwrap(), b"ID,SMILES\n1,CCO\n");
    }

    #[test]
    fn an_archive_that_expands_past_the_ceiling_is_refused() {
        let mut encoder = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::best());
        // Highly compressible input: a few hundred kilobytes on the wire stands in
        // for the gigabytes a real bomb would inflate to.
        for _ in 0..((MAX_INFLATED_BYTES / 1024) + 16) {
            encoder.write_all(&[b'a'; 1024]).expect("gzip write");
        }
        let compressed = encoder.finish().expect("gzip finish");
        let error = inflate(&compressed).expect_err("an oversized archive must be refused");
        assert!(error.contains("expands beyond"));
    }

    #[test]
    fn only_public_http_addresses_are_retrieved() {
        assert!(retrieve("http://127.0.0.1/set.csv", 10).is_err());
        assert!(retrieve("file:///etc/passwd", 10).is_err());
        assert!(retrieve("not a url", 10).is_err());
    }

    #[test]
    fn the_file_name_comes_from_the_last_path_segment() {
        let url = url::Url::parse("https://example.com/data/sets/catalogue.sdf.gz?v=2").unwrap();
        assert_eq!(url_file_name(&url), "catalogue.sdf.gz");
        let bare = url::Url::parse("https://example.com/").unwrap();
        assert_eq!(url_file_name(&bare), "");
    }
}
