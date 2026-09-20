use super::*;
use std::io::Seek;

#[derive(Debug)]
pub(super) struct TableStream {
    extension: String,
    options: GridParseOptions,
    prefix: String,
    inference: Vec<usize>,
    buffer: String,
    cursor: GridCursor,
    initialized: bool,
    exhausted: bool,
    refill: bool,
    pub(super) has_molecules: bool,
}

impl TableStream {
    pub(super) fn new(extension: &str, options: &GridParseOptions) -> Self {
        Self {
            extension: extension.into(),
            options: GridParseOptions {
                smiles_column: options.smiles_column.clone(),
                include_single_sdf: options.include_single_sdf,
            },
            prefix: String::new(),
            inference: Vec::new(),
            buffer: String::new(),
            cursor: GridCursor::default(),
            initialized: false,
            exhausted: false,
            refill: false,
            has_molecules: true,
        }
    }

    // Infer once with bounded counters, then rewind the same file. Sparse or wide
    // rows cannot change the schema at a later page or inflate a retained sample.
    fn infer_schema(
        &mut self,
        source: &mut SdfFileReader,
        cancel: Option<&AtomicBool>,
    ) -> Result<(), String> {
        let separator = if self.extension == "csv" { ',' } else { '\t' };
        let mut bytes = Vec::new();
        let mut headers = None;
        let mut values = Vec::new();
        let mut smiles = Vec::new();
        let mut scanned = 0;
        let mut record = String::new();
        let mut quoted = false;
        while let Some(line) = source.read_line(&mut bytes, cancel)? {
            if record.len() + line.len() + 1 > MAX_STREAMED_SDF_RECORD_BYTES {
                return Err("Table record exceeds the 512 KiB indexing limit".into());
            }
            for byte in line.bytes() {
                if byte == b'"' {
                    quoted = !quoted;
                }
            }
            record.push_str(&line);
            record.push('\n');
            if quoted {
                continue;
            }
            if record.trim().is_empty() {
                record.clear();
                continue;
            }
            let cells = parse_delimited_line(record.trim_end_matches(['\r', '\n']), separator);
            record.clear();
            if headers.is_none() {
                values = vec![0; cells.len()];
                smiles = vec![0; cells.len()];
                headers = Some(cells);
                continue;
            }
            scanned += 1;
            for (index, count) in values.iter_mut().enumerate() {
                let value = cells.get(index).map(|s| s.trim()).unwrap_or("");
                if value.is_empty() {
                    continue;
                }
                *count += 1;
                if looks_like_smiles(value) || looks_like_reaction_smiles(value) {
                    smiles[index] += 1;
                }
            }
            if scanned >= SMILES_INFERENCE_MAX_SCANNED_ROWS
                || values.iter().all(|n| *n >= SMILES_INFERENCE_SAMPLE_VALUES)
            {
                break;
            }
        }
        if quoted {
            return Err("Unterminated quoted table record".into());
        }
        self.inference = (0..values.len())
            .filter(|i| is_likely_smiles_column(values[*i], smiles[*i]))
            .collect();
        let headers = headers.unwrap_or_default();
        let named = headers
            .iter()
            .map(|s| normalize_column_name(s))
            .any(|s| is_smiles_column(&s) || matches!(s.as_str(), "molblock" | "molfile"));
        self.has_molecules = self.options.smiles_column.is_some()
            || headers.len() < 2
            || !headers.iter().any(|s| !s.trim().is_empty())
            || named
            || !self.inference.is_empty();
        source.verify_unchanged()?;
        source.reader.rewind().map_err(|e| e.to_string())?;
        source.byte_offset = 0;
        source.skip_line_feed_after_carriage_return = false;
        Ok(())
    }

