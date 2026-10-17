//! Plays a Desmond `-out.cms` + `_trj/` pair in Mol* without Schrödinger.
//!
//! Mol* receives the CMS topology and one decoded original frame at a time.
//! Frame locations are persisted as fixed-size disk records; only the requested
//! frame and its source time/cell are decoded. No temporal subsampling occurs.
//!
//! A DTR frame file holds consecutive frames. Each frame starts with a
//! big-endian header, followed by label metadata, then the values themselves in
//! the writer's native byte order: single values packed in a scalar block, arrays
//! in a field block padded to eight bytes.

use super::text_xyz::desmond_topology_from_cms;
use super::trajectory::IndexedFrame;
use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::io::{BufWriter, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};

const FRAME_MAGIC: u32 = 0x4445_534D; // "DESM"
const FRAME_HEADER_BYTES: usize = 96;
/// Keeps the DCD comfortably inside the 75 MiB structure payload limit.
#[cfg(test)]
const DCD_BYTE_BUDGET: usize = 64 * 1024 * 1024;
/// Standard AKMA -> ps conversion, also used by MDAnalysis and VMD.
const CHARMM_TIME_UNIT_PS: f64 = 0.048_888_21;
const FRAME_BYTE_LIMIT: u64 = 64 * 1024 * 1024;
const PARTICLE_LIMIT: usize = 5_000_000;

#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
struct FrameLocation {
    file: usize,
    offset: u64,
    size: u64,
}

struct DecodedFrame {
    time_ps: Option<f64>,
    positions: Vec<f32>,
    cell: Option<[f64; 9]>,
}

#[derive(Debug, Serialize, Deserialize)]
pub(super) struct DesmondIndex {
    cms: PathBuf,
    files: Vec<PathBuf>,
    locations: Vec<FrameLocation>,
    components: Vec<(usize, usize)>,
    pub(super) atom_count: usize,
    particle_count: usize,
}

impl DesmondIndex {
    pub(super) fn open(cms: &Path, trj_dir: &Path) -> Result<(Self, Vec<u8>), String> {
        if fs::metadata(cms).map_err(|e| e.to_string())?.len() > FRAME_BYTE_LIMIT {
            return Err("Desmond topology exceeds its byte limit.".into());
        }
        let topology = desmond_topology_from_cms(&fs::read(cms).map_err(|e| e.to_string())?)
            .ok_or("Desmond topology has no full-system atom table.")?;
        let atom_count = topology.components.iter().map(|(atoms, _)| atoms).sum();
        let particle_count = topology
            .components
            .iter()
            .map(|(atoms, pseudo)| atoms + pseudo)
            .sum();
        if particle_count == 0 || particle_count > PARTICLE_LIMIT {
            return Err("Desmond particle count exceeds its limit or is invalid.".into());
        }
        let files = dtr_frame_files(trj_dir)?;
        let locations = locate_frames(&files)?;
        Ok((
            Self {
                cms: cms.to_path_buf(),
                files,
                locations,
                components: topology.components,
                atom_count,
                particle_count,
            },
            topology.pdb,
        ))
    }

    pub(super) fn source_paths(&self) -> Vec<PathBuf> {
        std::iter::once(self.cms.clone())
            .chain(self.files.iter().cloned())
            .collect()
    }

    pub(super) fn frame_count(&self) -> usize {
        self.locations.len()
    }

    pub(super) fn write_locations(&self, path: &Path) -> Result<(), String> {
        let mut writer = BufWriter::new(File::create(path).map_err(|e| e.to_string())?);
        for location in &self.locations {
            for value in [location.file as u64, location.offset, location.size] {
                writer
                    .write_all(&value.to_le_bytes())
                    .map_err(|e| e.to_string())?;
            }
        }
        writer.flush().map_err(|e| e.to_string())?;
        writer.get_ref().sync_all().map_err(|e| e.to_string())
    }

    pub(super) fn detach_locations(&mut self) {
        self.locations = Vec::new();
    }

