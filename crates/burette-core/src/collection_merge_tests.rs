use super::*;
use std::sync::atomic::{AtomicUsize, Ordering};

static NEXT_ROOT: AtomicUsize = AtomicUsize::new(0);
struct TestRoot(PathBuf);
impl TestRoot {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!(
            "burette-merge-test-{}-{}",
            std::process::id(),
            NEXT_ROOT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&root).unwrap();
        Self(root)
    }
    fn file(&self, name: &str, text: &str) -> String {
        let path = self.0.join(name);
        fs::write(&path, text).unwrap();
        path.to_string_lossy().into_owned()
    }
}
impl Drop for TestRoot {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.0).unwrap();
    }
}

#[test]
fn raw_count_is_checked_before_paths_and_aggregate_size_before_contents() {
    let error =
        merge_collection_files(&vec!["missing.smi".into(); MAX_MERGE_PATHS + 1]).unwrap_err();
    assert!(error.contains("64 collection"));
    let root = TestRoot::new();
    let first = root.file("first.smi", "\0");
    let second = root.file("second.smi", "\0");
    fs::OpenOptions::new()
        .write(true)
        .open(&first)
        .unwrap()
        .set_len(MAX_MERGE_BYTES as u64)
        .unwrap();
    assert!(merge_collection_files(&[first, second])
        .unwrap_err()
        .contains("75 MiB"));
}

#[test]
fn actual_reads_reject_growth_and_invalid_utf8() {
    assert_eq!(read_utf8_bounded(&b"CCO"[..], 3).unwrap(), "CCO");
    assert!(read_utf8_bounded(&b"CCO\n"[..], 3)
        .unwrap_err()
        .contains("75 MiB"));
    assert!(read_utf8_bounded(&b"\xff"[..], 3).is_err());
}

#[test]
fn canonical_deduplication_preserves_source_and_molecule_order() {
    let root = TestRoot::new();
    let first = root.file("first.smiles", " # first\nCCO ethanol\n\n");
    let second = root.file("second.smi", "CCN amine\nCCO duplicate molecule\n");
    let alias = root.0.join("./first.smiles").to_string_lossy().into_owned();
    let (extension, text) = merge_collection_files(&[first.clone(), alias, second]).unwrap();
    assert_eq!(extension, "smi");
    assert_eq!(
        text,
        "# first\nCCO ethanol\nCCN amine\nCCO duplicate molecule\n"
    );
    assert!(merge_collection_files(&[first.clone(), first])
        .unwrap_err()
        .contains("at least two"));
}

#[test]
fn format_semantics_preserve_sdf_records_and_delimited_headers() {
    let sdf = merge_collection_text(
        CollectionFamily::Sdf,
        &[
            "\nFirst\r\nM  END\r\nprice $$$$ marker\r\n\r\n$$$$\n",
            "\nSecond\nM  END\n\n",
        ],
    )
    .unwrap();
    assert_eq!(
        sdf,
        "First\nM  END\nprice $$$$ marker\n$$$$\nSecond\nM  END\n$$$$\n"
    );
    for (family, separator) in [(CollectionFamily::Csv, ','), (CollectionFamily::Tsv, '\t')] {
        let first = format!("\u{feff}SMILES{separator}Name\nCCO{separator}ethanol\n  \n");
        let second = format!("\nsmiles{separator}name\nCCN{separator}amine  \n\n");
        assert_eq!(
            merge_collection_text(family, &[&first, &second]).unwrap(),
            format!("SMILES{separator}Name\nCCO{separator}ethanol\nCCN{separator}amine  \n")
        );
    }
    assert!(merge_collection_text(CollectionFamily::Csv, &["a,b\nx,y", "b,a\ny,x"]).is_err());
    assert!(merge_collection_text(CollectionFamily::Smiles, &["# comment only"]).is_err());
}

#[test]
fn output_overhead_and_oversized_headers_are_bounded() {
    let large_record = "C".repeat(MAX_MERGE_BYTES - 4);
    assert!(
        merge_collection_text(CollectionFamily::Sdf, &[&large_record])
            .unwrap_err()
            .contains("75 MiB")
    );
    drop(large_record);
    let header = format!("{}\nC\n", ",".repeat(MAX_HEADER_BYTES + 1));
    assert!(merge_collection_text(CollectionFamily::Csv, &[&header])
        .unwrap_err()
        .contains("header exceeds"));
}

#[test]
fn failed_open_cleans_only_new_output_and_success_retains_source() {
    let root = TestRoot::new();
    let original = root.file("original.smi", "CCO\n");
    let failed = root.0.join("failed");
    let result = with_generated_output(&failed, "smi", "CCN\n", |path| {
        assert_eq!(fs::read_to_string(path).unwrap(), "CCN\n");
        Err::<(), _>("preview failed".to_string())
    });
    assert_eq!(result.unwrap_err(), "preview failed");
    assert!(!failed.exists());
    assert_eq!(fs::read_to_string(&original).unwrap(), "CCO\n");
    let successful = root.0.join("successful");
    let path = with_generated_output(&successful, "smi", "CCC\n", Ok).unwrap();
    assert_eq!(fs::read_to_string(&path).unwrap(), "CCC\n");
    assert!(with_generated_output(&successful, "smi", "overwrite", Ok).is_err());
    assert_eq!(fs::read_to_string(&path).unwrap(), "CCC\n");
}

#[test]
fn concurrency_slots_are_bounded_and_released() {
    let first = MergeSlot::acquire().unwrap();
    let second = MergeSlot::acquire().unwrap();
    assert!(MergeSlot::acquire().is_err());
    drop(first);
    let third = MergeSlot::acquire().unwrap();
    drop((second, third));
    assert!(MergeSlot::acquire().is_ok());
}
