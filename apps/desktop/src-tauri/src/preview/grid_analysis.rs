use std::{collections::BTreeSet, path::Path};

use burrete_compute_protocol::{
    CapabilityMaturity, RepresentativePolicy, WorkflowTemplateId, MAX_JSON_SAFE_INTEGER,
    MAX_PACK_FILES, MAX_PACK_RECORDS,
};
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::Serialize;
use uuid::Uuid;

use super::grid_database::open_grid_database;

#[path = "grid_analysis_schema.rs"]
mod schema;

const MAX_PROVENANCE_BYTES: usize = 64 * 1024;
const MAX_VALUE_ID_BYTES: usize = 160;
const MAX_VALUE_TEXT_BYTES: usize = 4_096;
const MAX_ARTIFACT_ROLE_BYTES: usize = 160;
const MAX_SIMILARITY_MATCHES: usize = 500;

#[derive(Clone, Debug)]
pub(crate) enum GridAnalysisValue {
    Integer(i64),
    Real(f64),
    Boolean(bool),
    Text(String),
}

#[derive(Clone, Debug)]
pub(crate) struct GridAnalysisValueInput {
    pub(crate) molecule_id: i64,
    pub(crate) source_index: u64,
    pub(crate) molecule_content_sha256: String,
    pub(crate) value_id: String,
    pub(crate) value: GridAnalysisValue,
}

#[derive(Clone, Debug)]
pub(crate) struct GridAnalysisArtifactInput {
    pub(crate) artifact_id: Uuid,
    pub(crate) role: String,
    pub(crate) manifest_sha256: String,
}

#[derive(Clone, Debug)]
pub(crate) struct GridAnalysisApplyInput {
    pub(crate) run_id: Uuid,
    pub(crate) workflow_template: WorkflowTemplateId,
    pub(crate) document_fingerprint_sha256: String,
    pub(crate) source_revision: u64,
    pub(crate) snapshot_id: Uuid,
    pub(crate) snapshot_sha256: String,
    pub(crate) normalized_settings_sha256: String,
    pub(crate) maturity: CapabilityMaturity,
    pub(crate) representative_policy: RepresentativePolicy,
    pub(crate) provenance: serde_json::Value,
    pub(crate) created_at_ms: u64,
    pub(crate) values: Vec<GridAnalysisValueInput>,
    pub(crate) artifacts: Vec<GridAnalysisArtifactInput>,
}

#[derive(Clone, Debug)]
pub(crate) struct GridClusterAssignmentInput {
    pub(crate) source_index: u64,
    pub(crate) molecule_content_sha256: String,
    pub(crate) cluster_id: Option<u64>,
    pub(crate) representative: bool,
    pub(crate) error: Option<String>,
}

#[derive(Clone, Debug)]
pub(crate) struct GridClusterAnalysisApplyInput {
    pub(crate) run_id: Uuid,
    pub(crate) document_fingerprint_sha256: String,
    pub(crate) source_revision: u64,
    pub(crate) snapshot_id: Uuid,
    pub(crate) snapshot_sha256: String,
    pub(crate) normalized_settings_sha256: String,
    pub(crate) representative_policy: RepresentativePolicy,
    pub(crate) provenance: serde_json::Value,
    pub(crate) created_at_ms: u64,
    pub(crate) artifact_id: Uuid,
    pub(crate) artifact_manifest_sha256: String,
    pub(crate) assignments: Vec<GridClusterAssignmentInput>,
}

#[derive(Clone, Debug)]
pub(crate) struct GridConformerAssignmentInput {
    pub(crate) source_index: u64,
    pub(crate) molecule_content_sha256: String,
    pub(crate) conformer_count: u64,
    pub(crate) passed_count: u64,
    pub(crate) best_etk_energy: Option<f64>,
    pub(crate) best_mmff_energy: Option<f64>,
    pub(crate) error: Option<String>,
    pub(crate) mmff_error: Option<String>,
}