    pub(super) fn frame_from_index(
        &self,
        path: &Path,
        index: usize,
    ) -> Result<IndexedFrame, String> {
        let mut file = File::open(path).map_err(|e| e.to_string())?;
        let length = file.metadata().map_err(|e| e.to_string())?.len();
        let offset = (index as u64)
            .checked_mul(24)
            .ok_or("Desmond index offset overflow.")?;
        if !length.is_multiple_of(24) || offset >= length {
            return Err("Desmond frame index is out of range or truncated.".into());
        }
        let mut bytes = [0; 24];
        file.seek(SeekFrom::Start(offset))
            .and_then(|_| file.read_exact(&mut bytes))
            .map_err(|e| e.to_string())?;
        let file = usize::try_from(u64::from_le_bytes(bytes[..8].try_into().unwrap()))
            .map_err(|e| e.to_string())?;
        self.decode_location(FrameLocation {
            file,
            offset: u64::from_le_bytes(bytes[8..16].try_into().unwrap()),
            size: u64::from_le_bytes(bytes[16..].try_into().unwrap()),
        })
    }

    pub(super) fn frame(&self, index: usize) -> Result<IndexedFrame, String> {
        let location = *self
            .locations
            .get(index)
            .ok_or("Desmond frame index is out of range.")?;
        self.decode_location(location)
    }

    fn decode_location(&self, location: FrameLocation) -> Result<IndexedFrame, String> {
        if self.particle_count == 0
            || self.particle_count > PARTICLE_LIMIT
            || self.atom_count == 0
            || location.size > FRAME_BYTE_LIMIT
        {
            return Err("Desmond frame exceeds its byte or particle limit.".into());
        }
        let totals =
            self.components
                .iter()
                .try_fold((0usize, 0usize), |(atoms, particles), (a, p)| {
                    Some((
                        atoms.checked_add(*a)?,
                        particles.checked_add(*a)?.checked_add(*p)?,
                    ))
                });
        if totals != Some((self.atom_count, self.particle_count)) {
            return Err("Invalid cached Desmond component counts.".into());
        }
        let path = self
            .files
            .get(location.file)
            .ok_or("Invalid Desmond frame file index.")?;
        let mut file = File::open(path).map_err(|e| e.to_string())?;
        let mut bytes = vec![0; location.size as usize];
        file.seek(SeekFrom::Start(location.offset))
            .and_then(|_| file.read_exact(&mut bytes))
            .map_err(|e| format!("Desmond frame changed or is truncated: {e}"))?;
        let frame = decode_frame(&bytes)?;
        if frame.positions.len() != self.particle_count * 3 {
            return Err("Desmond frame particle count disagrees with its topology.".into());
        }
        let (time, cell) = (frame.time_ps, frame.cell);
        Ok((
            write_dcd(&[frame], &self.components, self.atom_count),
            time,
            cell,
        ))
    }
}

#[cfg(test)]
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

