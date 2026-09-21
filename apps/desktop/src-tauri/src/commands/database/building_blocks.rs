//! Building-block search against the datawarrior.org catalogue service.
//!
//! The service publishes its own REST interface - `?what=help` returns the
//! parameter list - so this is written from what the server documents about
//! itself rather than from any client.
//!
//! It answers with a tab-separated table whose data rows carry one cell more
//! than the header: the leading cell is the structure column, and the header
//! does not name it.

use super::http::{fetch_text, DatabaseRequest};
use super::table::{idcode_dwar, DatabaseTable};
use super::{DatabasePayload, StructureSearchMode};

const BUILDING_BLOCKS_URL: &str = "https://bb.datawarrior.org/";

#[derive(Debug, Default, Clone)]
pub(crate) struct BuildingBlockQuery {
    pub(crate) smiles: String,
    pub(crate) mode: StructureSearchMode,
    pub(crate) threshold: f64,
    /// A comma-separated provider list, or "any". Empty means the service's own
    /// default, which is Enamine.
    pub(crate) providers: String,
    pub(crate) max_price: Option<f64>,
    pub(crate) min_amount: Option<f64>,
}

pub(crate) fn search(query: &BuildingBlockQuery, limit: usize) -> Result<DatabasePayload, String> {
    let url = query_url(query, limit)?;
    let text = fetch_text(&DatabaseRequest::get(url).with_timeout(180))?;
    if let Some(error) = text.strip_prefix("Error:") {
        return Err(format!(
            "The building block service refused the query:{error}"
        ));
    }
    Ok(build(&text, limit))
}

fn query_url(query: &BuildingBlockQuery, limit: usize) -> Result<String, String> {
    let smiles = query.smiles.trim();
    if smiles.is_empty() {
        return Err("A building block search needs a query structure".to_string());
    }
    let mut url = url::Url::parse(BUILDING_BLOCKS_URL).map_err(|error| error.to_string())?;
    {
        let mut pairs = url.query_pairs_mut();
        pairs.append_pair("what", "query");
        pairs.append_pair("smiles", smiles);
        pairs.append_pair(
            "searchType",
            match query.mode {
                StructureSearchMode::Similarity => "similarity",
                // The catalogue has no exact-structure mode; a substructure search
                // for the whole molecule is the closest it offers.
                StructureSearchMode::Substructure | StructureSearchMode::Exact => "substructure",
            },
        );
        if query.mode == StructureSearchMode::Similarity {
            pairs.append_pair("threshold", &format!("{}", query.threshold.round() as i64));
        }
        let providers = query.providers.trim();
        if !providers.is_empty() {
            pairs.append_pair("providers", providers);
        }
        if let Some(price) = query.max_price.filter(|price| *price > 0.0) {
            pairs.append_pair("price", &format!("{price}"));
        }
        if let Some(amount) = query.min_amount.filter(|amount| *amount > 0.0) {
            pairs.append_pair("amount", &format!("{amount}"));
        }
        pairs.append_pair("maxrows", &limit.to_string());
    }
    Ok(url.to_string())
}

