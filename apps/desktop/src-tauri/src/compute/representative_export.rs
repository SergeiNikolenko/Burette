use std::{
    fs::{self, File, OpenOptions},
    io::{BufRead, BufReader, Read, Write},
    os::unix::fs::{DirBuilderExt, OpenOptionsExt},
    path::{Path, PathBuf},
};

use burette_compute_protocol::{
    ArtifactManifest, JobSnapshot, MolecularSnapshotRecordV1, OrderedRecordMoleculeIdentityHasher,
    MOLECULAR_RECORDS_FILE_PATH,
};
use rustix::fs::{renameat_with, RenameFlags};
use serde::Serialize;
use sha2::{Digest, Sha256};
use uuid::Uuid;

use super::{
    artifact_publisher::artifact_manifest_sha256,
    artifact_reader::open_verified_artifact_file,
    error::{ComputeCoordinatorError, ComputeResult},
    snapshot_repository::SnapshotRepository,
    store::ComputeStore,
};

const EXPORT_SCHEMA_VERSION: &str = "burette.cluster-representative-export.v1";
const REPRESENTATIVES_PATH: &str = "result/representatives.bin";
const CLUSTER_IDS_PATH: &str = "result/cluster-ids.bin";
const MAX_RECORD_LINE_BYTES: usize = 512 * 1024;
const DIRECTORY_MODE: u32 = 0o700;
const FILE_MODE: u32 = 0o600;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ClusterRepresentativeExportResult {
    pub(crate) bundle_path: String,
    pub(crate) report_path: String,
    pub(crate) table_path: String,
    pub(crate) structure_paths: Vec<String>,
    pub(crate) representative_count: u64,
    pub(crate) sdf_record_count: u64,
    pub(crate) smiles_record_count: u64,
    pub(crate) table_only_record_count: u64,
    pub(crate) report_sha256: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExportReport<'a> {
    schema_version: &'static str,
    export_id: Uuid,
    created_at_ms: u64,
    representative_count: u64,
    sdf_record_count: u64,
    smiles_record_count: u64,
    table_only_record_count: u64,
    payload_files: &'a [ExportPayloadFile],
    job: &'a JobSnapshot,
    artifact: &'a ArtifactManifest,
    artifact_manifest_sha256: &'a str,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExportPayloadFile {
    role: &'static str,
    relative_path: String,
    sha256: String,
    byte_count: u64,
    media_type: &'static str,
    record_count: u64,
}

#[derive(Default)]
struct ExportCounts {
    representatives: u64,
    sdf: u64,
    smiles: u64,
    table_only: u64,
}

