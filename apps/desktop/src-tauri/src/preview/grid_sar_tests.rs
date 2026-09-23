use super::*;

#[test]
fn sar_text_columns_filter_sort_and_page() {
    let mut db = Connection::open_in_memory().unwrap();
    db.execute_batch("create table molecules (id integer primary key, name text, smiles text, molblock text, source_index integer);
        create table derived_columns (column_id text primary key, label text, kind text, params_json text, created_at_ms integer);
        create table descriptor_values (molecule_id integer, descriptor_id text, label text, value_real real, value_text text, missing_kind text, error_text text, updated_at_ms integer, primary key (molecule_id, descriptor_id));
        insert into molecules values (1, 'a', 'CC', null, 0), (2, 'b', 'CO', null, 1), (3, 'c', 'CN', null, 2);").unwrap();
    store_derived_values_in_database(
        &mut db,
        "RGroup_Series",
        "Series",
        "rgroup",
        None,
        &[
            DerivedValueInput {
                row_id: 1,
                value_real: None,
                value_text: Some("S2".into()),
                error_text: None,
            },
            DerivedValueInput {
                row_id: 2,
                value_real: None,
                value_text: Some("S1".into()),
                error_text: None,
            },
            DerivedValueInput {
                row_id: 3,
                value_real: None,
                value_text: None,
                error_text: None,
            },
        ],
    )
    .unwrap();
    let sort = page_sort_clause(
        Some(&GridDescriptorSort {
            id: "RGroup_Series".into(),
            direction: "asc".into(),
        }),
        "index",
    );
    let sorted: Vec<i64> = db
        .prepare(&format!(
            "select molecules.id from molecules {} order by {}",
            sort.join_sql, sort.order_sql
        ))
        .unwrap()
        .query_map(params_from_iter(sort.params), |row| row.get(0))
        .unwrap()
        .map(Result::unwrap)
        .collect();
    assert_eq!(sorted, vec![2, 1, 3]);
    let plan = grid_predicate::plan_grid_predicate(
        &burette_compute_protocol::GridTextQuery::Text {
            text: String::new(),
        },
        &[burette_compute_protocol::ColumnFilter {
            id: "descriptor:RGroup_Series".into(),
            filter_type: burette_compute_protocol::ColumnFilterKind::Text,
            text: Some("S2".into()),
            min: None,
            max: None,
        }],
        &[],
        &[],
    )
    .unwrap();
    let filtered: Vec<i64> = db
        .prepare(&format!(
            "select id from molecules where {} limit 1 offset 0",
            plan.predicate_sql
        ))
        .unwrap()
        .query_map(params_from_iter(plan.params), |row| row.get(0))
        .unwrap()
        .map(Result::unwrap)
        .collect();
    assert_eq!(filtered, vec![1]);
}
