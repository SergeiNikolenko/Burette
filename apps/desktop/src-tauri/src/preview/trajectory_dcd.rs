//! Bounded, constant-time random access to ordinary 32-bit-record DCD files.
use serde::{Deserialize, Serialize};
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

const MAX_ATOMS: usize = 2_000_000;
const MAX_FRAME_BYTES: usize = 64 * 1024 * 1024;
const MAX_TITLE_BYTES: usize = 64 * 1024;
const AKMA_PS: f64 = 0.048_888_21;

#[derive(Debug, Serialize, Deserialize)]
pub(super) struct DcdIndex {
    pub(super) atom_count: usize,
    pub(super) frame_count: usize,
    little_endian: bool,
    header: Vec<u8>,
    title: Vec<u8>,
    free_atoms: Vec<usize>,
    fixed_atoms: bool,
    cell: bool,
    four_dims: bool,
    first_offset: u64,
    first_stride: u64,
    next_stride: u64,
    source_size: u64,
    start_step: i32,
    save_interval: u32,
    delta_ps: f64,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(little: bool, fixed: bool, cell: bool, four: bool, xplor: bool) -> Vec<u8> {
        let mut header = vec![0; 84];
        header[..4].copy_from_slice(b"CORD");
        for (offset, value) in [
            (4, 3u32),
            (8, 100),
            (12, 5),
            (36, if fixed { 1 } else { 0 }),
            (40, 0.5f32.to_bits()),
            (44, u32::from(cell)),
            (48, u32::from(four)),
            (80, 24),
        ] {
            header[offset..offset + 4].copy_from_slice(&value.to_le_bytes());
        }
        if xplor {
            header[40..48].copy_from_slice(&0.5f64.to_le_bytes());
            header[80..84].fill(0);
        }
        if !little {
            normalize(&mut header[4..], 4, false);
            if xplor {
                header[40..48].copy_from_slice(&0.5f64.to_be_bytes());
            }
        }
        fn push(out: &mut Vec<u8>, data: &[u8], little: bool) {
            let marker = if little {
                (data.len() as u32).to_le_bytes()
            } else {
                (data.len() as u32).to_be_bytes()
            };
            out.extend_from_slice(&marker);
            out.extend_from_slice(data);
            out.extend_from_slice(&marker);
        }
        let bytes4 = |n: u32| {
            if little {
                n.to_le_bytes()
            } else {
                n.to_be_bytes()
            }
        };
        let mut out = Vec::new();
        push(&mut out, &header, little);
        push(&mut out, &bytes4(0), little);
        push(&mut out, &bytes4(2), little);
        if fixed {
            push(&mut out, &bytes4(2), little);
        }
        for frame in 0..3 {
            if cell {
                let cell = [10.0f64 + frame as f64, 0.125, 12.0, 0.25, 0.5, 14.0];
                let data: Vec<u8> = cell
                    .into_iter()
                    .flat_map(|n| {
                        if little {
                            n.to_le_bytes()
                        } else {
                            n.to_be_bytes()
                        }
                    })
                    .collect();
                push(&mut out, &data, little);
            }
            for axis in 0..if four { 4 } else { 3 } {
                let data: Vec<u8> = (0..2)
                    .filter(|&atom| !fixed || frame == 0 || atom == 1)
                    .flat_map(|atom| bytes4(((100 * frame + 10 * axis + atom) as f32).to_bits()))
                    .collect();
                push(&mut out, &data, little);
            }
        }
        out
    }

