//! ChEMBL structure search and the activity join behind "Similar From ChEMBL
//! Actives".
//!
//! DataWarrior queries a private mirror; Burette uses EBI's own documented web
//! service instead, so the protocol is public, versioned and can be smoke-tested
//! against the live service (scripts/db-smoke.mjs).

use std::collections::HashMap;

use serde_json::Value;

use super::http::{fetch_text, DatabaseRequest};
use super::table::DatabaseTable;
use super::{scalar_text, DatabasePayload, StructureSearchMode};

const CHEMBL_API: &str = "https://www.ebi.ac.uk/chembl/api/data";
const MOLECULE_FIELDS: &str =
    "molecule_chembl_id,pref_name,max_phase,similarity,molecule_structures,molecule_properties";
const ACTIVITY_FIELDS: &str = "molecule_chembl_id,target_chembl_id,target_pref_name,standard_type,standard_value,standard_units,pchembl_value";
/// One request per chunk of molecules, small enough to keep the URL well under
/// any gateway's length limit.
const ACTIVITY_CHUNK: usize = 20;

pub(crate) fn structure_search(
    smiles: &str,
    mode: StructureSearchMode,
    threshold: f64,
    limit: usize,
) -> Result<DatabasePayload, String> {
    let url = structure_search_url(smiles, mode, threshold, limit)?;
    let text = fetch_text(&DatabaseRequest::get(url).with_timeout(90))?;
    let molecules = parse_molecules(&text)?;
    let table = molecule_table(&molecules);
    Ok(DatabasePayload {
        extension: "csv",
        record_count: table.len(),
        text: table.without_empty_columns().to_csv(),
        warnings: Vec::new(),
    })
}

/// Similar ChEMBL compounds that carry measured activity, in the shape the
/// current collection can absorb: one row per compound, with its strongest
/// reported activity attached.
pub(crate) fn similar_actives(
    smiles: &str,
    threshold: f64,
    limit: usize,
) -> Result<DatabasePayload, String> {
    let url = structure_search_url(smiles, StructureSearchMode::Similarity, threshold, limit)?;
    let text = fetch_text(&DatabaseRequest::get(url).with_timeout(90))?;
    let molecules = parse_molecules(&text)?;
    if molecules.is_empty() {
        return Ok(DatabasePayload {
            extension: "csv",
            text: String::new(),
            record_count: 0,
            warnings: Vec::new(),
        });
    }
    let mut activities: HashMap<String, ChemblActivity> = HashMap::new();
    let mut warnings = Vec::new();
    for chunk in molecules
        .iter()
        .map(|molecule| molecule.chembl_id.as_str())
        .collect::<Vec<_>>()
        .chunks(ACTIVITY_CHUNK)
    {
        match fetch_activities(chunk) {
            Ok(found) => {
                for (id, activity) in found {
                    merge_strongest_activity(&mut activities, id, activity);
                }
            }
            Err(error) => warnings.push(format!("ChEMBL activities are incomplete: {error}")),
        }
    }
    let actives: Vec<&ChemblMolecule> = molecules
        .iter()
        .filter(|molecule| activities.contains_key(&molecule.chembl_id))
        .collect();
    let skipped = molecules.len() - actives.len();
    if skipped > 0 {
        warnings.push(format!(
            "{skipped} similar compound(s) have no measured activity in ChEMBL and were skipped"
        ));
    }
    let mut table = DatabaseTable::new(&[
        "SMILES",
        "Name",
        "ChEMBL ID",
        "Similarity",
        "Target",
        "Target ID",
        "Activity Type",
        "Activity Value",
        "Activity Units",
        "pChEMBL",
    ]);
    for molecule in actives {
        let activity = &activities[&molecule.chembl_id];
        table.push_row(vec![
            molecule.smiles.clone(),
            molecule.display_name(),
            molecule.chembl_id.clone(),
            molecule.similarity.clone(),
            activity.target_name.clone(),
            activity.target_id.clone(),
            activity.activity_type.clone(),
            activity.value.clone(),
            activity.units.clone(),
            activity.pchembl.clone(),
        ]);
    }
    Ok(DatabasePayload {
        extension: "csv",
        record_count: table.len(),
        text: table.to_csv(),
        warnings,
    })
}

