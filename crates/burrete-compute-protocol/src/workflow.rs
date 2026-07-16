use std::collections::BTreeSet;

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    validation::{canonical_json_bytes, sha256_hex, validate_bounded_text},
    ProtocolError,
};

const MAX_DOCUMENT_ID_BYTES: usize = 256;
const MAX_SELECTED_ROWS: usize = 65_536;
const MAX_FILTERS: usize = 64;
const MAX_QUERY_BYTES: usize = 4_096;
const MAX_FILTER_ID_BYTES: usize = 160;
const MAX_FILTER_TEXT_BYTES: usize = 4_096;
pub const MIN_COMPUTE_MEMORY_BYTES: u64 = 16 * 1024 * 1024;
pub const MAX_COMPUTE_MEMORY_BYTES: u64 = 32 * 1024 * 1024 * 1024;
pub const MAX_UNDIRECTED_SIMILARITY_EDGES: u64 = 500_000_000;
const MAX_DISPATCH_MS: u32 = 2_000;
pub const MAX_CONFORMERS_PER_MOLECULE: u32 = 4_096;
pub const MAX_CONFORMER_ATTEMPTS: u16 = 64;
pub const MAX_CONFORMERS_PER_BATCH: u32 = 65_536;
const MAX_SAFE_JSON_INTEGER: u64 = 9_007_199_254_740_991;

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum ComputeJobSchemaVersion {
    #[serde(rename = "burrete.compute-job.v1")]
    V1,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum WorkflowTemplateId {
    #[serde(rename = "alignment.v1")]
    AlignmentV1,
    #[serde(rename = "cluster.v1")]
    ClusterV1,
    #[serde(rename = "conformer.v1")]
    ConformerV1,
    #[serde(rename = "similaritySearch.v1")]
    SimilaritySearchV1,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
pub enum ConformerVariant {
    #[serde(rename = "DG")]
    Dg,
    #[serde(rename = "KDG")]
    Kdg,
    #[serde(rename = "ETDG")]
    Etdg,
    #[serde(rename = "ETDGv2")]
    EtdgV2,
    #[serde(rename = "ETKDG")]
    Etkdg,
    #[serde(rename = "ETKDGv2")]
    EtkdgV2,
    #[serde(rename = "ETKDGv3")]
    EtkdgV3,
    #[serde(rename = "srETKDGv3")]
    SrEtkdgV3,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
pub enum MmffVariant {
    #[serde(rename = "MMFF94")]
    Mmff94,
    #[serde(rename = "MMFF94s")]
    Mmff94s,
}

impl MmffVariant {
    pub const fn wire_id(self) -> &'static str {
        match self {
            Self::Mmff94 => "MMFF94",
            Self::Mmff94s => "MMFF94s",
        }
    }
}

impl ConformerVariant {
    pub const ALL: [Self; 8] = [
        Self::Dg,
        Self::Kdg,
        Self::Etdg,
        Self::EtdgV2,
        Self::Etkdg,
        Self::EtkdgV2,
        Self::EtkdgV3,
        Self::SrEtkdgV3,
    ];

    pub const fn wire_id(self) -> &'static str {
        match self {
            Self::Dg => "DG",
            Self::Kdg => "KDG",
            Self::Etdg => "ETDG",
            Self::EtdgV2 => "ETDGv2",
            Self::Etkdg => "ETKDG",
            Self::EtkdgV2 => "ETKDGv2",
            Self::EtkdgV3 => "ETKDGv3",
            Self::SrEtkdgV3 => "srETKDGv3",
        }
    }
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

    /// Serializes the normalized request using RFC 8785 JSON Canonicalization Scheme.
    pub fn canonical_json_bytes(&self) -> Result<Vec<u8>, ProtocolError> {
        canonical_json_bytes(&self.clone().normalized()?)
    }

    /// Hashes the canonical normalized request bytes used by durable job records.
    pub fn canonical_sha256(&self) -> Result<String, ProtocolError> {
        self.canonical_json_bytes().map(|bytes| sha256_hex(&bytes))
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConformerV1SubmitRequest {
    pub schema_version: ComputeJobSchemaVersion,
    pub workflow_template: WorkflowTemplateId,
    pub source: GridSourceReference,
    pub parameters: ConformerV1Parameters,
    pub execution_policy: ExecutionPolicy,
    pub limits: ConformerResourceLimits,
}

impl ConformerV1SubmitRequest {
    pub fn validate(&self) -> Result<(), ProtocolError> {
        if self.schema_version != ComputeJobSchemaVersion::V1
            || self.workflow_template != WorkflowTemplateId::ConformerV1
        {
            return Err(ProtocolError::Validation(
                "conformer request has an incompatible schema or workflow template".into(),
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

    pub fn normalized(mut self) -> Result<Self, ProtocolError> {
        self.source.scope = self.source.scope.normalized()?;
        self.validate()?;
        Ok(self)
    }

    pub fn canonical_json_bytes(&self) -> Result<Vec<u8>, ProtocolError> {
        canonical_json_bytes(&self.clone().normalized()?)
    }

    pub fn canonical_sha256(&self) -> Result<String, ProtocolError> {
        self.canonical_json_bytes().map(|bytes| sha256_hex(&bytes))
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(untagged)]
pub enum ComputeSubmitRequest {
    ClusterV1(ClusterV1SubmitRequest),
    ConformerV1(ConformerV1SubmitRequest),
}

impl ComputeSubmitRequest {
    pub fn validate(&self) -> Result<(), ProtocolError> {
        match self {
            Self::ClusterV1(request) => request.validate(),
            Self::ConformerV1(request) => request.validate(),
        }
    }

    pub fn normalized(self) -> Result<Self, ProtocolError> {
        match self {
            Self::ClusterV1(request) => request.normalized().map(Self::ClusterV1),
            Self::ConformerV1(request) => request.normalized().map(Self::ConformerV1),
        }
    }

    pub fn canonical_json_bytes(&self) -> Result<Vec<u8>, ProtocolError> {
        match self {
            Self::ClusterV1(request) => request.canonical_json_bytes(),
            Self::ConformerV1(request) => request.canonical_json_bytes(),
        }
    }

    pub fn canonical_sha256(&self) -> Result<String, ProtocolError> {
        self.canonical_json_bytes().map(|bytes| sha256_hex(&bytes))
    }

    pub const fn workflow_template(&self) -> WorkflowTemplateId {
        match self {
            Self::ClusterV1(request) => request.workflow_template,
            Self::ConformerV1(request) => request.workflow_template,
        }
    }

    pub const fn backend_policy(&self) -> BackendPolicy {
        match self {
            Self::ClusterV1(request) => request.execution_policy.backend_policy,
            Self::ConformerV1(request) => request.execution_policy.backend_policy,
        }
    }

    pub const fn source(&self) -> &GridSourceReference {
        match self {
            Self::ClusterV1(request) => &request.source,
            Self::ConformerV1(request) => &request.source,
        }
    }

    pub fn as_cluster(&self) -> Result<&ClusterV1SubmitRequest, ProtocolError> {
        match self {
            Self::ClusterV1(request) => Ok(request),
            Self::ConformerV1(_) => Err(ProtocolError::Validation(
                "cluster operation received a conformer request".into(),
            )),
        }
    }

    pub fn as_conformer(&self) -> Result<&ConformerV1SubmitRequest, ProtocolError> {
        match self {
            Self::ConformerV1(request) => Ok(request),
            Self::ClusterV1(_) => Err(ProtocolError::Validation(
                "conformer operation received a cluster request".into(),
            )),
        }
    }
}

impl From<ClusterV1SubmitRequest> for ComputeSubmitRequest {
    fn from(request: ClusterV1SubmitRequest) -> Self {
        Self::ClusterV1(request)
    }
}

impl From<ConformerV1SubmitRequest> for ComputeSubmitRequest {
    fn from(request: ConformerV1SubmitRequest) -> Self {
        Self::ConformerV1(request)
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
            query,
            column_filters,
            descriptor_filters,
            analysis_filters,
        }) = &mut self
        {
            let filter_count =
                column_filters.len() + descriptor_filters.len() + analysis_filters.len();
            if filter_count > MAX_FILTERS {
                return Err(ProtocolError::Validation(format!(
                    "filtered scope has {filter_count} filters; limit is {MAX_FILTERS}"
                )));
            }
            query.validate()?;
            let GridTextQuery::Text { text } = query;
            *text = normalize_like_text(text);
            for filter in column_filters.iter_mut() {
                filter.validate()?;
                normalize_signed_zero(&mut filter.min);
                normalize_signed_zero(&mut filter.max);
                if filter.filter_type == ColumnFilterKind::Text {
                    let text = filter
                        .text
                        .as_mut()
                        .expect("validated text filter contains text");
                    *text = normalize_like_text(text);
                }
            }
            for filter in descriptor_filters.iter_mut() {
                filter.validate("descriptor filter")?;
                normalize_signed_zero(&mut filter.min);
                normalize_signed_zero(&mut filter.max);
            }
            for filter in analysis_filters.iter_mut() {
                filter.validate("analysis filter")?;
                normalize_signed_zero(&mut filter.min);
                normalize_signed_zero(&mut filter.max);
            }
            column_filters.sort_by(|left, right| left.id.cmp(&right.id));
            descriptor_filters.sort_by(|left, right| left.id.cmp(&right.id));
            merge_descriptor_filter_intersections(descriptor_filters);
            analysis_filters.sort_by(|left, right| {
                (left.run_id, left.value_id.as_str()).cmp(&(right.run_id, right.value_id.as_str()))
            });
            merge_analysis_filter_intersections(analysis_filters);
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
                let text = self.text.as_deref().ok_or_else(|| {
                    ProtocolError::Validation("text column filter requires text".into())
                })?;
                validate_bounded_text("column filter text", text, MAX_FILTER_TEXT_BYTES)?;
                if normalize_like_text(text).is_empty() {
                    return Err(ProtocolError::Validation(
                        "text column filter requires non-whitespace text".into(),
                    ));
                }
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
        if self.run_id.is_nil() {
            return Err(ProtocolError::Validation(
                "analysis filter runId must be a non-nil UUID".into(),
            ));
        }
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

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConformerV1Parameters {
    pub variant: ConformerVariant,
    pub mmff_variant: MmffVariant,
    pub conformers_per_molecule: u32,
    pub max_attempts_per_conformer: u16,
}

impl ConformerV1Parameters {
    fn validate(&self) -> Result<(), ProtocolError> {
        if self.conformers_per_molecule == 0
            || self.conformers_per_molecule > MAX_CONFORMERS_PER_MOLECULE
        {
            return Err(ProtocolError::Validation(format!(
                "conformersPerMolecule must be in 1..={MAX_CONFORMERS_PER_MOLECULE}"
            )));
        }
        if self.max_attempts_per_conformer == 0
            || self.max_attempts_per_conformer > MAX_CONFORMER_ATTEMPTS
        {
            return Err(ProtocolError::Validation(format!(
                "maxAttemptsPerConformer must be in 1..={MAX_CONFORMER_ATTEMPTS}"
            )));
        }
        Ok(())
    }
}

impl ClusterV1Parameters {
    fn validate(&self) -> Result<(), ProtocolError> {
        self.fingerprint.validate()?;
        self.similarity.cutoff.validate()?;
        if self.representative_policy != RepresentativePolicy::ButinaMaxNeighborsV1 {
            return Err(ProtocolError::Validation(
                "cluster.v1 requires the Butina representative policy".into(),
            ));
        }
        Ok(())
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

    pub fn canonical_sha256(&self) -> Result<String, ProtocolError> {
        self.validate()?;
        canonical_json_bytes(self).map(|bytes| sha256_hex(&bytes))
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
    #[serde(rename = "notApplicable")]
    NotApplicable,
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
    /// Maximum qualifying unordered record pairs. Each `{i, j}` pair counts
    /// once even though the symmetric CSR stores both directed entries.
    pub max_edges: u64,
    pub max_memory_bytes: u64,
    pub max_dispatch_ms: u32,
}

impl ResourceLimits {
    pub fn validate(&self) -> Result<(), ProtocolError> {
        if self.max_edges == 0 || self.max_edges > MAX_UNDIRECTED_SIMILARITY_EDGES {
            return Err(ProtocolError::Validation(format!(
                "maxEdges counts undirected similarity edges and must be in 1..={MAX_UNDIRECTED_SIMILARITY_EDGES}"
            )));
        }
        if !(MIN_COMPUTE_MEMORY_BYTES..=MAX_COMPUTE_MEMORY_BYTES).contains(&self.max_memory_bytes) {
            return Err(ProtocolError::Validation(format!(
                "maxMemoryBytes must be in {MIN_COMPUTE_MEMORY_BYTES}..={MAX_COMPUTE_MEMORY_BYTES}"
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

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConformerResourceLimits {
    pub max_memory_bytes: u64,
    pub max_dispatch_ms: u32,
    pub max_conformers_per_batch: u32,
}

impl ConformerResourceLimits {
    pub fn validate(&self) -> Result<(), ProtocolError> {
        if !(MIN_COMPUTE_MEMORY_BYTES..=MAX_COMPUTE_MEMORY_BYTES).contains(&self.max_memory_bytes) {
            return Err(ProtocolError::Validation(format!(
                "maxMemoryBytes must be in {MIN_COMPUTE_MEMORY_BYTES}..={MAX_COMPUTE_MEMORY_BYTES}"
            )));
        }
        if self.max_dispatch_ms == 0 || self.max_dispatch_ms > MAX_DISPATCH_MS {
            return Err(ProtocolError::Validation(format!(
                "maxDispatchMs must be in 1..={MAX_DISPATCH_MS}"
            )));
        }
        if self.max_conformers_per_batch == 0
            || self.max_conformers_per_batch > MAX_CONFORMERS_PER_BATCH
        {
            return Err(ProtocolError::Validation(format!(
                "maxConformersPerBatch must be in 1..={MAX_CONFORMERS_PER_BATCH}"
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

fn normalize_signed_zero(value: &mut Option<f64>) {
    if value.is_some_and(|bound| bound == 0.0) {
        *value = Some(0.0);
    }
}

fn normalize_like_text(value: &str) -> String {
    value
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

fn merge_descriptor_filter_intersections(filters: &mut Vec<DescriptorFilter>) {
    let mut merged: Vec<DescriptorFilter> = Vec::with_capacity(filters.len());
    for filter in filters.drain(..) {
        if let Some(previous) = merged
            .last_mut()
            .filter(|previous| previous.id == filter.id)
        {
            previous.min = maximum_bound(previous.min, filter.min);
            previous.max = minimum_bound(previous.max, filter.max);
        } else {
            merged.push(filter);
        }
    }
    *filters = merged;
}

fn merge_analysis_filter_intersections(filters: &mut Vec<AnalysisFilter>) {
    let mut merged: Vec<AnalysisFilter> = Vec::with_capacity(filters.len());
    for filter in filters.drain(..) {
        if let Some(previous) = merged.last_mut().filter(|previous| {
            previous.run_id == filter.run_id && previous.value_id == filter.value_id
        }) {
            previous.min = maximum_bound(previous.min, filter.min);
            previous.max = minimum_bound(previous.max, filter.max);
        } else {
            merged.push(filter);
        }
    }
    *filters = merged;
}

fn maximum_bound(left: Option<f64>, right: Option<f64>) -> Option<f64> {
    match (left, right) {
        (Some(left), Some(right)) => Some(left.max(right)),
        (Some(value), None) | (None, Some(value)) => Some(value),
        (None, None) => None,
    }
}

fn minimum_bound(left: Option<f64>, right: Option<f64>) -> Option<f64> {
    match (left, right) {
        (Some(left), Some(right)) => Some(left.min(right)),
        (Some(value), None) | (None, Some(value)) => Some(value),
        (None, None) => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn similarity_search_analysis_workflow_has_a_stable_wire_id() {
        assert_eq!(
            serde_json::to_string(&WorkflowTemplateId::SimilaritySearchV1)
                .expect("serialize similarity workflow ID"),
            "\"similaritySearch.v1\""
        );
    }

    #[test]
    fn conformer_workflow_has_a_stable_wire_id() {
        assert_eq!(
            serde_json::to_string(&WorkflowTemplateId::ConformerV1)
                .expect("serialize conformer workflow ID"),
            "\"conformer.v1\""
        );
    }

    #[test]
    fn all_conformer_variants_have_stable_unique_wire_ids() {
        let encoded = ConformerVariant::ALL
            .into_iter()
            .map(|variant| {
                let json = serde_json::to_string(&variant).expect("serialize conformer variant");
                assert_eq!(json, format!("\"{}\"", variant.wire_id()));
                json
            })
            .collect::<BTreeSet<_>>();
        assert_eq!(encoded.len(), ConformerVariant::ALL.len());
    }

    fn valid_conformer_request() -> ConformerV1SubmitRequest {
        ConformerV1SubmitRequest {
            schema_version: ComputeJobSchemaVersion::V1,
            workflow_template: WorkflowTemplateId::ConformerV1,
            source: GridSourceReference {
                document_id: "document-1".into(),
                scope: GridScope::Selected(SelectedGridScope {
                    source_indexes: vec![7, 2, 7],
                }),
            },
            parameters: ConformerV1Parameters {
                variant: ConformerVariant::EtkdgV3,
                mmff_variant: MmffVariant::Mmff94s,
                conformers_per_molecule: 32,
                max_attempts_per_conformer: 8,
            },
            execution_policy: ExecutionPolicy {
                backend_policy: BackendPolicy::GpuPreferred,
                scheduling_policy: SchedulingPolicy::Balanced,
            },
            limits: ConformerResourceLimits {
                max_memory_bytes: 512 * 1024 * 1024,
                max_dispatch_ms: 250,
                max_conformers_per_batch: 2_048,
            },
        }
    }

    #[test]
    fn conformer_request_is_bounded_normalized_and_hashable() {
        let request = valid_conformer_request();
        let normalized = request.clone().normalized().expect("normalize request");
        assert_eq!(
            normalized.source.scope,
            GridScope::Selected(SelectedGridScope {
                source_indexes: vec![2, 7]
            })
        );
        assert_eq!(
            request.canonical_sha256().expect("hash request"),
            normalized
                .canonical_sha256()
                .expect("hash normalized request")
        );

        let mut invalid = normalized.clone();
        invalid.parameters.conformers_per_molecule = 0;
        assert!(invalid.validate().is_err());
        invalid = normalized.clone();
        invalid.parameters.max_attempts_per_conformer = MAX_CONFORMER_ATTEMPTS + 1;
        assert!(invalid.validate().is_err());
        invalid = normalized;
        invalid.limits.max_conformers_per_batch = MAX_CONFORMERS_PER_BATCH + 1;
        assert!(invalid.validate().is_err());
    }

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
    fn max_edges_is_a_bounded_undirected_similarity_edge_count() {
        let mut request = valid_request();
        request.limits.max_edges = MAX_UNDIRECTED_SIMILARITY_EDGES;
        assert_eq!(request.validate(), Ok(()));

        request.limits.max_edges = MAX_UNDIRECTED_SIMILARITY_EDGES + 1;
        let error = request.validate().expect_err("edge budget above maximum");
        assert!(error.to_string().contains("undirected similarity edges"));
    }

    #[test]
    fn canonical_request_bytes_and_hash_are_pinned() {
        let mut request = valid_request();
        request.source.scope = GridScope::Selected(SelectedGridScope {
            source_indexes: vec![7, 2, 7],
        });
        request.parameters.similarity.cutoff = SimilarityCutoff {
            numerator: 14,
            denominator: 20,
        };
        let declaration_order_json = concat!(
            r#"{"schemaVersion":"burrete.compute-job.v1","workflowTemplate":"cluster.v1","source":{"documentId":"document-1","scope":{"kind":"selected","sourceIndexes":[2,7]}},"#,
            r#""parameters":{"fingerprint":{"algorithm":"rdkitMorganBit.v1","rdkitVersion":"2025.03.4","radius":2,"bitCount":2048,"useChirality":true,"useFeatures":false,"sanitize":true,"inputOrder":"sourceRecord"},"#,
            r#""similarity":{"cutoff":{"numerator":7,"denominator":10}},"representativePolicy":"butinaMaxNeighbors.v1"},"#,
            r#""executionPolicy":{"backendPolicy":"gpuRequired","schedulingPolicy":"balanced"},"#,
            r#""limits":{"maxEdges":1000000,"maxMemoryBytes":536870912,"maxDispatchMs":250}}"#,
        )
        .as_bytes();

        assert_ne!(
            request.canonical_json_bytes().expect("canonical request"),
            declaration_order_json
        );
        assert_eq!(
            request.canonical_sha256().expect("request hash"),
            "e9ac23cb9b124ece406aee5619cf49112de538f4fdf6d2f2217387df1ab202af"
        );
    }

    #[test]
    fn canonical_request_normalizes_signed_zero_filter_bounds() {
        let filtered_request = |zero| {
            let mut request = valid_request();
            request.source.scope = GridScope::Filtered(FilteredGridScope {
                query: GridTextQuery::Text {
                    text: "caffeine".into(),
                },
                column_filters: vec![
                    ColumnFilter {
                        id: "name".into(),
                        filter_type: ColumnFilterKind::Text,
                        text: Some("methyl".into()),
                        min: None,
                        max: None,
                    },
                    ColumnFilter {
                        id: "mass".into(),
                        filter_type: ColumnFilterKind::Number,
                        text: None,
                        min: Some(zero),
                        max: Some(500.0),
                    },
                ],
                descriptor_filters: vec![
                    DescriptorFilter {
                        id: "logP".into(),
                        min: Some(zero),
                        max: None,
                    },
                    DescriptorFilter {
                        id: "hbd".into(),
                        min: Some(1.0),
                        max: None,
                    },
                ],
                analysis_filters: vec![
                    AnalysisFilter {
                        run_id: Uuid::from_u128(7),
                        value_id: "clusterScore".into(),
                        min: None,
                        max: Some(zero),
                    },
                    AnalysisFilter {
                        run_id: Uuid::from_u128(6),
                        value_id: "representative".into(),
                        min: Some(1.0),
                        max: None,
                    },
                ],
            });
            request
        };
        let mut negative = filtered_request(-0.0);
        let GridScope::Filtered(scope) = &mut negative.source.scope else {
            unreachable!("test creates a filtered scope")
        };
        scope.column_filters.reverse();
        scope.descriptor_filters.reverse();
        scope.analysis_filters.reverse();
        let positive = filtered_request(0.0);
        let positive_hash = positive.canonical_sha256().expect("positive zero hash");

        assert_eq!(
            negative.canonical_sha256().expect("negative zero hash"),
            positive_hash
        );
        assert_eq!(
            positive_hash,
            "abc35f1fd431bf053362f15ed63e7125e8f573f2762f92e40454afaf02341c9b"
        );
        assert!(
            !String::from_utf8(negative.canonical_json_bytes().expect("canonical request"))
                .expect("JSON is UTF-8")
                .contains("-0.0")
        );
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

    #[test]
    fn rejects_nil_analysis_run_id() {
        let filter = AnalysisFilter {
            run_id: Uuid::nil(),
            value_id: "clusterId".into(),
            min: Some(0.0),
            max: None,
        };

        assert!(filter.validate("analysis filter").is_err());
    }

    #[test]
    fn canonical_scope_intersects_duplicate_descriptor_and_analysis_filters() {
        let run_id = Uuid::from_u128(7);
        let scope = GridScope::Filtered(FilteredGridScope {
            query: GridTextQuery::Text {
                text: String::new(),
            },
            column_filters: Vec::new(),
            descriptor_filters: vec![
                DescriptorFilter {
                    id: "MW".into(),
                    min: Some(40.0),
                    max: None,
                },
                DescriptorFilter {
                    id: "MW".into(),
                    min: None,
                    max: Some(80.0),
                },
            ],
            analysis_filters: vec![
                AnalysisFilter {
                    run_id,
                    value_id: "clusterScore".into(),
                    min: Some(0.25),
                    max: None,
                },
                AnalysisFilter {
                    run_id,
                    value_id: "clusterScore".into(),
                    min: None,
                    max: Some(0.75),
                },
            ],
        });

        let GridScope::Filtered(normalized) = scope.normalized().expect("normalize filters") else {
            unreachable!("test creates a filtered scope")
        };
        assert_eq!(
            normalized.descriptor_filters,
            vec![DescriptorFilter {
                id: "MW".into(),
                min: Some(40.0),
                max: Some(80.0),
            }]
        );
        assert_eq!(
            normalized.analysis_filters,
            vec![AnalysisFilter {
                run_id,
                value_id: "clusterScore".into(),
                min: Some(0.25),
                max: Some(0.75),
            }]
        );
    }

    #[test]
    fn normalization_rejects_invalid_raw_filters_before_intersection() {
        let descriptor_scope = GridScope::Filtered(FilteredGridScope {
            query: GridTextQuery::Text {
                text: String::new(),
            },
            column_filters: Vec::new(),
            descriptor_filters: vec![
                DescriptorFilter {
                    id: "MW".into(),
                    min: Some(f64::NAN),
                    max: None,
                },
                DescriptorFilter {
                    id: "MW".into(),
                    min: Some(40.0),
                    max: None,
                },
            ],
            analysis_filters: Vec::new(),
        });
        assert!(descriptor_scope.normalized().is_err());

        let run_id = Uuid::from_u128(7);
        let analysis_scope = GridScope::Filtered(FilteredGridScope {
            query: GridTextQuery::Text {
                text: String::new(),
            },
            column_filters: Vec::new(),
            descriptor_filters: Vec::new(),
            analysis_filters: vec![
                AnalysisFilter {
                    run_id,
                    value_id: "clusterScore".into(),
                    min: None,
                    max: None,
                },
                AnalysisFilter {
                    run_id,
                    value_id: "clusterScore".into(),
                    min: Some(0.25),
                    max: None,
                },
            ],
        });
        assert!(analysis_scope.normalized().is_err());
    }

    #[test]
    fn canonical_scope_normalizes_like_text_and_rejects_blank_filters() {
        for text in [None, Some("   \n  ")] {
            let filter = ColumnFilter {
                id: "name".into(),
                filter_type: ColumnFilterKind::Text,
                text: text.map(str::to_string),
                min: None,
                max: None,
            };
            assert!(filter.validate().is_err());
        }

        let scope = GridScope::Filtered(FilteredGridScope {
            query: GridTextQuery::Text {
                text: "  ALPHA \n BETA  ".into(),
            },
            column_filters: vec![ColumnFilter {
                id: "name".into(),
                filter_type: ColumnFilterKind::Text,
                text: Some("  BENZ   ENE  ".into()),
                min: None,
                max: None,
            }],
            descriptor_filters: Vec::new(),
            analysis_filters: Vec::new(),
        });
        let GridScope::Filtered(normalized) = scope.normalized().expect("normalize LIKE text")
        else {
            unreachable!("test creates a filtered scope")
        };
        assert_eq!(
            normalized.query,
            GridTextQuery::Text {
                text: "alpha beta".into()
            }
        );
        assert_eq!(
            normalized.column_filters[0].text.as_deref(),
            Some("benz ene")
        );
    }
}
