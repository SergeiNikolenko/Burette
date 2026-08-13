//! Google Patents search.
//!
//! This provider talks to an endpoint Google has never documented, which is the
//! whole reason the browser fallback exists from the first commit rather than
//! being added the day the endpoint changes. Every failure - a moved endpoint, a
//! rate limit, an answer in a shape this parser does not know - returns the
//! ordinary Google Patents search address for the same query, so the search
//! itself never becomes unavailable.

use serde_json::Value;

use super::http::{fetch_text, DatabaseRequest};
use super::table::DatabaseTable;
use super::{scalar_text, DatabasePayload};

const PATENTS_XHR: &str = "https://patents.google.com/xhr/query";
const PATENTS_SEARCH: &str = "https://patents.google.com/";

/// The address to open in a browser for the same query. Always produced, whether
/// or not the request succeeded.
pub(crate) fn browser_url(query: &str) -> String {
    let mut url = url::Url::parse(PATENTS_SEARCH).expect("the Google Patents URL is a valid base");
    url.query_pairs_mut().append_pair("q", query);
    url.to_string()
}

pub(crate) fn search(query: &str, limit: usize) -> Result<DatabasePayload, String> {
    let text =
        fetch_text(&DatabaseRequest::get(xhr_url(query)?).with_timeout(90)).map_err(|error| {
            // 429 is the common one and reads as an unhelpful HTTP error otherwise.
            if error.contains("429") {
                "Google Patents is rate limiting this search. Open it in a browser instead."
                    .to_string()
            } else {
                error
            }
        })?;
    let (results, total) = parse_results(&text)?;
    let mut table = DatabaseTable::new(&[
        "Publication",
        "Title",
        "Assignee",
        "Inventor",
        "Publication Date",
        "Filing Date",
        "Priority Date",
        "Snippet",
        "Link",
    ]);
    for result in results.iter().take(limit) {
        table.push_row(vec![
            result.publication_number.clone(),
            result.title.clone(),
            result.assignee.clone(),
            result.inventor.clone(),
            result.publication_date.clone(),
            result.filing_date.clone(),
            result.priority_date.clone(),
            result.snippet.clone(),
            result.link(),
        ]);
    }
    let mut warnings = vec![
        "Google Patents returns documents, not structures, so this collection is a data table."
            .to_string(),
    ];
    if total > table.len() {
        warnings.push(format!(
            "Google Patents reports {total} hits; the first {} are in this collection",
            table.len()
        ));
    }
    Ok(DatabasePayload {
        extension: "csv",
        record_count: table.len(),
        text: table.without_empty_columns().to_csv(),
        warnings,
    })
}

/// The endpoint takes the whole query string as one encoded parameter.
fn xhr_url(query: &str) -> Result<String, String> {
    let query = query.trim();
    if query.is_empty() {
        return Err("A patent search needs a query".to_string());
    }
    let mut inner = url::form_urlencoded::Serializer::new(String::new());
    inner.append_pair("q", query);
    let mut url = url::Url::parse(PATENTS_XHR).map_err(|error| error.to_string())?;
    url.query_pairs_mut().append_pair("url", &inner.finish());
    Ok(url.to_string())
}

#[derive(Debug, Clone)]
pub(crate) struct PatentResult {
    pub(crate) publication_number: String,
    pub(crate) title: String,
    pub(crate) assignee: String,
    pub(crate) inventor: String,
    pub(crate) publication_date: String,
    pub(crate) filing_date: String,
    pub(crate) priority_date: String,
    pub(crate) snippet: String,
}

impl PatentResult {
    fn link(&self) -> String {
        format!(
            "https://patents.google.com/patent/{}",
            self.publication_number
        )
    }
}