#[derive(Clone, Debug)]
pub(crate) struct GridConformerAnalysisApplyInput {
    pub(crate) run_id: Uuid,
    pub(crate) document_fingerprint_sha256: String,
    pub(crate) source_revision: u64,
    pub(crate) snapshot_id: Uuid,
    pub(crate) snapshot_sha256: String,
    pub(crate) normalized_settings_sha256: String,
    pub(crate) provenance: serde_json::Value,
    pub(crate) created_at_ms: u64,
    pub(crate) artifact_id: Uuid,
    pub(crate) artifact_manifest_sha256: String,
    pub(crate) assignments: Vec<GridConformerAssignmentInput>,
}

#[derive(Clone, Debug)]
pub(crate) struct GridSimilarityMatchInput {
    pub(crate) source_index: u64,
    pub(crate) molecule_content_sha256: String,
    pub(crate) rank: u64,
    pub(crate) intersection: u64,
    pub(crate) union: u64,
}

#[derive(Clone, Debug)]
pub(crate) struct GridSimilarityAnalysisApplyInput {
    pub(crate) run_id: Uuid,
    pub(crate) document_fingerprint_sha256: String,
    pub(crate) source_revision: u64,
    pub(crate) snapshot_id: Uuid,
    pub(crate) snapshot_sha256: String,
    pub(crate) normalized_settings_sha256: String,
    pub(crate) representative_policy: RepresentativePolicy,
    pub(crate) provenance: serde_json::Value,
    pub(crate) created_at_ms: u64,
    pub(crate) artifact_id: Uuid,
    pub(crate) artifact_manifest_sha256: String,
    pub(crate) query_source_index: u64,
    pub(crate) query_molecule_content_sha256: String,
    pub(crate) matches: Vec<GridSimilarityMatchInput>,
}

pub(crate) fn initialize(connection: &Connection) -> Result<(), String> {
    schema::initialize(connection)
}

pub(crate) fn apply_analysis_run(
    database_path: &Path,
    input: &GridAnalysisApplyInput,
) -> Result<(), String> {
    let validated = ValidatedApply::new(input)?;
    let mut connection = open_grid_database(database_path)?;
    initialize(&connection)?;
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| error.to_string())?;
    insert_run(&transaction, input, &validated)?;
    insert_values(&transaction, input)?;
    insert_artifacts(&transaction, input)?;
    transaction.commit().map_err(|error| error.to_string())
}

