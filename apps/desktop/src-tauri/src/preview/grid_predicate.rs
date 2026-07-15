use std::{cmp::Ordering, collections::BTreeSet};

use burrete_compute_protocol::{
    AnalysisFilter, ColumnFilter, ColumnFilterKind, DescriptorFilter, GridTextQuery,
};
use rusqlite::types::Value as SqlValue;

const MAX_FILTERS: usize = 64;
const MAX_FILTER_ID_BYTES: usize = 160;
const MAX_FILTER_TEXT_BYTES: usize = 4_096;
const MAX_QUERY_BYTES: usize = 4_096;

#[derive(Debug, PartialEq)]
pub(crate) struct GridPredicatePlan {
    pub(crate) predicate_sql: String,
    pub(crate) params: Vec<SqlValue>,
    pub(crate) fts_query: Option<String>,
}

pub(crate) fn parse_column_filter_kind(value: &str) -> Result<ColumnFilterKind, String> {
    match value {
        "text" => Ok(ColumnFilterKind::Text),
        "number" => Ok(ColumnFilterKind::Number),
        _ => Err(format!("Unsupported Grid column filter type: {value}")),
    }
}

/// Plans the shared, sort-independent predicate used by Grid pages and frozen scopes.
pub(crate) fn plan_grid_predicate(
    query: &GridTextQuery,
    column_filters: &[ColumnFilter],
    descriptor_filters: &[DescriptorFilter],
    analysis_filters: &[AnalysisFilter],
) -> Result<GridPredicatePlan, String> {
    let filter_count = column_filters.len() + descriptor_filters.len() + analysis_filters.len();
    if filter_count > MAX_FILTERS {
        return Err(format!(
            "Grid predicate has {filter_count} filters; limit is {MAX_FILTERS}"
        ));
    }

    let mut clauses = Vec::new();
    let mut params = Vec::new();
    let GridTextQuery::Text { text } = query;
    if text.len() > MAX_QUERY_BYTES {
        return Err(format!(
            "Grid text query exceeds {MAX_QUERY_BYTES} UTF-8 bytes"
        ));
    }
    let normalized_query = normalize_like_text(text);
    let fts_query = (!normalized_query.is_empty())
        .then(|| fts_query(&normalized_query))
        .flatten();
    if !normalized_query.is_empty() {
        clauses.push("molecules.search_text like ? escape '\\'".to_string());
        params.push(SqlValue::Text(like_pattern(&normalized_query)));
    }

    let mut ordered_columns = column_filters.iter().collect::<Vec<_>>();
    ordered_columns.sort_by(|left, right| left.id.cmp(&right.id));
    reject_duplicate_keys(
        &ordered_columns,
        |filter| filter.id.as_str(),
        "column filter ID",
    )?;
    for filter in ordered_columns {
        plan_column_filter(filter, &mut clauses, &mut params)?;
    }

    let mut ordered_descriptors = descriptor_filters.iter().collect::<Vec<_>>();
    ordered_descriptors.sort_by(|left, right| {
        left.id
            .cmp(&right.id)
            .then_with(|| compare_optional_f64(left.min, right.min))
            .then_with(|| compare_optional_f64(left.max, right.max))
    });
    for filter in ordered_descriptors {
        validate_filter_id("descriptor filter", &filter.id)?;
        let bounds =
            validate_numeric_bounds("descriptor filter", &filter.id, filter.min, filter.max)?;
        let mut clause = "exists (select 1 from descriptor_values as descriptor_filter where descriptor_filter.molecule_id = molecules.id and descriptor_filter.descriptor_id = ?".to_string();
        params.push(SqlValue::Text(filter.id.clone()));
        clause.push_str(" and ");
        append_numeric_bounds(
            &mut clause,
            "descriptor_filter.value_real",
            bounds,
            &mut params,
        );
        clause.push(')');
        clauses.push(clause);
    }

    let mut ordered_analyses = analysis_filters.iter().collect::<Vec<_>>();
    ordered_analyses.sort_by(|left, right| {
        (left.run_id, left.value_id.as_str()).cmp(&(right.run_id, right.value_id.as_str()))
    });
    let mut analysis_keys = BTreeSet::new();
    for filter in ordered_analyses {
        if filter.run_id.is_nil() {
            return Err("Analysis filter runId cannot be the nil UUID".to_string());
        }
        validate_filter_id("analysis value", &filter.value_id)?;
        if !analysis_keys.insert((filter.run_id, filter.value_id.as_str())) {
            return Err(format!(
                "Duplicate analysis filter: {}/{}",
                filter.run_id, filter.value_id
            ));
        }
        let bounds =
            validate_numeric_bounds("analysis filter", &filter.value_id, filter.min, filter.max)?;
        let mut clause = "exists (select 1 from analysis_values as analysis_filter where analysis_filter.molecule_id = molecules.id and analysis_filter.run_id = ? and analysis_filter.value_id = ?".to_string();
        params.push(SqlValue::Text(filter.run_id.to_string()));
        params.push(SqlValue::Text(filter.value_id.clone()));
        clause.push_str(" and ");
        append_numeric_bounds(
            &mut clause,
            "coalesce(analysis_filter.value_real, cast(analysis_filter.value_integer as real))",
            bounds,
            &mut params,
        );
        clause.push(')');
        clauses.push(clause);
    }

    Ok(GridPredicatePlan {
        predicate_sql: clauses.join(" and "),
        params,
        fts_query,
    })
}