/// Rows carry the unnamed structure cell first. When the catalogue fills it in,
/// the answer becomes a DataWarrior collection the grid draws; when it does not -
/// which is what the public REST interface returns today - the answer is an
/// honest price table, and the caller says so.
pub(crate) fn build(text: &str, limit: usize) -> DatabasePayload {
    let mut lines = text.lines().filter(|line| !line.trim().is_empty());
    let Some(header_line) = lines.next() else {
        return DatabasePayload {
            extension: "csv",
            text: String::new(),
            record_count: 0,
            warnings: Vec::new(),
        };
    };
    let headers: Vec<String> = header_line
        .split('\t')
        .map(|header| header.trim().to_string())
        .collect();
    let mut structures = Vec::new();
    let mut rows = Vec::new();
    for line in lines.take(limit) {
        let mut cells: Vec<String> = line
            .split('\t')
            .map(|cell| cell.trim().to_string())
            .collect();
        // Only the data rows carry the leading structure cell.
        let structure = if cells.len() > headers.len() {
            cells.remove(0)
        } else {
            String::new()
        };
        structures.push(structure);
        cells.resize(headers.len(), String::new());
        rows.push(cells);
    }
    let drawable = structures.iter().any(|structure| !structure.is_empty());
    if drawable {
        let pairs: Vec<(String, Vec<String>)> = structures.into_iter().zip(rows).collect();
        return DatabasePayload {
            extension: "dwar",
            record_count: pairs.len(),
            text: idcode_dwar("Structure", &headers, &pairs),
            warnings: Vec::new(),
        };
    }
    let mut table = DatabaseTable::new(&headers.iter().map(String::as_str).collect::<Vec<_>>());
    for row in rows {
        table.push_row(row);
    }
    let warnings = if table.len() > 0 {
        vec![
            "The building block service's public interface returns catalogue entries without structures, so this collection is a price table."
                .to_string(),
        ]
    } else {
        Vec::new()
    };
    DatabasePayload {
        extension: "csv",
        record_count: table.len(),
        text: table.without_empty_columns().to_csv(),
        warnings,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> String {
        std::fs::read_to_string(
            std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../../../tests/fixtures/database/building-blocks.tsv"),
        )
        .expect("recorded building block fixture")
    }

    #[test]
    fn catalogue_entries_become_rows_under_the_named_columns() {
        let payload = build(&fixture(), 100);
        assert_eq!(payload.extension, "csv");
        assert_eq!(payload.record_count, 5);
        let header = payload.text.lines().next().expect("header");
        assert!(header.starts_with("Product-ID,Provider,Amount (g),Price"));
        assert!(payload.text.contains("EN300-"));
        assert!(payload.text.contains("Enamine"));
        // The leading structure cell is dropped rather than shifting every column.
        assert!(!payload.text.lines().nth(1).expect("row").starts_with(','));
        assert!(payload.warnings[0].contains("price table"));
    }

    #[test]
    fn a_catalogue_that_does_send_structures_becomes_a_drawable_collection() {
        let text = "Product-ID\tProvider\nfJ@@\tBB-1\tEnamine\ndklB@@\tBB-2\tEnamine\n";
        let payload = build(text, 100);
        assert_eq!(payload.extension, "dwar");
        assert_eq!(payload.record_count, 2);
        assert!(payload
            .text
            .contains("<columnProperty=\"specialType\tidcode\">"));
        assert!(payload.text.contains("Structure\tProduct-ID\tProvider"));
        assert!(payload.text.contains("fJ@@\tBB-1\tEnamine"));
        assert!(payload.warnings.is_empty());
    }

    #[test]
    fn the_row_limit_is_applied_to_the_answer() {
        assert_eq!(build(&fixture(), 2).record_count, 2);
        assert_eq!(build("", 10).record_count, 0);
    }

    #[test]
    fn the_query_carries_only_the_parameters_the_service_documents() {
        let query = BuildingBlockQuery {
            smiles: "c1ccccc1O".to_string(),
            mode: StructureSearchMode::Similarity,
            threshold: 75.0,
            providers: "any".to_string(),
            max_price: Some(50.0),
            min_amount: Some(5.0),
        };
        let url = query_url(&query, 250).expect("url");
        assert!(url.starts_with("https://bb.datawarrior.org/?"));
        assert!(url.contains("what=query"));
        assert!(url.contains("searchType=similarity"));
        assert!(url.contains("threshold=75"));
        assert!(url.contains("providers=any"));
        assert!(url.contains("price=50"));
        assert!(url.contains("amount=5"));
        assert!(url.contains("maxrows=250"));

        let substructure = BuildingBlockQuery {
            smiles: "c1ccccc1".to_string(),
            mode: StructureSearchMode::Substructure,
            ..BuildingBlockQuery::default()
        };
        let url = query_url(&substructure, 10).expect("url");
        assert!(url.contains("searchType=substructure"));
        assert!(!url.contains("threshold="));
        assert!(!url.contains("providers="));
        assert!(!url.contains("price="));

        assert!(query_url(&BuildingBlockQuery::default(), 10).is_err());
    }

    #[test]
    fn a_refusal_from_the_service_is_reported_as_one() {
        // The service answers "Error:..." with HTTP 200, so the body has to be read.
        assert!(fixture().starts_with("Product-ID"));
        let payload = build("Error:Undefined request\n", 10);
        assert_eq!(payload.record_count, 0);
    }
}
