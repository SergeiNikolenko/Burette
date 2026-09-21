//! Stand-in topologies for trajectories that arrive without one.
//!
//! A coordinate-only trajectory stores atom count, positions, box and time and
//! nothing else: no elements, residues or bonds. Mol* still needs a model to
//! attach those coordinates to, so when no real topology sits beside the file we
//! derive a bond-less one.
//!
//! The derived model needs **only the atom count**. Mol* replaces every position
//! from the trajectory on each frame, including frame one, and takes the unit
//! cell from the trajectory too, so the coordinates written here are never
//! displayed. That is why this reads a header instead of decoding a frame:
//! every supported format records its atom count near the start, so deriving a
//! topology costs microseconds no matter how large the trajectory is.

use std::fs::{self, File};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;
use tauri::{Manager, Runtime};

use super::runtime_utils::stable_id;

/// Formats whose atom count this module can read directly.
///
/// A format is listed only once its header is parsed here, so an unsupported
/// trajectory keeps its current behaviour instead of opening against a topology
/// guessed from nothing.
pub(crate) const SYNTHETIC_TOPOLOGY_EXTENSIONS: &[&str] =
    &["xtc", "trr", "dcd", "nc", "ncdf", "netcdf", "nctraj"];

/// Enough for the longest header walk (DCD titles), and bounded so a corrupt
/// file cannot pull an unreasonable amount into memory.
const HEADER_READ_BYTES: usize = 64 * 1024;
/// Keeps the generated GRO below the desktop's bounded structure payload. Each
/// atom line is about 45 bytes, so this leaves headroom under the 75 MiB limit.
const MAX_SYNTHETIC_ATOMS: i64 = 1_700_000;

/// Builds (or reuses) the synthetic topology paired with `trajectory`.
///
/// The cache file name carries the trajectory's size and modification time, so a
/// rewritten trajectory misses the cache instead of silently pairing with a
/// stale atom count.
pub(crate) fn synthetic_topology_for_trajectory<R: Runtime>(
    app: &tauri::AppHandle<R>,
    trajectory: &Path,
) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_cache_dir()
        .map_err(|err| err.to_string())?
        .join("synthetic-topology");
    fs::create_dir_all(&directory).map_err(|err| err.to_string())?;
    let cached = directory.join(cache_file_name(trajectory)?);
    if cached.is_file() {
        return Ok(cached);
    }
    let atom_count = trajectory_atom_count(trajectory)?;
    fs::write(&cached, synthetic_gro(atom_count)).map_err(|err| err.to_string())?;
    Ok(cached)
}

/// Reads the atom count out of a trajectory header.
pub(crate) fn trajectory_atom_count(trajectory: &Path) -> Result<usize, String> {
    let mut header = Vec::new();
    File::open(trajectory)
        .map_err(|err| err.to_string())?
        .take(HEADER_READ_BYTES as u64)
        .read_to_end(&mut header)
        .map_err(|err| err.to_string())?;
    header_atom_count(&header).ok_or_else(|| {
        format!(
            "{} does not carry a readable trajectory header.",
            trajectory.display()
        )
    })
}

/// Dispatches on the header's own magic rather than the file extension, because
/// the extension is only a hint and these formats all identify themselves.
fn header_atom_count(header: &[u8]) -> Option<usize> {
    xtc_atom_count(header)
        .or_else(|| trr_atom_count(header))
        .or_else(|| dcd_atom_count(header))
        .or_else(|| netcdf_atom_count(header))
}

fn be_i32(bytes: &[u8], offset: usize) -> Option<i32> {
    Some(i32::from_be_bytes(
        bytes.get(offset..offset + 4)?.try_into().ok()?,
    ))
}

fn le_i32(bytes: &[u8], offset: usize) -> Option<i32> {
    Some(i32::from_le_bytes(
        bytes.get(offset..offset + 4)?.try_into().ok()?,
    ))
}

fn checked_atoms(atoms: i64) -> Option<usize> {
    (1..=MAX_SYNTHETIC_ATOMS)
        .contains(&atoms)
        .then_some(atoms as usize)
}