pub(crate) fn apply_cluster_analysis_run(
    database_path: &Path,
    cluster: &GridClusterAnalysisApplyInput,
) -> Result<(), String> {
    if cluster.assignments.is_empty() || cluster.assignments.len() as u64 > MAX_PACK_RECORDS {
        return Err(format!(
            "Cluster analysis requires 1..={MAX_PACK_RECORDS} assignments"
        ));
    }
    let mut connection = open_grid_database(database_path)?;
    initialize(&connection)?;
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| error.to_string())?;
    let mut values = Vec::new();
    values
        .try_reserve_exact(cluster.assignments.len().saturating_mul(3))
        .map_err(|_| "Cannot allocate Grid cluster analysis values".to_string())?;
    {
        let mut resolver = transaction
            .prepare(
                "select id from molecules
                 where source_index = ?1 and molecule_content_sha256 = ?2",
            )
            .map_err(|error| error.to_string())?;
        for assignment in &cluster.assignments {
            let molecule_id = resolver
                .query_row(
                    params![
                        assignment.source_index as i64,
                        assignment.molecule_content_sha256
                    ],
                    |row| row.get::<_, i64>(0),
                )
                .optional()
                .map_err(|error| error.to_string())?
                .ok_or_else(|| {
                    format!(
                        "Grid molecule identity changed at source index {}",
                        assignment.source_index
                    )
                })?;
            match (assignment.cluster_id, &assignment.error) {
                (Some(cluster_id), None) => {
                    let cluster_id = i64::try_from(cluster_id)
                        .map_err(|_| "Cluster ID exceeds the Grid integer range".to_string())?;
                    values.push(cluster_value(
                        molecule_id,
                        assignment,
                        "clusterId",
                        GridAnalysisValue::Integer(cluster_id),
                    ));
                    values.push(cluster_value(
                        molecule_id,
                        assignment,
                        "isRepresentative",
                        GridAnalysisValue::Boolean(assignment.representative),
                    ));
                    values.push(cluster_value(
                        molecule_id,
                        assignment,
                        "clusterStatus",
                        GridAnalysisValue::Text("ok".into()),
                    ));
                }
                (None, Some(error)) if !assignment.representative => {
                    values.push(cluster_value(
                        molecule_id,
                        assignment,
                        "clusterStatus",
                        GridAnalysisValue::Text("fingerprintError".into()),
                    ));
                    values.push(cluster_value(
                        molecule_id,
                        assignment,
                        "clusterError",
                        GridAnalysisValue::Text(error.clone()),
                    ));
                }
                _ => {
                    return Err(format!(
                        "Cluster assignment at source index {} has inconsistent validity",
                        assignment.source_index
                    ));
                }
            }
        }
    }
    let input = GridAnalysisApplyInput {
        run_id: cluster.run_id,
        workflow_template: WorkflowTemplateId::ClusterV1,
        document_fingerprint_sha256: cluster.document_fingerprint_sha256.clone(),
        source_revision: cluster.source_revision,
        snapshot_id: cluster.snapshot_id,
        snapshot_sha256: cluster.snapshot_sha256.clone(),
        normalized_settings_sha256: cluster.normalized_settings_sha256.clone(),
        maturity: CapabilityMaturity::Experimental,
        representative_policy: cluster.representative_policy,
        provenance: cluster.provenance.clone(),
        created_at_ms: cluster.created_at_ms,
        values,
        artifacts: vec![GridAnalysisArtifactInput {
            artifact_id: cluster.artifact_id,
            role: "clusterResult".into(),
            manifest_sha256: cluster.artifact_manifest_sha256.clone(),
        }],
    };
    let validated = ValidatedApply::new(&input)?;
    insert_run(&transaction, &input, &validated)?;
    insert_values(&transaction, &input)?;
    insert_artifacts(&transaction, &input)?;
    transaction.commit().map_err(|error| error.to_string())
}

