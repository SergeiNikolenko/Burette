use std::{
    collections::BTreeMap,
    fs::{self, File},
    io::Read,
    path::Path,
};

use base64::{engine::general_purpose::STANDARD, Engine as _};
use burette_compute_protocol::{EngineIdentity, RuntimeIdentity};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use super::cluster_plan::ClusterV1EngineIdentities;

const VENDOR_ASSETS_LOCK: &[u8] = include_bytes!("../../../../../vendor-assets.lock.json");
const RDKIT_PACKAGE: &str = "@rdkit/rdkit";
const RDKIT_BASELINE_VERSION: &str = "2025.3.4-1.0.0";
const RDKIT_ASSET_PATHS: [&str; 2] = [
    "PreviewExtension/Web/rdkit/RDKit_minimal.js",
    "PreviewExtension/Web/rdkit/RDKit_minimal.wasm",
];
const CONFORMER_EXTRACTOR_PACKAGE: &str = "burette-rdkit-conformer";
const CONFORMER_EXTRACTOR_VERSION: &str =
    "Release_2025_03_4@276b5a662302c6a548ac4f1363c066f3258e3a20";
const CONFORMER_EXTRACTOR_ASSET_PATHS: [&str; 2] = [
    "PreviewExtension/Web/rdkit-conformer/Burette_rdkit_conformer.js",
    "PreviewExtension/Web/rdkit-conformer/Burette_rdkit_conformer.wasm",
];
const VIEWER_PREFIX: &str = "PreviewExtension/Web/";
const MAX_ENGINE_ASSET_BYTES: u64 = 16 * 1024 * 1024;
const COORDINATOR_MANIFEST: &[u8] =
    br#"{"engineId":"burette-coordinator","implementation":"burette/src-tauri/compute","schemaVersion":1}"#;
const REFERENCE_CPU_MANIFEST: &[u8] =
    br#"{"engineId":"burette-reference-cpu","implementation":"burette-compute-core","schemaVersion":1}"#;
const REFERENCE_RUNTIME_MANIFEST: &[u8] =
    br#"{"runtimeVersion":"burette-native-compute-v1","linkedHelper":true,"metallib":null,"schemaVersion":1}"#;

#[derive(Debug)]
pub(crate) struct VerifiedEngineCatalog {
    identities: ClusterV1EngineIdentities,
    conformer_identities: ClusterV1EngineIdentities,
    reference_runtime: RuntimeIdentity,
}

impl VerifiedEngineCatalog {
    pub(crate) fn load(viewer_root: &Path, helper_sha256: &str) -> Result<Self, String> {
        validate_sha256("compute helper", helper_sha256)?;
        let rdkit = verify_rdkit(viewer_root)?;
        let conformer_extractor = verify_conformer_extractor(viewer_root)?;
        let version = env!("CARGO_PKG_VERSION");
        let identities = ClusterV1EngineIdentities {
            coordinator: EngineIdentity {
                engine_id: "burette-coordinator".into(),
                version: version.into(),
                manifest_sha256: sha256_hex(COORDINATOR_MANIFEST),
            },
            rdkit,
            reference_cpu: EngineIdentity {
                engine_id: "burette-reference-cpu".into(),
                version: version.into(),
                manifest_sha256: sha256_hex(REFERENCE_CPU_MANIFEST),
            },
        };
        let conformer_identities = ClusterV1EngineIdentities {
            coordinator: identities.coordinator.clone(),
            rdkit: conformer_extractor,
            reference_cpu: identities.reference_cpu.clone(),
        };
        identities
            .coordinator
            .validate()
            .map_err(|error| error.to_string())?;
        conformer_identities
            .rdkit
            .validate()
            .map_err(|error| error.to_string())?;
        identities
            .rdkit
            .validate()
            .map_err(|error| error.to_string())?;
        identities
            .reference_cpu
            .validate()
            .map_err(|error| error.to_string())?;
        let reference_runtime = RuntimeIdentity {
            version: "burette-native-compute-v1".into(),
            manifest_sha256: sha256_hex(REFERENCE_RUNTIME_MANIFEST),
            helper_sha256: helper_sha256.into(),
            metallib_sha256: None,
        };
        reference_runtime
            .validate()
            .map_err(|error| error.to_string())?;
        Ok(Self {
            identities,
            conformer_identities,
            reference_runtime,
        })
    }

    pub(crate) fn identities(&self) -> &ClusterV1EngineIdentities {
        &self.identities
    }

    pub(crate) fn conformer_identities(&self) -> &ClusterV1EngineIdentities {
        &self.conformer_identities
    }