/// XTC is XDR: magic 1995, then the atom count.
fn xtc_atom_count(header: &[u8]) -> Option<usize> {
    (be_i32(header, 0)? == 1995).then_some(())?;
    checked_atoms(i64::from(be_i32(header, 4)?))
}

/// TRR is XDR: magic 1993, a version string, ten section sizes, then the count.
///
/// The string is stored as its length plus one, then the length again, then the
/// characters padded to a four-byte boundary, so the count's offset moves with
/// the version string and cannot be hard-coded.
fn trr_atom_count(header: &[u8]) -> Option<usize> {
    (be_i32(header, 0)? == 1993).then_some(())?;
    let length = be_i32(header, 8)?;
    if !(0..=256).contains(&length) {
        return None;
    }
    let padded = (length as usize).div_ceil(4) * 4;
    // magic, length+1, length, the padded string, then ir/e/box/vir/pres/top/
    // sym/x/v/f sizes.
    let offset = 12 + padded + 10 * 4;
    checked_atoms(i64::from(be_i32(header, offset)?))
}

/// DCD stores the count after two Fortran record blocks, and its endianness
/// varies with the machine that wrote it, so the leading record marker of 84
/// decides how the rest is read.
fn dcd_atom_count(header: &[u8]) -> Option<usize> {
    let big_endian = match (be_i32(header, 0), le_i32(header, 0)) {
        (Some(84), _) => true,
        (_, Some(84)) => false,
        _ => return None,
    };
    let read = |offset: usize| {
        if big_endian {
            be_i32(header, offset)
        } else {
            le_i32(header, offset)
        }
    };
    (header.get(4..8)? == b"CORD").then_some(())?;
    // The 84-byte control block, then the title block, then a four-byte record
    // holding the count.
    let title_block = 4 + 84 + 4;
    let title_bytes = read(title_block)?;
    if !(0..HEADER_READ_BYTES as i32).contains(&title_bytes) {
        return None;
    }
    let count_block = title_block + 4 + title_bytes as usize + 4;
    (read(count_block)? == 4).then_some(())?;
    checked_atoms(i64::from(read(count_block + 4)?))
}

/// AMBER NetCDF: walk the classic-format dimension list for the one named
/// `atom`. Its length is the atom count.
fn netcdf_atom_count(header: &[u8]) -> Option<usize> {
    (header.get(0..3)? == b"CDF").then_some(())?;
    let version = *header.get(3)?;
    if version != 1 && version != 2 {
        return None;
    }
    // magic and version, then numrecs, then the dimension list tag and count.
    let mut offset = 8;
    (be_i32(header, offset)? == 0x0A).then_some(())?;
    let dimension_count = be_i32(header, offset + 4)?;
    if !(1..=1024).contains(&dimension_count) {
        return None;
    }
    offset += 8;
    for _ in 0..dimension_count {
        let name_length = be_i32(header, offset)? as usize;
        if name_length > 256 {
            return None;
        }
        let padded = name_length.div_ceil(4) * 4;
        let name = header.get(offset + 4..offset + 4 + name_length)?;
        let length = be_i32(header, offset + 4 + padded)?;
        if name == b"atom" {
            return checked_atoms(i64::from(length));
        }
        offset += 4 + padded + 4;
    }
    None
}

/// One bond-less carbon per atom, in its own residue.
///
/// GRO rather than PDB because PDB caps serial numbers at 99999 and MD boxes
/// routinely exceed that, while GRO wraps the field the way GROMACS itself does.
/// Positions and box are zero on purpose: every one of them is replaced by the
/// trajectory before anything is drawn.
fn synthetic_gro(atom_count: usize) -> String {
    let mut text = String::with_capacity(atom_count * 45 + 64);
    text.push_str("Burette derived topology\n");
    text.push_str(&format!("{atom_count:5}\n"));
    for index in 0..atom_count {
        let serial = (index + 1) % 100_000;
        text.push_str(&format!(
            "{serial:5}{:<5}{:>5}{serial:5}{:8.3}{:8.3}{:8.3}\n",
            "UNK", "C", 0.0, 0.0, 0.0
        ));
    }
    text.push_str(&format!("{:10.5}{:10.5}{:10.5}\n", 0.0, 0.0, 0.0));
    text
}

