//! Readers for multi-model PDB, XYZ and CHARMM DCD, and the DCD writer.
//!
//! Coordinates are parsed as `f32`, the precision MDAnalysis keeps, and widened
//! to `f64` so the numbers match the Python runner's.

use std::fs::File;
use std::io::{BufWriter, Write};
use std::path::Path;

/// Solvent and ion residue names that keep their source coordinates and stay
/// out of the alignment and the signal (`PRESERVED_SELECTION` in the runner).
const PRESERVED_RESIDUES: [&str; 18] = [
    "HOH", "WAT", "SOL", "TIP3", "TIP4", "TIP5", "TIP3P", "TIP4P", "TIP5P", "T3P", "T4P", "T5P",
    "NA", "CL", "K", "MG", "CA", "ZN",
];
/// MDAnalysis' AKMA time unit in picoseconds.
const AKMA_PS: f64 = 4.888821e-2;
/// The DCD unit-cell record MDAnalysis writes for a frame without a box.
const NO_CELL: [f64; 6] = [0.0, 1.0, 0.0, 1.0, 1.0, 0.0];

pub struct Trajectory {
    pub atom_count: usize,
    /// One flat `[x0, y0, z0, ...]` vector per frame.
    pub frames: Vec<Vec<f64>>,
    /// Raw DCD unit-cell records, one per frame, when the source has them.
    pub cells: Option<Vec<[f64; 6]>>,
    /// Time between frames in AKMA units, for the output header.
    pub delta: f32,
}

fn is_atom_record(line: &[u8]) -> bool {
    line.starts_with(b"ATOM") || line.starts_with(b"HETATM")
}

fn field(line: &[u8], start: usize, end: usize) -> &str {
    std::str::from_utf8(line.get(start..end.min(line.len())).unwrap_or_default())
        .unwrap_or_default()
        .trim()
}

fn coordinate(text: &str) -> Result<f64, String> {
    text.parse::<f32>()
        .map(f64::from)
        .map_err(|_| format!("Invalid coordinate {text:?}."))
}

fn lines(bytes: &[u8]) -> impl Iterator<Item = &[u8]> {
    bytes
        .split(|byte| *byte == b'\n')
        .map(|line| line.strip_suffix(b"\r").unwrap_or(line))
}

/// Indices of the atoms of the first PDB model that are not solvent or ions.
/// The second value is the model's atom count.
pub fn pdb_mobile_atoms(bytes: &[u8]) -> (Vec<usize>, usize) {
    let mut mobile = Vec::new();
    let mut count = 0;
    for line in lines(bytes) {
        if line.starts_with(b"ENDMDL") {
            break;
        }
        if is_atom_record(line) {
            if !PRESERVED_RESIDUES.contains(&field(line, 17, 21)) {
                mobile.push(count);
            }
            count += 1;
        }
    }
    (mobile, count)
}

/// Every model of a PDB file as one frame.
pub fn read_pdb(
    bytes: &[u8],
    on_frame: &mut dyn FnMut(usize, usize),
) -> Result<Trajectory, String> {
    let total = lines(bytes)
        .filter(|line| line.starts_with(b"ENDMDL"))
        .count();
    let mut frames: Vec<Vec<f64>> = Vec::new();
    let mut current = Vec::new();
    for line in lines(bytes) {
        if is_atom_record(line) {
            for start in [30, 38, 46] {
                current.push(coordinate(field(line, start, start + 8))?);
            }
        } else if line.starts_with(b"ENDMDL") && !current.is_empty() {
            let capacity = current.len();
            frames.push(std::mem::replace(
                &mut current,
                Vec::with_capacity(capacity),
            ));
            on_frame(frames.len(), total);
        }
    }
    if !current.is_empty() {
        frames.push(current);
    }
    finish_text_trajectory(frames)
}

