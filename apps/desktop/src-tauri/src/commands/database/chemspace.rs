//! ChemSpace catalogue search.
//!
//! The only provider in this menu that needs a credential. Burette's key comes
//! from the user - typed into Settings, kept in the login keychain, and sent to
//! curl over stdin so it never appears in the argument list. There is no key in
//! this repository and there never will be: a shipped token is one commit away
//! from being everybody's token, and it would be ChemSpace's to revoke, not ours.

use serde_json::Value;

use super::http::{fetch_text, DatabaseRequest, RequestBody};
use super::table::DatabaseTable;
use super::{scalar_text, DatabasePayload, StructureSearchMode};

const CHEMSPACE_API: &str = "https://api.chem-space.com/v3/search";
const CHEMSPACE_SEARCH: &str = "https://chem-space.com/search";
/// The catalogue this menu item searches: ChemSpace's in-stock screening
/// compounds, which is what "search the building block catalogue" means here.
const DEFAULT_CATEGORIES: &str = "CSCS";

/// The address to open in a browser when the API is unavailable or unconfigured.
pub(crate) fn browser_url(smiles: &str) -> String {
    let mut url = url::Url::parse(CHEMSPACE_SEARCH).expect("the ChemSpace URL is a valid base");
    url.query_pairs_mut().append_pair("query", smiles);
    url.to_string()
}

pub(crate) fn search(
    smiles: &str,
    mode: StructureSearchMode,
    threshold: f64,
    api_key: &str,
    limit: usize,
) -> Result<DatabasePayload, String> {
    let smiles = smiles.trim();
    if smiles.is_empty() {
        return Err("A ChemSpace search needs a query structure".to_string());
    }
    let api_key = api_key.trim();
    if api_key.is_empty() {
        return Err(
            "ChemSpace needs an API key. Add one in Settings, or open the search in a browser."
                .to_string(),
        );
    }
    if api_key.chars().any(char::is_control) {
        return Err("The ChemSpace API key contains characters it cannot have".to_string());
    }
    let mut url = url::Url::parse(&format!("{CHEMSPACE_API}/{}", search_path(mode)))
        .map_err(|error| error.to_string())?;
    url.query_pairs_mut()
        .append_pair("categories", DEFAULT_CATEGORIES)
        .append_pair("count", &limit.to_string());
    if mode == StructureSearchMode::Similarity {
        url.query_pairs_mut()
            .append_pair("simThreshold", &format!("{}", threshold.round() as i64));
    }
    let text = fetch_text(
        &DatabaseRequest::get(url.to_string())
            .with_timeout(120)
            // The key rides on stdin rather than argv, where any local process
            // could read it out of the process table.
            .with_secret_header(format!("Authorization: Bearer {api_key}"))
            .with_header("Accept: application/json")
            .with_body(RequestBody::Multipart(vec![(
                "SMILES".to_string(),
                smiles.to_string(),
            )])),
    )?;
    let items = parse_items(&text)?;
    let mut table = DatabaseTable::new(&[
        "SMILES",
        "Name",
        "ChemSpace ID",
        "CAS",
        "Similarity",
        "Vendor",
        "Purity",
        "Amount",
        "Price",
        "Currency",
        "Lead Time",
    ]);
    for item in items.iter().take(limit) {
        table.push_row(item.cells());
    }
    Ok(DatabasePayload {
        extension: "csv",
        record_count: table.len(),
        text: table.without_empty_columns().to_csv(),
        warnings: Vec::new(),
    })
}

fn search_path(mode: StructureSearchMode) -> &'static str {
    match mode {
        StructureSearchMode::Similarity => "sim",
        StructureSearchMode::Substructure => "sub",
        StructureSearchMode::Exact => "exact",
    }
}

#[derive(Debug, Clone, Default)]
pub(crate) struct ChemSpaceItem {
    pub(crate) smiles: String,
    pub(crate) name: String,
    pub(crate) id: String,
    pub(crate) cas: String,
    pub(crate) similarity: String,
    pub(crate) vendor: String,
    pub(crate) purity: String,
    pub(crate) amount: String,
    pub(crate) price: String,
    pub(crate) currency: String,
    pub(crate) lead_time: String,
}

impl ChemSpaceItem {
    fn cells(&self) -> Vec<String> {
        vec![
            self.smiles.clone(),
            self.name.clone(),
            self.id.clone(),
            self.cas.clone(),
            self.similarity.clone(),
            self.vendor.clone(),
            self.purity.clone(),
            self.amount.clone(),
            self.price.clone(),
            self.currency.clone(),
            self.lead_time.clone(),
        ]
    }
}