fn cache_file_name(trajectory: &Path) -> Result<String, String> {
    let metadata = fs::metadata(trajectory).map_err(|err| err.to_string())?;
    let modified = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|since| since.as_nanos())
        .unwrap_or_default();
    Ok(format!(
        "{}-{}-{}.gro",
        stable_id(trajectory),
        metadata.len(),
        modified
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Header bytes taken from files written by MDAnalysis, all describing the
    /// same 1220-atom system, so a parser that drifts fails here.
    fn xtc_header() -> Vec<u8> {
        let mut bytes = 1995i32.to_be_bytes().to_vec();
        bytes.extend_from_slice(&1220i32.to_be_bytes());
        bytes
    }

    fn trr_header() -> Vec<u8> {
        let mut bytes = 1993i32.to_be_bytes().to_vec();
        bytes.extend_from_slice(&13i32.to_be_bytes());
        bytes.extend_from_slice(&12i32.to_be_bytes());
        bytes.extend_from_slice(b"GMX_trn_file");
        for size in [0i32, 0, 36, 0, 0, 0, 0, 14640, 0, 0] {
            bytes.extend_from_slice(&size.to_be_bytes());
        }
        bytes.extend_from_slice(&1220i32.to_be_bytes());
        bytes
    }

    fn dcd_header() -> Vec<u8> {
        let mut bytes = 84i32.to_le_bytes().to_vec();
        bytes.extend_from_slice(b"CORD");
        bytes.extend_from_slice(&[0u8; 80]);
        bytes.extend_from_slice(&84i32.to_le_bytes());
        let title = vec![0u8; 244];
        bytes.extend_from_slice(&(title.len() as i32).to_le_bytes());
        bytes.extend_from_slice(&title);
        bytes.extend_from_slice(&(title.len() as i32).to_le_bytes());
        bytes.extend_from_slice(&4i32.to_le_bytes());
        bytes.extend_from_slice(&1220i32.to_le_bytes());
        bytes.extend_from_slice(&4i32.to_le_bytes());
        bytes
    }

    fn netcdf_header() -> Vec<u8> {
        let mut bytes = b"CDF\x02".to_vec();
        bytes.extend_from_slice(&6i32.to_be_bytes()); // numrecs
        bytes.extend_from_slice(&0x0Ai32.to_be_bytes()); // NC_DIMENSION
        bytes.extend_from_slice(&2i32.to_be_bytes()); // two dimensions
        bytes.extend_from_slice(&5i32.to_be_bytes());
        bytes.extend_from_slice(b"frame\0\0\0"); // padded to eight
        bytes.extend_from_slice(&0i32.to_be_bytes());
        bytes.extend_from_slice(&4i32.to_be_bytes());
        bytes.extend_from_slice(b"atom");
        bytes.extend_from_slice(&1220i32.to_be_bytes());
        bytes
    }

    #[test]
    fn reads_the_atom_count_from_every_supported_header() {
        assert_eq!(header_atom_count(&xtc_header()), Some(1220), "xtc");
        assert_eq!(header_atom_count(&trr_header()), Some(1220), "trr");
        assert_eq!(header_atom_count(&dcd_header()), Some(1220), "dcd");
        assert_eq!(header_atom_count(&netcdf_header()), Some(1220), "netcdf");
    }

    #[test]
    fn reads_a_big_endian_dcd() {
        // Written on a big-endian machine: same layout, opposite byte order.
        let mut bytes = 84i32.to_be_bytes().to_vec();
        bytes.extend_from_slice(b"CORD");
        bytes.extend_from_slice(&[0u8; 80]);
        bytes.extend_from_slice(&84i32.to_be_bytes());
        bytes.extend_from_slice(&0i32.to_be_bytes());
        bytes.extend_from_slice(&0i32.to_be_bytes());
        bytes.extend_from_slice(&4i32.to_be_bytes());
        bytes.extend_from_slice(&1220i32.to_be_bytes());
        assert_eq!(header_atom_count(&bytes), Some(1220));
    }

    #[test]
    fn rejects_headers_it_cannot_trust() {
        assert_eq!(header_atom_count(b"not a trajectory"), None);
        assert_eq!(header_atom_count(&[0u8; 4]), None, "truncated");

        let mut empty_system = 1995i32.to_be_bytes().to_vec();
        empty_system.extend_from_slice(&0i32.to_be_bytes());
        assert_eq!(header_atom_count(&empty_system), None, "zero atoms");

        let mut absurd = 1995i32.to_be_bytes().to_vec();
        absurd.extend_from_slice(&500_000_000i32.to_be_bytes());
        assert_eq!(
            header_atom_count(&absurd),
            None,
            "a count this large means a corrupt header, not a real system"
        );

        let mut negative = 1995i32.to_be_bytes().to_vec();
        negative.extend_from_slice(&(-4i32).to_be_bytes());
        assert_eq!(header_atom_count(&negative), None, "negative count");
    }

    #[test]
    fn netcdf_without_an_atom_dimension_is_not_a_trajectory() {
        let mut bytes = b"CDF\x01".to_vec();
        bytes.extend_from_slice(&1i32.to_be_bytes());
        bytes.extend_from_slice(&0x0Ai32.to_be_bytes());
        bytes.extend_from_slice(&1i32.to_be_bytes());
        bytes.extend_from_slice(&5i32.to_be_bytes());
        bytes.extend_from_slice(b"frame\0\0\0");
        bytes.extend_from_slice(&7i32.to_be_bytes());
        assert_eq!(header_atom_count(&bytes), None);
    }

    #[test]
    fn derived_gro_has_one_line_per_atom() {
        let text = synthetic_gro(3);
        let lines: Vec<_> = text.lines().collect();
        assert_eq!(lines.len(), 6, "title, count, three atoms, box");
        assert_eq!(lines[1].trim(), "3");
        assert!(lines[2].contains("UNK"), "got {}", lines[2]);
        // Every position is replaced by the trajectory, so writing anything but
        // zero would only invite the belief that these coordinates mean something.
        assert!(lines[2].contains("0.000"), "got {}", lines[2]);
    }

    #[test]
    fn derived_gro_wraps_serial_numbers_past_the_gro_field_width() {
        let text = synthetic_gro(100_001);
        // Two header lines come first, so the last atom is at 100_002. Its serial
        // wraps to 1, which is what GROMACS itself writes past the field width.
        let last = text.lines().nth(100_002).expect("last atom line");
        assert!(last.starts_with("    1"), "got {last}");
    }

    #[test]
    fn atom_count_reports_a_file_without_a_header() {
        let root = std::env::temp_dir().join(format!("burette-synthetic-{}", std::process::id()));
        fs::create_dir_all(&root).expect("create test directory");
        let short = root.join("short.xtc");
        fs::write(&short, b"xt").expect("write short file");

        assert!(trajectory_atom_count(&short)
            .expect_err("a two-byte file has no header")
            .contains("readable trajectory header"));

        fs::remove_dir_all(root).expect("remove test directory");
    }

    #[test]
    fn cache_name_changes_when_the_trajectory_changes() {
        let root = std::env::temp_dir().join(format!("burette-cache-{}", std::process::id()));
        fs::create_dir_all(&root).expect("create test directory");
        let trajectory = root.join("run.xtc");
        fs::write(&trajectory, b"first").expect("write trajectory");
        let first = cache_file_name(&trajectory).expect("first cache name");

        assert_eq!(
            first,
            cache_file_name(&trajectory).expect("stable cache name"),
            "an unchanged trajectory must reuse its cached topology"
        );

        fs::write(&trajectory, b"a longer trajectory").expect("rewrite trajectory");
        assert_ne!(
            first,
            cache_file_name(&trajectory).expect("second cache name"),
            "a rewritten trajectory must not reuse a stale topology"
        );

        fs::remove_dir_all(root).expect("remove test directory");
    }
}
