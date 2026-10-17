//! Desktop file-backed trajectories. Coordinate payloads contain one frame,
//! never the complete trajectory; the offset index stays on disk.
use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs::{self, File};
use std::io::{BufWriter, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    OnceLock,
};
use std::time::UNIX_EPOCH;
use tauri::{Manager, Runtime};

use super::desmond_trajectory::DesmondIndex;
use super::runtime_utils::stable_id;
use super::trajectory_dcd::DcdIndex;

const MAX_FRAME_BYTES: u64 = 64 * 1024 * 1024;
const MAX_INDEX_FRAMES: usize = 10_000_000;
const INDEX_RECORD_BYTES: u64 = 24;

/// Encoded single-frame payload, optional time in ps and optional cell basis in Angstrom.
pub(super) type IndexedFrame = (Vec<u8>, Option<f64>, Option<[f64; 9]>);

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
struct Revision {
    bytes: u64,
    modified_ns: u128,
    #[cfg(unix)]
    device: u64,
    #[cfg(unix)]
    inode: u64,
}

impl Revision {
    fn read(path: &Path) -> Result<Self, String> {
        let meta = fs::metadata(path).map_err(|error| error.to_string())?;
        if !meta.is_file() && !meta.is_dir() {
            return Err("Trajectory source is not a file or directory.".into());
        }
        #[cfg(unix)]
        use std::os::unix::fs::MetadataExt;
        Ok(Self {
            bytes: meta.len(),
            modified_ns: meta
                .modified()
                .map_err(|error| error.to_string())?
                .duration_since(UNIX_EPOCH)
                .map_err(|error| error.to_string())?
                .as_nanos(),
            #[cfg(unix)]
            device: meta.dev(),
            #[cfg(unix)]
            inode: meta.ino(),
        })
    }
}

#[derive(Debug, Deserialize, Serialize)]
struct Manifest {
    source: PathBuf,
    revision: Revision,
    format: String,
    frame_count: usize,
    atom_count: usize,
    dcd: Option<DcdIndex>,
    #[serde(default)]
    desmond: Option<DesmondIndex>,
    #[serde(default)]
    sources: Vec<(PathBuf, Revision)>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct IndexedTrajectory {
    version: u32,
    index_key: String,
    pub(crate) frame_count: usize,
    pub(crate) atom_count: usize,
    pub(crate) format: String,
    pub(crate) source_byte_count: u64,
    pub(crate) first_time_ps: Option<f64>,
    pub(crate) first_cell_basis: Option<[f64; 9]>,
}

fn index_directory<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_cache_dir()
        .map_err(|error| error.to_string())?
        .join("indexed-trajectories"))
}

