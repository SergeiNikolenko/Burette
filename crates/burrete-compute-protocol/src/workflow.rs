use serde::{Deserialize, Serialize};

use crate::ProtocolError;

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
        validate_bounded_text(
            "documentId",
            &self.source.document_id,
            MAX_DOCUMENT_ID_BYTES,
        )?;
        self.source.scope.validate()?;
        self.parameters.validate()?;
        self.limits.validate()
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
    Selected {
        #[serde(rename = "sourceIndexes")]
        source_indexes: Vec<u64>,
    },
    Filtered {
        query: GridTextQuery,
        #[serde(default, rename = "columnFilters")]
        column_filters: Vec<ColumnFilter>,
        #[serde(default, rename = "descriptorFilters")]
        descriptor_filters: Vec<DescriptorFilter>,
        #[serde(default, rename = "analysisFilters")]
        analysis_filters: Vec<AnalysisFilter>,
    },
    All,
}

impl GridScope {
    pub fn validate(&self) -> Result<(), ProtocolError> {
        match self {
            Self::Selected { source_indexes } => {
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
            }
            Self::Filtered {
                query,
                column_filters,
                descriptor_filters,
                analysis_filters,
            } => {
                query.validate()?;
                let filter_count =
                    column_filters.len() + descriptor_filters.len() + analysis_filters.len();
                if filter_count > MAX_FILTERS {
                    return Err(ProtocolError::Validation(format!(
                        "filtered scope has {filter_count} filters; limit is {MAX_FILTERS}"
                    )));
                }
                for filter in column_filters {
                    filter.validate()?;
                }
                for filter in descriptor_filters {
                    filter.validate("descriptor filter")?;
                }
                for filter in analysis_filters {
                    filter.validate("analysis filter")?;
                }
            }
            Self::All => {}
        }
        Ok(())
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

pub type AnalysisFilter = DescriptorFilter;

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
    pub radius: u8,
    pub bit_count: u16,
    pub use_chirality: bool,
    pub use_features: bool,
}

impl FingerprintSettings {
    fn validate(&self) -> Result<(), ProtocolError> {
        if self.radius != 2 || self.bit_count != 2_048 || !self.use_chirality || self.use_features {
            return Err(ProtocolError::Validation(
                "cluster.v1 requires the RDKit Morgan radius=2, bitCount=2048, useChirality=true, useFeatures=false baseline".into(),
            ));
        }
        Ok(())
    }
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
        if union == 0 {
            return Ok(true);
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
    fn validate(&self) -> Result<(), ProtocolError> {
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

fn validate_bounded_text(label: &str, value: &str, max: usize) -> Result<(), ProtocolError> {
    if value.is_empty() || value.len() > max {
        return Err(ProtocolError::Validation(format!(
            "{label} must contain 1..={max} bytes"
        )));
    }
    Ok(())
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
                scope: GridScope::All,
            },
            parameters: ClusterV1Parameters {
                fingerprint: FingerprintSettings {
                    algorithm: FingerprintAlgorithm::RdkitMorganBitV1,
                    radius: 2,
                    bit_count: 2_048,
                    use_chirality: true,
                    use_features: false,
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
        assert!(cutoff.matches_counts(0, 0).expect("compare empty"));
    }

    #[test]
    fn normalizes_selected_scope_bounds() {
        let selected = GridScope::Selected {
            source_indexes: vec![2, 2, 7],
        };
        assert_eq!(selected.validate(), Ok(()));
        assert!(GridScope::Selected {
            source_indexes: Vec::new()
        }
        .validate()
        .is_err());
    }
}
