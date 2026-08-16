//! Wikipedia's chemistry pages, as collected by wikipedia.cheminfo.org.
//!
//! The export is one tab-separated line per page: an OpenChemLib idcode and the
//! article title. Burette's backend has no chemistry toolkit, so the idcodes are
//! not decoded here - they are written into a DataWarrior collection, whose
//! structure column the grid already renders with OpenChemLib.

use super::http::{fetch_text, DatabaseRequest};
use super::table::idcode_dwar;
use super::DatabasePayload;

const WIKIPEDIA_IDCODES: &str = "https://wikipedia.cheminfo.org/idcode.txt";
/// The export is a few megabytes of text and grows slowly; well below this.
const MAX_EXPORT_BYTES: u64 = 32 * 1024 * 1024;

pub(crate) fn retrieve(name_filter: &str, limit: usize) -> Result<DatabasePayload, String> {
    let text = fetch_text(
        &DatabaseRequest::get(WIKIPEDIA_IDCODES)
            .with_timeout(120)
            .with_max_bytes(MAX_EXPORT_BYTES),
    )?;
    Ok(build(&text, name_filter, limit))
}

pub(crate) fn build(export: &str, name_filter: &str, limit: usize) -> DatabasePayload {
    let filter = name_filter.trim().to_lowercase();
    let mut rows = Vec::new();
    let mut matched = 0usize;
    for line in export.lines() {
        let Some((idcode, name)) = line.split_once('\t') else {
            continue;
        };
        let idcode = idcode.trim();
        let name = name.trim();
        if idcode.is_empty() || name.is_empty() {
            continue;
        }
        if !filter.is_empty() && !name.to_lowercase().contains(&filter) {
            continue;
        }
        matched += 1;
        if rows.len() < limit {
            rows.push((idcode.to_string(), vec![name.to_string()]));
        }
    }
    let mut warnings = Vec::new();
    if matched > rows.len() {
        warnings.push(format!(
            "Wikipedia lists {matched} matching molecules; the first {} are in this collection",
            rows.len()
        ));
    }
    DatabasePayload {
        extension: "dwar",
        record_count: rows.len(),
        text: idcode_dwar("Structure", &["Name".to_string()], &rows),
        warnings,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> String {
        std::fs::read_to_string(
            std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../../../tests/fixtures/database/wikipedia-idcode.txt"),
        )
        .expect("recorded Wikipedia fixture")
    }

    #[test]
    fn the_export_becomes_a_datawarrior_collection_of_idcodes() {
        let payload = build(&fixture(), "", 1000);
        assert_eq!(payload.extension, "dwar");
        assert_eq!(payload.record_count, 40);
        assert!(payload.warnings.is_empty());
        assert!(payload
            .text
            .contains("<columnProperty=\"specialType\tidcode\">"));
        assert!(payload.text.contains("fJ@@\tAmmonia"));
        assert!(payload.text.contains("dklB@@QmR[fUxUZBBF@@\tAspirin"));
    }

    #[test]
    fn a_name_filter_narrows_the_collection_without_regard_to_case() {
        let payload = build(&fixture(), "ASPIR", 1000);
        assert_eq!(payload.record_count, 1);
        assert!(payload.text.contains("Aspirin"));
    }

    #[test]
    fn the_row_limit_is_reported_rather_than_silently_applied() {
        let payload = build(&fixture(), "", 5);
        assert_eq!(payload.record_count, 5);
        assert_eq!(payload.warnings.len(), 1);
        assert!(payload.warnings[0].contains("40 matching molecules"));
    }

    #[test]
    fn malformed_export_lines_are_skipped() {
        let payload = build("fJ@@\tAmmonia\nno-tab-here\n\t\ndkl@@\t\n", "", 10);
        assert_eq!(payload.record_count, 1);
    }
}