    pub(super) fn next_batch(
        &mut self,
        source: &mut SdfFileReader,
        start: usize,
        limit: usize,
        cancel: Option<&AtomicBool>,
    ) -> Result<ParsedGridBatch, String> {
        if !self.initialized || self.refill {
            let initial = !self.initialized;
            self.buffer = self.prefix.clone();
            self.cursor.offset = self.prefix.len();
            if initial && matches!(self.extension.as_str(), "csv" | "tsv") {
                self.infer_schema(source, cancel)?;
            }
            let lines = limit;
            let mut bytes = Vec::new();
            let mut quoted = false;
            let mut record_bytes = 0;
            let mut lines_read = 0;
            while lines_read < lines
                || (initial
                    && self.extension == "dwar"
                    && datawarrior_header(&self.buffer).is_none())
            {
                lines_read += 1;
                loop {
                    let Some(line) = source.read_line(&mut bytes, cancel)? else {
                        self.exhausted = true;
                        break;
                    };
                    if self.extension == "dwar"
                        && datawarrior_header(&self.buffer).is_some()
                        && looks_like_datawarrior_section_tag(&line)
                    {
                        self.exhausted = true;
                        break;
                    }
                    record_bytes += line.len() + 1;
                    if record_bytes > MAX_STREAMED_SDF_RECORD_BYTES {
                        return Err("Table record exceeds the 512 KiB indexing limit".into());
                    }
                    // Doubled quotes toggle twice, leaving the quoted state unchanged.
                    if matches!(self.extension.as_str(), "csv" | "tsv") {
                        for byte in line.bytes() {
                            if byte == b'"' {
                                quoted = !quoted;
                            }
                        }
                    }
                    if self.buffer.len() + line.len() + 1 > 2 * MAX_STREAMED_SDF_BATCH_BYTES {
                        return Err(
                            "Table header/inference sample exceeds the 32 MiB indexing limit"
                                .into(),
                        );
                    }
                    self.buffer.push_str(&line);
                    self.buffer.push('\n');
                    if !quoted {
                        record_bytes = 0;
                        break;
                    }
                }
                if self.exhausted {
                    break;
                }
                // DWAR metadata can span more lines than the first page.
                if initial && self.extension == "dwar" && datawarrior_header(&self.buffer).is_none()
                {
                    continue;
                }
                if self.buffer.len() - self.prefix.len() >= MAX_STREAMED_SDF_BATCH_BYTES {
                    break;
                }
            }
            if quoted {
                return Err("Unterminated quoted table record".into());
            }
            if initial {
                self.prefix = match self.extension.as_str() {
                    "csv" | "tsv" => first_non_empty_line(&self.buffer)
                        .map(|(_, end)| self.buffer[..end].to_owned())
                        .unwrap_or_default(),
                    "dwar" => {
                        let header = datawarrior_header(&self.buffer)
                            .ok_or("DWAR header not found within the first indexing batch")?;
                        self.buffer[..header.data_offset].to_owned()
                    }
                    _ => String::new(),
                };
                self.cursor.offset = 0;
                self.initialized = true;
            }
            self.refill = false;
        }
        let mut batch = if matches!(self.extension.as_str(), "csv" | "tsv") {
            let separator = if self.extension == "csv" { ',' } else { '\t' };
            if !self.has_molecules {
                parse_generic_delimited_table_batch(
                    &self.buffer,
                    separator,
                    self.cursor,
                    start,
                    limit,
                )
            } else {
                parse_delimited_table_with_inference(
                    &self.buffer,
                    separator,
                    self.cursor,
                    start,
                    limit,
                    &self.options,
                    Some(&self.inference),
                )
                .or_else(|error| {
                    if error != "missing smiles column" || self.options.smiles_column.is_some() {
                        return Err(error);
                    }
                    parse_delimited_rows_as_smiles_batch(
                        &self.buffer,
                        separator,
                        &self.extension,
                        self.cursor,
                        start,
                        limit,
                    )
                })?
            }
        } else {
            parse_grid_batch_with_options(
                &self.extension,
                &self.buffer,
                self.cursor,
                start,
                limit,
                &self.options,
            )?
        };
        self.cursor = batch.next_cursor;
        if batch.complete {
            self.refill = true;
        }
        batch.complete &= self.exhausted;
        Ok(batch)
    }
}

