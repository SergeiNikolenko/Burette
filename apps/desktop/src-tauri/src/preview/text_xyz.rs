use flate2::read::GzDecoder;
use std::io::Read;

const BOHR_TO_ANGSTROM: f64 = 0.529_177_210_903;

#[derive(Clone, Debug, PartialEq)]
struct Atom {
    symbol: String,
    x: f64,
    y: f64,
    z: f64,
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct ConvertedStructureData {
    pub(crate) data: Vec<u8>,
    pub(crate) extension: &'static str,
}

#[derive(Clone, Debug, PartialEq)]
struct MaestroAtom {
    symbol: String,
    atom_name: String,
    residue_name: String,
    residue_number: i32,
    chain_name: String,
    x: f64,
    y: f64,
    z: f64,
}

pub(crate) fn converted_data_from_text(
    data: &[u8],
    extension: &str,
    label: &str,
) -> Option<ConvertedStructureData> {
    if matches!(extension, "cms" | "mae" | "maegz") {
        return maestro_pdb_data_from_text(data, extension);
    }
    pdb_data_from_text(data, extension, label).map(|data| ConvertedStructureData {
        data,
        extension: "pdb",
    })
}

pub(crate) fn xyz_data_from_text(data: &[u8], extension: &str, label: &str) -> Option<Vec<u8>> {
    let atoms = atoms_from_text(data, extension)?;
    if atoms.is_empty() {
        return None;
    }
    Some(atoms_to_xyz(&atoms, label).into_bytes())
}

fn pdb_data_from_text(data: &[u8], extension: &str, label: &str) -> Option<Vec<u8>> {
    let atoms = atoms_from_text(data, extension)?;
    if atoms.is_empty() {
        return None;
    }
    Some(generic_atoms_to_pdb(&atoms, label).into_bytes())
}

fn atoms_from_text(data: &[u8], extension: &str) -> Option<Vec<Atom>> {
    let decoded = decode_structure_text(data, extension)?;
    let text = decoded.replace("\r\n", "\n").replace('\r', "\n");
    let lines: Vec<&str> = text.lines().collect();
    match extension {
        "cub" | "cube" => parse_cube_atoms(&lines),
        "vasp" => parse_vasp_atoms(&lines),
        "in" => parse_quantum_espresso_atoms(&lines),
        "out" => parse_orca_atoms(&lines),
        "cif" | "mmcif" | "mcif" => parse_cif_core_atoms(&lines),
        "cms" | "mae" | "maegz" => parse_maestro_atoms(&lines, MAESTRO_PREVIEW_ATOM_LIMIT),
        _ => None,
    }
    .or_else(|| parse_best_coordinate_block(&lines))
}

fn atoms_to_xyz(atoms: &[Atom], label: &str) -> String {
    let mut xyz = format!("{}\nConverted from {}\n", atoms.len(), label);
    for atom in atoms {
        xyz.push_str(&format!(
            "{} {:.6} {:.6} {:.6}\n",
            atom.symbol, atom.x, atom.y, atom.z
        ));
    }
    xyz
}

const MAESTRO_PREVIEW_ATOM_LIMIT: usize = 3_000;
const MAESTRO_PDB_PREVIEW_ATOM_LIMIT: usize = 30_000;

fn decode_structure_text(data: &[u8], extension: &str) -> Option<String> {
    if extension == "maegz" {
        let mut decoder = GzDecoder::new(data);
        let mut text = String::new();
        decoder.read_to_string(&mut text).ok()?;
        return Some(text);
    }
    Some(String::from_utf8_lossy(data).into_owned())
}

fn parse_cube_atoms(lines: &[&str]) -> Option<Vec<Atom>> {
    if lines.len() < 6 {
        return None;
    }
    let count = fields(lines[2])
        .first()?
        .parse::<isize>()
        .ok()?
        .unsigned_abs();
    if count == 0 || lines.len() < 6 + count {
        return None;
    }
    let axis_counts = [
        fields(lines[3]).first()?.parse::<isize>().ok()?,
        fields(lines[4]).first()?.parse::<isize>().ok()?,
        fields(lines[5]).first()?.parse::<isize>().ok()?,
    ];
    let coordinate_scale = if axis_counts.iter().all(|count| *count > 0) {
        BOHR_TO_ANGSTROM
    } else {
        1.0
    };
    let mut atoms = Vec::with_capacity(count);
    for index in 0..count {
        let parts = fields(lines[6 + index]);
        let number = parts.first()?.parse::<usize>().ok()?;
        let x = parts.get(2)?.parse::<f64>().ok()?;
        let y = parts.get(3)?.parse::<f64>().ok()?;
        let z = parts.get(4)?.parse::<f64>().ok()?;
        atoms.push(Atom {
            symbol: symbol_for_atomic_number(number).to_string(),
            x: x * coordinate_scale,
            y: y * coordinate_scale,
            z: z * coordinate_scale,
        });
    }
    Some(atoms)
}

fn parse_vasp_atoms(lines: &[&str]) -> Option<Vec<Atom>> {
    if lines.len() < 8 {
        return None;
    }
    let scale = lines[1].trim().parse::<f64>().ok()?;
    let a = parse_vector(lines[2], scale)?;
    let b = parse_vector(lines[3], scale)?;
    let c = parse_vector(lines[4], scale)?;
    let symbols = fields(lines[5]);
    let counts: Vec<usize> = fields(lines[6])
        .iter()
        .map(|value| value.parse::<usize>())
        .collect::<Result<_, _>>()
        .ok()?;
    if symbols.is_empty() || symbols.len() != counts.len() {
        return None;
    }
    let mut index = 7;
    if lines
        .get(index)
        .is_some_and(|line| line.trim().to_lowercase().starts_with('s'))
    {
        index += 1;
    }
    let direct = lines
        .get(index)
        .is_some_and(|line| line.trim().to_lowercase().starts_with('d'));
    index += 1;
    let mut atoms = Vec::new();
    for (symbol_index, symbol) in symbols.iter().enumerate() {
        for _ in 0..counts[symbol_index] {
            let parts = fields(lines.get(index).copied().unwrap_or_default());
            index += 1;
            let x = parts.first().and_then(|value| value.parse::<f64>().ok());
            let y = parts.get(1).and_then(|value| value.parse::<f64>().ok());
            let z = parts.get(2).and_then(|value| value.parse::<f64>().ok());
            let (Some(x), Some(y), Some(z)) = (x, y, z) else {
                continue;
            };
            let position = if direct {
                combine(x, a, y, b, z, c)
            } else {
                (x * scale, y * scale, z * scale)
            };
            atoms.push(Atom {
                symbol: normalize_element_symbol(symbol),
                x: position.0,
                y: position.1,
                z: position.2,
            });
        }
    }
    (!atoms.is_empty()).then_some(atoms)
}

fn parse_quantum_espresso_atoms(lines: &[&str]) -> Option<Vec<Atom>> {
    let start = lines
        .iter()
        .position(|line| line.trim().to_lowercase().starts_with("atomic_positions"))?
        + 1;
    let mut atoms = Vec::new();
    for line in &lines[start..] {
        let parts = fields(line);
        if parts.len() < 4 {
            break;
        }
        let symbol = normalize_element_symbol(parts[0]);
        let x = parts[1].parse::<f64>().ok();
        let y = parts[2].parse::<f64>().ok();
        let z = parts[3].parse::<f64>().ok();
        let (Some(x), Some(y), Some(z)) = (x, y, z) else {
            break;
        };
        if !is_element_symbol(&symbol) {
            break;
        }
        atoms.push(Atom { symbol, x, y, z });
    }
    (!atoms.is_empty()).then_some(atoms)
}

fn parse_orca_atoms(lines: &[&str]) -> Option<Vec<Atom>> {
    let mut best = None;
    let mut index = 0;
    while index < lines.len() {
        if lines[index].contains("CARTESIAN COORDINATES (ANGSTROEM)") {
            let mut atoms = Vec::new();
            index += 1;
            while index < lines.len() && parse_element_coordinate_line(lines[index]).is_none() {
                index += 1;
            }
            while index < lines.len() {
                let Some(atom) = parse_element_coordinate_line(lines[index]) else {
                    break;
                };
                atoms.push(atom);
                index += 1;
            }
            if !atoms.is_empty() {
                best = Some(atoms);
            }
        } else {
            index += 1;
        }
    }
    best
}

fn parse_best_coordinate_block(lines: &[&str]) -> Option<Vec<Atom>> {
    let mut best = Vec::new();
    let mut current = Vec::new();
    for line in lines {
        if let Some(atom) = parse_element_coordinate_line(line) {
            current.push(atom);
        } else if current.len() > best.len() {
            best = std::mem::take(&mut current);
        } else {
            current.clear();
        }
    }
    if current.len() > best.len() {
        best = current;
    }
    (best.len() >= 2).then_some(best)
}

fn parse_maestro_atoms(lines: &[&str], atom_limit: usize) -> Option<Vec<Atom>> {
    parse_maestro_pdb_atoms(lines, atom_limit).map(|atoms| {
        atoms
            .into_iter()
            .map(|atom| Atom {
                symbol: atom.symbol,
                x: atom.x,
                y: atom.y,
                z: atom.z,
            })
            .collect()
    })
}

fn maestro_pdb_data_from_text(data: &[u8], extension: &str) -> Option<ConvertedStructureData> {
    let decoded = decode_structure_text(data, extension)?;
    let text = decoded.replace("\r\n", "\n").replace('\r', "\n");
    let lines: Vec<&str> = text.lines().collect();
    let atoms = parse_maestro_pdb_atoms(&lines, MAESTRO_PDB_PREVIEW_ATOM_LIMIT)?;
    if atoms.is_empty() {
        return None;
    }
    Some(ConvertedStructureData {
        data: maestro_atoms_to_pdb(&atoms).into_bytes(),
        extension: "pdb",
    })
}

fn parse_maestro_pdb_atoms(lines: &[&str], atom_limit: usize) -> Option<Vec<MaestroAtom>> {
    let mut index = 0;
    let mut current_ct_type = String::new();
    let mut best_score = -1;
    let mut best_atoms = None;
    while index < lines.len() {
        let trimmed = lines[index].trim();
        if trimmed == "f_m_ct {" {
            index += 1;
            current_ct_type = parse_maestro_ct_type(lines, &mut index).unwrap_or_default();
            continue;
        }
        if !trimmed.starts_with("m_atom[") || !trimmed.ends_with('{') {
            index += 1;
            continue;
        }

        index += 1;
        let mut headers = Vec::new();
        let mut has_implicit_atom_index = false;
        while index < lines.len() {
            let header_line = lines[index].trim();
            index += 1;
            if header_line == ":::" {
                break;
            }
            if header_line.starts_with('#') {
                has_implicit_atom_index |= header_line
                    .to_lowercase()
                    .contains("first column is atom index");
                continue;
            }
            if header_line == "}" {
                headers.clear();
                break;
            }
            headers.extend(header_line.split_whitespace().map(str::to_string));
        }
        if headers.is_empty() {
            continue;
        }

        let Some(x_index) = maestro_header_index(&headers, "r_m_x_coord") else {
            continue;
        };
        let Some(y_index) = maestro_header_index(&headers, "r_m_y_coord") else {
            continue;
        };
        let Some(z_index) = maestro_header_index(&headers, "r_m_z_coord") else {
            continue;
        };
        let atomic_number_index = maestro_optional_header_index(&headers, "i_m_atomic_number");
        let element_index = maestro_optional_header_index(&headers, "s_m_element")
            .or_else(|| maestro_optional_header_index(&headers, "s_m_pdb_element"));
        let atom_name_index = maestro_optional_header_index(&headers, "s_m_atom_name")
            .or_else(|| maestro_optional_header_index(&headers, "s_m_pdb_atom_name"));
        let pdb_atom_name_index =
            maestro_optional_header_index(&headers, "s_m_pdb_atom_name").or(atom_name_index);
        let residue_name_index = maestro_optional_header_index(&headers, "s_m_pdb_residue_name")
            .or_else(|| maestro_optional_header_index(&headers, "s_m_mmod_res"));
        let residue_number_index = maestro_optional_header_index(&headers, "i_m_residue_number");
        let chain_name_index = maestro_optional_header_index(&headers, "s_m_chain_name");

        let mut atoms = Vec::new();
        while index < lines.len() {
            let row_line = lines[index].trim();
            index += 1;
            if row_line == ":::" || row_line == "}" {
                break;
            }
            if row_line.is_empty() {
                continue;
            }
            let row = cif_tokens(row_line);
            let row_offset = usize::from(has_implicit_atom_index);
            let x = row
                .get(x_index + row_offset)
                .and_then(|value| value.parse::<f64>().ok());
            let y = row
                .get(y_index + row_offset)
                .and_then(|value| value.parse::<f64>().ok());
            let z = row
                .get(z_index + row_offset)
                .and_then(|value| value.parse::<f64>().ok());
            let symbol = maestro_atom_symbol(
                &row,
                row_offset,
                atomic_number_index,
                element_index,
                atom_name_index,
            );
            let atom_name = pdb_atom_name_index
                .and_then(|value_index| row.get(value_index + row_offset))
                .map(|value| normalize_pdb_atom_name(value))
                .filter(|value| !value.is_empty())
                .or_else(|| symbol.clone());
            let residue_name = residue_name_index
                .and_then(|value_index| row.get(value_index + row_offset))
                .map(|value| normalize_pdb_residue_name(value))
                .filter(|value| !value.is_empty())
                .unwrap_or_else(|| "MOL".to_string());
            let residue_number = residue_number_index
                .and_then(|value_index| row.get(value_index + row_offset))
                .and_then(|value| value.parse::<i32>().ok())
                .unwrap_or(1);
            let chain_name = chain_name_index
                .and_then(|value_index| row.get(value_index + row_offset))
                .and_then(|value| value.chars().find(|ch| ch.is_ascii_alphanumeric()))
                .map(|ch| ch.to_string())
                .unwrap_or_else(|| "A".to_string());
            let (Some(x), Some(y), Some(z), Some(symbol)) = (x, y, z, symbol) else {
                continue;
            };
            atoms.push(MaestroAtom {
                symbol,
                atom_name: atom_name.unwrap_or_else(|| "X".to_string()),
                residue_name,
                residue_number,
                chain_name,
                x,
                y,
                z,
            });
            if atoms.len() >= atom_limit {
                break;
            }
        }
        if !atoms.is_empty() {
            let score = maestro_ct_score(&current_ct_type);
            if score > best_score {
                best_score = score;
                best_atoms = Some(atoms);
            }
        }
    }
    best_atoms
}

fn parse_maestro_ct_type(lines: &[&str], index: &mut usize) -> Option<String> {
    let mut headers = Vec::new();
    while *index < lines.len() {
        let line = lines[*index].trim();
        *index += 1;
        if line == ":::" {
            break;
        }
        if line.starts_with("m_atom[") || line == "}" {
            *index = (*index).saturating_sub(1);
            return None;
        }
        headers.extend(line.split_whitespace().map(str::to_string));
    }
    let ct_type_index = maestro_optional_header_index(&headers, "s_ffio_ct_type")?;
    let mut values = Vec::new();
    while *index < lines.len() {
        let line = lines[*index].trim();
        if line.starts_with("m_atom[") || line == "}" {
            break;
        }
        values.extend(cif_tokens(line));
        *index += 1;
    }
    values
        .get(ct_type_index)
        .map(|value| value.trim().trim_matches('"').to_ascii_lowercase())
}

fn maestro_ct_score(ct_type: &str) -> i32 {
    match ct_type.trim().to_ascii_lowercase().as_str() {
        "solute" => 4,
        "full_system" => 3,
        "ion" => 1,
        "solvent" => 0,
        _ => 2,
    }
}

fn maestro_atoms_to_pdb(atoms: &[MaestroAtom]) -> String {
    let mut pdb = String::new();
    for (index, atom) in atoms.iter().enumerate() {
        pdb.push_str(&maestro_pdb_atom_line(index + 1, atom));
        pdb.push('\n');
    }
    push_pdb_conect_lines(&mut pdb, atoms);
    pdb.push_str("END\n");
    pdb
}

fn generic_atoms_to_pdb(atoms: &[Atom], label: &str) -> String {
    let mut pdb = format!("REMARK Converted from {label}\n");
    for (index, atom) in atoms.iter().take(99_999).enumerate() {
        pdb.push_str(&generic_pdb_atom_line(index + 1, atom));
        pdb.push('\n');
    }
    push_pdb_conect_lines(&mut pdb, atoms);
    pdb.push_str("END\n");
    pdb
}

fn generic_pdb_atom_line(serial: usize, atom: &Atom) -> String {
    let symbol = normalize_element_symbol(&atom.symbol);
    let atom_name = format_pdb_atom_name(&symbol, &symbol);
    format!(
        "HETATM{serial:>5} {atom_name:<4} MOL A{residue_number:>4}    {x:>8.3}{y:>8.3}{z:>8.3}  1.00 10.00          {element:>2}",
        serial = serial.min(99_999),
        residue_number = 1,
        x = atom.x,
        y = atom.y,
        z = atom.z,
        element = truncate_ascii(&symbol, 2),
    )
}

trait PdbBondAtom {
    fn symbol(&self) -> &str;
    fn x(&self) -> f64;
    fn y(&self) -> f64;
    fn z(&self) -> f64;
}

impl PdbBondAtom for Atom {
    fn symbol(&self) -> &str {
        &self.symbol
    }

