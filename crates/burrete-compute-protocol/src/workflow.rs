use std::collections::BTreeSet;

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{validation::validate_bounded_text, ProtocolError};

const MAX_DOCUMENT_ID_BYTES: usize = 256;
const MAX_SELECTED_ROWS: usize = 65_536;
const MAX_FILTERS: usize = 64;
const MAX_QUERY_BYTES: usize = 4_096;
const MAX_FILTER_ID_BYTES: usize = 160;
const MAX_FILTER_TEXT_BYTES: usize = 4_096;
const MIN_MEMORY_BYTES: u64 = 16 * 1024 * 1024;
const MAX_MEMORY_BYTES: u64 = 32 * 1024 * 1024 * 1024;
const MAX_EDGE_BUDGET: u64 = 500_000_000;
const MAX_DISPATCH_MS: u32 = 2_000;
const MAX_SAFE_JSON_INTEGER: u64 = 9_007_199_254_740_991;

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum ComputeJobSchemaVersion {
    #[serde(rename = "burrete.compute-job.v1")]
    V1,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum WorkflowTemplateId {
    #[serde(rename = "cluster.v1")]
    ClusterV1,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ClusterV1SubmitRequest {
    pub schema_version: ComputeJobSchemaVersion,
    pub workflow_template: WorkflowTemplateId,
    pub source: GridSourceReference,
    pub parameters: ClusterV1Parameters,
    pub execution_policy: ExecutionPolicy,
    pub limits: ResourceLimits,
}

impl ClusterV1SubmitRequest {
    pub fn validate(&self) -> Result<(), ProtocolError> {
        if self.schema_version != ComputeJobSchemaVersion::V1
            || self.workflow_template != WorkflowTemplateId::ClusterV1
        {
            return Err(ProtocolError::Validation(
                "cluster request has an incompatible schema or workflow template".into(),
            ));
        }
        validate_bounded_text(
            "documentId",
            &self.source.document_id,
            MAX_DOCUMENT_ID_BYTES,
        )?;
        self.source.scope.validate()?;
        self.parameters.validate()?;
        self.limits.validate()
    }

    /// Returns the only representation accepted for immutable request hashing.
    pub fn normalized(mut self) -> Result<Self, ProtocolError> {
        self.source.scope = self.source.scope.normalized()?;
        self.parameters.similarity.cutoff = self.parameters.similarity.cutoff.normalized()?;
        self.validate()?;
        Ok(self)
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GridSourceReference {
    pub document_id: String,
    pub scope: GridScope,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum GridScope {
    Selected(SelectedGridScope),
    Filtered(FilteredGridScope),
    All(AllGridScope),
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SelectedGridScope {
    pub source_indexes: Vec<u64>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FilteredGridScope {
    pub query: GridTextQuery,
    #[serde(default)]
    pub column_filters: Vec<ColumnFilter>,
    #[serde(default)]
    pub descriptor_filters: Vec<DescriptorFilter>,
    #[serde(default)]
    pub analysis_filters: Vec<AnalysisFilter>,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct AllGridScope {}

impl GridScope {
    pub fn validate(&self) -> Result<(), ProtocolError> {
        match self {
            Self::Selected(SelectedGridScope { source_indexes }) => {
                if source_indexes.is_empty() || source_indexes.len() > MAX_SELECTED_ROWS {
                    return Err(ProtocolError::Validation(format!(
                        "selected scope requires 1..={MAX_SELECTED_ROWS} source indexes"
                    )));
                }
                if source_indexes
                    .iter()
                    .any(|index| *index > MAX_SAFE_JSON_INTEGER)
                {
                    return Err(ProtocolError::Validation(
                        "selected source index exceeds the JSON safe integer range".into(),
                    ));
                }
                if source_indexes.windows(2).any(|pair| pair[0] >= pair[1]) {
                    return Err(ProtocolError::Validation(
                        "selected source indexes must be strictly increasing and unique".into(),
                    ));
                }
            }
            Self::Filtered(FilteredGridScope {
                query,
                column_filters,
                descriptor_filters,
                analysis_filters,
            }) => {
                query.validate()?;
                let filter_count =
                    column_filters.len() + descriptor_filters.len() + analysis_filters.len();
                if filter_count > MAX_FILTERS {
                    return Err(ProtocolError::Validation(format!(
                        "filtered scope has {filter_count} filters; limit is {MAX_FILTERS}"
                    )));
                }
                let mut column_ids = BTreeSet::new();
                for filter in column_filters {
                    filter.validate()?;
                    if !column_ids.insert(filter.id.as_str()) {
                        return Err(ProtocolError::Validation(format!(
                            "duplicate column filter ID: {}",
                            filter.id
                        )));
                    }
                }
                let mut descriptor_ids = BTreeSet::new();
                for filter in descriptor_filters {
                    filter.validate("descriptor filter")?;
                    if !descriptor_ids.insert(filter.id.as_str()) {
                        return Err(ProtocolError::Validation(format!(
                            "duplicate descriptor filter ID: {}",
                            filter.id
                        )));
                    }
                }
                let mut analysis_ids = BTreeSet::new();
                for filter in analysis_filters {
                    filter.validate("analysis filter")?;
                    if !analysis_ids.insert((filter.run_id, filter.value_id.as_str())) {
                        return Err(ProtocolError::Validation(format!(
                            "duplicate analysis filter value: {}",
                            filter.value_id
                        )));
                    }
                }
            }
            Self::All(_) => {}
        }
        Ok(())
    }

    /// Produces the canonical request representation used for hashing.
    pub fn normalized(mut self) -> Result<Self, ProtocolError> {
        if let Self::Selected(SelectedGridScope { source_indexes }) = &mut self {
            source_indexes.sort_unstable();
            source_indexes.dedup();
        } else if let Self::Filtered(FilteredGridScope {
            column_filters,
            descriptor_filters,
            analysis_filters,
            ..
        }) = &mut self
        {
            column_filters.sort_by(|left, right| left.id.cmp(&right.id));
            descriptor_filters.sort_by(|left, right| left.id.cmp(&right.id));
            analysis_filters.sort_by(|left, right| {
                (left.run_id, left.value_id.as_str()).cmp(&(right.run_id, right.value_id.as_str()))
            });
        }
        self.validate()?;
        Ok(self)
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum GridTextQuery {
    Text { text: String },
}

impl GridTextQuery {
    fn validate(&self) -> Result<(), ProtocolError> {
        match self {
            Self::Text { text } => {
                if text.len() > MAX_QUERY_BYTES {
                    return Err(ProtocolError::Validation(format!(
                        "text query exceeds {MAX_QUERY_BYTES} bytes"
                    )));
                }
                Ok(())
            }
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ColumnFilterKind {
    Text,
    Number,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ColumnFilter {
    pub id: String,
    pub filter_type: ColumnFilterKind,
    pub text: Option<String>,
    pub min: Option<f64>,
    pub max: Option<f64>,
}

impl ColumnFilter {
    fn validate(&self) -> Result<(), ProtocolError> {
        validate_filter_id(&self.id)?;
        match self.filter_type {
            ColumnFilterKind::Text => {
                let text = self.text.as_deref().unwrap_or_default();
                validate_bounded_text("column filter text", text, MAX_FILTER_TEXT_BYTES)?;
                if self.min.is_some() || self.max.is_some() {
                    return Err(ProtocolError::Validation(
                        "text column filter cannot contain numeric bounds".into(),
                    ));
                }
            }
            ColumnFilterKind::Number => {
                validate_numeric_bounds("column filter", self.min, self.max)?;
                if self.text.is_some() {
                    return Err(ProtocolError::Validation(
                        "numeric column filter cannot contain text".into(),
                    ));
                }
            }
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DescriptorFilter {
    pub id: String,
    pub min: Option<f64>,
    pub max: Option<f64>,
}

impl DescriptorFilter {
    fn validate(&self, label: &str) -> Result<(), ProtocolError> {
        validate_filter_id(&self.id)?;
        validate_numeric_bounds(label, self.min, self.max)
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AnalysisFilter {
    pub run_id: Uuid,
    pub value_id: String,
    pub min: Option<f64>,
    pub max: Option<f64>,
}

impl AnalysisFilter {
    fn validate(&self, label: &str) -> Result<(), ProtocolError> {
        validate_filter_id(&self.value_id)?;
        validate_numeric_bounds(label, self.min, self.max)
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ClusterV1Parameters {
    pub fingerprint: FingerprintSettings,
    pub similarity: SimilaritySettings,
    pub representative_policy: RepresentativePolicy,
}

impl ClusterV1Parameters {
    fn validate(&self) -> Result<(), ProtocolError> {
        self.fingerprint.validate()?;
        self.similarity.cutoff.validate()
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum FingerprintAlgorithm {
    #[serde(rename = "rdkitMorganBit.v1")]
    RdkitMorganBitV1,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FingerprintSettings {
    pub algorithm: FingerprintAlgorithm,
    pub rdkit_version: RdkitBaselineVersion,
    pub radius: u8,
    pub bit_count: u16,
    pub use_chirality: bool,
    pub use_features: bool,
    pub sanitize: bool,
    pub input_order: FingerprintInputOrder,
}

impl FingerprintSettings {
    fn validate(&self) -> Result<(), ProtocolError> {
        if self.algorithm != FingerprintAlgorithm::RdkitMorganBitV1
            || self.rdkit_version != RdkitBaselineVersion::V2025_03_4
            || self.radius != 2
            || self.bit_count != 2_048
            || !self.use_chirality
            || self.use_features
            || !self.sanitize
            || self.input_order != FingerprintInputOrder::SourceRecord
        {
            return Err(ProtocolError::Validation(
                "cluster.v1 requires the RDKit 2025.03.4 Morgan radius=2, bitCount=2048, useChirality=true, useFeatures=false, sanitize=true, source-record-order baseline".into(),
            ));
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum RdkitBaselineVersion {
    #[serde(rename = "2025.03.4")]
    V2025_03_4,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum FingerprintInputOrder {
    SourceRecord,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SimilaritySettings {
    pub cutoff: SimilarityCutoff,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SimilarityCutoff {
    pub numerator: u32,
    pub denominator: u32,
}

impl SimilarityCutoff {
    pub fn validate(&self) -> Result<(), ProtocolError> {
        if self.denominator == 0 || self.numerator > self.denominator {
            return Err(ProtocolError::Validation(
                "similarity cutoff must satisfy 0 <= numerator <= denominator and denominator > 0"
                    .into(),
            ));
        }
        Ok(())
    }

    pub fn normalized(self) -> Result<Self, ProtocolError> {
        self.validate()?;
        let divisor = greatest_common_divisor(self.numerator, self.denominator);
        Ok(Self {
            numerator: self.numerator / divisor,
            denominator: self.denominator / divisor,
        })
    }

    pub fn matches_counts(self, intersection: u64, union: u64) -> Result<bool, ProtocolError> {
        let cutoff = self.normalized()?;
        if intersection > union {
            return Err(ProtocolError::Validation(
                "fingerprint intersection cannot exceed union".into(),
            ));
        }
        if union == 0 {
            return Ok(cutoff.numerator == 0);
        }
        Ok(u128::from(intersection) * u128::from(cutoff.denominator)
            >= u128::from(union) * u128::from(cutoff.numerator))
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum RepresentativePolicy {
    #[serde(rename = "butinaMaxNeighbors.v1")]
    ButinaMaxNeighborsV1,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExecutionPolicy {
    pub backend_policy: BackendPolicy,
    pub scheduling_policy: SchedulingPolicy,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum BackendPolicy {
    GpuRequired,
    GpuPreferred,
    ReferenceCpu,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SchedulingPolicy {
    Interactive,
    Balanced,
    Throughput,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResourceLimits {
    pub max_edges: u64,
    pub max_memory_bytes: u64,
    pub max_dispatch_ms: u32,
}

impl ResourceLimits {
    pub fn validate(&self) -> Result<(), ProtocolError> {
        if self.max_edges == 0 || self.max_edges > MAX_EDGE_BUDGET {
            return Err(ProtocolError::Validation(format!(
                "maxEdges must be in 1..={MAX_EDGE_BUDGET}"
            )));
        }
        if !(MIN_MEMORY_BYTES..=MAX_MEMORY_BYTES).contains(&self.max_memory_bytes) {
            return Err(ProtocolError::Validation(format!(
                "maxMemoryBytes must be in {MIN_MEMORY_BYTES}..={MAX_MEMORY_BYTES}"
            )));
        }
        if self.max_dispatch_ms == 0 || self.max_dispatch_ms > MAX_DISPATCH_MS {
            return Err(ProtocolError::Validation(format!(
                "maxDispatchMs must be in 1..={MAX_DISPATCH_MS}"
            )));
        }
        Ok(())
    }
}

fn validate_filter_id(value: &str) -> Result<(), ProtocolError> {
    validate_bounded_text("filter id", value, MAX_FILTER_ID_BYTES)
}

fn validate_numeric_bounds(
    label: &str,
    min: Option<f64>,
    max: Option<f64>,
) -> Result<(), ProtocolError> {
    if min.is_none() && max.is_none() {
        return Err(ProtocolError::Validation(format!(
            "{label} requires min or max"
        )));
    }
    if min.is_some_and(|value| !value.is_finite()) || max.is_some_and(|value| !value.is_finite()) {
        return Err(ProtocolError::Validation(format!(
            "{label} bounds must be finite"
        )));
    }
    if matches!((min, max), (Some(minimum), Some(maximum)) if minimum > maximum) {
        return Err(ProtocolError::Validation(format!(
            "{label} minimum exceeds maximum"
        )));
    }
    Ok(())
}

fn greatest_common_divisor(mut left: u32, mut right: u32) -> u32 {
    while right != 0 {
        let remainder = left % right;
        left = right;
        right = remainder;
    }
    left.max(1)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn valid_request() -> ClusterV1SubmitRequest {
        ClusterV1SubmitRequest {
            schema_version: ComputeJobSchemaVersion::V1,
            workflow_template: WorkflowTemplateId::ClusterV1,
            source: GridSourceReference {
                document_id: "document-1".into(),
                scope: GridScope::All(AllGridScope {}),
            },
            parameters: ClusterV1Parameters {
                fingerprint: FingerprintSettings {
                    algorithm: FingerprintAlgorithm::RdkitMorganBitV1,
                    rdkit_version: RdkitBaselineVersion::V2025_03_4,
                    radius: 2,
                    bit_count: 2_048,
                    use_chirality: true,
                    use_features: false,
                    sanitize: true,
                    input_order: FingerprintInputOrder::SourceRecord,
                },
                similarity: SimilaritySettings {
                    cutoff: SimilarityCutoff {
                        numerator: 7,
                        denominator: 10,
                    },
                },
                representative_policy: RepresentativePolicy::ButinaMaxNeighborsV1,
            },
            execution_policy: ExecutionPolicy {
                backend_policy: BackendPolicy::GpuRequired,
                scheduling_policy: SchedulingPolicy::Balanced,
            },
            limits: ResourceLimits {
                max_edges: 1_000_000,
                max_memory_bytes: 512 * 1024 * 1024,
                max_dispatch_ms: 250,
            },
        }
    }

    #[test]
    fn validates_fixed_cluster_contract() {
        assert_eq!(valid_request().validate(), Ok(()));
        let mut changed = valid_request();
        changed.parameters.fingerprint.radius = 3;
        assert!(changed.validate().is_err());
    }

    #[test]
    fn rejects_arbitrary_request_fields() {
        let mut value = serde_json::to_value(valid_request()).expect("serialize request");
        value["stages"] = serde_json::json!([]);
        assert!(serde_json::from_value::<ClusterV1SubmitRequest>(value).is_err());
    }

    #[test]
    fn compares_similarity_at_exact_rational_boundary() {
        let cutoff = SimilarityCutoff {
            numerator: 7,
            denominator: 10,
        };
        assert!(cutoff.matches_counts(7, 10).expect("compare boundary"));
        assert!(!cutoff.matches_counts(699, 1_000).expect("compare below"));
        assert!(!cutoff.matches_counts(0, 0).expect("compare empty"));
        assert!(SimilarityCutoff {
            numerator: 0,
            denominator: 1,
        }
        .matches_counts(0, 0)
        .expect("compare empty at zero cutoff"));
        assert!(cutoff.matches_counts(2, 1).is_err());
    }

    #[test]
    fn normalizes_selected_scope_bounds() {
        let selected = GridScope::Selected(SelectedGridScope {
            source_indexes: vec![2, 2, 7],
        });
        assert!(selected.validate().is_err());
        assert_eq!(
            selected.normalized().expect("normalize selected"),
            GridScope::Selected(SelectedGridScope {
                source_indexes: vec![2, 7]
            })
        );
        assert!(GridScope::Selected(SelectedGridScope {
            source_indexes: Vec::new()
        })
        .validate()
        .is_err());
    }

    #[test]
    fn rejects_fields_from_another_scope_variant() {
        let value = serde_json::json!({"kind": "all", "sourceIndexes": [2]});
        assert!(serde_json::from_value::<GridScope>(value).is_err());
    }
}
