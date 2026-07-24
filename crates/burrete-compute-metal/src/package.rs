use std::{
    fs::{self, File},
    io::{Read, Take},
    path::Path,
};

use serde::Deserialize;
use sha2::{Digest, Sha256};

use crate::NATIVE_METAL_RUNTIME_VERSION;

const POINTER_MAX_BYTES: u64 = 4 * 1024;
const METADATA_MAX_BYTES: u64 = 64 * 1024;
const METALLIB_MAX_BYTES: u64 = 64 * 1024 * 1024;
const METADATA_FILE: &str = "build-metadata.v2.json";
const METALLIB_FILE: &str = "native-compute.v22.metallib";
const SOURCES: [(&str, &[u8]); 17] = [
    (
        "compute/metal/tanimoto.v2.metal",
        include_bytes!("../../../compute/metal/tanimoto.v2.metal"),
    ),
    (
        "compute/metal/conformer-initialize.v1.metal",
        include_bytes!("../../../compute/metal/conformer-initialize.v1.metal"),
    ),
    (
        "compute/metal/conformer-distance.v1.metal",
        include_bytes!("../../../compute/metal/conformer-distance.v1.metal"),
    ),
    (
        "compute/metal/conformer-optimize.v1.metal",
        include_bytes!("../../../compute/metal/conformer-optimize.v1.metal"),
    ),
    (
        "compute/metal/conformer-stereo.v1.metal",
        include_bytes!("../../../compute/metal/conformer-stereo.v1.metal"),
    ),
    (
        "compute/metal/conformer-etk.v1.metal",
        include_bytes!("../../../compute/metal/conformer-etk.v1.metal"),
    ),
    (
        "compute/metal/conformer-etk-optimize.v1.metal",
        include_bytes!("../../../compute/metal/conformer-etk-optimize.v1.metal"),
    ),
    (
        "compute/metal/mmff-energy.v1.metal",
        include_bytes!("../../../compute/metal/mmff-energy.v1.metal"),
    ),
    (
        "compute/metal/alignment-score.v1.metal",
        include_bytes!("../../../compute/metal/alignment-score.v1.metal"),
    ),
    (
        "compute/metal/rm1-fock.v1.metal",
        include_bytes!("../../../compute/metal/rm1-fock.v1.metal"),
    ),
    (
        "compute/metal/rm1-eigen.v1.metal",
        include_bytes!("../../../compute/metal/rm1-eigen.v1.metal"),
    ),
    (
        "compute/metal/rm1-pair-rotate.v1.metal",
        include_bytes!("../../../compute/metal/rm1-pair-rotate.v1.metal"),
    ),
    (
        "compute/metal/pm6-h4-hh.v1.metal",
        include_bytes!("../../../compute/metal/pm6-h4-hh.v1.metal"),
    ),
    (
        "compute/metal/pm6-d3.v2.metal",
        include_bytes!("../../../compute/metal/pm6-d3.v2.metal"),
    ),
    (
        "compute/metal/pm6-one-center-fock.v1.metal",
        include_bytes!("../../../compute/metal/pm6-one-center-fock.v1.metal"),
    ),
    (
        "compute/metal/pm6-pair-fock.v1.metal",
        include_bytes!("../../../compute/metal/pm6-pair-fock.v1.metal"),
    ),
    (
        "compute/metal/umap.v1.metal",
        include_bytes!("../../../compute/metal/umap.v1.metal"),
    ),
];
const CONTRACTS: [(&str, &[u8]); 17] = [
    (
        "compute/metal/tanimoto-kernel-contract.v2.json",
        include_bytes!("../../../compute/metal/tanimoto-kernel-contract.v2.json"),
    ),
    (
        "compute/metal/conformer-initialize-kernel-contract.v1.json",
        include_bytes!("../../../compute/metal/conformer-initialize-kernel-contract.v1.json"),
    ),
    (
        "compute/metal/conformer-distance-kernel-contract.v1.json",
        include_bytes!("../../../compute/metal/conformer-distance-kernel-contract.v1.json"),
    ),
    (
        "compute/metal/conformer-optimize-kernel-contract.v1.json",
        include_bytes!("../../../compute/metal/conformer-optimize-kernel-contract.v1.json"),
    ),
    (
        "compute/metal/conformer-stereo-kernel-contract.v1.json",
        include_bytes!("../../../compute/metal/conformer-stereo-kernel-contract.v1.json"),
    ),
    (
        "compute/metal/conformer-etk-kernel-contract.v1.json",
        include_bytes!("../../../compute/metal/conformer-etk-kernel-contract.v1.json"),
    ),
    (
        "compute/metal/conformer-etk-optimize-kernel-contract.v1.json",
        include_bytes!("../../../compute/metal/conformer-etk-optimize-kernel-contract.v1.json"),
    ),
    (
        "compute/metal/mmff-energy-kernel-contract.v1.json",
        include_bytes!("../../../compute/metal/mmff-energy-kernel-contract.v1.json"),
    ),
    (
        "compute/metal/alignment-score-kernel-contract.v1.json",
        include_bytes!("../../../compute/metal/alignment-score-kernel-contract.v1.json"),
    ),
    (
        "compute/metal/rm1-fock-kernel-contract.v1.json",
        include_bytes!("../../../compute/metal/rm1-fock-kernel-contract.v1.json"),
    ),
    (
        "compute/metal/rm1-eigen-kernel-contract.v1.json",
        include_bytes!("../../../compute/metal/rm1-eigen-kernel-contract.v1.json"),
    ),
    (
        "compute/metal/rm1-pair-rotate-kernel-contract.v1.json",
        include_bytes!("../../../compute/metal/rm1-pair-rotate-kernel-contract.v1.json"),
    ),
    (
        "compute/metal/pm6-h4-hh-kernel-contract.v1.json",
        include_bytes!("../../../compute/metal/pm6-h4-hh-kernel-contract.v1.json"),
    ),
    (
        "compute/metal/pm6-d3-kernel-contract.v2.json",
        include_bytes!("../../../compute/metal/pm6-d3-kernel-contract.v2.json"),
    ),
    (
        "compute/metal/pm6-one-center-fock-kernel-contract.v1.json",
        include_bytes!("../../../compute/metal/pm6-one-center-fock-kernel-contract.v1.json"),
    ),
    (
        "compute/metal/pm6-pair-fock-kernel-contract.v1.json",
        include_bytes!("../../../compute/metal/pm6-pair-fock-kernel-contract.v1.json"),
    ),
    (
        "compute/metal/umap-kernel-contract.v1.json",
        include_bytes!("../../../compute/metal/umap-kernel-contract.v1.json"),
    ),
];
const AIR_PATHS: [&str; 17] = [
    "tanimoto.v2.air",
    "conformer-initialize.v1.air",
    "conformer-distance.v1.air",
    "conformer-optimize.v1.air",
    "conformer-stereo.v1.air",
    "conformer-etk.v1.air",
    "conformer-etk-optimize.v1.air",
    "mmff-energy.v1.air",
    "alignment-score.v1.air",
    "rm1-fock.v1.air",
    "rm1-eigen.v1.air",
    "rm1-pair-rotate.v1.air",
    "pm6-h4-hh.v1.air",
    "pm6-d3.v2.air",
    "pm6-one-center-fock.v1.air",
    "pm6-pair-fock.v1.air",
    "umap.v1.air",
];
const ENTRYPOINTS: [&str; 24] = [
    "burrete_tanimoto_degree_count_v1",
    "burrete_tanimoto_csr_fill_v1",
    "burrete_tanimoto_query_counts_v1",
    "burrete_tanimoto_counts_batch_v1",
    "burrete_tanimoto_top_k_batch_v1",
    "burrete_conformer_initialize_v1",
    "burrete_conformer_distance_v1",
    "burrete_conformer_optimize_v1",
    "burrete_conformer_stereo_validate_v1",
    "burrete_conformer_etk_v1",
    "burrete_conformer_etk_optimize_v1",
    "burrete_mmff_energy_v1",
    "burrete_mmff_analytic_gradient_v1",
    "burrete_mmff_optimize_v1",
    "burrete_alignment_score_v1",
    "burrete_rm1_pair_fock_v1",
    "burrete_rm1_symmetric_eigen_v1",
    "burrete_rm1_pair_rotate_v1",
    "burrete_pm6_h4_hh_v1",
    "burrete_pm6_d3_v2",
    "burrete_pm6_one_center_fock_v1",
    "burrete_pm6_pair_fock_v1",
    "burrete_umap_initialize_v1",
    "burrete_umap_epoch_v1",
];

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum MetalRuntimeError {
    RuntimeMissing(String),
    Integrity(String),
    UnsupportedPlatform(String),
    MetalUnavailable(String),
    KernelUnavailable(String),
    Dispatch(String),
    ResourceLimit(String),
}