    fn x(&self) -> f64 {
        self.x
    }

    fn y(&self) -> f64 {
        self.y
    }

    fn z(&self) -> f64 {
        self.z
    }
}

impl PdbBondAtom for MaestroAtom {
    fn symbol(&self) -> &str {
        &self.symbol
    }

    fn x(&self) -> f64 {
        self.x
    }

    fn y(&self) -> f64 {
        self.y
    }

    fn z(&self) -> f64 {
        self.z
    }
}

fn push_pdb_conect_lines<T: PdbBondAtom>(pdb: &mut String, atoms: &[T]) {
    let bonds = infer_pdb_bonds(atoms);
    if bonds.is_empty() {
        return;
    }
    let mut adjacency = vec![Vec::<usize>::new(); atoms.len().min(99_999)];
    for (left, right) in bonds {
        adjacency[left].push(right + 1);
        adjacency[right].push(left + 1);
    }
    for (index, neighbors) in adjacency.iter().enumerate() {
        for chunk in neighbors.chunks(4) {
            pdb.push_str(&format!("CONECT{:>5}", index + 1));
            for serial in chunk {
                pdb.push_str(&format!("{serial:>5}"));
            }
            pdb.push('\n');
        }
    }
}

fn infer_pdb_bonds<T: PdbBondAtom>(atoms: &[T]) -> Vec<(usize, usize)> {
    let atoms = &atoms[..atoms.len().min(99_999)];
    if atoms.len() > 2_000 {
        return Vec::new();
    }
    let mut bonds = Vec::new();
    for left in 0..atoms.len() {
        let left_radius = covalent_radius(atoms[left].symbol());
        if left_radius == 0.0 {
            continue;
        }
        for right in (left + 1)..atoms.len() {
            let right_radius = covalent_radius(atoms[right].symbol());
            if right_radius == 0.0 {
                continue;
            }
            let dx = atoms[left].x() - atoms[right].x();
            let dy = atoms[left].y() - atoms[right].y();
            let dz = atoms[left].z() - atoms[right].z();
            let distance = (dx * dx + dy * dy + dz * dz).sqrt();
            let max_distance = (left_radius + right_radius + 0.45).min(2.25);
            if (0.35..=max_distance).contains(&distance) {
                bonds.push((left, right));
            }
        }
    }
    bonds
}

fn covalent_radius(symbol: &str) -> f64 {
    match normalize_element_symbol(symbol).as_str() {
        "H" => 0.31,
        "He" => 0.28,
        "Li" => 1.28,
        "Be" => 0.96,
        "B" => 0.84,
        "C" => 0.76,
        "N" => 0.71,
        "O" => 0.66,
        "F" => 0.57,
        "Ne" => 0.58,
        "Na" => 1.66,
        "Mg" => 1.41,
        "Al" => 1.21,
        "Si" => 1.11,
        "P" => 1.07,
        "S" => 1.05,
        "Cl" => 1.02,
        "Ar" => 1.06,
        "K" => 2.03,
        "Ca" => 1.76,
        "Fe" => 1.24,
        "Co" => 1.18,
        "Ni" => 1.17,
        "Cu" => 1.22,
        "Zn" => 1.22,
        "Br" => 1.20,
        "I" => 1.39,
        _ => 0.0,
    }
}

fn maestro_pdb_atom_line(serial: usize, atom: &MaestroAtom) -> String {
    let residue_name = truncate_ascii(&atom.residue_name, 3);
    let atom_name = format_pdb_atom_name(&atom.atom_name, &atom.symbol);
    let chain = truncate_ascii(&atom.chain_name, 1);
    let record = if is_standard_polymer_residue(&residue_name) {
        "ATOM"
    } else {
        "HETATM"
    };
    format!(
        "{record:<6}{serial:>5} {atom_name:<4} {residue_name:>3} {chain:1}{residue_number:>4}    {x:>8.3}{y:>8.3}{z:>8.3}  1.00 10.00          {element:>2}",
        serial = serial.min(99_999),
        residue_number = atom.residue_number.clamp(-999, 9999),
        x = atom.x,
        y = atom.y,
        z = atom.z,
        element = truncate_ascii(&atom.symbol, 2),
    )
}

fn format_pdb_atom_name(atom_name: &str, symbol: &str) -> String {
    let mut cleaned: String = atom_name
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric())
        .take(4)
        .collect();
    if cleaned.is_empty() {
        cleaned = symbol.to_string();
    }
    cleaned
}

