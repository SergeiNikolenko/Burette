//! Plays a Desmond `-out.cms` + `_trj/` pair in Mol* without Schrödinger.
//!
//! Mol* has no DTR reader, so the pair is converted once into a PDB topology
//! (the CMS full system) and a DCD holding an evenly spaced subset of frames,
//! both cached beside the other derived runtimes. The DCD is sized to stay under
//! the structure payload limit, so a long run keeps every atom and water and
//! trades frame density instead.
//!
//! A DTR frame file holds consecutive frames. Each frame starts with a
//! big-endian header, followed by label metadata, then the values themselves in
//! the writer's native byte order: single values packed in a scalar block, arrays
//! in a field block padded to eight bytes.

use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;
use tauri::{Manager, Runtime};

use super::runtime_utils::stable_id;
use super::text_xyz::desmond_topology_from_cms;

const FRAME_MAGIC: u32 = 0x4445_534D; // "DESM"
const FRAME_HEADER_BYTES: usize = 96;
/// Keeps the DCD comfortably inside the 75 MiB structure payload limit.
const DCD_BYTE_BUDGET: usize = 64 * 1024 * 1024;
/// Standard AKMA -> ps conversion, also used by MDAnalysis and VMD.
const CHARMM_TIME_UNIT_PS: f64 = 0.048_888_21;

/// Paths of the cached topology and trajectory for a Desmond pair.
pub(crate) struct DesmondTrajectoryFiles {
    pub(crate) topology: PathBuf,
    pub(crate) trajectory: PathBuf,
}

#[derive(Clone, Copy, Debug)]
struct FrameLocation {
    file: usize,
    offset: u64,
    size: u64,
}

struct DecodedFrame {
    time_ps: Option<f64>,
    positions: Vec<f32>,
}

pub(crate) fn desmond_trajectory_files<R: Runtime>(
    app: &tauri::AppHandle<R>,
    cms: &Path,
    trj_dir: &Path,
) -> Result<DesmondTrajectoryFiles, String> {
    let frame_files = dtr_frame_files(trj_dir)?;
    // The viewer labels the model after the topology file, so the cached pair
    // keeps the CMS stem and the cache key names their directory instead.
    let directory = app
        .path()
        .app_cache_dir()
        .map_err(|err| err.to_string())?
        .join("desmond-trajectory")
        .join(cache_key(cms, &frame_files)?);
    fs::create_dir_all(&directory).map_err(|err| err.to_string())?;
    let stem = cms
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or("desmond");
    let files = DesmondTrajectoryFiles {
        topology: directory.join(format!("{stem}.pdb")),
        trajectory: directory.join(format!("{stem}.dcd")),
    };
    if files.topology.is_file() && cached_dcd_complete(&files.trajectory) {
        return Ok(files);
    }

    let topology = desmond_topology_from_cms(&fs::read(cms).map_err(|err| err.to_string())?)
        .ok_or_else(|| format!("{} has no Desmond full-system atom table.", cms.display()))?;
    let atom_count = topology.components.iter().map(|(atoms, _)| atoms).sum();
    let particle_count = topology
        .components
        .iter()
        .map(|(atoms, pseudo)| atoms + pseudo)
        .sum();
    let dcd = dcd_from_frames(
        &frame_files,
        &topology.components,
        atom_count,
        particle_count,
    )?;
    // Publish complete files atomically; concurrent readers never see a partial
    // coordinate payload. The DCD is the last completion marker.
    atomic_cache_write(&files.topology, &topology.pdb)?;
    atomic_cache_write(&files.trajectory, &dcd)?;
    Ok(files)
}

fn atomic_cache_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let temporary = path.with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| -> std::io::Result<()> {
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        fs::rename(&temporary, path)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result.map_err(|error| error.to_string())
}

fn cached_dcd_complete(path: &Path) -> bool {
    let Ok(mut file) = File::open(path) else {
        return false;
    };
    let mut header = [0u8; 196];
    if file.read_exact(&mut header).is_err() || &header[4..8] != b"CORD" {
        return false;
    }
    let count = u32::from_le_bytes(header[8..12].try_into().unwrap()) as u64;
    let atoms = u32::from_le_bytes(header[188..192].try_into().unwrap()) as u64;
    let expected = (atoms * 12 + 24)
        .checked_mul(count)
        .and_then(|size| size.checked_add(196));
    count > 0
        && atoms > 0
        && file
            .metadata()
            .ok()
            .is_some_and(|m| Some(m.len()) == expected)
}