fn structure_search_url(
    smiles: &str,
    mode: StructureSearchMode,
    threshold: f64,
    limit: usize,
) -> Result<String, String> {
    let mut url = url::Url::parse(CHEMBL_API).map_err(|error| error.to_string())?;
    {
        let mut segments = url
            .path_segments_mut()
            .map_err(|_| "The ChEMBL endpoint is not a valid base URL".to_string())?;
        match mode {
            StructureSearchMode::Similarity => {
                segments.push("similarity");
                segments.push(smiles);
                // ChEMBL takes the cut-off as a whole percent in the path.
                segments.push(&format!("{}.json", threshold.round() as i64));
            }
            StructureSearchMode::Substructure => {
                segments.push("substructure");
                segments.push(&format!("{smiles}.json"));
            }
            StructureSearchMode::Exact => {
                segments.push("molecule.json");
            }
        }
    }
    url.query_pairs_mut()
        .append_pair("limit", &limit.to_string())
        .append_pair("only", MOLECULE_FIELDS);
    if mode == StructureSearchMode::Exact {
        url.query_pairs_mut()
            .append_pair("molecule_structures__canonical_smiles__flexmatch", smiles);
    }
    Ok(url.to_string())
}

fn fetch_activities(chembl_ids: &[&str]) -> Result<Vec<(String, ChemblActivity)>, String> {
    let mut url = url::Url::parse(&format!("{CHEMBL_API}/activity.json"))
        .map_err(|error| error.to_string())?;
    url.query_pairs_mut()
        .append_pair("molecule_chembl_id__in", &chembl_ids.join(","))
        .append_pair("limit", "1000")
        .append_pair("only", ACTIVITY_FIELDS);
    let text = fetch_text(&DatabaseRequest::get(url.to_string()).with_timeout(90))?;
    parse_activities(&text)
}

fn merge_strongest_activity(
    activities: &mut HashMap<String, ChemblActivity>,
    id: String,
    activity: ChemblActivity,
) {
    match activities.get(&id) {
        // pChEMBL is the comparable number across assays, so the row with the
        // highest one wins; an entry without it only fills an empty slot.
        Some(existing) if existing.pchembl_number() >= activity.pchembl_number() => {}
        _ => {
            activities.insert(id, activity);
        }
    }
}

#[derive(Debug, Clone)]
pub(crate) struct ChemblMolecule {
    pub(crate) chembl_id: String,
    pub(crate) name: String,
    pub(crate) smiles: String,
    pub(crate) similarity: String,
    pub(crate) max_phase: String,
    pub(crate) inchi_key: String,
    pub(crate) properties: HashMap<String, String>,
}

impl ChemblMolecule {
    fn display_name(&self) -> String {
        if self.name.is_empty() {
            self.chembl_id.clone()
        } else {
            self.name.clone()
        }
    }
}

#[derive(Debug, Clone)]
pub(crate) struct ChemblActivity {
    pub(crate) target_id: String,
    pub(crate) target_name: String,
    pub(crate) activity_type: String,
    pub(crate) value: String,
    pub(crate) units: String,
    pub(crate) pchembl: String,
}

impl ChemblActivity {
    fn pchembl_number(&self) -> f64 {
        self.pchembl.parse::<f64>().unwrap_or(f64::MIN)
    }
}

/// Molecules without a structure are dropped: ChEMBL keeps biotherapeutics and
/// withdrawn records whose `molecule_structures` is null, and a collection row
/// without a structure cannot be drawn, clustered or exported.
pub(crate) fn parse_molecules(text: &str) -> Result<Vec<ChemblMolecule>, String> {
    let payload: Value =
        serde_json::from_str(text).map_err(|error| format!("ChEMBL sent invalid JSON: {error}"))?;
    if let Some(error) = payload.get("error_message").and_then(Value::as_str) {
        return Err(format!("ChEMBL rejected the query: {error}"));
    }
    let molecules = payload
        .get("molecules")
        .and_then(Value::as_array)
        .ok_or_else(|| "ChEMBL sent no molecules".to_string())?;
    Ok(molecules
        .iter()
        .filter_map(|molecule| {
            let structures = molecule.get("molecule_structures")?;
            let smiles = structures.get("canonical_smiles").and_then(Value::as_str)?;
            if smiles.trim().is_empty() {
                return None;
            }
            let properties = molecule
                .get("molecule_properties")
                .and_then(Value::as_object)
                .map(|properties| {
                    properties
                        .iter()
                        .map(|(key, value)| (key.clone(), scalar_text(value)))
                        .collect()
                })
                .unwrap_or_default();
            Some(ChemblMolecule {
                chembl_id: scalar_text(molecule.get("molecule_chembl_id")?),
                name: scalar_text(molecule.get("pref_name").unwrap_or(&Value::Null)),
                smiles: smiles.trim().to_string(),
                similarity: scalar_text(molecule.get("similarity").unwrap_or(&Value::Null)),
                max_phase: scalar_text(molecule.get("max_phase").unwrap_or(&Value::Null)),
                inchi_key: scalar_text(
                    structures.get("standard_inchi_key").unwrap_or(&Value::Null),
                ),
                properties,
            })
        })
        .collect())
}