pub(crate) fn export_cluster_representatives(
    store: &ComputeStore,
    snapshots: &SnapshotRepository,
    job: &JobSnapshot,
    artifact: &ArtifactManifest,
    output_directory: &Path,
    collection_name: &str,
    created_at_ms: u64,
) -> ComputeResult<ClusterRepresentativeExportResult> {
    job.validate()?;
    artifact.validate_against_job(job)?;
    if created_at_ms == 0 {
        return Err(validation("representative export time must be positive"));
    }
    let expected_artifact_sha256 = artifact_manifest_sha256(artifact)?;
    let output_root = validate_output_directory(output_directory)?;
    let output_root_directory = File::open(&output_root)?;
    let export_id = Uuid::new_v4();
    let leaf = export_bundle_leaf(collection_name, job.job_id, export_id)?;
    let staging_leaf = format!(".{leaf}.staging");
    let staging = output_root.join(&staging_leaf);
    let destination = output_root.join(&leaf);
    create_export_directory(&staging)?;
    let mut cleanup = StagingCleanup::new(staging.clone());

    let mut verified_snapshot = snapshots.open_verified_source(&job.frozen_source)?;
    let (records_file, _) = verified_snapshot
        .reopen_file(MOLECULAR_RECORDS_FILE_PATH)
        .map_err(ComputeCoordinatorError::Filesystem)?;
    let representatives_file = open_verified_artifact_file(store, artifact, REPRESENTATIVES_PATH)?;
    let cluster_ids_file = open_verified_artifact_file(store, artifact, CLUSTER_IDS_PATH)?;

    let mut table = HashedExportFile::create(&staging, "representatives.csv")?;
    write_csv_row(
        &mut table,
        &[
            "sourceRecordId",
            "name",
            "smiles",
            "idcode",
            "idcoordinates",
            "clusterId",
            "structureFile",
            "structureRecord",
            "moleculeContentSha256",
            "jobId",
            "artifactId",
            "artifactManifestSha256",
            "snapshotId",
            "snapshotSha256",
            "normalizedRequestSha256",
            "propertiesJson",
        ],
    )?;
    let mut sdf = HashedExportFile::create(&staging, "representatives.sdf")?;
    let mut smiles = HashedExportFile::create(&staging, "representatives.smi")?;
    write_smiles_header(&mut smiles, job, artifact, &expected_artifact_sha256)?;

    let mut records = BufReader::new(records_file);
    let mut representatives = BufReader::new(representatives_file);
    let mut cluster_ids = BufReader::new(cluster_ids_file);
    let mut identity = OrderedRecordMoleculeIdentityHasher::new();
    let mut counts = ExportCounts::default();
    let expected_records = job.frozen_source.frozen_source.record_count;
    for ordinal in 0..expected_records {
        let line = read_bounded_line(&mut records)?.ok_or_else(|| {
            protocol("molecular record stream ended before its declared record count")
        })?;
        let record: MolecularSnapshotRecordV1 = serde_json::from_slice(&line).map_err(|error| {
            protocol(format!("cannot decode molecular snapshot record: {error}"))
        })?;
        record.validate()?;
        if record.canonical_json_line_bytes()? != line {
            return Err(protocol(
                "molecular snapshot record is not canonical JSON Lines",
            ));
        }
        identity.push(record.source_record_id, &record.molecule_content_sha256)?;

        let representative = read_bool8(&mut representatives, "representative flag", ordinal)?;
        let cluster_id = read_u64(&mut cluster_ids, "cluster ID", ordinal)?;
        if !representative {
            continue;
        }
        if cluster_id == u64::MAX {
            return Err(protocol(
                "representative record uses the invalid cluster ID sentinel",
            ));
        }
        counts.representatives = checked_increment(counts.representatives, "representatives")?;
        let (structure_file, structure_record) = if record.molblock.is_some() {
            counts.sdf = checked_increment(counts.sdf, "SDF representatives")?;
            write_sdf_record(
                &mut sdf,
                &record,
                cluster_id,
                job,
                artifact,
                &expected_artifact_sha256,
            )?;
            ("representatives.sdf", Some(counts.sdf))
        } else if let Some(structure) = record
            .smiles
            .as_deref()
            .filter(|structure| !structure.chars().any(char::is_whitespace))
        {
            counts.smiles = checked_increment(counts.smiles, "SMILES representatives")?;
            write_smiles_record(
                &mut smiles,
                structure,
                &record.name,
                record.source_record_id,
                cluster_id,
            )?;
            ("representatives.smi", Some(counts.smiles))
        } else {
            counts.table_only = checked_increment(counts.table_only, "table-only representatives")?;
            ("", None)
        };
        let props = serde_json::to_string(&record.props)?;
        let structure_record = structure_record
            .map(|record_number| record_number.to_string())
            .unwrap_or_default();
        write_csv_row(
            &mut table,
            &[
                &record.source_record_id.to_string(),
                &record.name,
                record.smiles.as_deref().unwrap_or(""),
                record.idcode.as_deref().unwrap_or(""),
                record.idcoordinates.as_deref().unwrap_or(""),
                &cluster_id.to_string(),
                structure_file,
                &structure_record,
                &record.molecule_content_sha256,
                &job.job_id.to_string(),
                &artifact.artifact_id.to_string(),
                &expected_artifact_sha256,
                &job.frozen_source.snapshot_id.to_string(),
                &job.frozen_source.snapshot_sha256,
                &job.normalized_request_sha256,
                &props,
            ],
        )?;
    }
    if read_bounded_line(&mut records)?.is_some() {
        return Err(protocol(
            "molecular record stream exceeds its declared record count",
        ));
    }
    require_eof(&mut representatives, "representative flags")?;
    require_eof(&mut cluster_ids, "cluster IDs")?;
    if identity.finish_hex()
        != job
            .frozen_source
            .frozen_source
            .ordered_record_molecule_identity_sha256
    {
        return Err(protocol(
            "representative export source identity differs from the frozen snapshot",
        ));
    }
    verified_snapshot
        .reverify()
        .map_err(ComputeCoordinatorError::Filesystem)?;

    let mut payload_files = vec![table.finish(
        "table",
        "representatives.csv",
        "text/csv",
        counts.representatives,
    )?];
    let mut structure_paths = Vec::new();
    if counts.sdf > 0 {
        payload_files.push(sdf.finish(
            "structuresSdf",
            "representatives.sdf",
            "chemical/x-mdl-sdfile",
            counts.sdf,
        )?);
        structure_paths.push(destination.join("representatives.sdf"));
    } else {
        sdf.discard()?;
    }
    if counts.smiles > 0 {
        payload_files.push(smiles.finish(
            "structuresSmiles",
            "representatives.smi",
            "chemical/x-daylight-smiles",
            counts.smiles,
        )?);
        structure_paths.push(destination.join("representatives.smi"));
    } else {
        smiles.discard()?;
    }
    payload_files.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));

    let report = ExportReport {
        schema_version: EXPORT_SCHEMA_VERSION,
        export_id,
        created_at_ms,
        representative_count: counts.representatives,
        sdf_record_count: counts.sdf,
        smiles_record_count: counts.smiles,
        table_only_record_count: counts.table_only,
        payload_files: &payload_files,
        job,
        artifact,
        artifact_manifest_sha256: &expected_artifact_sha256,
    };
    let mut report_file = HashedExportFile::create(&staging, "provenance.json")?;
    serde_json::to_writer_pretty(&mut report_file, &report)?;
    report_file.write_all(b"\n")?;
    let report_file =
        report_file.finish("provenanceReport", "provenance.json", "application/json", 1)?;

    sync_directory(&staging)?;
    renameat_with(
        &output_root_directory,
        staging_leaf.as_str(),
        &output_root_directory,
        leaf.as_str(),
        RenameFlags::NOREPLACE,
    )
    .map_err(|error| {
        ComputeCoordinatorError::Filesystem(format!(
            "cannot publish representative export bundle {}: {error}",
            destination.display()
        ))
    })?;
    output_root_directory.sync_all()?;
    cleanup.disarm();

    Ok(ClusterRepresentativeExportResult {
        bundle_path: display_path(&destination),
        report_path: display_path(&destination.join("provenance.json")),
        table_path: display_path(&destination.join("representatives.csv")),
        structure_paths: structure_paths
            .iter()
            .map(|path| display_path(path))
            .collect(),
        representative_count: counts.representatives,
        sdf_record_count: counts.sdf,
        smiles_record_count: counts.smiles,
        table_only_record_count: counts.table_only,
        report_sha256: report_file.sha256,
    })
}