pub(crate) fn apply_similarity_analysis_run(
    database_path: &Path,
    similarity: &GridSimilarityAnalysisApplyInput,
) -> Result<(), String> {
    if similarity.matches.len() > MAX_SIMILARITY_MATCHES {
        return Err(format!(
            "Similarity analysis exceeds the {MAX_SIMILARITY_MATCHES}-match limit"
        ));
    }
    if similarity.query_source_index > MAX_JSON_SAFE_INTEGER {
        return Err("Similarity query source index exceeds the JSON-safe integer limit".into());
    }
    let mut connection = open_grid_database(database_path)?;
    initialize(&connection)?;
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| error.to_string())?;
    let mut resolver = transaction
        .prepare(
            "select id from molecules
             where source_index = ?1 and molecule_content_sha256 = ?2",
        )
        .map_err(|error| error.to_string())?;
    let query_molecule_id = resolve_analysis_molecule(
        &mut resolver,
        similarity.query_source_index,
        &similarity.query_molecule_content_sha256,
    )?;
    let mut values = Vec::new();
    values
        .try_reserve_exact(1 + similarity.matches.len().saturating_mul(4))
        .map_err(|_| "Cannot allocate Grid similarity analysis values".to_string())?;
    values.push(GridAnalysisValueInput {
        molecule_id: query_molecule_id,
        source_index: similarity.query_source_index,
        molecule_content_sha256: similarity.query_molecule_content_sha256.clone(),
        value_id: "isSimilarityQuery".into(),
        value: GridAnalysisValue::Boolean(true),
    });
    let mut source_indexes = BTreeSet::new();
    for (position, matched) in similarity.matches.iter().enumerate() {
        let expected_rank = position as u64 + 1;
        if matched.rank != expected_rank
            || matched.source_index == similarity.query_source_index
            || matched.source_index > MAX_JSON_SAFE_INTEGER
            || !source_indexes.insert(matched.source_index)
            || matched.intersection > matched.union
            || matched.union > 2_048
        {
            return Err(format!(
                "Similarity match at rank {expected_rank} has inconsistent identity, order, or counts"
            ));
        }
        let molecule_id = resolve_analysis_molecule(
            &mut resolver,
            matched.source_index,
            &matched.molecule_content_sha256,
        )?;
        let score = if matched.union == 0 {
            0.0
        } else {
            matched.intersection as f64 / matched.union as f64
        };
        for (value_id, value) in [
            (
                "similarityRank",
                GridAnalysisValue::Integer(matched.rank as i64),
            ),
            ("similarityToQuery", GridAnalysisValue::Real(score)),
            (
                "tanimotoIntersection",
                GridAnalysisValue::Integer(matched.intersection as i64),
            ),
            (
                "tanimotoUnion",
                GridAnalysisValue::Integer(matched.union as i64),
            ),
        ] {
            values.push(GridAnalysisValueInput {
                molecule_id,
                source_index: matched.source_index,
                molecule_content_sha256: matched.molecule_content_sha256.clone(),
                value_id: value_id.into(),
                value,
            });
        }
    }
    drop(resolver);
    let input = GridAnalysisApplyInput {
        run_id: similarity.run_id,
        workflow_template: WorkflowTemplateId::SimilaritySearchV1,
        document_fingerprint_sha256: similarity.document_fingerprint_sha256.clone(),
        source_revision: similarity.source_revision,
        snapshot_id: similarity.snapshot_id,
        snapshot_sha256: similarity.snapshot_sha256.clone(),
        normalized_settings_sha256: similarity.normalized_settings_sha256.clone(),
        maturity: CapabilityMaturity::Experimental,
        representative_policy: similarity.representative_policy,
        provenance: similarity.provenance.clone(),
        created_at_ms: similarity.created_at_ms,
        values,
        artifacts: vec![GridAnalysisArtifactInput {
            artifact_id: similarity.artifact_id,
            role: "fingerprintSource".into(),
            manifest_sha256: similarity.artifact_manifest_sha256.clone(),
        }],
    };
    let validated = ValidatedApply::new(&input)?;
    insert_run(&transaction, &input, &validated)?;
    insert_values(&transaction, &input)?;
    insert_artifacts(&transaction, &input)?;
    transaction.commit().map_err(|error| error.to_string())
}

