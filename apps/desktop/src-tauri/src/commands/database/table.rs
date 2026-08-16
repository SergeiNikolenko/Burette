//! Providers answer in JSON, TSV or plain text; the grid reads collections. This
//! is the one place that turns a provider's rows into a delimited collection, so
//! quoting and cell hygiene are decided once.

/// The grid's delimited parser works line by line, so a cell may not contain a
/// line break: an embedded newline would silently split one record into two.
fn sanitize_cell(value: &str) -> String {
    let flattened: String = value
        .chars()
        .map(|character| {
            if character.is_control() {
                ' '
            } else {
                character
            }
        })
        .collect();
    flattened.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn quote_csv_cell(value: &str) -> String {
    let cell = sanitize_cell(value);
    if cell.contains(',') || cell.contains('"') {
        format!("\"{}\"", cell.replace('"', "\"\""))
    } else {
        cell
    }
}

#[derive(Debug, Default)]
pub(crate) struct DatabaseTable {
    headers: Vec<String>,
    rows: Vec<Vec<String>>,
}

impl DatabaseTable {
    pub(crate) fn new(headers: &[&str]) -> Self {
        Self {
            headers: headers.iter().map(|header| header.to_string()).collect(),
            rows: Vec::new(),
        }
    }

    pub(crate) fn push_row(&mut self, cells: Vec<String>) {
        let mut row = cells;
        row.resize(self.headers.len(), String::new());
        self.rows.push(row);
    }

    pub(crate) fn len(&self) -> usize {
        self.rows.len()
    }

    /// Drops columns that stayed empty in every row. Providers answer with a fixed
    /// field list, and a table of half-empty columns is harder to read than the
    /// handful the query actually filled in.
    pub(crate) fn without_empty_columns(mut self) -> Self {
        let keep: Vec<bool> = (0..self.headers.len())
            .map(|index| {
                self.rows
                    .iter()
                    .any(|row| !row.get(index).map(String::is_empty).unwrap_or(true))
            })
            .collect();
        if keep.iter().all(|value| *value) {
            return self;
        }
        self.headers = self
            .headers
            .iter()
            .enumerate()
            .filter(|(index, _)| keep[*index])
            .map(|(_, header)| header.clone())
            .collect();
        self.rows = self
            .rows
            .into_iter()
            .map(|row| {
                row.into_iter()
                    .enumerate()
                    .filter(|(index, _)| keep.get(*index).copied().unwrap_or(false))
                    .map(|(_, cell)| cell)
                    .collect()
            })
            .collect();
        self
    }

    pub(crate) fn to_csv(&self) -> String {
        let mut text = String::new();
        text.push_str(
            &self
                .headers
                .iter()
                .map(|header| quote_csv_cell(header))
                .collect::<Vec<_>>()
                .join(","),
        );
        text.push('\n');
        for row in &self.rows {
            text.push_str(
                &row.iter()
                    .map(|cell| quote_csv_cell(cell))
                    .collect::<Vec<_>>()
                    .join(","),
            );
            text.push('\n');
        }
        text
    }
}

/// Renders a DataWarrior file whose single structure column holds OpenChemLib
/// idcodes. Burette's grid store already understands this format, and it is the
/// only way to carry idcodes - the shape Wikipedia's chemistry export publishes -
/// into a collection without a chemistry toolkit in the backend.
pub(crate) fn idcode_dwar(
    structure_column: &str,
    headers: &[String],
    rows: &[(String, Vec<String>)],
) -> String {
    let cell = |value: &str| sanitize_cell(value).replace('\t', " ");
    let mut text = String::new();
    text.push_str("<datawarrior-fileinfo>\n");
    text.push_str("<version=\"3.3\">\n");
    text.push_str(&format!("<rowcount=\"{}\">\n", rows.len()));
    text.push_str("</datawarrior-fileinfo>\n");
    text.push_str("<column properties>\n");
    text.push_str(&format!("<columnName=\"{structure_column}\">\n"));
    text.push_str("<columnProperty=\"specialType\tidcode\">\n");
    text.push_str("</column properties>\n");
    text.push_str(structure_column);
    for header in headers {
        text.push('\t');
        text.push_str(&cell(header));
    }
    text.push('\n');
    for (idcode, values) in rows {
        text.push_str(&cell(idcode));
        for index in 0..headers.len() {
            text.push('\t');
            text.push_str(&cell(values.get(index).map(String::as_str).unwrap_or("")));
        }
        text.push('\n');
    }
    text
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cells_with_separators_and_quotes_survive_a_round_trip() {
        let mut table = DatabaseTable::new(&["SMILES", "Name"]);
        table.push_row(vec!["CC(=O)O".to_string(), "acid, \"vinegar\"".to_string()]);
        assert_eq!(
            table.to_csv(),
            "SMILES,Name\nCC(=O)O,\"acid, \"\"vinegar\"\"\"\n"
        );
    }

    #[test]
    fn line_breaks_inside_a_cell_never_split_a_record() {
        let mut table = DatabaseTable::new(&["SMILES", "Name"]);
        table.push_row(vec![
            "CCO".to_string(),
            "first\nsecond\r\nthird".to_string(),
        ]);
        let csv = table.to_csv();
        assert_eq!(csv.lines().count(), 2);
        assert!(csv.contains("first second third"));
    }

    #[test]
    fn short_rows_are_padded_to_the_header_width() {
        let mut table = DatabaseTable::new(&["SMILES", "Name", "Note"]);
        table.push_row(vec!["CCO".to_string()]);
        assert_eq!(table.to_csv(), "SMILES,Name,Note\nCCO,,\n");
    }

    #[test]
    fn columns_nobody_filled_in_are_dropped() {
        let mut table = DatabaseTable::new(&["SMILES", "Name", "Activity"]);
        table.push_row(vec!["CCO".to_string(), "ethanol".to_string()]);
        table.push_row(vec!["CCN".to_string(), "amine".to_string()]);
        assert_eq!(
            table.without_empty_columns().to_csv(),
            "SMILES,Name\nCCO,ethanol\nCCN,amine\n"
        );
    }

    #[test]
    fn idcode_collections_declare_the_structure_column() {
        let dwar = idcode_dwar(
            "Structure",
            &["Name".to_string()],
            &[("fJ@@".to_string(), vec!["Ammonia".to_string()])],
        );
        assert!(dwar.contains("<columnProperty=\"specialType\tidcode\">"));
        assert!(dwar.contains("Structure\tName\n"));
        assert!(dwar.contains("fJ@@\tAmmonia\n"));
    }
}