pub(crate) fn prepare<R: Runtime>(
    app: &tauri::AppHandle<R>,
    path: &Path,
) -> Result<(IndexedTrajectory, Vec<u8>), String> {
    let source = path.canonicalize().map_err(|error| error.to_string())?;
    let revision = Revision::read(&source)?;
    let format = source
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let directory = index_directory(app)?;
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    // Versioned cache includes source identity and nanosecond modification time.
    let key = stable_id(Path::new(&format!(
        "indexed-v1:{}:{revision:?}",
        source.display()
    )));
    let metadata_path = directory.join(format!("{key}.json"));
    let manifest = if let Ok(bytes) = read_bounded(&metadata_path, 32 * 1024 * 1024) {
        serde_json::from_slice::<Manifest>(&bytes)
            .ok()
            .filter(|value| value.revision == revision && value.source == source)
    } else {
        None
    };
    let manifest = match manifest {
        Some(manifest) => manifest,
        None => {
            let mut manifest = Manifest {
                source: source.clone(),
                revision: revision.clone(),
                format: format.clone(),
                frame_count: 0,
                atom_count: 0,
                dcd: None,
                desmond: None,
                sources: Vec::new(),
            };
            if format == "dcd" {
                let dcd = DcdIndex::open(&source)?;
                manifest.frame_count = dcd.frame_count;
                manifest.atom_count = dcd.atom_count;
                manifest.dcd = Some(dcd);
            } else if matches!(format.as_str(), "xtc" | "trr") {
                let temporary = directory.join(format!("{key}.{}.tmp", uuid::Uuid::new_v4()));
                let indexed = index_xdr(&source, &temporary, &format);
                match indexed {
                    Ok((count, atoms)) => {
                        fs::rename(&temporary, directory.join(format!("{key}.idx")))
                            .map_err(|error| error.to_string())?;
                        manifest.frame_count = count;
                        manifest.atom_count = atoms;
                    }
                    Err(error) => {
                        let _ = fs::remove_file(&temporary);
                        return Err(error);
                    }
                }
            } else {
                return Err(format!("Indexed {format} trajectories are not supported."));
            }
            if Revision::read(&source)? != revision {
                return Err("Trajectory source changed while indexing; reopen it.".into());
            }
            write_manifest(&metadata_path, &manifest)?;
            manifest
        }
    };
    let (bytes, time, cell) = read_frame(&directory, &key, &manifest, 0)?;
    Ok((
        IndexedTrajectory {
            version: 1,
            index_key: key,
            frame_count: manifest.frame_count,
            atom_count: manifest.atom_count,
            format,
            source_byte_count: revision.bytes,
            first_time_ps: time,
            first_cell_basis: cell,
        },
        bytes,
    ))
}

pub(crate) fn prepare_desmond<R: Runtime>(
    app: &tauri::AppHandle<R>,
    cms: &Path,
    trj: &Path,
) -> Result<(PathBuf, IndexedTrajectory, Vec<u8>), String> {
    let (mut index, topology) = DesmondIndex::open(cms, trj)?;
    let mut paths = index.source_paths();
    let directories = paths
        .iter()
        .skip(1)
        .filter_map(|path| path.parent().map(Path::to_path_buf))
        .chain(std::iter::once(trj.to_path_buf()))
        .collect::<std::collections::BTreeSet<_>>();
    paths.extend(directories);
    let sources = paths
        .into_iter()
        .map(|path| {
            let revision = Revision::read(&path)?;
            Ok((path, revision))
        })
        .collect::<Result<Vec<_>, String>>()?;
    let directory = index_directory(app)?;
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    let key = stable_id(Path::new(&format!("desmond-index-v1:{sources:?}")));
    let topology_path = directory.join(format!("{key}.pdb"));
    let index_path = directory.join(format!("{key}.idx"));
    let temporary = directory.join(format!("{key}.{}.tmp", uuid::Uuid::new_v4()));
    let result = index
        .write_locations(&temporary)
        .and_then(|_| fs::rename(&temporary, &index_path).map_err(|error| error.to_string()));
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result?;
    let (first, time, cell) = index.frame(0)?;
    let count = index.frame_count();
    let atoms = index.atom_count;
    index.detach_locations();
    let source_byte_count = sources.iter().map(|(_, revision)| revision.bytes).sum();
    let manifest = Manifest {
        source: cms.to_path_buf(),
        revision: Revision::read(cms)?,
        format: "dcd".into(),
        frame_count: count,
        atom_count: atoms,
        dcd: None,
        desmond: Some(index),
        sources,
    };
    validate_revision(&manifest)?;
    super::trace::write_bytes_atomic(&topology_path, &topology)?;
    write_manifest(&directory.join(format!("{key}.json")), &manifest)?;
    Ok((
        topology_path,
        IndexedTrajectory {
            version: 1,
            index_key: key,
            frame_count: count,
            atom_count: atoms,
            format: "dcd".into(),
            source_byte_count,
            first_time_ps: time,
            first_cell_basis: cell,
        },
        first,
    ))
}

