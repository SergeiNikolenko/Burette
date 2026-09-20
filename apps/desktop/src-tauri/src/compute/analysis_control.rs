use super::{
    error::{ComputeCoordinatorError, ComputeResult},
    store::ComputeStore,
};
use burette_compute_protocol::JobState;
use serde::Serialize;
use serde_json::Value;
use std::{
    fs::{File, OpenOptions},
    io::Write,
    path::PathBuf,
    sync::Mutex,
};
use uuid::Uuid;

pub(crate) type AnalysisCheckpoint<'a> = &'a dyn Fn(usize, Option<Value>) -> ComputeResult<()>;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AnalysisProgress {
    job_id: Uuid,
    completed: usize,
    total: usize,
    partial_report_path: Option<String>,
}

// One append-only report per job: completed rows survive cancellation, but are
// explicitly partial and never applied to Grid as a successful analysis run.
pub(crate) struct AnalysisControl<'a> {
    store: &'a ComputeStore,
    owner: &'a str,
    job_id: Uuid,
    total: usize,
    report_path: PathBuf,
    report: Mutex<Option<(File, usize)>>,
    header: Value,
    on_progress: &'a dyn Fn(AnalysisProgress),
}

impl<'a> AnalysisControl<'a> {
    pub(crate) fn prepare(store: &ComputeStore) -> ComputeResult<PathBuf> {
        let directory = store.artifact_root()?.join("partial-analysis");
        std::fs::create_dir_all(&directory)?;
        Ok(directory)
    }

    pub(crate) fn new(
        store: &'a ComputeStore,
        owner: &'a str,
        job: &burette_compute_protocol::JobSnapshot,
        directory: PathBuf,
        total: usize,
        on_progress: &'a dyn Fn(AnalysisProgress),
    ) -> Self {
        let job_id = job.job_id;
        Self {
            store,
            owner,
            job_id,
            total,
            report_path: directory.join(format!("{job_id}.jsonl")),
            report: Mutex::new(None),
            header: serde_json::json!({"schema":"burette.partial-analysis.v1", "status":"partial",
                "jobId":job_id, "total":total, "workflow":job.workflow_template, "request":job.request,
                "frozenSource":job.frozen_source, "runtime":job.pinned_runtime,
                "effectiveBackends":job.stages.iter().map(|stage| stage.effective_backend).collect::<Vec<_>>() }),
            on_progress,
        }
    }

    pub(crate) fn checkpoint(&self, completed: usize, row: Option<Value>) -> ComputeResult<()> {
        let mut report = self.report.lock().map_err(|_| {
            ComputeCoordinatorError::Unavailable("Partial report lock poisoned".into())
        })?;
        if let Some(row) = row {
            if report.is_none() {
                let mut file = OpenOptions::new()
                    .create_new(true)
                    .write(true)
                    .open(&self.report_path)?;
                let header = self.header.to_string();
                writeln!(file, "{header}")?;
                *report = Some((file, header.len() + 1));
            }
            let line = row.to_string();
            let (file, bytes) = report.as_mut().expect("report opened");
            if bytes.saturating_add(line.len() + 1) > 64 * 1024 * 1024 {
                return Err(ComputeCoordinatorError::Validation(
                    "Partial report exceeds 64 MiB".into(),
                ));
            }
            writeln!(file, "{line}")?;
            file.flush()?;
            *bytes += line.len() + 1;
        }

        (self.on_progress)(AnalysisProgress {
            job_id: self.job_id,
            completed,
            total: self.total,
            partial_report_path: report
                .as_ref()
                .map(|_| self.report_path.to_string_lossy().into_owned()),
        });
        let job = self.store.get_job(self.owner, self.job_id)?;
        if matches!(job.state, JobState::CancelRequested | JobState::Cancelled) {
            return Err(ComputeCoordinatorError::Cancelled);
        }
        Ok(())
    }
}