fn validate_output_directory(path: &Path) -> ComputeResult<PathBuf> {
    if !path.is_absolute() {
        return Err(validation(
            "representative export directory must be absolute",
        ));
    }
    let canonical = fs::canonicalize(path).map_err(|error| {
        filesystem(format!(
            "cannot resolve representative export directory {}: {error}",
            path.display()
        ))
    })?;
    let metadata = fs::symlink_metadata(&canonical)?;
    if !metadata.file_type().is_dir() || metadata.file_type().is_symlink() {
        return Err(validation(
            "representative export destination must be an existing directory",
        ));
    }
    Ok(canonical)
}

fn export_bundle_leaf(
    collection_name: &str,
    job_id: Uuid,
    export_id: Uuid,
) -> ComputeResult<String> {
    let stem = collection_name
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.') {
                character
            } else {
                '_'
            }
        })
        .collect::<String>()
        .trim_matches(['.', '_'])
        .chars()
        .take(80)
        .collect::<String>();
    let stem = if stem.is_empty() { "molecules" } else { &stem };
    let job = job_id.simple().to_string();
    let export = export_id.simple().to_string();
    Ok(format!("{stem}-diverse-{}-{}", &job[..8], &export[..8]))
}

fn create_export_directory(path: &Path) -> ComputeResult<()> {
    fs::DirBuilder::new()
        .mode(DIRECTORY_MODE)
        .create(path)
        .map_err(ComputeCoordinatorError::from)?;
    Ok(())
}

fn sync_directory(path: &Path) -> ComputeResult<()> {
    File::open(path)?.sync_all()?;
    Ok(())
}

fn read_bool8(reader: &mut BufReader<File>, label: &str, ordinal: u64) -> ComputeResult<bool> {
    let mut byte = [0_u8; 1];
    reader.read_exact(&mut byte).map_err(|error| {
        protocol(format!(
            "{label} ended before record ordinal {ordinal}: {error}"
        ))
    })?;
    match byte[0] {
        0 => Ok(false),
        1 => Ok(true),
        value => Err(protocol(format!(
            "{label} at ordinal {ordinal} is not bool8: {value}"
        ))),
    }
}

fn read_u64(reader: &mut BufReader<File>, label: &str, ordinal: u64) -> ComputeResult<u64> {
    let mut bytes = [0_u8; 8];
    reader.read_exact(&mut bytes).map_err(|error| {
        protocol(format!(
            "{label} ended before record ordinal {ordinal}: {error}"
        ))
    })?;
    Ok(u64::from_le_bytes(bytes))
}