fn validate_revision(manifest: &Manifest) -> Result<(), String> {
    for (path, revision) in std::iter::once((&manifest.source, &manifest.revision)).chain(
        manifest
            .sources
            .iter()
            .map(|(path, revision)| (path, revision)),
    ) {
        if Revision::read(path)? != *revision {
            return Err("Trajectory source changed; reopen it before seeking.".into());
        }
    }
    Ok(())
}

fn read_frame(
    directory: &Path,
    key: &str,
    manifest: &Manifest,
    frame: usize,
) -> Result<IndexedFrame, String> {
    if frame >= manifest.frame_count {
        return Err("Trajectory frame is out of range.".into());
    }
    validate_revision(manifest)?;
    let (bytes, time, cell) = if let Some(desmond) = &manifest.desmond {
        desmond.frame_from_index(&directory.join(format!("{key}.idx")), frame)?
    } else if let Some(dcd) = &manifest.dcd {
        (
            dcd.frame(&manifest.source, frame)?,
            Some(dcd.time_ps(frame)),
            None,
        )
    } else {
        let mut index =
            File::open(directory.join(format!("{key}.idx"))).map_err(|error| error.to_string())?;
        index
            .seek(SeekFrom::Start(frame as u64 * INDEX_RECORD_BYTES))
            .map_err(|error| error.to_string())?;
        let mut record = [0u8; 24];
        index
            .read_exact(&mut record)
            .map_err(|error| error.to_string())?;
        let start = u64::from_le_bytes(record[..8].try_into().unwrap());
        let length = u64::from_le_bytes(record[8..16].try_into().unwrap());
        let time = f64::from_le_bytes(record[16..24].try_into().unwrap());
        (
            read_slice(
                &mut File::open(&manifest.source).map_err(|error| error.to_string())?,
                start,
                length,
            )?,
            Some(time),
            None,
        )
    };
    if bytes.len() as u64 > MAX_FRAME_BYTES {
        return Err("Trajectory frame exceeds the bounded frame budget.".into());
    }
    validate_revision(manifest)?;
    Ok((bytes, time, cell))
}

/// Requests are scoped to the runtime's own descriptor, never arbitrary source
/// paths sent by a web page. Blocking file access runs on the worker pool.
#[tauri::command]
pub(crate) async fn read_indexed_trajectory_frame<R: Runtime>(
    app: tauri::AppHandle<R>,
    runtime_path: String,
    frame_index: usize,
    segment_index: usize,
    validate_only: Option<bool>,
) -> Result<Value, String> {
    static SLOTS: OnceLock<[tauri::async_runtime::Mutex<()>; 2]> = OnceLock::new();
    static NEXT: AtomicUsize = AtomicUsize::new(0);
    let slots = SLOTS.get_or_init(|| {
        [
            tauri::async_runtime::Mutex::new(()),
            tauri::async_runtime::Mutex::new(()),
        ]
    });
    let _slot = slots[NEXT.fetch_add(1, Ordering::Relaxed) % 2].lock().await;
    tauri::async_runtime::spawn_blocking(move || {
        let runtime = PathBuf::from(runtime_path).canonicalize().map_err(|error| error.to_string())?;
        let viewer_root = app.path().app_cache_dir().map_err(|error| error.to_string())?.join("viewer")
            .canonicalize().map_err(|error| error.to_string())?;
        if !runtime.starts_with(&viewer_root) || runtime.file_name().and_then(|value| value.to_str()) != Some("index.html") {
            return Err("Invalid trajectory runtime.".into());
        }
        let config_path = runtime.parent().ok_or("Missing runtime directory.")?.join("preview-config.js");
        let config = String::from_utf8(read_bounded(&config_path, 2 * 1024 * 1024)?).map_err(|error| error.to_string())?;
        let config: Value = serde_json::from_str(config.trim().strip_prefix("window.BuretteConfig = ").and_then(|value| value.strip_suffix(';')).ok_or("Invalid runtime config.")?)
            .map_err(|error| error.to_string())?;
        let descriptor: IndexedTrajectory = serde_json::from_value(config["docking"]["ligands"][segment_index]["indexedTrajectory"].clone()).map_err(|error| error.to_string())?;
        if descriptor.version != 1 || descriptor.index_key.is_empty() || descriptor.index_key.len() > 16 || !descriptor.index_key.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return Err("Invalid trajectory descriptor.".into());
        }
        let directory = index_directory(&app)?;
        let metadata = read_bounded(&directory.join(format!("{}.json", descriptor.index_key)), 32 * 1024 * 1024)?;
        let manifest: Manifest = serde_json::from_slice(&metadata).map_err(|error| error.to_string())?;
        if validate_only == Some(true) {
            if frame_index >= manifest.frame_count { return Err("Trajectory frame is out of range.".into()); }
            validate_revision(&manifest)?;
            return Ok(json!({"valid": true, "frameIndex": frame_index}));
        }
        let (bytes, time, cell) = read_frame(&directory, &descriptor.index_key, &manifest, frame_index)?;
        Ok(json!({"base64": base64::engine::general_purpose::STANDARD.encode(bytes), "timePs": time, "cellBasis": cell, "frameIndex": frame_index}))
    }).await.map_err(|error| format!("Trajectory reader worker failed: {error}"))?
}