    fn with_file(bytes: &[u8], test: impl FnOnce(&Path)) {
        let path = std::env::temp_dir().join(format!("burette-dcd-{}.dcd", uuid::Uuid::new_v4()));
        std::fs::write(&path, bytes).unwrap();
        test(&path);
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn random_last_frame_preserves_coordinates_cells_and_timing() {
        for little in [true, false] {
            for fixed in [true, false] {
                with_file(&fixture(little, fixed, true, true, false), |path| {
                    let index = DcdIndex::open(path).unwrap();
                    assert_eq!((index.atom_count, index.frame_count), (2, 3));
                    assert!((index.time_ps(2) - 110.0 * 0.5 * AKMA_PS).abs() < 1e-12);
                    let output = index.frame(path, 2).unwrap();
                    with_file(&output, |single| {
                        let one = DcdIndex::open(single).unwrap();
                        assert_eq!(
                            (
                                one.atom_count,
                                one.frame_count,
                                one.fixed_atoms,
                                one.four_dims
                            ),
                            (2, 1, false, false)
                        );
                        let (cell, axes) = one
                            .coordinates(&mut File::open(single).unwrap(), 0)
                            .unwrap();
                        assert_eq!(f64::from_le_bytes(cell[8..16].try_into().unwrap()), 0.125);
                        assert_eq!(f64::from_le_bytes(cell[..8].try_into().unwrap()), 12.0);
                        for (axis, values) in axes.iter().enumerate() {
                            let values: Vec<f32> = values
                                .as_chunks::<4>()
                                .0
                                .iter()
                                .map(|v| f32::from_le_bytes(*v))
                                .collect();
                            assert_eq!(
                                values,
                                vec![
                                    (if fixed { 0 } else { 200 }) as f32 + axis as f32 * 10.0,
                                    201.0 + axis as f32 * 10.0
                                ]
                            );
                        }
                    });
                    assert!(index.frame(path, 3).is_err());
                });
            }
        }
    }

    #[test]
    fn xplor_double_delta_supports_both_byte_orders() {
        for little in [true, false] {
            with_file(&fixture(little, false, false, false, true), |path| {
                let index = DcdIndex::open(path).unwrap();
                assert_eq!(index.time_ps(1), 105.0 * 0.5 * AKMA_PS);
                with_file(&index.frame(path, 1).unwrap(), |path| {
                    assert_eq!(DcdIndex::open(path).unwrap().delta_ps, 0.5 * AKMA_PS);
                });
            });
        }
    }

    #[test]
    fn rejects_truncation_count_mismatch_and_corrupt_interior_record() {
        let original = fixture(true, false, false, false, false);
        with_file(&original[..original.len() - 1], |path| {
            assert!(DcdIndex::open(path).is_err())
        });
        let mut bad_count = original.clone();
        bad_count[8..12].copy_from_slice(&4u32.to_le_bytes());
        with_file(&bad_count, |path| assert!(DcdIndex::open(path).is_err()));
        with_file(&original, |path| {
            let index = DcdIndex::open(path).unwrap();
            let mut corrupt = original.clone();
            corrupt[(index.first_offset + index.first_stride) as usize] ^= 1;
            std::fs::write(path, corrupt).unwrap();
            assert!(index.frame(path, 1).is_err());
        });
    }
}

fn word(bytes: &[u8], little: bool) -> u32 {
    let value: [u8; 4] = bytes[..4].try_into().expect("four-byte DCD word");
    if little {
        u32::from_le_bytes(value)
    } else {
        u32::from_be_bytes(value)
    }
}

fn record(file: &mut File, little: bool, expected: usize) -> Result<Vec<u8>, String> {
    let mut marker = [0; 4];
    file.read_exact(&mut marker)
        .map_err(|e| format!("Truncated DCD record: {e}"))?;
    if word(&marker, little) as usize != expected {
        return Err("DCD record has an unexpected length.".into());
    }
    let mut data = vec![0; expected];
    file.read_exact(&mut data)
        .map_err(|e| format!("Truncated DCD data: {e}"))?;
    let mut end = [0; 4];
    file.read_exact(&mut end)
        .map_err(|e| format!("Truncated DCD trailer: {e}"))?;
    if marker != end {
        return Err("DCD record markers disagree.".into());
    }
    Ok(data)
}

fn append_record(out: &mut Vec<u8>, bytes: &[u8]) {
    out.extend_from_slice(&(bytes.len() as u32).to_le_bytes());
    out.extend_from_slice(bytes);
    out.extend_from_slice(&(bytes.len() as u32).to_le_bytes());
}

fn normalize(bytes: &mut [u8], width: usize, little: bool) {
    if !little {
        for value in bytes.chunks_exact_mut(width) {
            value.reverse();
        }
    }
}

impl DcdIndex {
    pub(super) fn open(path: &Path) -> Result<Self, String> {
        let mut file = File::open(path).map_err(|e| e.to_string())?;
        let source_size = file.metadata().map_err(|e| e.to_string())?.len();
        let mut marker = [0; 4];
        file.read_exact(&mut marker).map_err(|e| e.to_string())?;
        let little = if u32::from_le_bytes(marker) == 84 {
            true
        } else if u32::from_be_bytes(marker) == 84 {
            false
        } else {
            return Err("Unsupported DCD header or record-marker width.".into());
        };
        file.rewind().map_err(|e| e.to_string())?;
        let header = record(&mut file, little, 84)?;
        if &header[..4] != b"CORD" {
            return Err("DCD does not contain coordinates.".into());
        }
        let get = |offset| word(&header[offset..], little);
        let frame_count = get(4) as usize;
        let save_interval = get(12);
        let fixed_count = get(36) as usize;
        if frame_count == 0
            || frame_count > i32::MAX as usize
            || save_interval == 0
            || save_interval > i32::MAX as u32
        {
            return Err("DCD has an invalid frame count or save interval.".into());
        }
        let charmm = get(80) != 0;
        let delta = if charmm {
            f32::from_bits(get(40)) as f64
        } else {
            let bytes = header[40..48].try_into().expect("DCD double timestep");
            if little {
                f64::from_le_bytes(bytes)
            } else {
                f64::from_be_bytes(bytes)
            }
        };
        if !delta.is_finite() || delta < 0.0 {
            return Err("DCD has an invalid timestep.".into());
        }
        let title_offset = file.stream_position().map_err(|e| e.to_string())?;
        file.read_exact(&mut marker).map_err(|e| e.to_string())?;
        let title_size = word(&marker, little) as usize;
        if !(4..=MAX_TITLE_BYTES).contains(&title_size) || !(title_size - 4).is_multiple_of(80) {
            return Err("DCD title exceeds its limit or has an invalid length.".into());
        }
        file.seek(SeekFrom::Start(title_offset))
            .map_err(|e| e.to_string())?;
        let title = record(&mut file, little, title_size)?;
        if word(&title, little) as usize != (title_size - 4) / 80 {
            return Err("DCD title count disagrees with its record length.".into());
        }
        let atom_count = word(&record(&mut file, little, 4)?, little) as usize;
        if atom_count == 0 || atom_count > MAX_ATOMS || fixed_count > atom_count {
            return Err("DCD atom count exceeds its limit or is invalid.".into());
        }
        let mut free_atoms = Vec::new();
        if fixed_count > 0 {
            let indices = record(&mut file, little, (atom_count - fixed_count) * 4)?;
            let mut seen = vec![false; atom_count];
            for bytes in indices.as_chunks::<4>().0 {
                let index = word(bytes, little) as usize;
                if index == 0 || index > atom_count || seen[index - 1] {
                    return Err("DCD free-atom indices are invalid or duplicated.".into());
                }
                seen[index - 1] = true;
                free_atoms.push(index - 1);
            }
        }
        let cell = charmm && get(44) != 0;
        let four_dims = charmm && get(48) != 0;
        let stride = |count: usize| -> u64 {
            (if cell { 56 } else { 0 }) + ((count as u64 * 4 + 8) * if four_dims { 4 } else { 3 })
        };
        let first_stride = stride(atom_count);
        if first_stride > MAX_FRAME_BYTES as u64 {
            return Err("DCD frame exceeds its byte limit.".into());
        }
        let next_stride = stride(if fixed_count > 0 {
            free_atoms.len()
        } else {
            atom_count
        });
        let first_offset = file.stream_position().map_err(|e| e.to_string())?;
        let end = first_offset
            .checked_add(first_stride)
            .and_then(|v| v.checked_add(next_stride.checked_mul((frame_count - 1) as u64)?));
        if end != Some(source_size) {
            return Err(
                "DCD frame count disagrees with its file length (possibly truncated).".into(),
            );
        }
        let index = Self {
            atom_count,
            frame_count,
            little_endian: little,
            start_step: get(8) as i32,
            save_interval,
            delta_ps: delta * AKMA_PS,
            header,
            title,
            free_atoms,
            fixed_atoms: fixed_count > 0,
            cell,
            four_dims,
            first_offset,
            first_stride,
            next_stride,
            source_size,
        };
        // File length and end records verify constant layout without scanning a
        // multi-terabyte trajectory; interior markers are checked on each seek.
        index.check_frame(&mut file, 0)?;
        if frame_count > 1 {
            index.check_frame(&mut file, frame_count - 1)?;
        }
        Ok(index)
    }