fn truncate_ascii(value: &str, max_len: usize) -> String {
    value
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric())
        .take(max_len)
        .collect()
}

fn normalize_pdb_atom_name(value: &str) -> String {
    value.trim().trim_matches('"').trim().to_string()
}

fn normalize_pdb_residue_name(value: &str) -> String {
    value
        .trim()
        .trim_matches('"')
        .trim()
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric())
        .take(3)
        .collect::<String>()
        .to_ascii_uppercase()
}

fn is_standard_polymer_residue(residue_name: &str) -> bool {
    matches!(
        residue_name,
        "ALA"
            | "ARG"
            | "ASN"
            | "ASP"
            | "CYS"
            | "CYX"
            | "GLN"
            | "GLU"
            | "GLY"
            | "HIS"
            | "HID"
            | "HIE"
            | "HIP"
            | "ILE"
            | "LEU"
            | "LYS"
            | "MET"
            | "PHE"
            | "PRO"
            | "SER"
            | "THR"
            | "TRP"
            | "TYR"
            | "VAL"
    )
}

fn maestro_header_index(headers: &[String], name: &str) -> Option<usize> {
    maestro_optional_header_index(headers, name)
}

fn maestro_optional_header_index(headers: &[String], name: &str) -> Option<usize> {
    headers
        .iter()
        .position(|header| header.eq_ignore_ascii_case(name))
}