/// Titles and snippets arrive as search-result HTML: bold marks around the hit
/// terms and HTML entities. They are text in a table cell here, so the markup
/// comes out.
fn plain_text(value: &Value) -> String {
    let raw = scalar_text(value);
    let mut text = String::with_capacity(raw.len());
    let mut inside_tag = false;
    for character in raw.chars() {
        match character {
            '<' => inside_tag = true,
            '>' => inside_tag = false,
            _ if !inside_tag => text.push(character),
            _ => {}
        }
    }
    text.replace("&hellip;", "…")
        .replace("&amp;", "&")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

pub(crate) fn parse_results(text: &str) -> Result<(Vec<PatentResult>, usize), String> {
    let payload: Value = serde_json::from_str(text)
        .map_err(|_| "Google Patents answered in a shape Burette does not know".to_string())?;
    let results = payload
        .get("results")
        .ok_or_else(|| "Google Patents answered without results".to_string())?;
    let total = results
        .get("total_num_results")
        .and_then(Value::as_u64)
        .unwrap_or(0) as usize;
    let mut parsed = Vec::new();
    for cluster in results
        .get("cluster")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or_default()
    {
        for result in cluster
            .get("result")
            .and_then(Value::as_array)
            .map(Vec::as_slice)
            .unwrap_or_default()
        {
            let Some(patent) = result.get("patent") else {
                continue;
            };
            let field = |key: &str| patent.get(key).map(plain_text).unwrap_or_default();
            let publication_number = field("publication_number");
            if publication_number.is_empty() {
                continue;
            }
            parsed.push(PatentResult {
                publication_number,
                title: field("title"),
                assignee: field("assignee"),
                inventor: field("inventor"),
                publication_date: field("publication_date"),
                filing_date: field("filing_date"),
                priority_date: field("priority_date"),
                snippet: field("snippet"),
            });
        }
    }
    Ok((parsed, total))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> String {
        std::fs::read_to_string(
            std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../../../tests/fixtures/database/google-patents.json"),
        )
        .expect("recorded Google Patents fixture")
    }

    #[test]
    fn search_results_become_rows_with_a_patent_link() {
        let (results, total) = parse_results(&fixture()).expect("results");
        assert!(!results.is_empty());
        assert_eq!(total, 162_708);
        let first = &results[0];
        assert_eq!(first.publication_number, "US20100130542A1");
        assert_eq!(
            first.link(),
            "https://patents.google.com/patent/US20100130542A1"
        );
        assert!(first.title.starts_with("Composition Comprising"));
        assert_eq!(first.publication_date, "2010-05-27");
        assert_eq!(first.assignee, "The Curators Of The University Of Missouri");
    }

    #[test]
    fn result_markup_and_entities_come_out_of_the_cells() {
        let (results, _) = parse_results(&fixture()).expect("results");
        for result in &results {
            assert!(
                !result.title.contains('<'),
                "markup left in {:?}",
                result.title
            );
            assert!(!result.snippet.contains("<b>"));
            assert!(!result.snippet.contains("&hellip;"));
        }
        assert_eq!(
            plain_text(&serde_json::json!(" a <b>hit</b> &amp; more &hellip;")),
            "a hit & more …"
        );
    }

    #[test]
    fn an_answer_in_an_unknown_shape_is_reported_rather_than_read_as_empty() {
        assert!(parse_results("<!doctype html><html>").is_err());
        assert!(parse_results("{}").is_err());
        // A known shape with nothing in it is a real empty result.
        let (results, total) = parse_results(r#"{"results":{"cluster":[]}}"#).expect("empty");
        assert!(results.is_empty());
        assert_eq!(total, 0);
    }

    #[test]
    fn results_without_a_publication_number_are_skipped() {
        let (results, _) = parse_results(
            r#"{"results":{"total_num_results":2,"cluster":[{"result":[
                {"patent":{"title":"no number"}},
                {"patent":{"publication_number":"US1A","title":"kept"}}]}]}}"#,
        )
        .expect("results");
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].title, "kept");
    }

    #[test]
    fn every_query_has_a_browser_address_to_fall_back_to() {
        assert_eq!(
            browser_url("aspirin derivatives"),
            "https://patents.google.com/?q=aspirin+derivatives"
        );
        let url = xhr_url("aspirin").expect("xhr url");
        assert!(url.starts_with("https://patents.google.com/xhr/query?url="));
        assert!(url.contains("q%3Daspirin"));
        assert!(xhr_url("   ").is_err());
    }
}