fn read_slice(file: &mut File, offset: u64, length: u64) -> Result<Vec<u8>, String> {
    if length == 0 || length > MAX_FRAME_BYTES {
        return Err("Trajectory frame exceeds the 64 MiB frame budget.".into());
    }
    let mut bytes = vec![0; length as usize];
    file.seek(SeekFrom::Start(offset))
        .and_then(|_| file.read_exact(&mut bytes))
        .map_err(|error| error.to_string())?;
    Ok(bytes)
}

fn read_bounded(path: &Path, limit: u64) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::new();
    File::open(path)
        .map_err(|error| error.to_string())?
        .take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| error.to_string())?;
    if bytes.len() as u64 > limit {
        return Err("Trajectory metadata exceeds its byte budget.".into());
    }
    Ok(bytes)
}

fn write_manifest(path: &Path, manifest: &Manifest) -> Result<(), String> {
    let bytes = serde_json::to_vec(manifest).map_err(|error| error.to_string())?;
    if bytes.len() > 32 * 1024 * 1024 {
        return Err("Trajectory index metadata exceeds its 32 MiB budget.".into());
    }
    super::trace::write_bytes_atomic(path, &bytes)
}

fn be_u32(bytes: &[u8], offset: usize) -> u32 {
    u32::from_be_bytes(bytes[offset..offset + 4].try_into().unwrap())
}