fn maestro_atom_symbol(
    row: &[String],
    row_offset: usize,
    atomic_number_index: Option<usize>,
    element_index: Option<usize>,
    atom_name_index: Option<usize>,
) -> Option<String> {
    if let Some(number) = atomic_number_index
        .and_then(|index| row.get(index + row_offset))
        .and_then(|value| value.parse::<usize>().ok())
    {
        let symbol = symbol_for_atomic_number(number);
        if symbol != "X" {
            return Some(symbol.to_string());
        }
    }
    if let Some(symbol) = element_index
        .and_then(|index| row.get(index + row_offset))
        .and_then(|value| element_symbol_from_cif(value))
    {
        return Some(symbol);
    }
    atom_name_index
        .and_then(|index| row.get(index + row_offset))
        .and_then(|value| element_symbol_from_cif(value))
}

fn parse_cif_core_atoms(lines: &[&str]) -> Option<Vec<Atom>> {
    let cell = parse_cif_cell(lines)?;
    let mut index = 0;
    while index < lines.len() {
        if lines[index].trim().to_lowercase() != "loop_" {
            index += 1;
            continue;
        }
        index += 1;
        let mut headers = Vec::new();
        while index < lines.len() && lines[index].trim().starts_with('_') {
            headers.push(lines[index].trim().to_lowercase());
            index += 1;
        }
        let fract_x_index = headers
            .iter()
            .position(|header| header == "_atom_site_fract_x");
        let fract_y_index = headers
            .iter()
            .position(|header| header == "_atom_site_fract_y");
        let fract_z_index = headers
            .iter()
            .position(|header| header == "_atom_site_fract_z");
        let (Some(fract_x_index), Some(fract_y_index), Some(fract_z_index)) =
            (fract_x_index, fract_y_index, fract_z_index)
        else {
            continue;
        };
        let type_index = headers
            .iter()
            .position(|header| header == "_atom_site_type_symbol");
        let label_index = headers
            .iter()
            .position(|header| header == "_atom_site_label");
        let mut atoms = Vec::new();
        while index < lines.len() {
            let trimmed = lines[index].trim();
            if trimmed.is_empty()
                || trimmed.starts_with('#')
                || trimmed.starts_with('_')
                || trimmed.to_lowercase() == "loop_"
                || trimmed.to_lowercase().starts_with("data_")
            {
                break;
            }
            let parts = cif_tokens(trimmed);
            index += 1;
            if parts.len() < headers.len() {
                continue;
            }
            let raw_symbol = type_index
                .and_then(|part_index| parts.get(part_index))
                .or_else(|| label_index.and_then(|part_index| parts.get(part_index)))?;
            let symbol = element_symbol_from_cif(raw_symbol)?;
            let fx = parse_cif_number(parts.get(fract_x_index)?)?;
            let fy = parse_cif_number(parts.get(fract_y_index)?)?;
            let fz = parse_cif_number(parts.get(fract_z_index)?)?;
            let position = fractional_to_cartesian(fx, fy, fz, cell);
            atoms.push(Atom {
                symbol,
                x: position.0,
                y: position.1,
                z: position.2,
            });
        }
        if !atoms.is_empty() {
            return Some(atoms);
        }
    }
    None
}