/// Every frame of an XYZ file.
pub fn read_xyz(
    bytes: &[u8],
    on_frame: &mut dyn FnMut(usize, usize),
) -> Result<Trajectory, String> {
    let text =
        std::str::from_utf8(bytes).map_err(|_| "The XYZ file is not UTF-8 text.".to_string())?;
    let mut rows = text.lines();
    let mut frames = Vec::new();
    let mut total = 0;
    while let Some(header) = rows.next() {
        if header.trim().is_empty() {
            continue;
        }
        let atom_count: usize = header
            .split_whitespace()
            .next()
            .and_then(|value| value.parse().ok())
            .ok_or_else(|| format!("Invalid XYZ atom count {header:?}."))?;
        rows.next();
        let mut frame = Vec::with_capacity(3 * atom_count);
        for _ in 0..atom_count {
            let row = rows.next().ok_or("The XYZ file ends inside a frame.")?;
            let mut columns = row.split_whitespace().skip(1);
            for _ in 0..3 {
                frame.push(coordinate(
                    columns.next().ok_or("An XYZ atom line is incomplete.")?,
                )?);
            }
        }
        if total == 0 {
            // Frames are the same size, so the first one sizes the file.
            total = text.lines().count() / (atom_count + 2);
        }
        frames.push(frame);
        on_frame(frames.len(), total);
    }
    finish_text_trajectory(frames)
}

fn finish_text_trajectory(frames: Vec<Vec<f64>>) -> Result<Trajectory, String> {
    let atom_count = frames.first().map_or(0, |frame| frame.len() / 3);
    if atom_count == 0 || frames.iter().any(|frame| frame.len() != 3 * atom_count) {
        return Err("Trajectory frames do not share one atom count.".into());
    }
    Ok(Trajectory {
        atom_count,
        frames,
        cells: None,
        // MDAnalysis assumes 1 ps between frames of a text trajectory.
        delta: (1.0 / AKMA_PS) as f32,
    })
}

struct Cursor<'a> {
    bytes: &'a [u8],
    offset: usize,
    big_endian: bool,
}

impl Cursor<'_> {
    fn take<const N: usize>(&mut self) -> Result<[u8; N], String> {
        let chunk = self
            .bytes
            .get(self.offset..self.offset + N)
            .ok_or("The DCD file is truncated.")?;
        self.offset += N;
        let mut value = [0; N];
        value.copy_from_slice(chunk);
        if self.big_endian {
            value.reverse();
        }
        Ok(value)
    }

    fn int(&mut self) -> Result<i32, String> {
        Ok(i32::from_le_bytes(self.take()?))
    }

    fn size(&mut self) -> Result<usize, String> {
        usize::try_from(self.int()?).map_err(|_| "The DCD file is corrupt.".to_string())
    }

    /// One Fortran record of `count` 4-byte floats.
    fn floats(&mut self, count: usize, axis: usize, frame: &mut [f64]) -> Result<(), String> {
        if self.size()? != 4 * count {
            return Err("Unexpected DCD coordinate record size.".into());
        }
        for atom in 0..count {
            frame[3 * atom + axis] = f64::from(f32::from_le_bytes(self.take()?));
        }
        self.offset += 4;
        Ok(())
    }
}