// Only frame headers and record lengths are read. Compressed XTC coordinates
// are decoded by Mol* one frame at a time in the viewer.
fn index_xdr(path: &Path, output: &Path, format: &str) -> Result<(usize, usize), String> {
    let mut source = File::open(path).map_err(|error| error.to_string())?;
    let length = source.metadata().map_err(|error| error.to_string())?.len();
    let mut index = BufWriter::new(File::create(output).map_err(|error| error.to_string())?);
    let mut offset = 0;
    let mut count = 0;
    let mut atom_count = 0;
    while offset < length {
        let (size, atoms, time) = if format == "xtc" {
            let head = read_slice(&mut source, offset, 56)?;
            if be_u32(&head, 0) != 1995 {
                return Err("Unsupported or malformed XTC frame header.".into());
            }
            let atoms = be_u32(&head, 4) as usize;
            if be_u32(&head, 52) as usize != atoms {
                return Err("XTC coordinate count does not match its header.".into());
            }
            let size = if atoms <= 9 {
                56 + atoms as u64 * 12
            } else {
                let compressed = read_slice(&mut source, offset + 56, 36)?;
                92 + u64::from(be_u32(&compressed, 32)).div_ceil(4) * 4
            };
            (
                size,
                atoms,
                f32::from_be_bytes(head[12..16].try_into().unwrap()) as f64,
            )
        } else {
            let prefix = read_slice(&mut source, offset, 12)?;
            if be_u32(&prefix, 0) != 1993 {
                return Err("Unsupported or malformed TRR frame header.".into());
            }
            let version_bytes = u64::from(be_u32(&prefix, 8));
            if version_bytes > 1024 {
                return Err("Malformed TRR version header.".into());
            }
            let version_bytes = version_bytes.div_ceil(4) * 4;
            let head = read_slice(&mut source, offset + 12 + version_bytes, 68)?;
            let sizes: Vec<u64> = (0..10).map(|i| u64::from(be_u32(&head, i * 4))).collect();
            // Mol*'s TRR parser does not support legacy embedded topology blocks.
            if [0, 1, 5, 6].iter().any(|i| sizes[*i] != 0) {
                return Err("TRR embedded topology blocks are unsupported.".into());
            }
            let atoms = be_u32(&head, 40) as usize;
            let precision = if sizes[2] != 0 {
                sizes[2] / 9
            } else if atoms > 0 {
                sizes[7] / (atoms as u64 * 3)
            } else {
                0
            };
            if !matches!(precision, 4 | 8)
                || sizes[7] != atoms as u64 * 3 * precision
                || (sizes[2] != 0 && sizes[2] != 9 * precision)
            {
                return Err(
                    "TRR frame has unsupported coordinate precision or no positions.".into(),
                );
            }
            let time = if precision == 8 {
                f64::from_be_bytes(head[52..60].try_into().unwrap())
            } else {
                f32::from_be_bytes(head[52..56].try_into().unwrap()) as f64
            };
            (
                12 + version_bytes + 52 + 2 * precision + sizes.iter().sum::<u64>(),
                atoms,
                time,
            )
        };
        if atoms == 0
            || atoms > 5_000_000
            || size > MAX_FRAME_BYTES
            || offset.checked_add(size).is_none_or(|end| end > length)
            || !time.is_finite()
        {
            return Err("Malformed, truncated or oversized trajectory frame.".into());
        }
        if count == 0 {
            atom_count = atoms;
        } else if atoms != atom_count {
            return Err("Trajectory atom count changes between frames.".into());
        }
        if count >= MAX_INDEX_FRAMES {
            return Err("Trajectory exceeds the 10 million frame index budget.".into());
        }
        index
            .write_all(&offset.to_le_bytes())
            .and_then(|_| index.write_all(&size.to_le_bytes()))
            .and_then(|_| index.write_all(&time.to_le_bytes()))
            .map_err(|error| error.to_string())?;
        count += 1;
        offset += size;
    }
    if count == 0 {
        return Err("Trajectory contains no frames.".into());
    }
    index
        .flush()
        .and_then(|_| index.get_ref().sync_all())
        .map_err(|error| error.to_string())?;
    Ok((count, atom_count))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_directory() -> PathBuf {
        let path = std::env::temp_dir().join(format!("burette-indexed-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&path).unwrap();
        path
    }

    fn xtc_frame(time: f32, position: f32) -> Vec<u8> {
        let mut frame = Vec::new();
        for value in [1995i32, 1, 0] {
            frame.extend_from_slice(&value.to_be_bytes());
        }
        frame.extend_from_slice(&time.to_be_bytes());
        for value in [1.0f32, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0] {
            frame.extend_from_slice(&value.to_be_bytes());
        }
        frame.extend_from_slice(&1i32.to_be_bytes());
        for value in [position, position + 1.0, position + 2.0] {
            frame.extend_from_slice(&value.to_be_bytes());
        }
        frame
    }

    #[test]
    fn xdr_index_reads_exact_random_frame_and_rejects_revision_changes() {
        let directory = temp_directory();
        let source = directory.join("run.xtc");
        let frames = [
            xtc_frame(0.0, 1.0),
            xtc_frame(2.5, 3.0),
            xtc_frame(8.0, 4.0),
        ];
        fs::write(&source, frames.concat()).unwrap();
        assert_eq!(
            index_xdr(&source, &directory.join("test.idx"), "xtc").unwrap(),
            (3, 1)
        );
        let manifest = Manifest {
            source: source.clone(),
            revision: Revision::read(&source).unwrap(),
            format: "xtc".into(),
            frame_count: 3,
            atom_count: 1,
            dcd: None,
            desmond: None,
            sources: Vec::new(),
        };
        for index in [2, 0, 1] {
            let (bytes, time, _) = read_frame(&directory, "test", &manifest, index).unwrap();
            assert_eq!(bytes, frames[index]);
            assert_eq!(time, Some([0.0, 2.5, 8.0][index]));
        }
        fs::write(&source, [frames.concat(), vec![0]].concat()).unwrap();
        assert!(read_frame(&directory, "test", &manifest, 0)
            .unwrap_err()
            .contains("changed"));
        assert!(index_xdr(&source, &directory.join("bad.idx"), "xtc").is_err());
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn file_backed_dcd_above_preview_limit_reads_last_frame_without_full_payload() {
        let directory = temp_directory();
        let source = directory.join("large.dcd");
        let mut header = vec![0u8; 196];
        header[..4].copy_from_slice(&84u32.to_le_bytes());
        header[4..8].copy_from_slice(b"CORD");
        let count = 2_000_001u32;
        header[8..12].copy_from_slice(&count.to_le_bytes());
        header[16..20].copy_from_slice(&1u32.to_le_bytes());
        header[44..48].copy_from_slice(&1.0f32.to_le_bytes());
        header[84..88].copy_from_slice(&24u32.to_le_bytes());
        header[88..92].copy_from_slice(&84u32.to_le_bytes());
        header[92..96].copy_from_slice(&84u32.to_le_bytes());
        header[96..100].copy_from_slice(&1u32.to_le_bytes());
        header[180..184].copy_from_slice(&84u32.to_le_bytes());
        header[184..188].copy_from_slice(&4u32.to_le_bytes());
        header[188..192].copy_from_slice(&2u32.to_le_bytes());
        header[192..196].copy_from_slice(&4u32.to_le_bytes());
        let mut file = File::create(&source).unwrap();
        file.write_all(&header).unwrap();
        file.set_len(196 + count as u64 * 48).unwrap();
        // Sparse fixture: only requested frames are materialised. The reader
        // must use checked offsets rather than allocate/read the whole source.
        for index in [0, count / 2, count - 1] {
            file.seek(SeekFrom::Start(196 + index as u64 * 48)).unwrap();
            for axis in 0..3 {
                file.write_all(&8u32.to_le_bytes()).unwrap();
                file.write_all(&(index as f32 + axis as f32).to_le_bytes())
                    .unwrap();
                file.write_all(&(index as f32 + axis as f32 + 0.5).to_le_bytes())
                    .unwrap();
                file.write_all(&8u32.to_le_bytes()).unwrap();
            }
        }
        drop(file);
        let dcd = DcdIndex::open(&source).unwrap();
        assert!(
            fs::metadata(&source).unwrap().len() > super::super::runtime::MAX_STRUCTURE_FILE_SIZE
        );
        assert_eq!(dcd.frame_count, count as usize);
        for index in [count as usize - 1, count as usize / 2, 0] {
            let bytes = dcd.frame(&source, index).unwrap();
            assert_eq!(bytes.len(), 244);
            assert_eq!(
                f32::from_le_bytes(bytes[200..204].try_into().unwrap()),
                index as f32
            );
        }
        fs::remove_dir_all(directory).unwrap();
    }
}