fn plan_column_filter(
    filter: &ColumnFilter,
    clauses: &mut Vec<String>,
    params: &mut Vec<SqlValue>,
) -> Result<(), String> {
    validate_filter_id("column filter", &filter.id)?;
    match filter.filter_type {
        ColumnFilterKind::Text => {
            if filter.min.is_some() || filter.max.is_some() {
                return Err(format!(
                    "Text column filter {} cannot contain numeric bounds",
                    filter.id
                ));
            }
            let text = filter
                .text
                .as_deref()
                .ok_or_else(|| format!("Text column filter {} requires text", filter.id))?;
            if text.len() > MAX_FILTER_TEXT_BYTES {
                return Err(format!(
                    "Text column filter {} exceeds {MAX_FILTER_TEXT_BYTES} UTF-8 bytes",
                    filter.id
                ));
            }
            let normalized_text = normalize_like_text(text);
            if normalized_text.is_empty() {
                return Err(format!(
                    "Text column filter {} requires non-empty text",
                    filter.id
                ));
            }
            let pattern = SqlValue::Text(like_pattern(&normalized_text));
            match filter.id.as_str() {
                "name" => {
                    clauses
                        .push("lower(coalesce(molecules.name, '')) like ? escape '\\'".to_string());
                    params.push(pattern);
                }
                "smiles" => {
                    clauses.push(
                        "lower(coalesce(molecules.smiles, '')) like ? escape '\\'".to_string(),
                    );
                    params.push(pattern);
                }
                id if id.starts_with("prop:") => {
                    clauses.push("lower(coalesce(json_extract(molecules.props_json, ?), '')) like ? escape '\\'".to_string());
                    params.push(SqlValue::Text(property_json_path(id)?));
                    params.push(pattern);
                }
                _ => return unsupported_column(&filter.id, "text"),
            }
        }
        ColumnFilterKind::Number => {
            if filter.text.is_some() {
                return Err(format!(
                    "Numeric column filter {} cannot contain text",
                    filter.id
                ));
            }
            let bounds = validate_numeric_bounds(
                "numeric column filter",
                &filter.id,
                filter.min,
                filter.max,
            )?;
            match filter.id.as_str() {
                "index" => {
                    let mut clause = String::new();
                    append_numeric_bounds(
                        &mut clause,
                        "(molecules.source_index + 1)",
                        bounds,
                        params,
                    );
                    clauses.push(clause);
                }
                id if id.starts_with("prop:") => {
                    let mut clause = String::new();
                    params.push(SqlValue::Text(property_json_path(id)?));
                    append_numeric_bounds(
                        &mut clause,
                        "cast(json_extract(molecules.props_json, ?) as real)",
                        bounds,
                        params,
                    );
                    clauses.push(clause);
                }
                _ => return unsupported_column(&filter.id, "number"),
            }
        }
    }
    Ok(())
}

