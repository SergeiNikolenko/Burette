//! Installed Avogadro plugin packages below `<app data>/extensions/avogadro`.
//!
//! Layout: `<name>/<commit>/` holds the extracted package and `<name>/installed.json`
//! is the receipt. Writing the receipt (temp file + rename) is the commit point:
//! a failure or cancellation before it leaves any previous version in place.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use super::archive::{create_private_dir, extract};
use super::index::IndexEntry;
use super::CANCELLED;

const RECEIPT: &str = "installed.json";
const MAX_TEXT_BYTES: u64 = 64 * 1024;
const LICENSE_FILES: [&str; 5] = [
    "LICENSE",
    "LICENSE.txt",
    "LICENSE.md",
    "COPYING",
    "LICENSE.rst",
];

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Receipt {
    pub(crate) name: String,
    pub(crate) version: String,
    pub(crate) commit: String,
    pub(crate) sha256: String,
    pub(crate) archive_bytes: u64,
    pub(crate) files: usize,
    pub(crate) expanded_bytes: u64,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct InstalledPlugin {
    #[serde(flatten)]
    pub(crate) receipt: Receipt,
    /// The package's own `pyproject.toml`, which declares its commands.
    pub(crate) pyproject: String,
    /// The package's own license text, when it ships one.
    pub(crate) license_text: Option<String>,
    /// Whether a prepared Python environment exists for this version.
    pub(crate) prepared: bool,
}

pub(crate) fn package_dir(root: &Path, receipt: &Receipt) -> PathBuf {
    root.join(&receipt.name).join(&receipt.commit)
}

fn read_small(path: &Path) -> Option<String> {
    let metadata = fs::symlink_metadata(path).ok()?;
    if !metadata.is_file() || metadata.len() > MAX_TEXT_BYTES {
        return None;
    }
    fs::read_to_string(path).ok()
}

pub(crate) fn describe_receipt(root: &Path, receipt: Receipt) -> Option<InstalledPlugin> {
    let dir = package_dir(root, &receipt);
    let pyproject = read_small(&dir.join("pyproject.toml"))?;
    let license_text = LICENSE_FILES
        .iter()
        .find_map(|name| read_small(&dir.join(name)));
    let prepared = dir.join(".pixi/envs/default/bin").is_dir();
    Some(InstalledPlugin {
        receipt,
        pyproject,
        license_text,
        prepared,
    })
}

pub(crate) fn read_receipt(root: &Path, name: &str) -> Option<Receipt> {
    let receipt: Receipt =
        serde_json::from_str(&read_small(&root.join(name).join(RECEIPT))?).ok()?;
    (receipt.name == name && super::index::valid_commit(&receipt.commit)).then_some(receipt)
}

/// Every intact installation. Folders without a valid receipt are ignored.
pub(crate) fn installed(root: &Path) -> Vec<InstalledPlugin> {
    let Ok(children) = fs::read_dir(root) else {
        return Vec::new();
    };
    let mut plugins: Vec<_> = children
        .filter_map(Result::ok)
        .filter_map(|child| child.file_name().into_string().ok())
        .filter(|name| super::index::valid_name(name))
        .filter_map(|name| read_receipt(root, &name))
        .filter_map(|receipt| describe_receipt(root, receipt))
        .collect();
    plugins.sort_by(|left, right| left.receipt.name.cmp(&right.receipt.name));
    plugins
}

fn discard(root: &Path, path: &Path) {
    let trash = root.join(format!(".trash-{}", uuid::Uuid::new_v4()));
    if fs::rename(path, &trash).is_ok() {
        let _ = fs::remove_dir_all(trash);
    }
}

/// Verifies `archive` against the index entry, then publishes it atomically.
pub(crate) fn install(
    root: &Path,
    entry: &IndexEntry,
    archive: &[u8],
    cancel: &AtomicBool,
) -> Result<InstalledPlugin, String> {
    let digest = Sha256::digest(archive);
    let hex: String = digest.iter().map(|byte| format!("{byte:02x}")).collect();
    if hex != entry.sha256 {
        return Err("The downloaded plugin does not match the Avogadro plugin index".into());
    }
    create_private_dir(root)?;
    let staging = root.join(format!(".staging-{}", uuid::Uuid::new_v4()));
    create_private_dir(&staging)?;
    let result = (|| {
        let summary = extract(archive, &staging, cancel)?;
        let pyproject = read_small(&staging.join("pyproject.toml"))
            .ok_or("The plugin has no readable pyproject.toml")?;
        if !declares_project(&pyproject, &entry.name) {
            return Err(
                "The plugin package name does not match the Avogadro plugin index".to_string(),
            );
        }
        let receipt = Receipt {
            name: entry.name.clone(),
            version: entry.version.clone(),
            commit: entry.commit.clone(),
            sha256: entry.sha256.clone(),
            archive_bytes: archive.len() as u64,
            files: summary.files,
            expanded_bytes: summary.expanded_bytes,
        };
        let plugin_dir = root.join(&entry.name);
        create_private_dir(&plugin_dir)?;
        let target = package_dir(root, &receipt);
        if cancel.load(Ordering::Relaxed) {
            return Err(CANCELLED.to_string());
        }
        let previous = read_receipt(root, &entry.name);
        if target.exists() {
            // A reinstall of the current version replaces its files, including
            // any prepared environment, only once the new copy is complete.
            discard(root, &target);
        }
        fs::rename(&staging, &target)
            .map_err(|error| format!("The plugin could not be installed: {error}"))?;
        let temporary = plugin_dir.join(format!(".{RECEIPT}.{}", uuid::Uuid::new_v4()));
        fs::write(
            &temporary,
            serde_json::to_vec(&receipt).map_err(|error| error.to_string())?,
        )
        .and_then(|()| fs::rename(&temporary, plugin_dir.join(RECEIPT)))
        .map_err(|error| {
            let _ = fs::remove_file(&temporary);
            if previous
                .as_ref()
                .is_none_or(|previous| previous.commit != receipt.commit)
            {
                discard(root, &target);
            }
            format!("The plugin could not be installed: {error}")
        })?;
        if let Some(previous) = previous.filter(|previous| previous.commit != receipt.commit) {
            discard(root, &package_dir(root, &previous));
        }
        describe_receipt(root, receipt)
            .ok_or_else(|| "The installed plugin could not be read".to_string())
    })();
    if staging.exists() {
        let _ = fs::remove_dir_all(&staging);
    }
    result
}

pub(crate) fn remove(root: &Path, name: &str) -> Result<(), String> {
    let dir = root.join(name);
    if !dir.exists() {
        return Ok(());
    }
    let trash = root.join(format!(".trash-{}", uuid::Uuid::new_v4()));
    fs::rename(&dir, &trash)
        .map_err(|error| format!("The plugin could not be removed: {error}"))?;
    let _ = fs::remove_dir_all(trash);
    Ok(())
}

/// `[project] name = "..."` in the package's pyproject, ignoring other tables.
fn declares_project(pyproject: &str, name: &str) -> bool {
    let mut in_project = false;
    for line in pyproject.lines().map(str::trim) {
        if line.starts_with('[') {
            in_project = line == "[project]";
        } else if in_project {
            if let Some(value) = line
                .strip_prefix("name")
                .map(str::trim_start)
                .and_then(|rest| rest.strip_prefix('='))
            {
                return value.trim().trim_matches(|c| c == '"' || c == '\'') == name;
            }
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::avogadro_plugins::archive::tests::zip;
    use crate::commands::avogadro_plugins::index::{entry, SAVED_INDEX};

    const RDKIT: &[u8] =
        include_bytes!("../../../../../../tests/fixtures/avogadro/avogadro-rdkit-82498e3a.zip");

    fn root() -> PathBuf {
        std::env::temp_dir().join(format!("burette-avogadro-store-{}", uuid::Uuid::new_v4()))
    }

    #[test]
    fn the_recorded_rdkit_archive_installs_reinstalls_and_removes() {
        let root = root();
        let rdkit = entry(SAVED_INDEX, "avogadro-rdkit").unwrap();
        let plugin = install(&root, &rdkit, RDKIT, &AtomicBool::new(false)).unwrap();
        assert_eq!(plugin.receipt.version, "0.3.0");
        assert_eq!(plugin.receipt.files, 14);
        assert!(plugin.pyproject.contains("[[tool.avogadro.menu-commands]]"));
        assert!(plugin
            .license_text
            .as_deref()
            .is_some_and(|text| text.contains("BSD")));
        assert!(!plugin.prepared);
        assert_eq!(installed(&root), vec![plugin.clone()]);
        // Reinstalling the same version keeps exactly one copy.
        install(&root, &rdkit, RDKIT, &AtomicBool::new(false)).unwrap();
        assert_eq!(
            fs::read_dir(root.join("avogadro-rdkit")).unwrap().count(),
            2
        );
        remove(&root, "avogadro-rdkit").unwrap();
        assert!(installed(&root).is_empty());
        assert_eq!(fs::read_dir(&root).unwrap().count(), 0);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn mismatched_cancelled_or_misnamed_archives_leave_the_previous_version() {
        let root = root();
        let rdkit = entry(SAVED_INDEX, "avogadro-rdkit").unwrap();
        install(&root, &rdkit, RDKIT, &AtomicBool::new(false)).unwrap();
        let mut tampered = RDKIT.to_vec();
        *tampered.last_mut().unwrap() ^= 1;
        assert!(install(&root, &rdkit, &tampered, &AtomicBool::new(false))
            .unwrap_err()
            .contains("does not match"));
        assert_eq!(
            install(&root, &rdkit, RDKIT, &AtomicBool::new(true)).unwrap_err(),
            CANCELLED
        );

        let other = zip(&[(
            "pkg/pyproject.toml",
            b"[project]\nname = \"something-else\"\n",
            0o100_644,
        )]);
        let mut renamed = rdkit.clone();
        renamed.commit = "1".repeat(40);
        renamed.sha256 = Sha256::digest(&other)
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect();
        assert!(install(&root, &renamed, &other, &AtomicBool::new(false))
            .unwrap_err()
            .contains("name does not match"));

        let survivors = installed(&root);
        assert_eq!(survivors.len(), 1);
        assert_eq!(survivors[0].receipt.commit, rdkit.commit);
        let leftovers: Vec<_> = fs::read_dir(&root)
            .unwrap()
            .filter_map(Result::ok)
            .map(|child| child.file_name().into_string().unwrap())
            .collect();
        assert_eq!(leftovers, ["avogadro-rdkit"]);
        fs::remove_dir_all(root).unwrap();
    }
}