/// ChemSpace wraps its results in `{"items": [...]}` and prices each item in a
/// nested offer list. Both the wrapper and the offer list are read defensively:
/// this is the one provider Burette cannot exercise without a key, so an answer
/// that does not match is reported rather than silently read as empty.
pub(crate) fn parse_items(text: &str) -> Result<Vec<ChemSpaceItem>, String> {
    let payload: Value = serde_json::from_str(text)
        .map_err(|_| "ChemSpace answered in a shape Burette does not know".to_string())?;
    if let Some(message) = payload.get("message").and_then(Value::as_str) {
        if payload.get("items").is_none() {
            return Err(format!("ChemSpace refused the query: {message}"));
        }
    }
    let items = payload
        .get("items")
        .and_then(Value::as_array)
        .ok_or_else(|| "ChemSpace answered without a result list".to_string())?;
    Ok(items
        .iter()
        .filter_map(|item| {
            let smiles = ["smiles", "SMILES", "canonical_smiles"]
                .into_iter()
                .filter_map(|key| item.get(key))
                .map(scalar_text)
                .find(|value| !value.is_empty())?;
            let field = |key: &str| item.get(key).map(scalar_text).unwrap_or_default();
            // The cheapest offer is the one worth showing next to the structure.
            let offer = item
                .get("offers")
                .and_then(Value::as_array)
                .and_then(|offers| {
                    offers.iter().min_by(|left, right| {
                        offer_price(left)
                            .partial_cmp(&offer_price(right))
                            .unwrap_or(std::cmp::Ordering::Equal)
                    })
                });
            let offer_field = |key: &str| {
                offer
                    .and_then(|offer| offer.get(key))
                    .map(scalar_text)
                    .unwrap_or_default()
            };
            Some(ChemSpaceItem {
                smiles,
                name: field("name"),
                id: ["csId", "cs_id", "id"]
                    .into_iter()
                    .filter_map(|key| item.get(key))
                    .map(scalar_text)
                    .find(|value| !value.is_empty())
                    .unwrap_or_default(),
                cas: field("cas"),
                similarity: field("similarity"),
                vendor: offer_field("vendorName"),
                purity: offer_field("purity"),
                amount: offer_field("packG"),
                price: offer_field("priceUsd"),
                currency: if offer_field("priceUsd").is_empty() {
                    String::new()
                } else {
                    "USD".to_string()
                },
                lead_time: offer_field("leadTimeDays"),
            })
        })
        .collect())
}

fn offer_price(offer: &Value) -> f64 {
    offer
        .get("priceUsd")
        .and_then(|price| {
            price
                .as_f64()
                .or_else(|| price.as_str().and_then(|text| text.parse().ok()))
        })
        .unwrap_or(f64::MAX)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// ChemSpace is the one provider that cannot be exercised without a
    /// credential, so this stands in for a recorded response: it is the documented
    /// answer shape, not a capture, and it is labelled as such.
    const DOCUMENTED_ANSWER: &str = r#"{
      "count": 2,
      "items": [
        {"csId": "CSC000123", "smiles": "CC(=O)Oc1ccccc1C(=O)O", "name": "aspirin",
         "cas": "50-78-2", "similarity": 1,
         "offers": [
           {"vendorName": "Vendor B", "purity": 95, "packG": 1, "priceUsd": 120, "leadTimeDays": 10},
           {"vendorName": "Vendor A", "purity": 98, "packG": 1, "priceUsd": 45, "leadTimeDays": 3}
         ]},
        {"csId": "CSC000124", "smiles": "CCO", "name": "ethanol", "offers": []}
      ]
    }"#;

    #[test]
    fn catalogue_items_become_rows_priced_by_the_cheapest_offer() {
        let items = parse_items(DOCUMENTED_ANSWER).expect("items");
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].id, "CSC000123");
        assert_eq!(items[0].smiles, "CC(=O)Oc1ccccc1C(=O)O");
        assert_eq!(items[0].vendor, "Vendor A");
        assert_eq!(items[0].price, "45");
        assert_eq!(items[0].currency, "USD");
        assert_eq!(items[1].vendor, "");
        assert_eq!(items[1].currency, "");
    }

    #[test]
    fn an_answer_in_an_unknown_shape_is_reported_rather_than_read_as_empty() {
        assert!(parse_items("<html>").is_err());
        assert!(parse_items("{}").is_err());
        let error = parse_items(r#"{"message":"Invalid credentials","status":401}"#)
            .expect_err("a refusal is an error");
        assert!(error.contains("Invalid credentials"));
        assert!(parse_items(r#"{"items":[]}"#).expect("empty").is_empty());
    }

    #[test]
    fn items_without_a_structure_are_skipped() {
        let items =
            parse_items(r#"{"items":[{"csId":"A"},{"csId":"B","smiles":"CCO"}]}"#).expect("items");
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].id, "B");
    }

    #[test]
    fn a_search_without_a_key_never_reaches_the_service() {
        let error = search("CCO", StructureSearchMode::Similarity, 80.0, "  ", 10)
            .expect_err("a keyless search is refused");
        assert!(error.contains("API key"));
        assert!(search("", StructureSearchMode::Similarity, 80.0, "key", 10).is_err());
        assert!(search("CCO", StructureSearchMode::Similarity, 80.0, "k\ney", 10).is_err());
    }

    #[test]
    fn search_modes_map_to_the_documented_paths() {
        assert_eq!(search_path(StructureSearchMode::Similarity), "sim");
        assert_eq!(search_path(StructureSearchMode::Substructure), "sub");
        assert_eq!(search_path(StructureSearchMode::Exact), "exact");
    }

    #[test]
    fn every_query_has_a_browser_address_to_fall_back_to() {
        assert_eq!(
            browser_url("CC(=O)O"),
            "https://chem-space.com/search?query=CC%28%3DO%29O"
        );
    }
}