#[cfg(test)]
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
        while offset < length {
            if length - offset < FRAME_HEADER_BYTES as u64 {
                return Err("Truncated trailing Desmond frame header.".into());
            }
            file.seek(SeekFrom::Start(offset))
                .and_then(|_| file.read_exact(&mut header))
                .map_err(|err| err.to_string())?;
            if be_u32(&header, 0) != Some(FRAME_MAGIC) {
                return Err("Malformed trailing Desmond frame header.".into());
            }
            let size = u64::from(be_u32(&header, 8).unwrap_or(0))
                | (u64::from(be_u32(&header, 12).unwrap_or(0)) << 32);
            if size < FRAME_HEADER_BYTES as u64 || size > FRAME_BYTE_LIMIT || size > length - offset
            {
                return Err("Desmond frame is truncated or exceeds its byte limit.".into());
            }
            if frames.len() >= 1_000_000 {
                return Err("Desmond frame index exceeds its entry limit.".into());
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
    let frame_size = u64::from(be_u32(bytes, 8).ok_or_else(malformed)?)
        | (u64::from(be_u32(bytes, 12).ok_or_else(malformed)?) << 32);
    if be_u32(bytes, 0) != Some(FRAME_MAGIC)
        || frame_size != bytes.len() as u64
        || frame_size > FRAME_BYTE_LIMIT
        || header_size < FRAME_HEADER_BYTES
    {
        return Err(malformed());
    }
    // The writer stores 0x12345678 in its own byte order, which fixes the order
    // of every value after the header.
    let little_endian = bytes.get(24..28).ok_or_else(malformed)? == [0x78, 0x56, 0x34, 0x12];
    if !little_endian && bytes.get(24..28) != Some(&[0x12, 0x34, 0x56, 0x78]) {
        return Err(malformed());
    }
    let label_count = header(52).ok_or_else(malformed)?;
    let [meta_size, type_size, label_size, scalar_size] =
        [56, 60, 64, 68].map(|offset| header(offset).unwrap_or(0));
    if label_count > 4096
        || meta_size < label_count * 16
        || type_size > 64 * 1024
        || label_size > 256 * 1024
    {
        return Err(malformed());
    }
    let type_start = header_size.checked_add(meta_size).ok_or_else(malformed)?;
    let label_start = type_start.checked_add(type_size).ok_or_else(malformed)?;
    let scalar_start = label_start.checked_add(label_size).ok_or_else(malformed)?;
    let scalar_end = scalar_start
        .checked_add(scalar_size)
        .ok_or_else(malformed)?;
    let field_end = scalar_end
        .checked_add(header(72).ok_or_else(malformed)?)
        .ok_or_else(malformed)?;
    if field_end > bytes.len() {
        return Err(malformed());
    }
    let names = |start: usize, size: usize| -> Vec<String> {
        bytes
            .get(start..start + size)
            .unwrap_or_default()
            .split(|byte| *byte == 0)
            .map(|name| String::from_utf8_lossy(name).into_owned())
            .collect()
    };
    let type_names = names(type_start, type_size);
    let labels = names(label_start, label_size);
    let mut scalar = scalar_start;
    let mut field = scalar_end;
    let mut time_ps = None;
    let mut positions = None;
    let mut cell = None;
    for index in 0..label_count {
        let meta = header_size + index * 16;
        let type_name = type_names
            .get(be_u32(bytes, meta).ok_or_else(malformed)? as usize)
            .map(String::as_str)
            .unwrap_or_default();
        let element_size = be_u32(bytes, meta + 4).ok_or_else(malformed)? as usize;
        let count = be_u32(bytes, meta + 8).ok_or_else(malformed)? as usize;
        if element_size == 0 || element_size > 16 {
            return Err(malformed());
        }
        let byte_count = element_size.checked_mul(count).ok_or_else(malformed)?;
        let start = if count <= 1 {
            scalar = scalar
                .checked_next_multiple_of(element_size)
                .ok_or_else(malformed)?;
            let start = scalar;
            scalar = scalar
                .checked_add(byte_count)
                .filter(|end| *end <= scalar_end)
                .ok_or_else(malformed)?;
            start
        } else {
            let start = field;
            field = field
                .checked_add(
                    byte_count
                        .checked_next_multiple_of(8)
                        .ok_or_else(malformed)?,
                )
                .filter(|end| *end <= field_end)
                .ok_or_else(malformed)?;
            start
        };
        let value = bytes.get(start..start + byte_count).ok_or_else(malformed)?;
        match (labels.get(index).map(String::as_str), type_name) {
            (Some("BOX" | "UNITCELL"), "double" | "float") if count == 9 => {
                let width = if type_name == "double" { 8 } else { 4 };
                if element_size != width {
                    return Err(malformed());
                }
                let mut basis = [0.0; 9];
                for (i, coordinate) in basis.iter_mut().enumerate() {
                    let raw = &value[i * width..(i + 1) * width];
                    *coordinate = if width == 8 {
                        if little_endian {
                            f64::from_le_bytes(raw.try_into().unwrap())
                        } else {
                            f64::from_be_bytes(raw.try_into().unwrap())
                        }
                    } else {
                        f64::from(if little_endian {
                            f32::from_le_bytes(raw.try_into().unwrap())
                        } else {
                            f32::from_be_bytes(raw.try_into().unwrap())
                        })
                    };
                }
                if basis.iter().any(|value| !value.is_finite()) {
                    return Err(malformed());
                }
                cell = Some(basis);
            }
            (Some("CHEMICAL_TIME"), "double") if count == 1 => {
                let raw: [u8; 8] = value.try_into().map_err(|_| malformed())?;
                time_ps = Some(if little_endian {
                    f64::from_le_bytes(raw)
                } else {
                    f64::from_be_bytes(raw)
                });
                if !time_ps.is_some_and(f64::is_finite) {
                    return Err(malformed());
                }
            }
            (Some("POSITION"), "float")
                if element_size == 4 && count <= PARTICLE_LIMIT * 3 && count.is_multiple_of(3) =>
            {
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
            (Some("POSITION"), "double")
                if element_size == 8 && count <= PARTICLE_LIMIT * 3 && count.is_multiple_of(3) =>
            {
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
        cell,
        positions: positions
            .ok_or_else(|| "Desmond trajectory frame has no POSITION field.".to_string())?,
    })
}

/// Evenly spaced frame indices that always include the first and last frame.
#[cfg(test)]
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

#[cfg(test)]
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
        dtr_frame_with_box(time, positions, None)
    }

    fn dtr_frame_with_box(time: f64, positions: &[f32], cell: Option<[f64; 9]>) -> Vec<u8> {
        let mut labels = vec!["CHEMICAL_TIME", "FORMAT", "NACTIVE", "POSITION"];
        let types = "double\0char\0int32_t\0float\0";
        let mut meta: Vec<(u32, u32, u32)> = vec![
            (0, 8, 1),
            (1, 1, 11),
            (2, 4, 1),
            (3, 4, positions.len() as u32),
        ];
        if cell.is_some() {
            labels.push("BOX");
            meta.push((0, 8, 9));
        }
        let mut label_block = (labels.join("\0") + "\0").into_bytes();
        while !(FRAME_HEADER_BYTES + meta.len() * 16 + types.len() + label_block.len())
            .is_multiple_of(8)
        {
            label_block.push(0);
        }
        let mut scalars = time.to_le_bytes().to_vec();
        scalars.extend_from_slice(&((positions.len() / 3) as i32).to_le_bytes());
        scalars.resize(16, 0);
        let mut fields = b"WRAPPED_V_2".to_vec();
        fields.resize(16, 0);
        for value in positions {
            fields.extend_from_slice(&value.to_le_bytes());
        }
        fields.resize(fields.len().next_multiple_of(8), 0);
        if let Some(cell) = cell {
            for value in cell {
                fields.extend_from_slice(&value.to_le_bytes());
            }
        }

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
        frame.extend_from_slice(&label_block);
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
    fn original_last_frame_preserves_time_box_and_drops_pseudo_particles() {
        let root =
            std::env::temp_dir().join(format!("burette-dtr-direct-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let path = root.join("frame000000000");
        let basis = [10.0, 0.0, 0.0, 1.0, 11.0, 0.0, 0.0, 2.0, 12.0];
        let mut bytes = dtr_frame(0.0, &[0.0; 9]);
        bytes.extend(dtr_frame_with_box(
            123.5,
            &[1.0, 2.0, 3.0, 99.0, 99.0, 99.0, 4.0, 5.0, 6.0],
            Some(basis),
        ));
        fs::write(&path, &bytes).unwrap();
        let mut index = DesmondIndex {
            cms: root.join("topology.cms"),
            files: vec![path.clone()],
            locations: locate_frames(std::slice::from_ref(&path)).unwrap(),
            components: vec![(1, 1), (1, 0)],
            atom_count: 2,
            particle_count: 3,
        };
        assert_eq!(index.frame_count(), 2);
        let (dcd, time, cell) = index.frame(1).unwrap();
        let locations_path = root.join("locations.bin");
        index.write_locations(&locations_path).unwrap();
        index.detach_locations();
        assert_eq!(
            index.frame_from_index(&locations_path, 1).unwrap(),
            (dcd.clone(), time, cell)
        );
        assert!(index.frame_from_index(&locations_path, 2).is_err());
        assert_eq!((time, cell), (Some(123.5), Some(basis)));
        let xs: Vec<f32> = dcd[200..208]
            .chunks_exact(4)
            .map(|v| f32::from_le_bytes(v.try_into().unwrap()))
            .collect();
        assert_eq!(xs, vec![1.0, 4.0]);
        fs::write(&path, &bytes[..bytes.len() - 1]).unwrap();
        assert!(index.frame_from_index(&locations_path, 1).is_err());
        assert!(locate_frames(std::slice::from_ref(&path)).is_err());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_trailing_garbage_and_oversized_frames() {
        let root =
            std::env::temp_dir().join(format!("burette-dtr-invalid-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let path = root.join("frame000000000");
        let mut bytes = dtr_frame(0.0, &[0.0; 3]);
        bytes.push(0);
        fs::write(&path, &bytes).unwrap();
        assert!(locate_frames(std::slice::from_ref(&path)).is_err());
        bytes[8..12].copy_from_slice(&((FRAME_BYTE_LIMIT + 1) as u32).to_be_bytes());
        assert!(decode_frame(&bytes).is_err());
        fs::remove_dir_all(root).unwrap();
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