fn require_eof(reader: &mut BufReader<File>, label: &str) -> ComputeResult<()> {
    if !reader.fill_buf()?.is_empty() {
        return Err(protocol(format!("{label} exceeds the frozen record count")));
    }
    Ok(())
}

fn read_bounded_line(reader: &mut BufReader<File>) -> ComputeResult<Option<Vec<u8>>> {
    let mut line = Vec::new();
    loop {
        let available = reader.fill_buf()?;
        if available.is_empty() {
            if line.is_empty() {
                return Ok(None);
            }
            return Err(protocol(
                "molecular record stream ends without a line delimiter",
            ));
        }
        let take = available
            .iter()
            .position(|byte| *byte == b'\n')
            .map_or(available.len(), |position| position + 1);
        if line.len().saturating_add(take) > MAX_RECORD_LINE_BYTES {
            return Err(protocol(
                "molecular snapshot record exceeds the export input bound",
            ));
        }
        line.extend_from_slice(&available[..take]);
        reader.consume(take);
        if line.last() == Some(&b'\n') {
            return Ok(Some(line));
        }
    }
}

fn write_smiles_header(
    writer: &mut impl Write,
    job: &JobSnapshot,
    artifact: &ArtifactManifest,
    artifact_sha256: &str,
) -> ComputeResult<()> {
    writeln!(writer, "# Burette cluster representative export v1")?;
    writeln!(writer, "# jobId={}", job.job_id)?;
    writeln!(writer, "# artifactId={}", artifact.artifact_id)?;
    writeln!(writer, "# artifactManifestSha256={artifact_sha256}")?;
    writeln!(writer, "# snapshotId={}", job.frozen_source.snapshot_id)?;
    writeln!(
        writer,
        "# snapshotSha256={}",
        job.frozen_source.snapshot_sha256
    )?;
    Ok(())
}

fn write_smiles_record(
    writer: &mut impl Write,
    smiles: &str,
    name: &str,
    source_record_id: u64,
    cluster_id: u64,
) -> ComputeResult<()> {
    let name = single_line_metadata(name);
    writeln!(
        writer,
        "{smiles}\t{name} | clusterId={cluster_id} sourceRecordId={source_record_id}"
    )?;
    Ok(())
}

fn write_sdf_record(
    writer: &mut impl Write,
    record: &MolecularSnapshotRecordV1,
    cluster_id: u64,
    job: &JobSnapshot,
    artifact: &ArtifactManifest,
    artifact_sha256: &str,
) -> ComputeResult<()> {
    let molblock = record
        .molblock
        .as_deref()
        .ok_or_else(|| protocol("SDF export record lacks a molblock"))?
        .trim_end();
    if molblock.lines().any(|line| line.trim() == "$$$$") {
        return Err(protocol(
            "snapshot molblock contains an embedded SDF record delimiter",
        ));
    }
    writeln!(writer, "{molblock}")?;
    write_sdf_property(writer, "BURETTE_NAME", &single_line_metadata(&record.name))?;
    if let Some(smiles) = record.smiles.as_deref() {
        write_sdf_property(writer, "SMILES", &single_line_metadata(smiles))?;
    }
    write_sdf_property(
        writer,
        "BURETTE_SOURCE_RECORD_ID",
        &record.source_record_id.to_string(),
    )?;
    write_sdf_property(writer, "BURETTE_CLUSTER_ID", &cluster_id.to_string())?;
    write_sdf_property(writer, "BURETTE_CLUSTER_JOB_ID", &job.job_id.to_string())?;
    write_sdf_property(
        writer,
        "BURETTE_CLUSTER_ARTIFACT_ID",
        &artifact.artifact_id.to_string(),
    )?;
    write_sdf_property(
        writer,
        "BURETTE_CLUSTER_ARTIFACT_MANIFEST_SHA256",
        artifact_sha256,
    )?;
    write_sdf_property(
        writer,
        "BURETTE_SNAPSHOT_SHA256",
        &job.frozen_source.snapshot_sha256,
    )?;
    write_sdf_property(
        writer,
        "BURETTE_SOURCE_PROPERTIES_JSON",
        &serde_json::to_string(&record.props)?,
    )?;
    writeln!(writer, "$$$$")?;
    Ok(())
}

fn write_sdf_property(writer: &mut impl Write, name: &str, value: &str) -> ComputeResult<()> {
    writeln!(writer, "> <{name}>")?;
    if value == "$$$$" {
        writeln!(writer, "\\$$$$")?;
    } else {
        writeln!(writer, "{value}")?;
    }
    writeln!(writer)?;
    Ok(())
}

