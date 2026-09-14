//! Stage local MolViewSpec dependencies inside the existing preview asset scope.
use super::runtime_utils::asset_url;
use serde_json::Value;
use std::{collections::BTreeMap, fs, path::Path};

const MAX_RESOURCES: usize = 64;
const MAX_RESOURCE_BYTES: u64 = 25 * 1024 * 1024;
const MAX_TOTAL_BYTES: u64 = 100 * 1024 * 1024;

pub(super) struct StagedMvs {
    pub data: Vec<u8>,
    pub resource_urls: Vec<String>,
}

pub(super) fn stage_resources(
    source: &Path,
    runtime: &Path,
    data: &[u8],
) -> Result<StagedMvs, String> {
    let mut document: Value = serde_json::from_slice(data)
        .map_err(|error| format!("Invalid MolViewSpec JSON: {error}"))?;
    let parent = source
        .parent()
        .ok_or("MolViewSpec source has no parent directory")?
        .canonicalize()
        .map_err(|error| error.to_string())?;
    let mut resources = BTreeMap::new();
    let mut total = 0;
    visit(&mut document, &parent, runtime, &mut resources, &mut total)?;
    Ok(StagedMvs {
        data: serde_json::to_vec(&document).map_err(|error| error.to_string())?,
        resource_urls: resources.into_values().collect(),
    })
}

fn visit(
    value: &mut Value,
    parent: &Path,
    runtime: &Path,
    resources: &mut BTreeMap<String, String>,
    total: &mut u64,
) -> Result<(), String> {
    match value {
        Value::Object(object) => {
            if let Some(Value::Object(params)) = object.get_mut("params") {
                for key in ["url", "uri"] {
                    if let Some(Value::String(reference)) = params.get_mut(key) {
                        if reference.is_empty()
                            || reference.contains(':')
                            || reference.starts_with("//")
                        {
                            continue;
                        }
                        if let Some(url) = resources.get(reference) {
                            *reference = url.clone();
                            continue;
                        }
                        if resources.len() >= MAX_RESOURCES {
                            return Err("MolViewSpec has too many local resources".into());
                        }
                        let path = parent.join(&*reference).canonicalize()
                            .map_err(|error| format!("Cannot load MolViewSpec resource {reference}: {error}. Keep the referenced files beside the MVSJ or open the bundled MVSX."))?;
                        if !path.starts_with(parent) {
                            return Err(format!(
                                "MolViewSpec resource escapes its source directory: {reference}"
                            ));
                        }
                        let metadata = fs::metadata(&path).map_err(|error| error.to_string())?;
                        if !metadata.is_file()
                            || metadata.len() > MAX_RESOURCE_BYTES
                            || *total + metadata.len() > MAX_TOTAL_BYTES
                        {
                            return Err(format!(
                                "MolViewSpec resource exceeds the preview size limit: {reference}"
                            ));
                        }
                        let bytes = fs::read(&path).map_err(|error| error.to_string())?;
                        if bytes.len() as u64 != metadata.len() {
                            return Err("MolViewSpec resource changed while being read".into());
                        }
                        *total += bytes.len() as u64;
                        let target = runtime.join(format!("mvs-resource-{}", resources.len()));
                        fs::write(&target, bytes).map_err(|error| error.to_string())?;
                        let url = asset_url(&target);
                        resources.insert(reference.clone(), url.clone());
                        *reference = url;
                    }
                }
            }
            for child in object.values_mut() {
                visit(child, parent, runtime, resources, total)?;
            }
        }
        Value::Array(items) => {
            for item in items {
                visit(item, parent, runtime, resources, total)?;
            }
        }
        _ => {}
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn stages_deduplicated_local_assets_and_rejects_escape_or_missing_files() {
        let root = std::env::temp_dir().join(format!("burette-mvs-{}", uuid::Uuid::new_v4()));
        let source = root.join("source");
        let runtime = root.join("runtime");
        fs::create_dir_all(&source).unwrap();
        fs::create_dir_all(&runtime).unwrap();
        fs::write(source.join("protein.pdb"), b"ATOM test").unwrap();
        fs::write(root.join("outside.pdb"), b"outside").unwrap();
        let input = br#"{"children":[{"params":{"url":"protein.pdb"}},{"params":{"url":"protein.pdb"}},{"params":{"url":"https://example.org/protein.cif"}}]}"#;
        let result: Value = serde_json::from_slice(
            &stage_resources(&source.join("story.mvsj"), &runtime, input)
                .unwrap()
                .data,
        )
        .unwrap();
        assert_eq!(
            result["children"][0]["params"]["url"],
            result["children"][1]["params"]["url"]
        );
        assert_eq!(
            result["children"][2]["params"]["url"],
            "https://example.org/protein.cif"
        );
        assert_eq!(
            fs::read(runtime.join("mvs-resource-0")).unwrap(),
            b"ATOM test"
        );
        assert_eq!(fs::read_dir(&runtime).unwrap().count(), 1);
        for reference in ["../outside.pdb", "missing.pdb"] {
            let input =
                serde_json::to_vec(&serde_json::json!({"params":{"url":reference}})).unwrap();
            assert!(stage_resources(&source.join("story.mvsj"), &runtime, &input).is_err());
        }
        fs::remove_dir_all(root).unwrap();
    }
}