    pub(crate) fn reference_runtime(&self) -> &RuntimeIdentity {
        &self.reference_runtime
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct VendorLock {
    schema_version: u32,
    packages: BTreeMap<String, VendorPackage>,
    assets: Vec<VendorAsset>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct VendorPackage {
    package_name: String,
    version: String,
    integrity: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct VendorAsset {
    path: String,
    package: String,
    bytes: u64,
    sha256: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RdkitEngineManifest<'a> {
    schema_version: u32,
    engine_id: &'static str,
    package_name: &'a str,
    version: &'a str,
    integrity: &'a str,
    assets: &'a [VendorAsset],
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ConformerExtractorManifest<'a> {
    schema_version: u32,
    engine_id: &'static str,
    rdkit_source_revision: &'static str,
    binary_abi_version: u16,
    assets: &'a [VendorAsset],
}

fn verify_rdkit(viewer_root: &Path) -> Result<EngineIdentity, String> {
    require_real_directory(viewer_root)?;
    let lock: VendorLock = serde_json::from_slice(VENDOR_ASSETS_LOCK)
        .map_err(|error| format!("Cannot decode the embedded vendor asset lock: {error}"))?;
    if lock.schema_version != 2 {
        return Err("The embedded vendor asset lock has an unsupported schema".into());
    }
    let package = lock
        .packages
        .get(RDKIT_PACKAGE)
        .ok_or_else(|| "The embedded vendor asset lock does not pin RDKit".to_string())?;
    if package.package_name != RDKIT_PACKAGE || package.version != RDKIT_BASELINE_VERSION {
        return Err(format!(
            "The embedded RDKit package does not match the required {RDKIT_BASELINE_VERSION} baseline"
        ));
    }

    let mut assets = Vec::with_capacity(RDKIT_ASSET_PATHS.len());
    for expected_path in RDKIT_ASSET_PATHS {
        let asset = lock
            .assets
            .iter()
            .find(|asset| asset.path == expected_path && asset.package == RDKIT_PACKAGE)
            .ok_or_else(|| format!("The vendor asset lock is missing {expected_path}"))?
            .clone();
        let relative = expected_path
            .strip_prefix(VIEWER_PREFIX)
            .expect("RDKit asset constants use the ViewerWeb prefix");
        verify_asset(&viewer_root.join(relative), &asset)?;
        assets.push(asset);
    }
    assets.sort_by(|left, right| left.path.cmp(&right.path));
    let manifest = RdkitEngineManifest {
        schema_version: 1,
        engine_id: "rdkit",
        package_name: &package.package_name,
        version: &package.version,
        integrity: &package.integrity,
        assets: &assets,
    };
    let manifest_bytes = serde_json::to_vec(&manifest)
        .map_err(|error| format!("Cannot encode the verified RDKit engine manifest: {error}"))?;
    Ok(EngineIdentity {
        engine_id: "rdkit".into(),
        version: package.version.clone(),
        manifest_sha256: sha256_hex(&manifest_bytes),
    })
}

fn verify_conformer_extractor(viewer_root: &Path) -> Result<EngineIdentity, String> {
    require_real_directory(viewer_root)?;
    let lock: VendorLock = serde_json::from_slice(VENDOR_ASSETS_LOCK)
        .map_err(|error| format!("Cannot decode the embedded vendor asset lock: {error}"))?;
    if lock.schema_version != 2 {
        return Err("The embedded vendor asset lock has an unsupported schema".into());
    }
    let mut assets = Vec::with_capacity(CONFORMER_EXTRACTOR_ASSET_PATHS.len());
    for expected_path in CONFORMER_EXTRACTOR_ASSET_PATHS {
        let asset = lock
            .assets
            .iter()
            .find(|asset| {
                asset.path == expected_path && asset.package == CONFORMER_EXTRACTOR_PACKAGE
            })
            .ok_or_else(|| format!("The vendor asset lock is missing {expected_path}"))?
            .clone();
        let relative = expected_path
            .strip_prefix(VIEWER_PREFIX)
            .expect("conformer extractor assets use the ViewerWeb prefix");
        verify_asset(&viewer_root.join(relative), &asset)?;
        assets.push(asset);
    }
    assets.sort_by(|left, right| left.path.cmp(&right.path));
    let manifest = ConformerExtractorManifest {
        schema_version: 1,
        engine_id: "rdkit",
        rdkit_source_revision: CONFORMER_EXTRACTOR_VERSION,
        binary_abi_version: 1,
        assets: &assets,
    };
    let manifest_bytes = serde_json::to_vec(&manifest).map_err(|error| {
        format!("Cannot encode the verified conformer extractor manifest: {error}")
    })?;
    Ok(EngineIdentity {
        engine_id: "rdkit".into(),
        version: CONFORMER_EXTRACTOR_VERSION.into(),
        manifest_sha256: sha256_hex(&manifest_bytes),
    })
}

fn require_real_directory(path: &Path) -> Result<(), String> {
    let metadata = fs::symlink_metadata(path).map_err(|error| {
        format!(
            "The bundled ViewerWeb runtime is unavailable at {}: {error}",
            path.display()
        )
    })?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(format!(
            "The bundled ViewerWeb runtime is not a real directory at {}",
            path.display()
        ));
    }
    Ok(())
}

fn verify_asset(path: &Path, expected: &VendorAsset) -> Result<(), String> {
    if expected.bytes == 0 || expected.bytes > MAX_ENGINE_ASSET_BYTES {
        return Err(format!("Vendor asset {} has an unsafe size", expected.path));
    }
    let metadata = fs::symlink_metadata(path).map_err(|error| {
        format!(
            "Bundled RDKit asset {} is unavailable: {error}",
            path.display()
        )
    })?;
    if metadata.file_type().is_symlink() || !metadata.is_file() || metadata.len() != expected.bytes
    {
        return Err(format!(
            "Bundled RDKit asset {} has an unexpected type or size",
            path.display()
        ));
    }
    let expected_hash = decode_sri_sha256(&expected.sha256)?;
    let observed_hash = hash_bounded_file(path, expected.bytes)?;
    if observed_hash != expected_hash {
        return Err(format!(
            "Bundled RDKit asset {} failed SHA-256 verification",
            path.display()
        ));
    }
    Ok(())
}

fn decode_sri_sha256(value: &str) -> Result<[u8; 32], String> {
    let encoded = value
        .strip_prefix("sha256-")
        .ok_or_else(|| "Vendor asset digest is not SHA-256 SRI".to_string())?;
    let bytes = STANDARD
        .decode(encoded)
        .map_err(|error| format!("Vendor asset SHA-256 SRI is invalid: {error}"))?;
    bytes
        .try_into()
        .map_err(|_| "Vendor asset SHA-256 SRI has the wrong length".into())
}

fn hash_bounded_file(path: &Path, expected_bytes: u64) -> Result<[u8; 32], String> {
    let mut file = File::open(path).map_err(|error| {
        format!(
            "Cannot open bundled RDKit asset {}: {error}",
            path.display()
        )
    })?;
    let mut hasher = Sha256::new();
    let mut remaining = expected_bytes;
    let mut buffer = [0_u8; 64 * 1024];
    while remaining > 0 {
        let limit = usize::try_from(remaining.min(buffer.len() as u64))
            .expect("bounded read size fits usize");
        let read = file
            .read(&mut buffer[..limit])
            .map_err(|error| format!("Cannot hash bundled RDKit asset: {error}"))?;
        if read == 0 {
            return Err("Bundled RDKit asset ended before its declared size".into());
        }
        hasher.update(&buffer[..read]);
        remaining -= read as u64;
    }
    let mut trailing = [0_u8; 1];
    if file
        .read(&mut trailing)
        .map_err(|error| format!("Cannot finish hashing bundled RDKit asset: {error}"))?
        != 0
    {
        return Err("Bundled RDKit asset exceeds its declared size".into());
    }
    Ok(hasher.finalize().into())
}

fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    let mut encoded = String::with_capacity(64);
    use std::fmt::Write;
    for byte in digest {
        write!(encoded, "{byte:02x}").expect("writing to a String cannot fail");
    }
    encoded
}

fn validate_sha256(label: &str, value: &str) -> Result<(), String> {
    if value.len() != 64
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(format!("{label} is not a lowercase SHA-256 digest"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn verifies_the_checked_in_rdkit_runtime_and_builds_cpu_identity() {
        let viewer_root =
            Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../PreviewExtension/Web");
        let catalog = VerifiedEngineCatalog::load(&viewer_root, &"a".repeat(64))
            .expect("verify checked-in RDKit assets");
        assert_eq!(catalog.identities().rdkit.engine_id, "rdkit");
        assert_eq!(catalog.identities().rdkit.version, RDKIT_BASELINE_VERSION);
        assert_eq!(catalog.conformer_identities().rdkit.engine_id, "rdkit");
        assert_eq!(
            catalog.conformer_identities().rdkit.version,
            CONFORMER_EXTRACTOR_VERSION
        );
        assert_eq!(catalog.reference_runtime().metallib_sha256, None);
    }

    #[test]
    fn rejects_a_missing_viewer_runtime() {
        let missing =
            std::env::temp_dir().join(format!("burette-missing-viewer-{}", uuid::Uuid::new_v4()));
        assert!(VerifiedEngineCatalog::load(&missing, &"a".repeat(64)).is_err());
    }
}