fn unsupported_column<T>(id: &str, filter_type: &str) -> Result<T, String> {
    Err(format!(
        "Grid column {id} does not support {filter_type} filtering"
    ))
}

#[derive(Clone, Copy)]
struct NumericBounds {
    min: Option<f64>,
    max: Option<f64>,
}

fn validate_numeric_bounds(
    label: &str,
    id: &str,
    min: Option<f64>,
    max: Option<f64>,
) -> Result<NumericBounds, String> {
    if min.is_none() && max.is_none() {
        return Err(format!("{label} {id} requires at least one bound"));
    }
    if min.into_iter().chain(max).any(|value| !value.is_finite()) {
        return Err(format!("{label} {id} has a non-finite bound"));
    }
    if min.zip(max).is_some_and(|(lower, upper)| lower > upper) {
        return Err(format!("{label} {id} has min greater than max"));
    }
    Ok(NumericBounds { min, max })
}

fn compare_optional_f64(left: Option<f64>, right: Option<f64>) -> Ordering {
    match (left, right) {
        (Some(left), Some(right)) => left.total_cmp(&right),
        (None, Some(_)) => Ordering::Less,
        (Some(_), None) => Ordering::Greater,
        (None, None) => Ordering::Equal,
    }
}

fn append_numeric_bounds(
    clause: &mut String,
    expression: &str,
    bounds: NumericBounds,
    params: &mut Vec<SqlValue>,
) {
    match (bounds.min, bounds.max) {
        (Some(min), Some(max)) => {
            clause.push_str(expression);
            clause.push_str(" between ? and ?");
            params.push(SqlValue::Real(min));
            params.push(SqlValue::Real(max));
        }
        (Some(min), None) => {
            clause.push_str(expression);
            clause.push_str(" >= ?");
            params.push(SqlValue::Real(min));
        }
        (None, Some(max)) => {
            clause.push_str(expression);
            clause.push_str(" <= ?");
            params.push(SqlValue::Real(max));
        }
        (None, None) => unreachable!("numeric bounds are validated before SQL planning"),
    }
}

fn validate_filter_id(label: &str, id: &str) -> Result<(), String> {
    if id.is_empty() || id.len() > MAX_FILTER_ID_BYTES {
        return Err(format!(
            "{label} id must contain 1..={MAX_FILTER_ID_BYTES} UTF-8 bytes"
        ));
    }
    Ok(())
}

fn property_json_path(id: &str) -> Result<String, String> {
    let key = id
        .strip_prefix("prop:")
        .filter(|key| !key.is_empty())
        .ok_or_else(|| format!("Invalid property filter id: {id}"))?;
    if key.contains('\0') {
        return Err(format!("Invalid property filter id: {id}"));
    }
    let escaped = key.replace('\\', "\\\\").replace('"', "\\\"");
    Ok(format!("$.\"{escaped}\""))
}