impl std::fmt::Display for MetalRuntimeError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::RuntimeMissing(message)
            | Self::Integrity(message)
            | Self::UnsupportedPlatform(message)
            | Self::MetalUnavailable(message)
            | Self::KernelUnavailable(message)
            | Self::Dispatch(message)
            | Self::ResourceLimit(message) => formatter.write_str(message),
        }
    }
}

impl std::error::Error for MetalRuntimeError {}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VerifiedMetalPackage {
    pub runtime_version: String,
    pub metadata_sha256: String,
    pub metallib_sha256: String,
    pub metallib_bytes: Vec<u8>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct GenerationPointer {
    schema_version: String,
    generation: String,
    metadata_sha256: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BuildMetadata {
    schema_version: String,
    runtime_version: String,
    library_id: String,
    sources: Vec<HashedPath>,
    contracts: Vec<HashedPath>,
    air: Vec<HashedPath>,
    metallib: HashedPath,
    compiler: CompilerIdentity,
    linker: HashedPath,
    sdk: SdkIdentity,
    deployment_target: String,
    compile_arguments: Vec<String>,
    entrypoints: Vec<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct HashedPath {
    path: String,
    sha256: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct CompilerIdentity {
    path: String,
    sha256: String,
    version: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SdkIdentity {
    name: String,
    path: String,
    version: String,
    build_version: String,
}

pub fn verify_runtime_package(root: &Path) -> Result<VerifiedMetalPackage, MetalRuntimeError> {
    validate_directory(root, "Metal runtime root")?;
    let pointer_bytes = read_bounded(
        &root.join("current.json"),
        POINTER_MAX_BYTES,
        "Metal generation pointer",
    )?;
    let pointer: GenerationPointer = decode_json(&pointer_bytes, "Metal generation pointer")?;
    if pointer.schema_version != "burrete.compute.metal-generation-pointer.v1" {
        return integrity("Metal generation pointer has an unsupported schema");
    }
    validate_sha256(&pointer.metadata_sha256, "metadata SHA-256")?;
    validate_generation_name(&pointer.generation)?;

    let generation = root.join(&pointer.generation);
    validate_directory(&generation, "Metal generation directory")?;
    let metadata_bytes = read_bounded(
        &generation.join(METADATA_FILE),
        METADATA_MAX_BYTES,
        "Metal build metadata",
    )?;
    if sha256(&metadata_bytes) != pointer.metadata_sha256 {
        return integrity("Metal build metadata differs from the generation pointer");
    }
    let metadata: BuildMetadata = decode_json(&metadata_bytes, "Metal build metadata")?;
    validate_metadata(&metadata)?;

    let metallib_bytes = read_bounded(
        &generation.join(METALLIB_FILE),
        METALLIB_MAX_BYTES,
        "Metal library",
    )?;
    if sha256(&metallib_bytes) != metadata.metallib.sha256 {
        return integrity("Metal library differs from verified build metadata");
    }

    Ok(VerifiedMetalPackage {
        runtime_version: metadata.runtime_version,
        metadata_sha256: pointer.metadata_sha256,
        metallib_sha256: metadata.metallib.sha256,
        metallib_bytes,
    })
}

fn validate_metadata(metadata: &BuildMetadata) -> Result<(), MetalRuntimeError> {
    for (label, hash) in metadata
        .sources
        .iter()
        .map(|item| ("source", &item.sha256))
        .chain(
            metadata
                .contracts
                .iter()
                .map(|item| ("contract", &item.sha256)),
        )
        .chain(metadata.air.iter().map(|item| ("AIR", &item.sha256)))
        .chain([
            ("metallib", &metadata.metallib.sha256),
            ("compiler", &metadata.compiler.sha256),
            ("linker", &metadata.linker.sha256),
        ])
    {
        validate_sha256(hash, label)?;
    }
    let expected_entrypoints: Vec<String> = ENTRYPOINTS.iter().map(ToString::to_string).collect();
    if metadata.schema_version != "burrete.compute.metal-build-metadata.v2"
        || metadata.runtime_version != NATIVE_METAL_RUNTIME_VERSION
        || metadata.library_id != "burrete.compute.native.v22"
        || !matches_hashed_inputs(&metadata.sources, &SOURCES)
        || !matches_hashed_inputs(&metadata.contracts, &CONTRACTS)
        || metadata.air.len() != AIR_PATHS.len()
        || metadata
            .air
            .iter()
            .zip(AIR_PATHS)
            .any(|(actual, expected)| actual.path != expected)
        || metadata.metallib.path != METALLIB_FILE
        || metadata.deployment_target != "14.0"
        || metadata.compile_arguments
            != [
                "-std=metal3.1",
                "-mmacosx-version-min=14.0",
                "-fmodules-cache-path=<temporary>",
            ]
        || metadata.entrypoints != expected_entrypoints
    {
        return integrity("Metal build metadata does not match the compiled runtime contract");
    }
    for (label, value) in [
        ("compiler path", metadata.compiler.path.as_str()),
        ("compiler version", metadata.compiler.version.as_str()),
        ("linker path", metadata.linker.path.as_str()),
        ("SDK path", metadata.sdk.path.as_str()),
        ("SDK version", metadata.sdk.version.as_str()),
        ("SDK build version", metadata.sdk.build_version.as_str()),
    ] {
        validate_bounded_text(value, label)?;
    }
    if metadata.sdk.name != "macosx" {
        return integrity("Metal build metadata names an unexpected SDK");
    }
    Ok(())
}

fn matches_hashed_inputs(actual: &[HashedPath], expected: &[(&str, &[u8])]) -> bool {
    actual.len() == expected.len()
        && actual
            .iter()
            .zip(expected)
            .all(|(actual, (path, bytes))| actual.path == *path && actual.sha256 == sha256(bytes))
}

fn validate_directory(path: &Path, label: &str) -> Result<(), MetalRuntimeError> {
    let metadata = fs::symlink_metadata(path).map_err(|error| {
        MetalRuntimeError::RuntimeMissing(format!("{label} is unavailable: {error}"))
    })?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return integrity(format!("{label} must be a real directory"));
    }
    Ok(())
}

fn read_bounded(path: &Path, maximum: u64, label: &str) -> Result<Vec<u8>, MetalRuntimeError> {
    let metadata = fs::symlink_metadata(path).map_err(|error| {
        MetalRuntimeError::RuntimeMissing(format!("{label} is unavailable: {error}"))
    })?;
    if metadata.file_type().is_symlink() || !metadata.is_file() || metadata.len() == 0 {
        return integrity(format!("{label} must be a non-empty regular file"));
    }
    if metadata.len() > maximum {
        return integrity(format!("{label} exceeds its {maximum}-byte limit"));
    }
    let file = File::open(path).map_err(|error| {
        MetalRuntimeError::RuntimeMissing(format!("{label} cannot open: {error}"))
    })?;
    read_to_end_bounded(file.take(maximum + 1), maximum, label)
}

fn read_to_end_bounded(
    mut reader: Take<File>,
    maximum: u64,
    label: &str,
) -> Result<Vec<u8>, MetalRuntimeError> {
    let mut bytes = Vec::new();
    reader
        .read_to_end(&mut bytes)
        .map_err(|error| MetalRuntimeError::Integrity(format!("{label} cannot read: {error}")))?;
    if bytes.is_empty() || bytes.len() as u64 > maximum {
        return integrity(format!("{label} changed while it was read"));
    }
    Ok(bytes)
}

fn decode_json<T: for<'de> Deserialize<'de>>(
    bytes: &[u8],
    label: &str,
) -> Result<T, MetalRuntimeError> {
    serde_json::from_slice(bytes)
        .map_err(|error| MetalRuntimeError::Integrity(format!("{label} is invalid: {error}")))
}

fn validate_generation_name(value: &str) -> Result<(), MetalRuntimeError> {
    let suffix = value.strip_prefix("generation.").unwrap_or_default();
    if suffix.len() < 6
        || suffix.len() > 64
        || !suffix.bytes().all(|byte| byte.is_ascii_alphanumeric())
    {
        return integrity("Metal generation name is not a canonical path component");
    }
    Ok(())
}

fn validate_sha256(value: &str, label: &str) -> Result<(), MetalRuntimeError> {
    if value.len() != 64
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return integrity(format!("{label} is not a lowercase SHA-256 digest"));
    }
    Ok(())
}

fn validate_bounded_text(value: &str, label: &str) -> Result<(), MetalRuntimeError> {
    if value.is_empty()
        || value.len() > 4_096
        || value.chars().any(|character| character.is_control())
    {
        return integrity(format!(
            "{label} is empty, oversized, or contains control characters"
        ));
    }
    Ok(())
}

fn sha256(bytes: &[u8]) -> String {
    use std::fmt::Write;

    let mut encoded = String::with_capacity(64);
    for byte in Sha256::digest(bytes) {
        write!(encoded, "{byte:02x}").expect("writing to a String cannot fail");
    }
    encoded
}

fn integrity<T>(message: impl Into<String>) -> Result<T, MetalRuntimeError> {
    Err(MetalRuntimeError::Integrity(message.into()))
}

#[cfg(test)]
mod tests {
    use std::{fs, os::unix::fs::symlink, path::PathBuf};

    use serde_json::json;
    use tempfile::TempDir;

    use super::*;

    #[test]
    fn verifies_a_complete_hash_bound_runtime_generation() {
        let fixture = RuntimeFixture::new();
        let package = verify_runtime_package(fixture.root()).expect("verified package");
        assert_eq!(package.runtime_version, NATIVE_METAL_RUNTIME_VERSION);
        assert_eq!(package.metallib_bytes, b"test-metallib");
    }

    #[test]
    fn rejects_pointer_traversal_hash_mismatch_and_symlinked_library() {
        let fixture = RuntimeFixture::new();
        fixture.write_pointer("../escape", &"0".repeat(64));
        assert!(matches!(
            verify_runtime_package(fixture.root()),
            Err(MetalRuntimeError::Integrity(_))
        ));

        let fixture = RuntimeFixture::new();
        fixture.write_pointer(&fixture.generation, &"0".repeat(64));
        assert!(matches!(
            verify_runtime_package(fixture.root()),
            Err(MetalRuntimeError::Integrity(_))
        ));

        let fixture = RuntimeFixture::new();
        let library = fixture.generation_path().join(METALLIB_FILE);
        fs::remove_file(&library).expect("remove fixture library");
        symlink("outside", &library).expect("symlink fixture library");
        assert!(matches!(
            verify_runtime_package(fixture.root()),
            Err(MetalRuntimeError::Integrity(_))
        ));
    }

    struct RuntimeFixture {
        temporary: TempDir,
        generation: String,
    }

    impl RuntimeFixture {
        fn new() -> Self {
            let temporary = tempfile::tempdir().expect("temporary runtime root");
            let fixture = Self {
                temporary,
                generation: "generation.ABC123".into(),
            };
            fs::create_dir(fixture.generation_path()).expect("generation directory");
            let metallib = b"test-metallib";
            fs::write(fixture.generation_path().join(METALLIB_FILE), metallib)
                .expect("fixture metallib");
            let metadata = fixture.metadata(metallib);
            let metadata_bytes = serde_json::to_vec_pretty(&metadata).expect("metadata JSON");
            fs::write(
                fixture.generation_path().join(METADATA_FILE),
                &metadata_bytes,
            )
            .expect("fixture metadata");
            fixture.write_pointer(&fixture.generation, &sha256(&metadata_bytes));
            fixture
        }

        fn root(&self) -> &Path {
            self.temporary.path()
        }

        fn generation_path(&self) -> PathBuf {
            self.root().join(&self.generation)
        }

        fn write_pointer(&self, generation: &str, metadata_sha256: &str) {
            let pointer = json!({
                "schemaVersion": "burrete.compute.metal-generation-pointer.v1",
                "generation": generation,
                "metadataSha256": metadata_sha256,
            });
            fs::write(
                self.root().join("current.json"),
                serde_json::to_vec(&pointer).expect("pointer JSON"),
            )
            .expect("fixture pointer");
        }

        fn metadata(&self, metallib: &[u8]) -> serde_json::Value {
            let hash = "0".repeat(64);
            json!({
                "schemaVersion": "burrete.compute.metal-build-metadata.v2",
                "runtimeVersion": NATIVE_METAL_RUNTIME_VERSION,
                "libraryId": "burrete.compute.native.v22",
                "sources": SOURCES.map(|(path, bytes)| json!({
                    "path": path,
                    "sha256": sha256(bytes),
                })),
                "contracts": CONTRACTS.map(|(path, bytes)| json!({
                    "path": path,
                    "sha256": sha256(bytes),
                })),
                "air": AIR_PATHS.map(|path| json!({ "path": path, "sha256": hash.clone() })),
                "metallib": { "path": METALLIB_FILE, "sha256": sha256(metallib) },
                "compiler": { "path": "/toolchain/metal", "sha256": hash, "version": "test" },
                "linker": { "path": "/toolchain/metallib", "sha256": hash },
                "sdk": { "name": "macosx", "path": "/SDK", "version": "14.0", "buildVersion": "test" },
                "deploymentTarget": "14.0",
                "compileArguments": [
                    "-std=metal3.1",
                    "-mmacosx-version-min=14.0",
                    "-fmodules-cache-path=<temporary>"
                ],
                "entrypoints": ENTRYPOINTS,
            })
        }
    }
}