// Logical CSV/TSV row including newlines inside quoted fields.
pub(super) fn record_at(text: &str, offset: usize) -> Option<(&str, usize)> {
    if offset >= text.len() {
        return None;
    }
    let bytes = text.as_bytes();
    let mut quoted = false;
    let mut index = offset;
    while index < bytes.len() {
        match bytes[index] {
            b'"' => quoted = !quoted,
            b'\r' | b'\n' if !quoted => {
                let width = if bytes[index] == b'\r' && bytes.get(index + 1) == Some(&b'\n') {
                    2
                } else {
                    1
                };
                return Some((&text[offset..index], index + width));
            }
            _ => {}
        }
        index += 1;
    }
    Some((&text[offset..], text.len()))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn compare_stream(extension: &str, text: &str, limit: usize) {
        let path = std::env::temp_dir().join(format!(
            "burette-stream-{}.{}",
            uuid::Uuid::new_v4(),
            extension
        ));
        std::fs::write(&path, text).unwrap();
        let mut source = SdfFileReader::open(&path).unwrap();
        let options = GridParseOptions::default();
        let mut table = TableStream::new(extension, &options);
        let mut actual = Vec::new();
        loop {
            let batch = table
                .next_batch(&mut source, actual.len(), limit, None)
                .unwrap();
            actual.extend(batch.records);
            if batch.complete {
                break;
            }
        }
        let expected = parse_grid_batch_with_options(
            extension,
            text,
            GridCursor::default(),
            0,
            usize::MAX,
            &options,
        )
        .unwrap();
        assert_eq!(
            format!("{actual:?}"),
            format!("{:?}", expected.records),
            "{extension}"
        );
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn streamed_tables_freeze_sparse_inference_and_stop_at_dwar_footer() {
        let csv = format!(
            "id,note,candidate\n{}1,blank,\n2,molecule,CCO\n",
            "\n".repeat(19_999)
        );
        compare_stream("csv", &csv, 1);
        let dwar = format!("<datawarrior-fileinfo>\n<version=\"3.3\">\n</datawarrior-fileinfo>\nSMILES\tName\nCCO\tfirst\n<datawarrior properties>\n{}bbb\tfooter payload\n", "<setting=\"test\">\n".repeat(200));
        compare_stream("dwar", &dwar, 192);
    }

    #[test]
    fn streamed_tables_bound_wide_rows_without_retaining_the_sample() {
        let mut csv = String::from("SMILES,Name,Note\n");
        for index in 0..3600 {
            csv.push_str(&format!("CCO,molecule{index},{}\n", "x".repeat(20_000)));
        }
        compare_stream("csv", &csv, 1000);
    }

    #[test]
    fn streamed_tables_preserve_records_across_batches() {
        for (extension, text) in [
            ("csv", "SMILES,Name,Note\nCCO,ethanol,\"line one\nline two\"\nCC,methane,ok\nCCC,propane,ok\n"),
            ("tsv", "SMILES\tName\nCCO\tethanol\nCC\tethane\nCCC\tpropane\n"),
            ("smi", "CCO ethanol\nCC ethane\nCCC propane\n"),
            ("dwar", "<datawarrior-fileinfo>\n<version=\"3.3\">\n</datawarrior-fileinfo>\nSMILES\tName\nCCO\tethanol\nCC\tethane\nCCC\tpropane\n"),
        ] {
            let path = std::env::temp_dir().join(format!("burette-stream-{}.{}", uuid::Uuid::new_v4(), extension));
            std::fs::write(&path, text).unwrap();
            let mut source = SdfFileReader::open(&path).unwrap();
            let options = GridParseOptions::default();
            let mut table = TableStream::new(extension, &options);
            let mut actual = Vec::new();
            loop {
                let batch = table.next_batch(&mut source, actual.len(), 1, None).unwrap();
                actual.extend(batch.records);
                if batch.complete { break; }
            }
            let expected = parse_grid_batch_with_options(extension, text, GridCursor::default(), 0, usize::MAX, &options).unwrap();
            assert_eq!(format!("{actual:?}"), format!("{:?}", expected.records), "{extension}");
            assert_eq!(actual.len(), 3);
            std::fs::remove_file(path).unwrap();
        }
    }
}