fn normalize_like_text(value: &str) -> String {
    value
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

fn like_pattern(value: &str) -> String {
    let escaped = value
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_");
    format!("%{escaped}%")
}

fn fts_query(value: &str) -> Option<String> {
    let mut tokens = Vec::new();
    let mut token = String::new();
    for character in value.chars() {
        if character.is_alphanumeric() {
            token.push(character);
        } else if !token.is_empty() {
            tokens.push(std::mem::take(&mut token));
        }
    }
    if !token.is_empty() {
        tokens.push(token);
    }
    if tokens.is_empty() {
        return None;
    }
    Some(
        tokens
            .into_iter()
            .take(16)
            .map(|token| format!("\"{}\"", token.replace('"', "\"\"")))
            .collect::<Vec<_>>()
            .join(" AND "),
    )
}

fn reject_duplicate_keys<'a, T, F>(values: &[&'a T], key: F, label: &str) -> Result<(), String>
where
    F: Fn(&'a T) -> &'a str,
{
    for pair in values.windows(2) {
        if key(pair[0]) == key(pair[1]) {
            return Err(format!("Duplicate {label}: {}", key(pair[0])));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::{params, params_from_iter, Connection};
    use uuid::Uuid;

    fn text_query(text: &str) -> GridTextQuery {
        GridTextQuery::Text {
            text: text.to_string(),
        }
    }

    fn column(
        id: &str,
        filter_type: ColumnFilterKind,
        text: Option<&str>,
        min: Option<f64>,
        max: Option<f64>,
    ) -> ColumnFilter {
        ColumnFilter {
            id: id.to_string(),
            filter_type,
            text: text.map(str::to_string),
            min,
            max,
        }
    }

    #[test]
    fn plans_canonical_parameterized_predicates() {
        let run_id = Uuid::from_u128(7);
        let columns = vec![
            column(
                "prop:score' OR 1=1 --",
                ColumnFilterKind::Number,
                None,
                Some(1.5),
                None,
            ),
            column(
                "name",
                ColumnFilterKind::Text,
                Some("  BENZ   ENE%_  "),
                None,
                None,
            ),
            column(
                "index",
                ColumnFilterKind::Number,
                None,
                Some(2.0),
                Some(3.0),
            ),
        ];
        let descriptors = vec![DescriptorFilter {
            id: "MW' OR 1=1".to_string(),
            min: Some(40.0),
            max: Some(80.0),
        }];
        let analyses = vec![AnalysisFilter {
            run_id,
            value_id: "cluster'score".to_string(),
            min: Some(0.25),
            max: None,
        }];

        let plan = plan_grid_predicate(
            &text_query("  Alpha \n BETA%_  "),
            &columns,
            &descriptors,
            &analyses,
        )
        .expect("plan predicate");

        assert!(plan
            .predicate_sql
            .starts_with("molecules.search_text like ? escape '\\'"));
        assert!(plan
            .predicate_sql
            .contains("(molecules.source_index + 1) between ? and ?"));
        assert!(plan
            .predicate_sql
            .contains("json_extract(molecules.props_json, ?)"));
        assert!(plan
            .predicate_sql
            .contains("descriptor_filter.descriptor_id = ?"));
        assert!(plan.predicate_sql.contains("analysis_filter.run_id = ?"));
        assert_eq!(plan.fts_query.as_deref(), Some("\"alpha\" AND \"beta\""));
        for dynamic in [
            "Alpha",
            "BENZ",
            "score' OR 1=1 --",
            "MW' OR 1=1",
            "cluster'score",
        ] {
            assert!(!plan.predicate_sql.contains(dynamic));
        }
        assert_eq!(
            plan.params,
            vec![
                SqlValue::Text("%alpha beta\\%\\_%".to_string()),
                SqlValue::Real(2.0),
                SqlValue::Real(3.0),
                SqlValue::Text("%benz ene\\%\\_%".to_string()),
                SqlValue::Text("$.\"score' OR 1=1 --\"".to_string()),
                SqlValue::Real(1.5),
                SqlValue::Text("MW' OR 1=1".to_string()),
                SqlValue::Real(40.0),
                SqlValue::Real(80.0),
                SqlValue::Text(run_id.to_string()),
                SqlValue::Text("cluster'score".to_string()),
                SqlValue::Real(0.25),
            ]
        );
    }

    #[test]
    fn canonicalizes_filter_order() {
        let first = vec![
            column("smiles", ColumnFilterKind::Text, Some("CC"), None, None),
            column("name", ColumnFilterKind::Text, Some("amine"), None, None),
        ];
        let mut second = first.clone();
        second.reverse();
        let descriptors = vec![
            DescriptorFilter {
                id: "MW".to_string(),
                min: Some(40.0),
                max: None,
            },
            DescriptorFilter {
                id: "MW".to_string(),
                min: None,
                max: Some(80.0),
            },
        ];
        let mut reversed_descriptors = descriptors.clone();
        reversed_descriptors.reverse();

        assert_eq!(
            plan_grid_predicate(&text_query(""), &first, &descriptors, &[]).expect("first plan"),
            plan_grid_predicate(&text_query(""), &second, &reversed_descriptors, &[])
                .expect("second plan")
        );
    }

    #[test]
    fn executes_column_descriptor_and_typed_analysis_filters() {
        let connection = Connection::open_in_memory().expect("open database");
        connection
            .execute_batch(
                "create table molecules (
                   id integer primary key,
                   source_index integer not null,
                   name text,
                   smiles text,
                   props_json text not null,
                   search_text text not null
                 );
                 create table descriptor_values (
                   molecule_id integer not null,
                   descriptor_id text not null,
                   value_real real
                 );
                 create table analysis_values (
                   run_id text not null,
                   molecule_id integer not null,
                   value_id text not null,
                   value_integer integer,
                   value_real real
                 );
                 insert into molecules values
                   (1, 0, 'Alpha', 'CCO', '{\"score\": 2.5}', 'alpha cco'),
                   (2, 1, 'Beta', 'CCN', '{\"score\": 1.0}', 'beta ccn');
                 insert into descriptor_values values
                   (1, 'MW', 46.0),
                   (2, 'MW', 45.0);",
            )
            .expect("create predicate fixture");
        let run_id = Uuid::from_u128(7);
        for (molecule_id, cluster_id, score) in [(1, 7, 0.8), (2, 3, 0.6)] {
            connection
                .execute(
                    "insert into analysis_values(
                       run_id, molecule_id, value_id, value_integer, value_real
                     ) values (?1, ?2, 'clusterId', ?3, null),
                              (?1, ?2, 'score', null, ?4)",
                    params![run_id.to_string(), molecule_id, cluster_id, score],
                )
                .expect("insert typed analysis values");
        }

        let plan = plan_grid_predicate(
            &text_query(""),
            &[
                column(
                    "index",
                    ColumnFilterKind::Number,
                    None,
                    Some(1.0),
                    Some(1.0),
                ),
                column(
                    "prop:score",
                    ColumnFilterKind::Number,
                    None,
                    Some(2.0),
                    None,
                ),
            ],
            &[DescriptorFilter {
                id: "MW".to_string(),
                min: Some(40.0),
                max: Some(50.0),
            }],
            &[
                AnalysisFilter {
                    run_id,
                    value_id: "clusterId".to_string(),
                    min: Some(7.0),
                    max: None,
                },
                AnalysisFilter {
                    run_id,
                    value_id: "score".to_string(),
                    min: None,
                    max: Some(0.9),
                },
            ],
        )
        .expect("plan executable predicate");
        let sql = format!(
            "select source_index from molecules where {} order by source_index",
            plan.predicate_sql
        );
        let source_indexes = connection
            .prepare(&sql)
            .expect("prepare predicate")
            .query_map(params_from_iter(plan.params.iter()), |row| row.get(0))
            .expect("query predicate")
            .collect::<Result<Vec<i64>, _>>()
            .expect("collect source indexes");

        assert_eq!(source_indexes, vec![0]);
    }

    #[test]
    fn rejects_unsupported_or_malformed_filters() {
        assert!(parse_column_filter_kind("date").is_err());
        assert!(plan_grid_predicate(
            &text_query(""),
            &[column(
                "molecule",
                ColumnFilterKind::Text,
                Some("CCO"),
                None,
                None,
            )],
            &[],
            &[],
        )
        .is_err());
        assert!(plan_grid_predicate(
            &text_query(""),
            &[column("index", ColumnFilterKind::Number, None, None, None,)],
            &[],
            &[],
        )
        .is_err());
        assert!(plan_grid_predicate(
            &text_query(""),
            &[],
            &[DescriptorFilter {
                id: "MW".to_string(),
                min: Some(80.0),
                max: Some(40.0),
            }],
            &[],
        )
        .is_err());
        assert!(plan_grid_predicate(
            &text_query(""),
            &[],
            &[],
            &[AnalysisFilter {
                run_id: Uuid::nil(),
                value_id: "clusterScore".to_string(),
                min: Some(0.0),
                max: None,
            }],
        )
        .is_err());
        assert!(plan_grid_predicate(
            &text_query(""),
            &[column(
                "prop:score",
                ColumnFilterKind::Number,
                None,
                Some(f64::NAN),
                None,
            )],
            &[],
            &[],
        )
        .is_err());
    }
}