pub(crate) fn apply_conformer_analysis_run(
    database_path: &Path,
    conformer: &GridConformerAnalysisApplyInput,
) -> Result<(), String> {
    if conformer.assignments.is_empty() || conformer.assignments.len() as u64 > MAX_PACK_RECORDS {
        return Err(format!(
            "Conformer analysis requires 1..={MAX_PACK_RECORDS} assignments"
        ));
    }
    let mut connection = open_grid_database(database_path)?;
    initialize(&connection)?;
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| error.to_string())?;
    let mut resolver = transaction
        .prepare(
            "select id from molecules
             where source_index = ?1 and molecule_content_sha256 = ?2",
        )
        .map_err(|error| error.to_string())?;
    let mut values = Vec::new();
    for assignment in &conformer.assignments {
        if assignment.passed_count > assignment.conformer_count
            || assignment
                .best_etk_energy
                .is_some_and(|value| !value.is_finite())
            || assignment
                .best_mmff_energy
                .is_some_and(|value| !value.is_finite())
        {
            return Err("Conformer assignment contains inconsistent counts or energy".into());
        }
        let molecule_id = resolve_analysis_molecule(
            &mut resolver,
            assignment.source_index,
            &assignment.molecule_content_sha256,
        )?;
        let status = if assignment.error.is_some() {
            "inputError"
        } else if assignment.passed_count == assignment.conformer_count {
            "ok"
        } else if assignment.passed_count > 0 {
            "partial"
        } else {
            "failed"
        };
        for (value_id, value) in [
            (
                "conformerCount",
                GridAnalysisValue::Integer(assignment.conformer_count as i64),
            ),
            (
                "conformerPassedCount",
                GridAnalysisValue::Integer(assignment.passed_count as i64),
            ),
            ("conformerStatus", GridAnalysisValue::Text(status.into())),
        ] {
            values.push(GridAnalysisValueInput {
                molecule_id,
                source_index: assignment.source_index,
                molecule_content_sha256: assignment.molecule_content_sha256.clone(),
                value_id: value_id.into(),
                value,
            });
        }
        if let Some(energy) = assignment.best_etk_energy {
            values.push(GridAnalysisValueInput {
                molecule_id,
                source_index: assignment.source_index,
                molecule_content_sha256: assignment.molecule_content_sha256.clone(),
                value_id: "bestEtkEnergy".into(),
                value: GridAnalysisValue::Real(energy),
            });
        }
        if let Some(energy) = assignment.best_mmff_energy {
            values.push(GridAnalysisValueInput {
                molecule_id,
                source_index: assignment.source_index,
                molecule_content_sha256: assignment.molecule_content_sha256.clone(),
                value_id: "bestMmff94sEnergy".into(),
                value: GridAnalysisValue::Real(energy),
            });
        }
        values.push(GridAnalysisValueInput {
            molecule_id,
            source_index: assignment.source_index,
            molecule_content_sha256: assignment.molecule_content_sha256.clone(),
            value_id: "mmffOptimizationStatus".into(),
            value: GridAnalysisValue::Text(
                if assignment.best_mmff_energy.is_some() {
                    "optimized"
                } else {
                    "unavailable"
                }
                .into(),
            ),
        });
        if let Some(error) = &assignment.mmff_error {
            values.push(GridAnalysisValueInput {
                molecule_id,
                source_index: assignment.source_index,
                molecule_content_sha256: assignment.molecule_content_sha256.clone(),
                value_id: "mmffOptimizationError".into(),
                value: GridAnalysisValue::Text(error.clone()),
            });
        }
        if let Some(error) = &assignment.error {
            values.push(GridAnalysisValueInput {
                molecule_id,
                source_index: assignment.source_index,
                molecule_content_sha256: assignment.molecule_content_sha256.clone(),
                value_id: "conformerError".into(),
                value: GridAnalysisValue::Text(error.clone()),
            });
        }
    }
    drop(resolver);
    let input = GridAnalysisApplyInput {
        run_id: conformer.run_id,
        workflow_template: WorkflowTemplateId::ConformerV1,
        document_fingerprint_sha256: conformer.document_fingerprint_sha256.clone(),
        source_revision: conformer.source_revision,
        snapshot_id: conformer.snapshot_id,
        snapshot_sha256: conformer.snapshot_sha256.clone(),
        normalized_settings_sha256: conformer.normalized_settings_sha256.clone(),
        maturity: CapabilityMaturity::Experimental,
        representative_policy: RepresentativePolicy::NotApplicable,
        provenance: conformer.provenance.clone(),
        created_at_ms: conformer.created_at_ms,
        values,
        artifacts: vec![GridAnalysisArtifactInput {
            artifact_id: conformer.artifact_id,
            role: "conformerResult".into(),
            manifest_sha256: conformer.artifact_manifest_sha256.clone(),
        }],
    };
    let validated = ValidatedApply::new(&input)?;
    insert_run(&transaction, &input, &validated)?;
    insert_values(&transaction, &input)?;
    insert_artifacts(&transaction, &input)?;
    transaction.commit().map_err(|error| error.to_string())
}

fn resolve_analysis_molecule(
    resolver: &mut rusqlite::Statement<'_>,
    source_index: u64,
    molecule_content_sha256: &str,
) -> Result<i64, String> {
    resolver
        .query_row(
            params![source_index as i64, molecule_content_sha256],
            |row| row.get::<_, i64>(0),
        )
        .optional()
        .map_err(|error| error.to_string())?
        .ok_or_else(|| format!("Grid molecule identity changed at source index {source_index}"))
}