#[derive(Clone, Copy)]
struct CifCell {
    a: f64,
    b: f64,
    c: f64,
    alpha: f64,
    beta: f64,
    gamma: f64,
}

fn parse_cif_cell(lines: &[&str]) -> Option<CifCell> {
    let mut a = None;
    let mut b = None;
    let mut c = None;
    let mut alpha = None;
    let mut beta = None;
    let mut gamma = None;
    for line in lines {
        let parts = cif_tokens(line.trim());
        if parts.len() < 2 {
            continue;
        }
        match parts[0].to_lowercase().as_str() {
            "_cell_length_a" => a = parse_cif_number(&parts[1]),
            "_cell_length_b" => b = parse_cif_number(&parts[1]),
            "_cell_length_c" => c = parse_cif_number(&parts[1]),
            "_cell_angle_alpha" => alpha = parse_cif_number(&parts[1]),
            "_cell_angle_beta" => beta = parse_cif_number(&parts[1]),
            "_cell_angle_gamma" => gamma = parse_cif_number(&parts[1]),
            _ => {}
        }
    }
    Some(CifCell {
        a: a?,
        b: b?,
        c: c?,
        alpha: alpha?,
        beta: beta?,
        gamma: gamma?,
    })
}

fn fractional_to_cartesian(fx: f64, fy: f64, fz: f64, cell: CifCell) -> (f64, f64, f64) {
    let alpha = cell.alpha.to_radians();
    let beta = cell.beta.to_radians();
    let gamma = cell.gamma.to_radians();
    let cos_alpha = alpha.cos();
    let cos_beta = beta.cos();
    let cos_gamma = gamma.cos();
    let sin_gamma = gamma.sin();
    let a = (cell.a, 0.0, 0.0);
    let b = (cell.b * cos_gamma, cell.b * sin_gamma, 0.0);
    let cx = cell.c * cos_beta;
    let cy = cell.c * (cos_alpha - cos_beta * cos_gamma) / sin_gamma;
    let cz = (cell.c * cell.c - cx * cx - cy * cy).max(0.0).sqrt();
    combine(fx, a, fy, b, fz, (cx, cy, cz))
}

