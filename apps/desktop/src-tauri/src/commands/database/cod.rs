//! Crystallography Open Database search.
//!
//! COD's public REST interface answers with crystal metadata, not with molecules:
//! the deposited structures are CIF files, and the service offers no substructure
//! endpoint. The result is therefore a data collection - one row per deposition,
//! with the CIF address that Burette can open on its own - and the caller is told
//! so rather than left wondering why no structures were drawn.

use serde_json::Value;

use super::http::{fetch_text, DatabaseRequest};
use super::table::DatabaseTable;
use super::{scalar_text, DatabasePayload};

const COD_RESULT_URL: &str = "https://www.crystallography.net/cod/result";
const COD_CIF_URL: &str = "https://www.crystallography.net/cod";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CodSearchField {
    Text,
    Formula,
    Element,
}

impl CodSearchField {
    pub(crate) fn parse(value: Option<&str>) -> Self {
        match value.map(str::trim).unwrap_or("") {
            "formula" => Self::Formula,
            "element" | "elements" => Self::Element,
            _ => Self::Text,
        }
    }

    fn query_key(self) -> &'static str {
        match self {
            Self::Text => "text",
            Self::Formula => "formula",
            Self::Element => "el",
        }
    }
}

pub(crate) fn search(
    query: &str,
    field: CodSearchField,
    limit: usize,
) -> Result<DatabasePayload, String> {
    let query = query.trim();
    if query.is_empty() {
        return Err("A Crystallography DB search needs a text, formula or element query".into());
    }
    let mut url = url::Url::parse(COD_RESULT_URL).map_err(|error| error.to_string())?;
    url.query_pairs_mut()
        .append_pair("format", "json")
        .append_pair(field.query_key(), query);
    let text = fetch_text(&DatabaseRequest::get(url.to_string()).with_timeout(120))?;
    let entries = parse_entries(&text)?;
    let total = entries.len();
    let table = entry_table(&entries, limit);
    let mut warnings = vec![
        "COD publishes crystal depositions as CIF files, so this collection carries the crystal data and CIF addresses rather than drawn structures.".to_string(),
    ];
    if total > limit {
        warnings.push(format!(
            "COD returned {total} depositions; the first {limit} are in this collection"
        ));
    }
    Ok(DatabasePayload {
        extension: "csv",
        record_count: table.len(),
        text: table.without_empty_columns().to_csv(),
        warnings,
    })
}

#[derive(Debug, Clone)]
pub(crate) struct CodEntry {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) formula: String,
    pub(crate) space_group: String,
    pub(crate) cell: [String; 6],
    pub(crate) volume: String,
    pub(crate) year: String,
    pub(crate) journal: String,
    pub(crate) doi: String,
    pub(crate) authors: String,
    pub(crate) title: String,
}

impl CodEntry {
    fn cif_url(&self) -> String {
        format!("{COD_CIF_URL}/{}.cif", self.id)
    }
}

/// COD wraps a chemical formula in dashes ("- C9 H8 O4 -"); the dashes are a
/// storage artefact, not part of the formula.
fn clean_formula(value: &str) -> String {
    value.trim().trim_matches('-').trim().to_string()
}

pub(crate) fn parse_entries(text: &str) -> Result<Vec<CodEntry>, String> {
    let payload: Value =
        serde_json::from_str(text).map_err(|error| format!("COD sent invalid JSON: {error}"))?;
    let rows = payload
        .as_array()
        .ok_or_else(|| "COD sent no result list".to_string())?;
    Ok(rows
        .iter()
        .filter_map(|row| {
            let id = scalar_text(row.get("file")?);
            if id.is_empty() {
                return None;
            }
            let field = |key: &str| row.get(key).map(scalar_text).unwrap_or_default();
            let name = ["commonname", "chemname", "mineral"]
                .into_iter()
                .map(field)
                .find(|value| !value.is_empty())
                .unwrap_or_else(|| format!("COD {id}"));
            Some(CodEntry {
                id,
                name,
                formula: clean_formula(&field("formula")),
                space_group: field("sg"),
                cell: [
                    field("a"),
                    field("b"),
                    field("c"),
                    field("alpha"),
                    field("beta"),
                    field("gamma"),
                ],
                volume: field("vol"),
                year: field("year"),
                journal: field("journal"),
                doi: field("doi"),
                authors: field("authors"),
                title: field("title"),
            })
        })
        .collect())
}

fn entry_table(entries: &[CodEntry], limit: usize) -> DatabaseTable {
    let mut table = DatabaseTable::new(&[
        "Name",
        "COD ID",
        "Formula",
        "Space Group",
        "a",
        "b",
        "c",
        "alpha",
        "beta",
        "gamma",
        "Cell Volume",
        "Year",
        "Journal",
        "DOI",
        "Authors",
        "Title",
        "CIF",
    ]);
    for entry in entries.iter().take(limit) {
        table.push_row(vec![
            entry.name.clone(),
            entry.id.clone(),
            entry.formula.clone(),
            entry.space_group.clone(),
            entry.cell[0].clone(),
            entry.cell[1].clone(),
            entry.cell[2].clone(),
            entry.cell[3].clone(),
            entry.cell[4].clone(),
            entry.cell[5].clone(),
            entry.volume.clone(),
            entry.year.clone(),
            entry.journal.clone(),
            entry.doi.clone(),
            entry.authors.clone(),
            entry.title.clone(),
            entry.cif_url(),
        ]);
    }
    table
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> String {
        std::fs::read_to_string(
            std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../../../tests/fixtures/database/cod-result.json"),
        )
        .expect("recorded COD fixture")
    }

    #[test]
    fn depositions_become_rows_with_a_cif_address() {
        let entries = parse_entries(&fixture()).expect("entries");
        assert_eq!(entries.len(), 5);
        let first = &entries[0];
        assert_eq!(first.id, "1515581");
        assert_eq!(first.name, "Aspirin form II");
        assert_eq!(first.formula, "C9 H8 O4");
        assert_eq!(first.space_group, "P 1 21/c 1");
        assert_eq!(
            first.cif_url(),
            "https://www.crystallography.net/cod/1515581.cif"
        );

        let csv = entry_table(&entries, 100).without_empty_columns().to_csv();
        assert!(csv
            .lines()
            .next()
            .expect("header")
            .starts_with("Name,COD ID,Formula"));
        assert_eq!(csv.lines().count(), 6);
        // Author lists carry commas, which must stay inside one cell.
        assert!(csv.contains("\"Varughese, Sunil;"));
    }

    #[test]
    fn the_row_limit_is_applied_to_the_collection() {
        let entries = parse_entries(&fixture()).expect("entries");
        assert_eq!(entry_table(&entries, 2).len(), 2);
    }

    #[test]
    fn rows_without_a_cod_id_are_skipped() {
        let entries = parse_entries(r#"[{"file":""},{"file":"1000"},{"nofile":1}]"#).expect("rows");
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].name, "COD 1000");
    }

    #[test]
    fn search_fields_map_to_the_documented_query_keys() {
        assert_eq!(
            CodSearchField::parse(Some("formula")).query_key(),
            "formula"
        );
        assert_eq!(CodSearchField::parse(Some("element")).query_key(), "el");
        assert_eq!(CodSearchField::parse(None).query_key(), "text");
        assert_eq!(CodSearchField::parse(Some("anything")).query_key(), "text");
    }

    #[test]
    fn an_empty_query_never_reaches_the_service() {
        assert!(search("   ", CodSearchField::Text, 10).is_err());
    }
}