pub(crate) fn parse_activities(text: &str) -> Result<Vec<(String, ChemblActivity)>, String> {
    let payload: Value =
        serde_json::from_str(text).map_err(|error| format!("ChEMBL sent invalid JSON: {error}"))?;
    let activities = payload
        .get("activities")
        .and_then(Value::as_array)
        .ok_or_else(|| "ChEMBL sent no activities".to_string())?;
    Ok(activities
        .iter()
        .filter_map(|activity| {
            let molecule = activity.get("molecule_chembl_id").map(scalar_text)?;
            if molecule.is_empty() {
                return None;
            }
            Some((
                molecule,
                ChemblActivity {
                    target_id: activity.get("target_chembl_id").map(scalar_text)?,
                    target_name: activity
                        .get("target_pref_name")
                        .map(scalar_text)
                        .unwrap_or_default(),
                    activity_type: activity
                        .get("standard_type")
                        .map(scalar_text)
                        .unwrap_or_default(),
                    value: activity
                        .get("standard_value")
                        .map(scalar_text)
                        .unwrap_or_default(),
                    units: activity
                        .get("standard_units")
                        .map(scalar_text)
                        .unwrap_or_default(),
                    pchembl: activity
                        .get("pchembl_value")
                        .map(scalar_text)
                        .unwrap_or_default(),
                },
            ))
        })
        .collect())
}