fn cif_tokens(line: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut current = String::new();
    let mut quote = None;
    for character in line.chars() {
        if let Some(active_quote) = quote {
            if character == active_quote {
                quote = None;
            } else {
                current.push(character);
            }
            continue;
        }
        if character == '\'' || character == '"' {
            quote = Some(character);
            continue;
        }
        if character.is_whitespace() {
            if !current.is_empty() {
                tokens.push(std::mem::take(&mut current));
            }
            continue;
        }
        current.push(character);
    }
    if !current.is_empty() {
        tokens.push(current);
    }
    tokens
}

fn parse_cif_number(value: &str) -> Option<f64> {
    let mut end = 0;
    for (index, character) in value.char_indices() {
        let valid = character.is_ascii_digit() || matches!(character, '+' | '-' | '.' | 'e' | 'E');
        if !valid {
            break;
        }
        end = index + character.len_utf8();
    }
    if end == 0 {
        return None;
    }
    value[..end].parse::<f64>().ok()
}

fn element_symbol_from_cif(value: &str) -> Option<String> {
    let letters: String = value
        .chars()
        .filter(|character| character.is_ascii_alphabetic())
        .take(2)
        .collect();
    let symbol = normalize_element_symbol(&letters);
    is_element_symbol(&symbol).then_some(symbol)
}