/// A CHARMM/NAMD DCD file with 32-bit record markers and no fixed atoms.
pub fn read_dcd(
    bytes: &[u8],
    on_frame: &mut dyn FnMut(usize, usize),
) -> Result<Trajectory, String> {
    let big_endian = match bytes.get(..4) {
        Some([84, 0, 0, 0]) => false,
        Some([0, 0, 0, 84]) => true,
        _ => return Err("Unsupported DCD header.".into()),
    };
    let mut cursor = Cursor {
        bytes,
        offset: 4,
        big_endian,
    };
    if bytes.get(4..8) != Some(b"CORD") {
        return Err("Unsupported DCD header.".into());
    }
    cursor.offset = 8;
    let mut control = [0_i32; 20];
    for value in control.iter_mut() {
        *value = cursor.int()?;
    }
    let (fixed_atoms, has_cell, has_fourth_dimension, charmm) = (
        control[8],
        control[10] != 0,
        control[11] != 0,
        control[19] != 0,
    );
    if fixed_atoms != 0 || has_fourth_dimension || !charmm {
        return Err("This DCD variant needs the Python runner.".into());
    }
    let step_delta = f32::from_bits(control[9] as u32);
    let steps_per_frame = control[2].max(1);
    cursor.offset += 4;
    let title_size = cursor.size()?;
    cursor.offset += title_size + 4;
    cursor.offset += 4;
    let atom_count = cursor.size()?;
    cursor.offset += 4;
    let frame_size = if has_cell { 56 } else { 0 } + 3 * (8 + 4 * atom_count);
    if atom_count == 0 || cursor.offset > bytes.len() {
        return Err("The DCD file has no atoms.".into());
    }
    let frame_count = (bytes.len() - cursor.offset) / frame_size;
    let mut frames = Vec::with_capacity(frame_count);
    let mut cells = Vec::with_capacity(if has_cell { frame_count } else { 0 });
    for index in 0..frame_count {
        if has_cell {
            if cursor.int()? != 48 {
                return Err("Unexpected DCD unit-cell record size.".into());
            }
            let mut cell = [0.0; 6];
            for value in cell.iter_mut() {
                *value = f64::from_le_bytes(cursor.take()?);
            }
            cursor.offset += 4;
            cells.push(cell);
        }
        let mut frame = vec![0.0; 3 * atom_count];
        for axis in 0..3 {
            cursor.floats(atom_count, axis, &mut frame)?;
        }
        frames.push(frame);
        on_frame(index + 1, frame_count);
    }
    Ok(Trajectory {
        atom_count,
        frames,
        cells: has_cell.then_some(cells),
        delta: step_delta * steps_per_frame as f32,
    })
}

/// Write frames as a little-endian CHARMM DCD, laid out as MDAnalysis writes it.
/// `cells` carries the source box per frame; without it the box is omitted.
pub fn write_dcd(
    path: &Path,
    trajectory: &Trajectory,
    cells: Option<&[[f64; 6]]>,
    on_frame: &mut dyn FnMut(usize, usize),
) -> Result<(), String> {
    let failed = |error: std::io::Error| format!("Could not write {}: {error}", path.display());
    let mut out = BufWriter::new(File::create(path).map_err(failed)?);
    let atoms = trajectory.atom_count;
    let frame_count = trajectory.frames.len();
    let mut header = Vec::with_capacity(276 + 12);
    let mut control = [0_i32; 20];
    control[0] = frame_count as i32;
    control[2] = 1;
    control[9] = trajectory.delta.to_bits() as i32;
    control[10] = 1;
    control[19] = 24;
    header.extend(84_i32.to_le_bytes());
    header.extend(b"CORD");
    for value in control {
        header.extend(value.to_le_bytes());
    }
    header.extend(84_i32.to_le_bytes());
    header.extend(244_i32.to_le_bytes());
    header.extend(3_i32.to_le_bytes());
    header.extend([0_u8; 240]);
    header.extend(244_i32.to_le_bytes());
    header.extend(4_i32.to_le_bytes());
    header.extend((atoms as i32).to_le_bytes());
    header.extend(4_i32.to_le_bytes());
    out.write_all(&header).map_err(failed)?;
    let record = (4 * atoms as i32).to_le_bytes();
    let mut buffer = Vec::with_capacity(56 + 3 * (8 + 4 * atoms));
    for (index, frame) in trajectory.frames.iter().enumerate() {
        buffer.clear();
        buffer.extend(48_i32.to_le_bytes());
        for value in cells.and_then(|cells| cells.get(index)).unwrap_or(&NO_CELL) {
            buffer.extend(value.to_le_bytes());
        }
        buffer.extend(48_i32.to_le_bytes());
        for axis in 0..3 {
            buffer.extend(record);
            for atom in 0..atoms {
                buffer.extend((frame[3 * atom + axis] as f32).to_le_bytes());
            }
            buffer.extend(record);
        }
        out.write_all(&buffer).map_err(failed)?;
        on_frame(index + 1, frame_count);
    }
    out.flush().map_err(failed)
}