fn cluster_value(
    molecule_id: i64,
    assignment: &GridClusterAssignmentInput,
    value_id: &str,
    value: GridAnalysisValue,
) -> GridAnalysisValueInput {
    GridAnalysisValueInput {
        molecule_id,
        source_index: assignment.source_index,
        molecule_content_sha256: assignment.molecule_content_sha256.clone(),
        value_id: value_id.into(),
        value,
    }
}

struct ValidatedApply {
    workflow_template: String,
    maturity: String,
    representative_policy: String,
    provenance_json: String,
}

impl ValidatedApply {
    fn new(input: &GridAnalysisApplyInput) -> Result<Self, String> {
        if input.run_id.is_nil() || input.snapshot_id.is_nil() {
            return Err("Analysis run and snapshot IDs cannot be nil".into());
        }
        for (label, value) in [
            ("document fingerprint", &input.document_fingerprint_sha256),
            ("snapshot", &input.snapshot_sha256),
            ("normalized settings", &input.normalized_settings_sha256),
        ] {
            validate_sha256(label, value)?;
        }
        validate_positive_json_safe("analysis source revision", input.source_revision)?;
        validate_positive_json_safe("analysis creation time", input.created_at_ms)?;
        if input.values.is_empty() || input.values.len() as u64 > MAX_PACK_RECORDS {
            return Err(format!(
                "Analysis apply requires 1..={MAX_PACK_RECORDS} values"
            ));
        }
        if input.artifacts.len() > MAX_PACK_FILES {
            return Err(format!(
                "Analysis apply exceeds the {MAX_PACK_FILES}-artifact limit"
            ));
        }
        let provenance_json = serde_json::to_string(&input.provenance)
            .map_err(|error| format!("Analysis provenance is not serializable: {error}"))?;
        if !input.provenance.is_object() || provenance_json.len() > MAX_PROVENANCE_BYTES {
            return Err(format!(
                "Analysis provenance must be an object of at most {MAX_PROVENANCE_BYTES} UTF-8 bytes"
            ));
        }

        let mut value_keys = BTreeSet::new();
        for value in &input.values {
            validate_value(value)?;
            if !value_keys.insert((value.molecule_id, value.value_id.as_str())) {
                return Err(format!(
                    "Duplicate analysis value for molecule {} and value {}",
                    value.molecule_id, value.value_id
                ));
            }
        }
        let mut artifact_keys = BTreeSet::new();
        for artifact in &input.artifacts {
            if artifact.artifact_id.is_nil() {
                return Err("Analysis artifact ID cannot be nil".into());
            }
            validate_bounded_text(
                "analysis artifact role",
                &artifact.role,
                MAX_ARTIFACT_ROLE_BYTES,
            )?;
            validate_sha256("analysis artifact manifest", &artifact.manifest_sha256)?;
            if !artifact_keys.insert((artifact.artifact_id, artifact.role.as_str())) {
                return Err(format!(
                    "Duplicate analysis artifact role: {}/{}",
                    artifact.artifact_id, artifact.role
                ));
            }
        }

        Ok(Self {
            workflow_template: enum_text(&input.workflow_template)?,
            maturity: enum_text(&input.maturity)?,
            representative_policy: enum_text(&input.representative_policy)?,
            provenance_json,
        })
    }
}

fn insert_run(
    connection: &Connection,
    input: &GridAnalysisApplyInput,
    validated: &ValidatedApply,
) -> Result<(), String> {
    connection
        .execute(
            "insert into analysis_runs(
               run_id, schema_version, workflow_template,
               document_fingerprint_sha256, source_revision,
               snapshot_id, snapshot_sha256, normalized_settings_sha256,
               maturity, representative_policy, provenance_json, created_at_ms
             ) values (?1, 1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![
                input.run_id.to_string(),
                validated.workflow_template,
                input.document_fingerprint_sha256,
                input.source_revision as i64,
                input.snapshot_id.to_string(),
                input.snapshot_sha256,
                input.normalized_settings_sha256,
                validated.maturity,
                validated.representative_policy,
                validated.provenance_json,
                input.created_at_ms as i64,
            ],
        )
        .map(|_| ())
        .map_err(|error| error.to_string())
}