fn single_line_metadata(value: &str) -> String {
    value
        .chars()
        .map(|character| {
            if character.is_control() {
                ' '
            } else {
                character
            }
        })
        .collect()
}

fn write_csv_row(writer: &mut impl Write, values: &[&str]) -> ComputeResult<()> {
    for (index, value) in values.iter().enumerate() {
        if index > 0 {
            writer.write_all(b",")?;
        }
        write_csv_cell(writer, value)?;
    }
    writer.write_all(b"\n")?;
    Ok(())
}

fn write_csv_cell(writer: &mut impl Write, value: &str) -> ComputeResult<()> {
    let quote = value.contains([',', '"', '\n', '\r']);
    if quote {
        writer.write_all(b"\"")?;
    }
    for chunk in value.split_inclusive('"') {
        if let Some(prefix) = chunk.strip_suffix('"') {
            writer.write_all(prefix.as_bytes())?;
            writer.write_all(b"\"\"")?;
        } else {
            writer.write_all(chunk.as_bytes())?;
        }
    }
    if quote {
        writer.write_all(b"\"")?;
    }
    Ok(())
}

fn checked_increment(value: u64, label: &str) -> ComputeResult<u64> {
    value
        .checked_add(1)
        .ok_or_else(|| protocol(format!("{label} count overflowed")))
}

fn display_path(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

struct HashedExportFile {
    path: PathBuf,
    file: Option<File>,
    digest: Sha256,
    byte_count: u64,
}

impl HashedExportFile {
    fn create(directory: &Path, name: &str) -> ComputeResult<Self> {
        let path = directory.join(name);
        let file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(FILE_MODE)
            .open(&path)?;
        Ok(Self {
            path,
            file: Some(file),
            digest: Sha256::new(),
            byte_count: 0,
        })
    }

    fn finish(
        mut self,
        role: &'static str,
        relative_path: &str,
        media_type: &'static str,
        record_count: u64,
    ) -> ComputeResult<ExportPayloadFile> {
        let file = self
            .file
            .take()
            .ok_or_else(|| protocol("export payload file was already finalized"))?;
        file.sync_all()?;
        drop(file);
        Ok(ExportPayloadFile {
            role,
            relative_path: relative_path.into(),
            sha256: encode_hex(self.digest.finalize()),
            byte_count: self.byte_count,
            media_type,
            record_count,
        })
    }

    fn discard(mut self) -> ComputeResult<()> {
        self.file.take();
        fs::remove_file(&self.path)?;
        Ok(())
    }
}

impl Write for HashedExportFile {
    fn write(&mut self, buffer: &[u8]) -> std::io::Result<usize> {
        let written = self
            .file
            .as_mut()
            .ok_or_else(|| std::io::Error::other("export file is finalized"))?
            .write(buffer)?;
        self.digest.update(&buffer[..written]);
        self.byte_count = self
            .byte_count
            .checked_add(written as u64)
            .ok_or_else(|| std::io::Error::other("export byte count overflowed"))?;
        Ok(written)
    }

    fn flush(&mut self) -> std::io::Result<()> {
        self.file
            .as_mut()
            .ok_or_else(|| std::io::Error::other("export file is finalized"))?
            .flush()
    }
}

struct StagingCleanup {
    path: PathBuf,
    armed: bool,
}

impl StagingCleanup {
    fn new(path: PathBuf) -> Self {
        Self { path, armed: true }
    }

    fn disarm(&mut self) {
        self.armed = false;
    }
}

impl Drop for StagingCleanup {
    fn drop(&mut self) {
        if self.armed {
            let _ = fs::remove_dir_all(&self.path);
        }
    }
}

fn encode_hex(bytes: impl AsRef<[u8]>) -> String {
    let mut encoded = String::with_capacity(bytes.as_ref().len() * 2);
    use std::fmt::Write as _;
    for byte in bytes.as_ref() {
        write!(encoded, "{byte:02x}").expect("writing to String cannot fail");
    }
    encoded
}

fn validation(message: impl Into<String>) -> ComputeCoordinatorError {
    ComputeCoordinatorError::Validation(message.into())
}

fn protocol(message: impl Into<String>) -> ComputeCoordinatorError {
    ComputeCoordinatorError::Protocol(message.into())
}

fn filesystem(message: impl Into<String>) -> ComputeCoordinatorError {
    ComputeCoordinatorError::Filesystem(message.into())
}