/// Frame files are `frameNNNNNNNNN`, optionally spread over hash directories.
fn dtr_frame_files(trj_dir: &Path) -> Result<Vec<PathBuf>, String> {
    fn collect(directory: &Path, depth: usize, files: &mut Vec<(u64, PathBuf)>) {
        let Ok(entries) = fs::read_dir(directory) else {
            return;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() && depth < 2 {
                collect(&path, depth + 1, files);
                continue;
            }
            let number = path
                .file_name()
                .and_then(|name| name.to_str())
                .and_then(|name| name.strip_prefix("frame"))
                .and_then(|digits| digits.parse::<u64>().ok());
            if let (Some(number), true) = (number, path.is_file()) {
                files.push((number, path));
            }
        }
    }
    let mut files = Vec::new();
    collect(trj_dir, 0, &mut files);
    files.sort();
    if files.is_empty() {
        return Err(format!(
            "{} contains no DTR frame files.",
            trj_dir.display()
        ));
    }
    Ok(files.into_iter().map(|(_, path)| path).collect())
}

fn cache_key(cms: &Path, frame_files: &[PathBuf]) -> Result<String, String> {
    // Invalidate old time units and same-chain overflow residue collisions.
    let mut stamp = String::from("standard-dcd-time-component-residues-v4;");
    for path in std::iter::once(cms).chain(frame_files.iter().map(PathBuf::as_path)) {
        let metadata = fs::metadata(path).map_err(|err| err.to_string())?;
        let modified = metadata
            .modified()
            .ok()
            .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
            .map(|since| since.as_nanos())
            .unwrap_or_default();
        stamp.push_str(&format!(
            "{}:{}:{modified};",
            path.display(),
            metadata.len()
        ));
    }
    Ok(format!(
        "{}-{}",
        stable_id(cms),
        stable_id(Path::new(&stamp))
    ))
}

fn be_u32(bytes: &[u8], offset: usize) -> Option<u32> {
    Some(u32::from_be_bytes(
        bytes.get(offset..offset + 4)?.try_into().ok()?,
    ))
}

/// Walks frame headers only, so indexing a long run costs one seek per frame.
fn locate_frames(frame_files: &[PathBuf]) -> Result<Vec<FrameLocation>, String> {
    let mut frames = Vec::new();
    for (file_index, path) in frame_files.iter().enumerate() {
        let mut file = File::open(path).map_err(|err| err.to_string())?;
        let length = file.metadata().map_err(|err| err.to_string())?.len();
        let mut offset = 0u64;
        let mut header = [0u8; FRAME_HEADER_BYTES];
        while offset + FRAME_HEADER_BYTES as u64 <= length {
            file.seek(SeekFrom::Start(offset))
                .and_then(|_| file.read_exact(&mut header))
                .map_err(|err| err.to_string())?;
            if be_u32(&header, 0) != Some(FRAME_MAGIC) {
                break;
            }
            let size = u64::from(be_u32(&header, 8).unwrap_or(0))
                | (u64::from(be_u32(&header, 12).unwrap_or(0)) << 32);
            if size < FRAME_HEADER_BYTES as u64 || offset + size > length {
                break;
            }
            frames.push(FrameLocation {
                file: file_index,
                offset,
                size,
            });
            offset += size;
        }
    }
    if frames.is_empty() {
        return Err("The Desmond trajectory contains no readable frames.".to_string());
    }
    Ok(frames)
}