fn insert_values(connection: &Connection, input: &GridAnalysisApplyInput) -> Result<(), String> {
    let mut statement = connection
        .prepare(
            "insert into analysis_values(
               run_id, molecule_id, source_index, molecule_content_sha256,
               value_id, value_kind, value_integer, value_real, value_text
             ) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        )
        .map_err(|error| error.to_string())?;
    for value in &input.values {
        let (kind, integer, real, text) = value.storage_parts();
        statement
            .execute(params![
                input.run_id.to_string(),
                value.molecule_id,
                value.source_index as i64,
                value.molecule_content_sha256,
                value.value_id,
                kind,
                integer,
                real,
                text,
            ])
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn insert_artifacts(connection: &Connection, input: &GridAnalysisApplyInput) -> Result<(), String> {
    let mut statement = connection
        .prepare(
            "insert into analysis_artifacts(run_id, artifact_id, role, manifest_sha256)
             values (?1, ?2, ?3, ?4)",
        )
        .map_err(|error| error.to_string())?;
    for artifact in &input.artifacts {
        statement
            .execute(params![
                input.run_id.to_string(),
                artifact.artifact_id.to_string(),
                artifact.role,
                artifact.manifest_sha256,
            ])
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

impl GridAnalysisValueInput {
    fn storage_parts(&self) -> (&'static str, Option<i64>, Option<f64>, Option<&str>) {
        match &self.value {
            GridAnalysisValue::Integer(value) => ("integer", Some(*value), None, None),
            GridAnalysisValue::Real(value) => ("real", None, Some(*value), None),
            GridAnalysisValue::Boolean(value) => ("boolean", Some(i64::from(*value)), None, None),
            GridAnalysisValue::Text(value) => ("text", None, None, Some(value.as_str())),
        }
    }
}

fn validate_value(value: &GridAnalysisValueInput) -> Result<(), String> {
    if value.molecule_id <= 0 {
        return Err("Analysis molecule ID must be positive".into());
    }
    if value.source_index > MAX_JSON_SAFE_INTEGER {
        return Err("Analysis source index exceeds the JSON-safe integer limit".into());
    }
    validate_sha256("analysis molecule content", &value.molecule_content_sha256)?;
    validate_bounded_text("analysis value ID", &value.value_id, MAX_VALUE_ID_BYTES)?;
    match &value.value {
        GridAnalysisValue::Integer(number) => {
            if number.unsigned_abs() > MAX_JSON_SAFE_INTEGER {
                return Err("Analysis integer exceeds the JSON-safe integer limit".into());
            }
        }
        GridAnalysisValue::Real(number) if !number.is_finite() => {
            return Err("Analysis real value must be finite".into());
        }
        GridAnalysisValue::Text(text) if text.len() > MAX_VALUE_TEXT_BYTES => {
            return Err(format!(
                "Analysis text value exceeds {MAX_VALUE_TEXT_BYTES} UTF-8 bytes"
            ));
        }
        _ => {}
    }
    Ok(())
}

fn validate_positive_json_safe(label: &str, value: u64) -> Result<(), String> {
    if value == 0 || value > MAX_JSON_SAFE_INTEGER {
        return Err(format!("{label} must be in 1..={MAX_JSON_SAFE_INTEGER}"));
    }
    Ok(())
}

fn validate_sha256(label: &str, value: &str) -> Result<(), String> {
    if value.len() != 64
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(format!("{label} is not a lowercase SHA-256"));
    }
    Ok(())
}

fn validate_bounded_text(label: &str, value: &str, max_bytes: usize) -> Result<(), String> {
    if value.is_empty() || value.len() > max_bytes {
        return Err(format!("{label} must contain 1..={max_bytes} UTF-8 bytes"));
    }
    Ok(())
}

fn enum_text(value: &impl Serialize) -> Result<String, String> {
    serde_json::to_value(value)
        .map_err(|error| error.to_string())?
        .as_str()
        .map(str::to_owned)
        .ok_or_else(|| "Analysis enum did not serialize as a string".to_string())
}

#[cfg(test)]
#[path = "grid_analysis_tests.rs"]
mod tests;