    pub(super) fn time_ps(&self, index: usize) -> f64 {
        (self.start_step as f64 + index as f64 * self.save_interval as f64) * self.delta_ps
    }

    fn seek_frame(&self, file: &mut File, index: usize) -> Result<usize, String> {
        if index >= self.frame_count {
            return Err("DCD frame index is out of range.".into());
        }
        let offset = if index == 0 {
            self.first_offset
        } else {
            self.next_stride
                .checked_mul((index - 1) as u64)
                .and_then(|v| v.checked_add(self.first_stride))
                .and_then(|v| v.checked_add(self.first_offset))
                .ok_or("DCD frame offset overflow.")?
        };
        file.seek(SeekFrom::Start(offset))
            .map_err(|e| e.to_string())?;
        Ok(if index > 0 && self.fixed_atoms {
            self.free_atoms.len()
        } else {
            self.atom_count
        })
    }

    fn check_frame(&self, file: &mut File, index: usize) -> Result<(), String> {
        let count = self.seek_frame(file, index)?;
        let lengths = self
            .cell
            .then_some(48)
            .into_iter()
            .chain(std::iter::repeat_n(
                count * 4,
                if self.four_dims { 4 } else { 3 },
            ));
        for length in lengths {
            let mut marker = [0; 4];
            file.read_exact(&mut marker).map_err(|e| e.to_string())?;
            if word(&marker, self.little_endian) as usize != length {
                return Err("DCD frame record length is invalid.".into());
            }
            file.seek(SeekFrom::Current(length as i64))
                .map_err(|e| e.to_string())?;
            let mut end = [0; 4];
            file.read_exact(&mut end).map_err(|e| e.to_string())?;
            if end != marker {
                return Err("DCD frame record markers disagree.".into());
            }
        }
        Ok(())
    }