fn molecule_table(molecules: &[ChemblMolecule]) -> DatabaseTable {
    let mut table = DatabaseTable::new(&[
        "SMILES",
        "Name",
        "ChEMBL ID",
        "Similarity",
        "Max Phase",
        "Formula",
        "MW",
        "cLogP",
        "TPSA",
        "HBA",
        "HBD",
        "Rotatable Bonds",
        "Aromatic Rings",
        "QED",
        "InChI Key",
    ]);
    for molecule in molecules {
        let property = |key: &str| molecule.properties.get(key).cloned().unwrap_or_default();
        table.push_row(vec![
            molecule.smiles.clone(),
            molecule.display_name(),
            molecule.chembl_id.clone(),
            molecule.similarity.clone(),
            molecule.max_phase.clone(),
            property("full_molformula"),
            property("full_mwt"),
            property("alogp"),
            property("psa"),
            property("hba"),
            property("hbd"),
            property("rtb"),
            property("aromatic_rings"),
            property("qed_weighted"),
            molecule.inchi_key.clone(),
        ]);
    }
    table
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(name: &str) -> String {
        std::fs::read_to_string(
            std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../../../tests/fixtures/database")
                .join(name),
        )
        .expect("recorded ChEMBL fixture")
    }

    #[test]
    fn similarity_hits_become_a_structure_collection() {
        let molecules = parse_molecules(&fixture("chembl-similarity.json")).expect("molecules");
        assert_eq!(molecules.len(), 5);
        let first = &molecules[0];
        assert_eq!(first.chembl_id, "CHEMBL2296002");
        assert_eq!(first.similarity, "100");
        assert!(first.smiles.contains("CC(=O)Oc1ccccc1C(=O)O"));
        assert_eq!(
            first.properties.get("full_mwt").map(String::as_str),
            Some("326.35")
        );

        let csv = molecule_table(&molecules).without_empty_columns().to_csv();
        let header = csv.lines().next().expect("header");
        assert!(header.starts_with("SMILES,Name,ChEMBL ID,Similarity"));
        assert_eq!(csv.lines().count(), 6);
        // The grid finds the structure column by name, so it must survive the
        // empty-column pass even when every hit is anonymous.
        assert!(header.contains("SMILES"));
    }

    #[test]
    fn substructure_hits_parse_with_the_same_reader() {
        let molecules = parse_molecules(&fixture("chembl-substructure.json")).expect("molecules");
        assert_eq!(molecules.len(), 5);
        assert!(molecules.iter().all(|molecule| !molecule.smiles.is_empty()));
        // A substructure search carries no similarity, so the column is dropped.
        let csv = molecule_table(&molecules).without_empty_columns().to_csv();
        assert!(!csv.lines().next().expect("header").contains("Similarity"));
    }

    #[test]
    fn molecules_without_a_structure_are_skipped() {
        let molecules = parse_molecules(
            r#"{"molecules":[{"molecule_chembl_id":"CHEMBL1","molecule_structures":null},
                {"molecule_chembl_id":"CHEMBL2","molecule_structures":{"canonical_smiles":"  "}},
                {"molecule_chembl_id":"CHEMBL3","molecule_structures":{"canonical_smiles":"CCO"}}]}"#,
        )
        .expect("molecules");
        assert_eq!(molecules.len(), 1);
        assert_eq!(molecules[0].chembl_id, "CHEMBL3");
        assert_eq!(molecules[0].display_name(), "CHEMBL3");
    }

    #[test]
    fn a_rejected_query_is_reported_rather_than_read_as_an_empty_result() {
        let error = parse_molecules(r#"{"error_message":"Invalid smiles"}"#).expect_err("error");
        assert!(error.contains("Invalid smiles"));
        assert!(parse_molecules("not json").is_err());
    }

    #[test]
    fn activities_are_reduced_to_the_strongest_measurement_per_molecule() {
        let activities = parse_activities(&fixture("chembl-activity.json")).expect("activities");
        assert!(!activities.is_empty());
        let mut strongest = HashMap::new();
        for (id, activity) in activities {
            merge_strongest_activity(&mut strongest, id, activity);
        }
        assert!(strongest.contains_key("CHEMBL25"));
        assert_eq!(strongest["CHEMBL25"].target_name, "Albumin");
    }

    #[test]
    fn a_measured_pchembl_outranks_an_unmeasured_one() {
        let mut strongest = HashMap::new();
        let without = ChemblActivity {
            target_id: "CHEMBL1".into(),
            target_name: "first".into(),
            activity_type: "IC50".into(),
            value: "10".into(),
            units: "nM".into(),
            pchembl: String::new(),
        };
        let with = ChemblActivity {
            pchembl: "8.0".into(),
            target_name: "second".into(),
            ..without.clone()
        };
        merge_strongest_activity(&mut strongest, "CHEMBL25".into(), without);
        merge_strongest_activity(&mut strongest, "CHEMBL25".into(), with);
        assert_eq!(strongest["CHEMBL25"].target_name, "second");

        let weaker = ChemblActivity {
            pchembl: "5.0".into(),
            target_name: "third".into(),
            ..strongest["CHEMBL25"].clone()
        };
        merge_strongest_activity(&mut strongest, "CHEMBL25".into(), weaker);
        assert_eq!(strongest["CHEMBL25"].target_name, "second");
    }

    #[test]
    fn search_urls_encode_the_query_structure_into_the_path() {
        let similarity =
            structure_search_url("CC(=O)O", StructureSearchMode::Similarity, 82.4, 50).unwrap();
        assert!(similarity.starts_with("https://www.ebi.ac.uk/chembl/api/data/similarity/"));
        assert!(similarity.contains("CC(=O)O") || similarity.contains("CC(%3DO)O"));
        assert!(similarity.contains("/82.json"));
        assert!(similarity.contains("limit=50"));

        let substructure =
            structure_search_url("c1ccccc1", StructureSearchMode::Substructure, 80.0, 10).unwrap();
        assert!(substructure.contains("/substructure/c1ccccc1.json"));
        assert!(!substructure.contains("similarity/"));

        let exact = structure_search_url("CCO", StructureSearchMode::Exact, 80.0, 10).unwrap();
        assert!(exact.contains("molecule.json"));
        assert!(exact.contains("flexmatch=CCO"));
    }
}