fn parse_element_coordinate_line(line: &str) -> Option<Atom> {
    let parts = fields(line);
    let symbol = normalize_element_symbol(parts.first()?);
    if !is_element_symbol(&symbol) {
        return None;
    }
    let x = parts.get(1)?.parse::<f64>().ok()?;
    let y = parts.get(2)?.parse::<f64>().ok()?;
    let z = parts.get(3)?.parse::<f64>().ok()?;
    Some(Atom { symbol, x, y, z })
}

fn fields(line: &str) -> Vec<&str> {
    line.split_whitespace().collect()
}

fn parse_vector(line: &str, scale: f64) -> Option<(f64, f64, f64)> {
    let parts = fields(line);
    Some((
        parts.first()?.parse::<f64>().ok()? * scale,
        parts.get(1)?.parse::<f64>().ok()? * scale,
        parts.get(2)?.parse::<f64>().ok()? * scale,
    ))
}

fn combine(
    x: f64,
    a: (f64, f64, f64),
    y: f64,
    b: (f64, f64, f64),
    z: f64,
    c: (f64, f64, f64),
) -> (f64, f64, f64) {
    (
        x * a.0 + y * b.0 + z * c.0,
        x * a.1 + y * b.1 + z * c.1,
        x * a.2 + y * b.2 + z * c.2,
    )
}

fn normalize_element_symbol(value: &str) -> String {
    let mut chars = value.chars();
    let Some(first) = chars.next() else {
        return String::new();
    };
    format!("{}{}", first.to_uppercase(), chars.as_str().to_lowercase())
}

fn is_element_symbol(value: &str) -> bool {
    ATOMIC_SYMBOLS.contains(&value)
}

fn symbol_for_atomic_number(number: usize) -> &'static str {
    ATOMIC_SYMBOLS
        .get(number.saturating_sub(1))
        .copied()
        .unwrap_or("X")
}

const ATOMIC_SYMBOLS: [&str; 86] = [
    "H", "He", "Li", "Be", "B", "C", "N", "O", "F", "Ne", "Na", "Mg", "Al", "Si", "P", "S", "Cl",
    "Ar", "K", "Ca", "Sc", "Ti", "V", "Cr", "Mn", "Fe", "Co", "Ni", "Cu", "Zn", "Ga", "Ge", "As",
    "Se", "Br", "Kr", "Rb", "Sr", "Y", "Zr", "Nb", "Mo", "Tc", "Ru", "Rh", "Pd", "Ag", "Cd", "In",
    "Sn", "Sb", "Te", "I", "Xe", "Cs", "Ba", "La", "Ce", "Pr", "Nd", "Pm", "Sm", "Eu", "Gd", "Tb",
    "Dy", "Ho", "Er", "Tm", "Yb", "Lu", "Hf", "Ta", "W", "Re", "Os", "Ir", "Pt", "Au", "Hg", "Tl",
    "Pb", "Bi", "Po", "At", "Rn",
];

#[cfg(test)]
mod tests {
    use super::{converted_data_from_text, xyz_data_from_text};
    use flate2::{write::GzEncoder, Compression};
    use std::io::Write;

    #[test]
    fn converts_orca_output_cartesian_section_to_xyz() {
        let data = br#"
header
CARTESIAN COORDINATES (ANGSTROEM)
---------------------------------
  O     -2.304659   -0.473599    0.509723
  C     -2.246527    0.624277   -0.047679
footer
"#;
        let xyz = String::from_utf8(xyz_data_from_text(data, "out", "bimp.out").unwrap()).unwrap();
        assert!(xyz.starts_with("2\nConverted from bimp.out\n"));
        assert!(xyz.contains("O -2.304659 -0.473599 0.509723"));
    }

