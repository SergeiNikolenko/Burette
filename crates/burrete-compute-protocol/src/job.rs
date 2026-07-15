use serde::{Deserialize, Serialize};

use crate::{BackendPolicy, ProtocolError};

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum OwnerSurface {
    Desktop,
    DesktopAgent,
    BrowserDev,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum JobState {
    Queued,
    Preparing,
    WaitingGpu,
    Running,
    Validating,
    Publishing,
    CancelRequested,
    Cancelled,
    Failed,
    Interrupted,
    Succeeded,
    SucceededWithFailures,
}

impl JobState {
    pub fn can_transition_to(self, next: Self) -> bool {
        use JobState::*;
        matches!(
            (self, next),
            (
                Queued,
                Preparing | CancelRequested | Cancelled | Failed | Interrupted
            ) | (
                Preparing,
                WaitingGpu | Running | CancelRequested | Failed | Interrupted
            ) | (WaitingGpu, Running | CancelRequested | Failed | Interrupted)
                | (Running, Validating | CancelRequested | Failed | Interrupted)
                | (
                    Validating,
                    Publishing | CancelRequested | Failed | Interrupted
                )
                | (
                    Publishing,
                    Succeeded | SucceededWithFailures | CancelRequested | Failed | Interrupted
                )
                | (CancelRequested, Cancelled | Failed | Interrupted)
                | (Interrupted, Queued | Cancelled | Failed)
        )
    }

    pub fn require_transition(self, next: Self) -> Result<(), ProtocolError> {
        if self.can_transition_to(next) {
            Ok(())
        } else {
            Err(ProtocolError::InvalidTransition {
                from: format!("{self:?}"),
                to: format!("{next:?}"),
            })
        }
    }

    pub fn is_terminal(self) -> bool {
        matches!(
            self,
            Self::Cancelled | Self::Failed | Self::Succeeded | Self::SucceededWithFailures
        )
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum StageKind {
    ChemistrySemantics,
    NumericCompute,
    Validation,
    ArtifactIo,
    Materialize,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Backend {
    Coordinator,
    Rdkit,
    NativeMetal,
    Mlx,
    ReferenceCpu,
}

impl Backend {
    pub fn is_gpu(self) -> bool {
        matches!(self, Self::NativeMetal | Self::Mlx)
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Precision {
    IntegerExact,
    Float32,
    Float64,
    Mixed,
    NotApplicable,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PlannedStage {
    pub stage_id: String,
    pub kind: StageKind,
    pub requested_backend: Backend,
    pub effective_backend: Backend,
    pub precision: Precision,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExecutionPlan {
    pub backend_policy: BackendPolicy,
    pub stages: Vec<PlannedStage>,
}

impl ExecutionPlan {
    pub fn validate(&self) -> Result<(), ProtocolError> {
        if self.stages.is_empty() || self.stages.len() > 32 {
            return Err(ProtocolError::Validation(
                "execution plan requires 1..=32 coordinator-defined stages".into(),
            ));
        }
        if self.backend_policy == BackendPolicy::GpuRequired {
            if let Some(stage) = self.stages.iter().find(|stage| {
                stage.kind == StageKind::NumericCompute && !stage.effective_backend.is_gpu()
            }) {
                return Err(ProtocolError::Validation(format!(
                    "gpuRequired numeric stage {} resolved to {:?}",
                    stage.stage_id, stage.effective_backend
                )));
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preserves_cancel_requested_as_a_distinct_state() {
        assert!(JobState::Running.can_transition_to(JobState::CancelRequested));
        assert!(JobState::CancelRequested.can_transition_to(JobState::Cancelled));
        assert!(!JobState::Running.can_transition_to(JobState::Cancelled));
        assert!(JobState::Succeeded.is_terminal());
        assert!(!JobState::Interrupted.is_terminal());
    }

    #[test]
    fn gpu_required_applies_only_to_numeric_stages() {
        let mut plan = ExecutionPlan {
            backend_policy: BackendPolicy::GpuRequired,
            stages: vec![
                PlannedStage {
                    stage_id: "fingerprints".into(),
                    kind: StageKind::ChemistrySemantics,
                    requested_backend: Backend::Rdkit,
                    effective_backend: Backend::Rdkit,
                    precision: Precision::NotApplicable,
                },
                PlannedStage {
                    stage_id: "neighbors".into(),
                    kind: StageKind::NumericCompute,
                    requested_backend: Backend::NativeMetal,
                    effective_backend: Backend::NativeMetal,
                    precision: Precision::IntegerExact,
                },
            ],
        };
        assert_eq!(plan.validate(), Ok(()));
        plan.stages[1].effective_backend = Backend::ReferenceCpu;
        assert!(plan.validate().is_err());
    }
}