fn decode_frame(bytes: &[u8]) -> Result<DecodedFrame, String> {
    let malformed = || "Malformed Desmond trajectory frame.".to_string();
    let header = |offset| be_u32(bytes, offset).map(|value| value as usize);
    let header_size = header(16).ok_or_else(malformed)?;
    // The writer stores 0x12345678 in its own byte order, which fixes the order
    // of every value after the header.
    let little_endian = bytes.get(24..28).ok_or_else(malformed)? == [0x78, 0x56, 0x34, 0x12];
    let label_count = header(52).ok_or_else(malformed)?;
    let [meta_size, type_size, label_size, scalar_size] =
        [56, 60, 64, 68].map(|offset| header(offset).unwrap_or(0));
    let names = |start: usize, size: usize| -> Vec<String> {
        bytes
            .get(start..start + size)
            .unwrap_or_default()
            .split(|byte| *byte == 0)
            .map(|name| String::from_utf8_lossy(name).into_owned())
            .collect()
    };
    let type_names = names(header_size + meta_size, type_size);
    let labels = names(header_size + meta_size + type_size, label_size);
    let mut scalar = header_size + meta_size + type_size + label_size;
    let mut field = scalar + scalar_size;
    let mut time_ps = None;
    let mut positions = None;
    for index in 0..label_count {
        let meta = header_size + index * 16;
        let type_name = type_names
            .get(be_u32(bytes, meta).ok_or_else(malformed)? as usize)
            .map(String::as_str)
            .unwrap_or_default();
        let element_size = be_u32(bytes, meta + 4).ok_or_else(malformed)? as usize;
        let count = be_u32(bytes, meta + 8).ok_or_else(malformed)? as usize;
        let byte_count = element_size * count;
        let start = if count <= 1 {
            scalar = scalar.next_multiple_of(element_size.max(1));
            let start = scalar;
            scalar += byte_count;
            start
        } else {
            let start = field;
            field += byte_count.next_multiple_of(8);
            start
        };
        let value = bytes.get(start..start + byte_count).ok_or_else(malformed)?;
        match (labels.get(index).map(String::as_str), type_name) {
            (Some("CHEMICAL_TIME"), "double") if count == 1 => {
                let raw: [u8; 8] = value.try_into().map_err(|_| malformed())?;
                time_ps = Some(if little_endian {
                    f64::from_le_bytes(raw)
                } else {
                    f64::from_be_bytes(raw)
                });
            }
            (Some("POSITION"), "float") => {
                positions = Some(
                    value
                        .as_chunks::<4>()
                        .0
                        .iter()
                        .map(|raw| {
                            if little_endian {
                                f32::from_le_bytes(*raw)
                            } else {
                                f32::from_be_bytes(*raw)
                            }
                        })
                        .collect(),
                );
            }
            (Some("POSITION"), "double") => {
                positions = Some(
                    value
                        .as_chunks::<8>()
                        .0
                        .iter()
                        .map(|raw| {
                            (if little_endian {
                                f64::from_le_bytes(*raw)
                            } else {
                                f64::from_be_bytes(*raw)
                            }) as f32
                        })
                        .collect(),
                );
            }
            _ => {}
        }
    }
    Ok(DecodedFrame {
        time_ps,
        positions: positions
            .ok_or_else(|| "Desmond trajectory frame has no POSITION field.".to_string())?,
    })
}

/// Evenly spaced frame indices that always include the first and last frame.
fn sampled_frame_indices(frame_count: usize, limit: usize) -> Vec<usize> {
    if frame_count <= limit {
        return (0..frame_count).collect();
    }
    if limit <= 1 {
        return vec![0];
    }
    let mut indices: Vec<usize> = (0..limit)
        .map(|index| (index * (frame_count - 1) + (limit - 1) / 2) / (limit - 1))
        .collect();
    indices.dedup();
    indices
}

fn dcd_from_frames(
    frame_files: &[PathBuf],
    components: &[(usize, usize)],
    atom_count: usize,
    particle_count: usize,
) -> Result<Vec<u8>, String> {
    let locations = locate_frames(frame_files)?;
    let frame_bytes = atom_count * 12 + 24;
    let limit = (DCD_BYTE_BUDGET / frame_bytes.max(1)).max(1);
    let indices = sampled_frame_indices(locations.len(), limit);
    let mut frames = Vec::with_capacity(indices.len());
    let mut buffer = Vec::new();
    for index in &indices {
        let location = locations[*index];
        let mut file = File::open(&frame_files[location.file]).map_err(|err| err.to_string())?;
        buffer.resize(location.size as usize, 0);
        file.seek(SeekFrom::Start(location.offset))
            .and_then(|_| file.read_exact(&mut buffer))
            .map_err(|err| err.to_string())?;
        let frame = decode_frame(&buffer)?;
        if frame.positions.len() != particle_count * 3 {
            return Err(format!(
                "The Desmond trajectory has {} particles per frame, but the CMS describes {particle_count}.",
                frame.positions.len() / 3
            ));
        }
        frames.push(frame);
    }
    Ok(write_dcd(&frames, components, atom_count))
}