    #[test]
    fn converts_core_cif_fractional_atoms_to_xyz() {
        let data = br#"
data_demo
_cell_length_a 10
_cell_length_b 20
_cell_length_c 30
_cell_angle_alpha 90
_cell_angle_beta 90
_cell_angle_gamma 90
loop_
_atom_site_label
_atom_site_type_symbol
_atom_site_fract_x
_atom_site_fract_y
_atom_site_fract_z
C1 C 0.1 0.2 0.3
O1 O 0.4 0.5 0.6
"#;
        let xyz = String::from_utf8(xyz_data_from_text(data, "cif", "demo.cif").unwrap()).unwrap();
        assert!(xyz.starts_with("2\nConverted from demo.cif\n"));
        assert!(xyz.contains("C 1.000000 4.000000 9.000000"));
        assert!(xyz.contains("O 4.000000 10.000000 18.000000"));
    }

    #[test]
    fn converts_cube_atoms_to_pdb_with_inferred_bonds_for_molstar() {
        let data = br#"water cube
generated
3 0.0 0.0 0.0
1 1.0 0.0 0.0
1 0.0 1.0 0.0
1 0.0 0.0 1.0
8 0.0 0.000 0.000 0.000
1 0.0 0.960 0.000 0.000
1 0.0 -0.240 0.930 0.000
"#;
        let converted = converted_data_from_text(data, "cube", "water.cube").unwrap();
        assert_eq!(converted.extension, "pdb");
        let pdb = String::from_utf8(converted.data).unwrap();
        assert!(pdb.starts_with("REMARK Converted from water.cube\nHETATM"));
        assert!(pdb.contains("HETATM    2 H    MOL A   1       0.508   0.000   0.000"));
        assert!(pdb.contains("CONECT    1    2    3"));
        assert!(pdb.ends_with("END\n"));
    }

    #[test]
    fn converts_maestro_atom_table_to_xyz_preview() {
        let data = br#"
f_m_ct {
  m_atom[2] {
    i_m_mmod_type
    i_m_atomic_number
    r_m_x_coord
    r_m_y_coord
    r_m_z_coord
    s_m_atom_name
    :::
    1 6 1.250000 2.500000 3.750000 "C1"
    1 8 -1.000000 0.000000 2.000000 "O1"
    :::
  }
}
"#;
        let xyz = String::from_utf8(xyz_data_from_text(data, "cms", "demo.cms").unwrap()).unwrap();
        assert!(xyz.starts_with("2\nConverted from demo.cms\n"));
        assert!(xyz.contains("C 1.250000 2.500000 3.750000"));
        assert!(xyz.contains("O -1.000000 0.000000 2.000000"));
    }

    #[test]
    fn converts_real_systembuilder_maestro_fixture_to_xyz_preview() {
        let data = include_bytes!("../../../../../tests/fixtures/real-systembuilder-mini.cms");
        for extension in ["cms", "mae"] {
            let xyz = String::from_utf8(
                xyz_data_from_text(data, extension, "real-systembuilder-mini.cms").unwrap(),
            )
            .unwrap();
            assert!(xyz.starts_with("12\nConverted from real-systembuilder-mini.cms\n"));
            assert!(xyz.contains("N -33.401553 -38.016742 -11.492666"));
            assert!(xyz.contains("O -33.502190 -35.787300 -10.140773"));
        }

        let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
        encoder.write_all(data).unwrap();
        let compressed = encoder.finish().unwrap();
        let xyz = String::from_utf8(
            xyz_data_from_text(&compressed, "maegz", "real-systembuilder-mini.mae.gz").unwrap(),
        )
        .unwrap();
        assert!(xyz.starts_with("12\nConverted from real-systembuilder-mini.mae.gz\n"));
        assert!(xyz.contains("N -33.401553 -38.016742 -11.492666"));
    }

    #[test]
    fn converts_real_systembuilder_maestro_fixture_to_pdb_preview() {
        let data = include_bytes!("../../../../../tests/fixtures/real-systembuilder-mini.cms");
        for extension in ["cms", "mae"] {
            let converted =
                converted_data_from_text(data, extension, "real-systembuilder-mini.cms").unwrap();
            assert_eq!(converted.extension, "pdb");
            let pdb = String::from_utf8(converted.data).unwrap();
            assert!(pdb.starts_with("ATOM      1"));
            assert!(pdb.contains(" HIP A 129"));
            assert!(pdb.contains(" -33.402 -38.017 -11.493"));
            assert!(pdb.ends_with("END\n"));
        }

        let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
        encoder.write_all(data).unwrap();
        let compressed = encoder.finish().unwrap();
        let converted =
            converted_data_from_text(&compressed, "maegz", "real-systembuilder-mini.mae.gz")
                .unwrap();
        assert_eq!(converted.extension, "pdb");
        let pdb = String::from_utf8(converted.data).unwrap();
        assert!(pdb.contains(" HIP A 129"));
    }
}