    fn coordinates(
        &self,
        file: &mut File,
        index: usize,
    ) -> Result<(Vec<u8>, Vec<Vec<u8>>), String> {
        let count = self.seek_frame(file, index)?;
        let mut cell = if self.cell {
            record(file, self.little_endian, 48)?
        } else {
            Vec::new()
        };
        normalize(&mut cell, 8, self.little_endian);
        let mut axes = Vec::with_capacity(3);
        for _ in 0..3 {
            let mut axis = record(file, self.little_endian, count * 4)?;
            normalize(&mut axis, 4, self.little_endian);
            axes.push(axis);
        }
        if self.four_dims {
            self.check_frame(file, index)?;
        }
        Ok((cell, axes))
    }

    /// Return one standalone LE frame; fixed coordinates come from frame zero.
    pub(super) fn frame(&self, path: &Path, index: usize) -> Result<Vec<u8>, String> {
        if self.atom_count == 0
            || self.atom_count > MAX_ATOMS
            || self.header.len() != 84
            || self.title.len() > MAX_TITLE_BYTES
            || self.title.len() < 4
        {
            return Err("Invalid cached DCD index.".into());
        }
        let mut file = File::open(path).map_err(|e| e.to_string())?;
        if file.metadata().map_err(|e| e.to_string())?.len() != self.source_size {
            return Err("DCD changed after indexing.".into());
        }
        let (cell, mut axes) = self.coordinates(&mut file, index)?;
        if self.fixed_atoms && index > 0 {
            let (_, mut expanded) = self.coordinates(&mut file, 0)?;
            for axis in 0..3 {
                for (free, &atom) in self.free_atoms.iter().enumerate() {
                    if atom >= self.atom_count {
                        return Err("Invalid cached DCD free-atom index.".into());
                    }
                    expanded[axis][atom * 4..atom * 4 + 4]
                        .copy_from_slice(&axes[axis][free * 4..free * 4 + 4]);
                }
            }
            axes = expanded;
        }
        let mut header = self.header.clone();
        normalize(&mut header[4..], 4, self.little_endian);
        // X-PLOR stores DELTA as a double spanning two header words.
        if word(&self.header[80..], self.little_endian) == 0 {
            header[40..48].copy_from_slice(&self.header[40..48]);
            normalize(&mut header[40..48], 8, self.little_endian);
        } else {
            header[48..52].copy_from_slice(&0u32.to_le_bytes());
        }
        header[4..8].copy_from_slice(&1u32.to_le_bytes());
        header[8..12].copy_from_slice(&0u32.to_le_bytes());
        header[12..16].copy_from_slice(&1u32.to_le_bytes());
        header[36..40].copy_from_slice(&0u32.to_le_bytes());
        let mut title = self.title.clone();
        normalize(&mut title[..4], 4, self.little_endian);
        let mut output = Vec::with_capacity(self.atom_count * 12 + title.len() + 180);
        append_record(&mut output, &header);
        append_record(&mut output, &title);
        append_record(&mut output, &(self.atom_count as u32).to_le_bytes());
        if self.cell {
            append_record(&mut output, &cell);
        }
        for axis in axes {
            append_record(&mut output, &axis);
        }
        Ok(output)
    }
}