/// Writes a CHARMM-style DCD that Mol*'s reader accepts: no unit cell block
/// and no fixed atoms, coordinates in Å.
fn write_dcd(frames: &[DecodedFrame], components: &[(usize, usize)], atom_count: usize) -> Vec<u8> {
    let times: Vec<f64> = frames.iter().filter_map(|frame| frame.time_ps).collect();
    let step_ps = (times.len() == frames.len() && frames.len() > 1)
        .then(|| (times[times.len() - 1] - times[0]) / (frames.len() - 1) as f64)
        .filter(|step| step.is_finite() && *step > 0.0);
    let first_step = match (step_ps, times.first()) {
        (Some(step), Some(first)) => (first / step).round().max(0.0) as i32,
        _ => 0,
    };

    let mut out = Vec::with_capacity(frames.len() * (atom_count * 12 + 24) + 256);
    let push_i32 = |out: &mut Vec<u8>, value: i32| out.extend_from_slice(&value.to_le_bytes());
    let mut control = [0i32; 20];
    control[0] = frames.len() as i32;
    control[1] = first_step;
    control[2] = 1;
    control[19] = 24;
    push_i32(&mut out, 84);
    out.extend_from_slice(b"CORD");
    for (index, value) in control.iter().enumerate() {
        if index == 9 {
            let delta = step_ps.map_or(0.0, |step| step / CHARMM_TIME_UNIT_PS) as f32;
            out.extend_from_slice(&delta.to_le_bytes());
        } else {
            push_i32(&mut out, *value);
        }
    }
    push_i32(&mut out, 84);

    let mut title = [b' '; 80];
    let text = b"Burette Desmond trajectory preview";
    title[..text.len()].copy_from_slice(text);
    push_i32(&mut out, 84);
    push_i32(&mut out, 1);
    out.extend_from_slice(&title);
    push_i32(&mut out, 84);

    push_i32(&mut out, 4);
    push_i32(&mut out, atom_count as i32);
    push_i32(&mut out, 4);

    let block = (atom_count * 4) as i32;
    for frame in frames {
        for axis in 0..3 {
            push_i32(&mut out, block);
            let mut particle = 0;
            for (atoms, pseudo) in components {
                for atom in particle..particle + atoms {
                    out.extend_from_slice(&frame.positions[atom * 3 + axis].to_le_bytes());
                }
                particle += atoms + pseudo;
            }
            push_i32(&mut out, block);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// One frame laid out the way Desmond writes `WRAPPED_V_2` frames.
    fn dtr_frame(time: f64, positions: &[f32]) -> Vec<u8> {
        let labels = ["CHEMICAL_TIME", "FORMAT", "NACTIVE", "POSITION"];
        let types = "double\0char\0int32_t\0float\0";
        let label_block = labels.join("\0") + "\0";
        let meta: [(u32, u32, u32); 4] = [
            (0, 8, 1),
            (1, 1, 11),
            (2, 4, 1),
            (3, 4, positions.len() as u32),
        ];
        let mut scalars = time.to_le_bytes().to_vec();
        scalars.extend_from_slice(&((positions.len() / 3) as i32).to_le_bytes());
        scalars.resize(16, 0);
        let mut fields = b"WRAPPED_V_2".to_vec();
        fields.resize(16, 0);
        for value in positions {
            fields.extend_from_slice(&value.to_le_bytes());
        }
        fields.resize(fields.len().next_multiple_of(8), 0);

        let body = meta.len() * 16 + types.len() + label_block.len() + scalars.len() + fields.len();
        let size = (FRAME_HEADER_BYTES + body) as u32;
        let mut header = vec![0u8; FRAME_HEADER_BYTES];
        let mut put = |offset: usize, value: u32| {
            header[offset..offset + 4].copy_from_slice(&value.to_be_bytes())
        };
        put(0, FRAME_MAGIC);
        put(8, size);
        put(16, FRAME_HEADER_BYTES as u32);
        put(52, labels.len() as u32);
        put(56, (meta.len() * 16) as u32);
        put(60, types.len() as u32);
        put(64, label_block.len() as u32);
        put(68, scalars.len() as u32);
        put(72, fields.len() as u32);
        header[24..28].copy_from_slice(&0x1234_5678u32.to_le_bytes());

        let mut frame = header;
        for (type_index, element_size, count) in meta {
            for value in [type_index, element_size, count, 0] {
                frame.extend_from_slice(&value.to_be_bytes());
            }
        }
        frame.extend_from_slice(types.as_bytes());
        frame.extend_from_slice(label_block.as_bytes());
        frame.extend_from_slice(&scalars);
        frame.extend_from_slice(&fields);
        frame
    }

    #[test]
    fn reads_time_and_positions_from_a_frame() {
        let frame = decode_frame(&dtr_frame(12.5, &[1.0, 2.0, 3.0, 4.0, 5.0, 6.0])).unwrap();
        assert_eq!(frame.time_ps, Some(12.5));
        assert_eq!(frame.positions, vec![1.0, 2.0, 3.0, 4.0, 5.0, 6.0]);
    }

    #[test]
    fn dcd_drops_pseudo_particles_and_matches_the_molstar_layout() {
        let root = std::env::temp_dir().join(format!("burette-dtr-{}", std::process::id()));
        fs::create_dir_all(&root).unwrap();
        // Component one: two atoms and one pseudo particle; component two: one atom.
        let frame_positions = |shift: f32| -> Vec<f32> {
            [
                [0.0, 0.0, 0.0],
                [1.0, 1.0, 1.0],
                [9.0, 9.0, 9.0],
                [2.0, 2.0, 2.0],
            ]
            .iter()
            .flat_map(|xyz| xyz.map(|value| value + shift))
            .collect()
        };
        let mut file = dtr_frame(0.0, &frame_positions(0.0));
        file.extend(dtr_frame(10.0, &frame_positions(0.5)));
        let path = root.join("frame000000000");
        fs::write(&path, file).unwrap();

        let dcd = dcd_from_frames(&[path], &[(2, 1), (1, 0)], 3, 4).unwrap();
        let int = |offset: usize| i32::from_le_bytes(dcd[offset..offset + 4].try_into().unwrap());
        let float = |offset: usize| f32::from_le_bytes(dcd[offset..offset + 4].try_into().unwrap());
        assert_eq!(
            (int(0), &dcd[4..8], int(8), int(88)),
            (84, &b"CORD"[..], 2, 84)
        );
        // Independent reference: 10 ps / 0.04888821 ps per AKMA.
        assert!((float(44) - 204.548_3).abs() < 1e-3);
        assert_eq!(int(12), 0, "the first frame starts at time zero");
        let cache = root.join("cache.dcd");
        atomic_cache_write(&cache, &dcd[..100]).unwrap();
        assert!(!cached_dcd_complete(&cache));
        atomic_cache_write(&cache, &dcd).unwrap();
        assert!(cached_dcd_complete(&cache));
        let delta_ps = f64::from(float(44)) * CHARMM_TIME_UNIT_PS;
        assert!(
            (delta_ps - 10.0).abs() < 1e-3,
            "frame spacing {delta_ps} ps"
        );
        // Title block (84 + 8 bytes) then the atom count block.
        assert_eq!((int(184), int(188), int(192)), (4, 3, 4));
        let second_frame_x = 196 + 3 * (8 + 12) + 4;
        let xs: Vec<f32> = (0..3)
            .map(|atom| float(second_frame_x + atom * 4))
            .collect();
        assert_eq!(
            xs,
            vec![0.5, 1.5, 2.5],
            "the pseudo particle at 9.5 is dropped"
        );
        assert_eq!(dcd.len(), 196 + 2 * 3 * (8 + 12));

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn sampling_keeps_both_ends_of_the_run() {
        assert_eq!(sampled_frame_indices(3, 10), vec![0, 1, 2]);
        let indices = sampled_frame_indices(1002, 148);
        assert_eq!((indices.len(), indices[0], indices[147]), (148, 0, 1001));
    }
}
