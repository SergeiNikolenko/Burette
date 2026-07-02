use flate2::read::GzDecoder;
use serde::Deserialize;
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
    pub(crate) staged_entries: Vec<ConvertedStagedEntry>,
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct ConvertedStagedEntry {
    pub(crate) label: String,
    pub(crate) data: Vec<u8>,
    pub(crate) extension: &'static str,
    pub(crate) representation: &'static str,
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

#[derive(Clone, Debug, PartialEq)]
struct MaestroPdbBlock {
    ct_type: String,
    atoms: Vec<MaestroAtom>,
}

pub(crate) fn converted_data_from_text(
    data: &[u8],
    extension: &str,
    label: &str,
) -> Option<ConvertedStructureData> {
    if matches!(extension, "ph4" | "json") {
        return pharmacophore_pdb_data_from_text(data, extension, label).map(|data| {
            ConvertedStructureData {
                data,
                extension: "pdb",
                staged_entries: Vec::new(),
            }
        });
    }
    if matches!(extension, "cms" | "mae" | "maegz") {
        return maestro_pdb_data_from_text(data, extension);
    }
    if extension == "gro" {
        return gro_pdb_data_from_text(data, label);
    }
    if matches!(extension, "lammpstrj" | "dump" | "pos") {
        return lammps_dump_xyz_data_from_text(data, label).map(|data| ConvertedStructureData {
            data,
            extension: "xyz",
            staged_entries: Vec::new(),
        });
    }
    pdb_data_from_text(data, extension, label).map(|data| ConvertedStructureData {
        data,
        extension: "pdb",
        staged_entries: Vec::new(),
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

fn lammps_dump_xyz_data_from_text(data: &[u8], label: &str) -> Option<Vec<u8>> {
    let decoded = decode_structure_text(data, "lammpstrj")?;
    let text = decoded.replace("\r\n", "\n").replace('\r', "\n");
    let lines: Vec<&str> = text.lines().collect();
    let frames = parse_lammps_dump_frames(&lines);
    if frames.is_empty() {
        return None;
    }

    let mut xyz = String::new();
    for (frame_index, atoms) in frames.iter().enumerate() {
        xyz.push_str(&format!(
            "{}\nConverted from {} frame {}\n",
            atoms.len(),
            label,
            frame_index + 1
        ));
        for atom in atoms {
            xyz.push_str(&format!(
                "{} {:.6} {:.6} {:.6}\n",
                atom.symbol, atom.x, atom.y, atom.z
            ));
        }
    }
    Some(xyz.into_bytes())
}

fn atoms_from_text(data: &[u8], extension: &str) -> Option<Vec<Atom>> {
    let decoded = decode_structure_text(data, extension)?;
    let text = decoded.replace("\r\n", "\n").replace('\r', "\n");
    let lines: Vec<&str> = text.lines().collect();
    match extension {
        "cub" | "cube" => parse_cube_atoms(&lines),
        "vasp" => parse_vasp_atoms(&lines),
        "in" | "inp" => parse_quantum_espresso_atoms(&lines),
        "out" => parse_orca_atoms(&lines),
        "abi" => parse_abinit_atoms(&lines),
        "fdf" => parse_fdf_atoms(&lines),
        "cif" | "mmcif" | "mcif" => parse_cif_core_atoms(&lines),
        "inpcrd" | "rst7" | "restrt" => parse_amber_restart_atoms(&lines),
        "lammpstrj" | "dump" | "pos" => parse_lammps_dump_atoms(&lines),
        "cfg" => parse_atomeye_cfg_atoms(&lines).or_else(|| parse_mlip_cfg_atoms(&lines)),
        "data" | "lammps" | "lmp" => parse_lammps_data_atoms(&lines),
        "crd" => parse_charmm_coordinate_atoms(&lines),
        "rst" => {
            parse_charmm_coordinate_atoms(&lines).or_else(|| parse_amber_restart_atoms(&lines))
        }
        "state" | "xml" => parse_xml_position_atoms(&text).or_else(|| parse_hoomd_xml_atoms(&text)),
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

#[derive(Clone, Debug, PartialEq)]
struct PharmacophoreFeature {
    name: String,
    x: f64,
    y: f64,
    z: f64,
    radius: f64,
    vector: Option<PharmacophoreVector>,
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct PharmacophoreVector {
    x: f64,
    y: f64,
    z: f64,
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct PharmacophoreSphere {
    x: f64,
    y: f64,
    z: f64,
    radius: f64,
}

#[derive(Clone, Debug, PartialEq)]
struct PharmacophorePreview {
    features: Vec<PharmacophoreFeature>,
    connectors: Vec<(usize, usize)>,
    volume_spheres: Vec<PharmacophoreSphere>,
    structure_pdb: Option<String>,
}

#[derive(Debug, Deserialize)]
struct PharmitSession {
    points: Vec<PharmitPoint>,
    ligand: Option<String>,
    receptor: Option<String>,
}

#[derive(Debug, Deserialize)]
struct PharmitPoint {
    name: String,
    x: f64,
    y: f64,
    z: f64,
    #[serde(default = "default_pharmacophore_radius")]
    radius: f64,
    #[serde(default = "default_enabled_pharmit_point")]
    enabled: bool,
    #[serde(default)]
    hasvec: bool,
    svector: Option<PharmitVector>,
}

#[derive(Debug, Deserialize)]
struct PharmitVector {
    x: f64,
    y: f64,
    z: f64,
}

fn default_pharmacophore_radius() -> f64 {
    1.0
}

fn default_enabled_pharmit_point() -> bool {
    true
}

fn pharmacophore_pdb_data_from_text(data: &[u8], extension: &str, label: &str) -> Option<Vec<u8>> {
    let text = String::from_utf8_lossy(data);
    let preview = match extension {
        "ph4" => parse_moe_ph4_preview(&text),
        "json" => parse_pharmit_json_preview(&text),
        _ => None,
    }?;
    if preview.features.is_empty() {
        return None;
    }
    Some(pharmacophore_preview_to_pdb(&preview, label).into_bytes())
}

fn parse_pharmit_json_preview(text: &str) -> Option<PharmacophorePreview> {
    let session: PharmitSession = serde_json::from_str(text).ok()?;
    let features: Vec<PharmacophoreFeature> = session
        .points
        .into_iter()
        .filter(|point| point.enabled)
        .map(|point| PharmacophoreFeature {
            name: point.name,
            x: point.x,
            y: point.y,
            z: point.z,
            radius: point.radius,
            vector: if point.hasvec {
                point.svector.and_then(|vector| {
                    normalized_pharmacophore_vector(vector.x, vector.y, vector.z)
                })
            } else {
                None
            },
        })
        .collect();
    (!features.is_empty()).then_some(PharmacophorePreview {
        features,
        connectors: Vec::new(),
        volume_spheres: Vec::new(),
        structure_pdb: joined_pdb_blocks([session.receptor, session.ligand]),
    })
}

fn parse_moe_ph4_preview(text: &str) -> Option<PharmacophorePreview> {
    if !text.trim_start().starts_with("#moe:ph4que") {
        return None;
    }
    let tokens: Vec<&str> = text.split_whitespace().collect();
    let feature_index = tokens.iter().position(|token| *token == "#feature")?;
    let feature_count = tokens.get(feature_index + 1)?.parse::<usize>().ok()?;
    let mut index = feature_index + 2;
    while index + 1 < tokens.len() {
        if tokens[index] == "m" && tokens[index + 1] == "ix" {
            index += 2;
            break;
        }
        index += 1;
    }
    let mut features = Vec::new();
    for _ in 0..feature_count {
        if index + 8 >= tokens.len() || tokens[index].starts_with('#') {
            break;
        }
        let name = tokens[index].to_string();
        let x = tokens[index + 2].parse::<f64>().ok()?;
        let y = tokens[index + 3].parse::<f64>().ok()?;
        let z = tokens[index + 4].parse::<f64>().ok()?;
        let radius = tokens[index + 5].parse::<f64>().unwrap_or(1.0);
        features.push(PharmacophoreFeature {
            name,
            x,
            y,
            z,
            radius,
            vector: None,
        });
        index += 9;
    }
    (!features.is_empty()).then_some(PharmacophorePreview {
        connectors: parse_moe_ph4_constraints(&tokens, features.len()),
        volume_spheres: parse_moe_ph4_volume_spheres(&tokens),
        features,
        structure_pdb: None,
    })
}

fn pharmacophore_preview_to_pdb(preview: &PharmacophorePreview, label: &str) -> String {
    let mut pdb = format!("REMARK Pharmacophore preview converted from {label}\n");
    pdb.push_str("REMARK Feature centers are pseudo-atoms; Pharmit vectors and MOE constraints are rendered as CONECT sticks.\n");
    if !preview.volume_spheres.is_empty() {
        pdb.push_str("REMARK MOE volume spheres are rendered as low-occupancy pseudo-atoms.\n");
    }
    if let Some(structure_pdb) = &preview.structure_pdb {
        pdb.push_str(structure_pdb);
        if !structure_pdb.ends_with('\n') {
            pdb.push('\n');
        }
    }
    let mut serial = max_pdb_serial(preview.structure_pdb.as_deref()).unwrap_or(0) + 1;
    let mut feature_serials = Vec::new();
    let mut conect_lines = Vec::new();
    for (index, feature) in preview.features.iter().enumerate() {
        if serial > 99_999 {
            break;
        }
        let symbol = pharmacophore_feature_symbol(&feature.name);
        let atom_name = format_pdb_atom_name(&pharmacophore_atom_name(&feature.name), symbol);
        let residue_name = pharmacophore_residue_name(&feature.name);
        let feature_serial = serial;
        feature_serials.push(feature_serial);
        pdb.push_str(&pharmacophore_pdb_atom_line(
            feature_serial,
            &atom_name,
            residue_name,
            "P",
            (index + 1).min(9999),
            feature.x,
            feature.y,
            feature.z,
            1.0,
            feature.radius,
            symbol,
        ));
        serial += 1;
        if let Some(vector) = feature.vector {
            if serial > 99_999 {
                break;
            }
            let length = (feature.radius * 2.0).max(1.25);
            pdb.push_str(&pharmacophore_pdb_atom_line(
                serial,
                "VEC",
                "VEC",
                "V",
                (index + 1).min(9999),
                feature.x + vector.x * length,
                feature.y + vector.y * length,
                feature.z + vector.z * length,
                1.0,
                0.2,
                "C",
            ));
            conect_lines.push((feature_serial, serial));
            serial += 1;
        }
    }
    for (left, right) in &preview.connectors {
        if let (Some(left_serial), Some(right_serial)) =
            (feature_serials.get(*left), feature_serials.get(*right))
        {
            conect_lines.push((*left_serial, *right_serial));
        }
    }
    for (index, sphere) in preview.volume_spheres.iter().enumerate() {
        if serial > 99_999 {
            break;
        }
        pdb.push_str(&pharmacophore_pdb_atom_line(
            serial,
            "VOL",
            "VOL",
            "Q",
            (index + 1).min(9999),
            sphere.x,
            sphere.y,
            sphere.z,
            0.2,
            sphere.radius,
            "C",
        ));
        serial += 1;
    }
    for (left, right) in conect_lines {
        pdb.push_str(&format!("CONECT{left:>5}{right:>5}\n"));
    }
    pdb.push_str("END\n");
    pdb
}

fn pharmacophore_pdb_atom_line(
    serial: usize,
    atom_name: &str,
    residue_name: &str,
    chain: &str,
    residue_number: usize,
    x: f64,
    y: f64,
    z: f64,
    occupancy: f64,
    b_factor: f64,
    element: &str,
) -> String {
    format!(
        "HETATM{serial:>5} {atom_name:<4} {residue_name:>3} {chain}{residue_number:>4}    {x:>8.3}{y:>8.3}{z:>8.3}{occupancy:>6.2}{b_factor:>6.2}          {element:>2}\n",
        serial = serial.min(99_999),
        atom_name = atom_name.chars().take(4).collect::<String>(),
        residue_name = residue_name.chars().take(3).collect::<String>(),
        chain = chain.chars().next().unwrap_or('P'),
        residue_number = residue_number.min(9999),
    )
}

fn normalized_pharmacophore_vector(x: f64, y: f64, z: f64) -> Option<PharmacophoreVector> {
    let length = (x * x + y * y + z * z).sqrt();
    (length > 0.000_001).then_some(PharmacophoreVector {
        x: x / length,
        y: y / length,
        z: z / length,
    })
}

fn joined_pdb_blocks(blocks: [Option<String>; 2]) -> Option<String> {
    let mut lines = Vec::new();
    for block in blocks.into_iter().flatten() {
        for line in block.lines() {
            let trimmed = line.trim_end();
            if trimmed == "END" || trimmed == "ENDMDL" || trimmed.is_empty() {
                continue;
            }
            if trimmed.starts_with("ATOM")
                || trimmed.starts_with("HETATM")
                || trimmed.starts_with("TER")
                || trimmed.starts_with("CONECT")
            {
                lines.push(trimmed.to_string());
            }
        }
    }
    (!lines.is_empty()).then(|| {
        lines.push("TER".to_string());
        lines.join("\n") + "\n"
    })
}

fn max_pdb_serial(pdb: Option<&str>) -> Option<usize> {
    pdb?.lines()
        .filter(|line| line.starts_with("ATOM") || line.starts_with("HETATM"))
        .filter_map(|line| line.get(6..11)?.trim().parse::<usize>().ok())
        .max()
}

fn parse_moe_ph4_constraints(tokens: &[&str], feature_count: usize) -> Vec<(usize, usize)> {
    let Some(mut index) = tokens.iter().position(|token| *token == "#constraint") else {
        return Vec::new();
    };
    let Some(count) = tokens
        .get(index + 1)
        .and_then(|token| token.parse::<usize>().ok())
    else {
        return Vec::new();
    };
    index += 2;
    while index < tokens.len() && tokens[index] != "ids" {
        index += 1;
    }
    if index >= tokens.len() {
        return Vec::new();
    }
    index += 2;
    let mut connectors = Vec::new();
    for _ in 0..count {
        if index + 4 >= tokens.len() || tokens[index].starts_with('#') {
            break;
        }
        let id_count = tokens[index + 2].parse::<usize>().unwrap_or(0);
        if id_count >= 2 {
            let left = tokens[index + 3].parse::<usize>().unwrap_or(0);
            let right = tokens[index + 4].parse::<usize>().unwrap_or(0);
            if (1..=feature_count).contains(&left) && (1..=feature_count).contains(&right) {
                connectors.push((left - 1, right - 1));
            }
        }
        index += 3 + id_count;
    }
    connectors
}

fn parse_moe_ph4_volume_spheres(tokens: &[&str]) -> Vec<PharmacophoreSphere> {
    let Some(mut index) = tokens.iter().position(|token| *token == "#volumesphere") else {
        return Vec::new();
    };
    let Some(count) = tokens
        .get(index + 1)
        .and_then(|token| token.parse::<usize>().ok())
    else {
        return Vec::new();
    };
    index += 2;
    while index + 7 < tokens.len() {
        if tokens[index] == "x"
            && tokens[index + 1] == "r"
            && tokens[index + 2] == "y"
            && tokens[index + 3] == "r"
            && tokens[index + 4] == "z"
            && tokens[index + 5] == "r"
            && tokens[index + 6] == "r"
            && tokens[index + 7] == "r"
        {
            index += 8;
            break;
        }
        index += 1;
    }
    let mut spheres = Vec::new();
    for _ in 0..count {
        if index + 3 >= tokens.len() || tokens[index].starts_with('#') {
            break;
        }
        let (Some(x), Some(y), Some(z), Some(radius)) = (
            tokens[index].parse::<f64>().ok(),
            tokens[index + 1].parse::<f64>().ok(),
            tokens[index + 2].parse::<f64>().ok(),
            tokens[index + 3].parse::<f64>().ok(),
        ) else {
            break;
        };
        spheres.push(PharmacophoreSphere { x, y, z, radius });
        index += 4;
    }
    spheres
}

#[allow(dead_code)]
fn parse_pharmit_json_features(text: &str) -> Option<Vec<PharmacophoreFeature>> {
    parse_pharmit_json_preview(text).map(|preview| preview.features)
}

#[allow(dead_code)]
fn parse_moe_ph4_features(text: &str) -> Option<Vec<PharmacophoreFeature>> {
    parse_moe_ph4_preview(text).map(|preview| preview.features)
}

fn pharmacophore_feature_symbol(name: &str) -> &'static str {
    let lower = name.to_ascii_lowercase();
    if lower.contains("acceptor") || lower.starts_with("acc") {
        "O"
    } else if lower.contains("donor") || lower.starts_with("don") {
        "N"
    } else if lower.contains("positive") || lower.contains("pos") {
        "P"
    } else if lower.contains("negative") || lower.contains("neg") {
        "S"
    } else {
        "C"
    }
}

fn pharmacophore_atom_name(name: &str) -> String {
    name.chars()
        .filter(|ch| ch.is_ascii_alphanumeric())
        .take(4)
        .collect::<String>()
}

fn pharmacophore_residue_name(name: &str) -> &'static str {
    let lower = name.to_ascii_lowercase();
    if lower.contains("acceptor") || lower.starts_with("acc") {
        "ACC"
    } else if lower.contains("donor") || lower.starts_with("don") {
        "DON"
    } else if lower.contains("aromatic") || lower.starts_with("aro") {
        "ARO"
    } else if lower.contains("hydrophobic") || lower.starts_with("hyd") {
        "HYD"
    } else if lower.contains("positive") || lower.contains("pos") {
        "POS"
    } else if lower.contains("negative") || lower.contains("neg") {
        "NEG"
    } else {
        "PH4"
    }
}

const MAESTRO_PREVIEW_ATOM_LIMIT: usize = 3_000;
const MAESTRO_PDB_PREVIEW_ATOM_LIMIT: usize = 99_999;

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

fn parse_amber_restart_atoms(lines: &[&str]) -> Option<Vec<Atom>> {
    if lines.len() < 2 {
        return None;
    }
    let atom_count = fields(lines[1]).first()?.parse::<usize>().ok()?;
    if atom_count == 0 {
        return None;
    }
    let mut values = Vec::with_capacity(atom_count * 3);
    for line in &lines[2..] {
        for token in fields(line) {
            if let Ok(value) = token.parse::<f64>() {
                values.push(value);
                if values.len() >= atom_count * 3 {
                    break;
                }
            }
        }
        if values.len() >= atom_count * 3 {
            break;
        }
    }
    if values.len() < atom_count * 3 {
        return None;
    }
    let mut atoms = Vec::with_capacity(atom_count);
    for index in 0..atom_count {
        atoms.push(Atom {
            symbol: "C".to_string(),
            x: values[index * 3],
            y: values[index * 3 + 1],
            z: values[index * 3 + 2],
        });
    }
    Some(atoms)
}

fn parse_charmm_coordinate_atoms(lines: &[&str]) -> Option<Vec<Atom>> {
    let mut atoms = Vec::new();
    for line in lines {
        let parts = fields(line);
        if parts.len() < 7 {
            continue;
        }
        let x = parts[4].parse::<f64>().ok();
        let y = parts[5].parse::<f64>().ok();
        let z = parts[6].parse::<f64>().ok();
        let (Some(x), Some(y), Some(z)) = (x, y, z) else {
            continue;
        };
        let symbol = element_symbol_from_atom_name(parts[3])
            .or_else(|| element_symbol_from_atom_name(parts[2]))
            .unwrap_or_else(|| "C".to_string());
        atoms.push(Atom { symbol, x, y, z });
    }
    (!atoms.is_empty()).then_some(atoms)
}

fn parse_lammps_dump_atoms(lines: &[&str]) -> Option<Vec<Atom>> {
    parse_lammps_dump_frames(lines).into_iter().next()
}

fn parse_atomeye_cfg_atoms(lines: &[&str]) -> Option<Vec<Atom>> {
    let atom_count = parse_atomeye_cfg_atom_count(lines)?;
    let scale = parse_atomeye_cfg_scale(lines).unwrap_or(1.0);
    let h0 = parse_atomeye_cfg_h0(lines)?;
    let entry_count = parse_atomeye_cfg_entry_count(lines)?;
    if atom_count == 0 || entry_count == 0 {
        return None;
    }
    let mut index = lines
        .iter()
        .position(|line| line.trim_start().starts_with("entry_count"))?
        + 1;
    let mut atoms = Vec::with_capacity(atom_count);
    while atoms.len() < atom_count && index + entry_count <= lines.len() {
        let entry = &lines[index..index + entry_count];
        index += entry_count;
        let symbol = entry
            .iter()
            .find_map(|line| element_symbol_from_atom_name(line))
            .unwrap_or_else(|| "C".to_string());
        let fractional = entry.iter().rev().find_map(|line| {
            let values = numeric_tokens(line);
            (values.len() >= 3).then_some((values[0], values[1], values[2]))
        })?;
        let x =
            scale * (h0[0][0] * fractional.0 + h0[0][1] * fractional.1 + h0[0][2] * fractional.2);
        let y =
            scale * (h0[1][0] * fractional.0 + h0[1][1] * fractional.1 + h0[1][2] * fractional.2);
        let z =
            scale * (h0[2][0] * fractional.0 + h0[2][1] * fractional.1 + h0[2][2] * fractional.2);
        atoms.push(Atom { symbol, x, y, z });
    }
    (atoms.len() == atom_count).then_some(atoms)
}

fn parse_mlip_cfg_atoms(lines: &[&str]) -> Option<Vec<Atom>> {
    let begin = lines
        .iter()
        .position(|line| line.trim().eq_ignore_ascii_case("BEGIN_CFG"))?;
    let end = lines[begin + 1..]
        .iter()
        .position(|line| line.trim().eq_ignore_ascii_case("END_CFG"))
        .map(|offset| begin + 1 + offset)
        .unwrap_or(lines.len());
    let block = &lines[begin + 1..end];
    let atom_count = parse_mlip_cfg_size(block)?;
    let atom_data_index = block
        .iter()
        .position(|line| line.trim_start().starts_with("AtomData:"))?;
    let header = fields(block[atom_data_index]);
    let column = |name: &str| -> Option<usize> {
        header
            .iter()
            .position(|value| value.eq_ignore_ascii_case(name))
            .and_then(|index| index.checked_sub(1))
    };
    let type_index = column("type");
    let x_index = column("cartes_x")?;
    let y_index = column("cartes_y")?;
    let z_index = column("cartes_z")?;
    let mut atoms = Vec::with_capacity(atom_count);
    for line in &block[atom_data_index + 1..] {
        let parts = fields(line);
        if parts.len() <= x_index.max(y_index).max(z_index) {
            if !atoms.is_empty() {
                break;
            }
            continue;
        }
        let x = parts[x_index].parse::<f64>().ok();
        let y = parts[y_index].parse::<f64>().ok();
        let z = parts[z_index].parse::<f64>().ok();
        let (Some(x), Some(y), Some(z)) = (x, y, z) else {
            if !atoms.is_empty() {
                break;
            }
            continue;
        };
        let symbol = type_index
            .and_then(|index| parts.get(index))
            .map(|value| mlip_cfg_symbol_for_type(value))
            .unwrap_or_else(|| "C".to_string());
        atoms.push(Atom { symbol, x, y, z });
        if atoms.len() == atom_count {
            break;
        }
    }
    (atoms.len() == atom_count).then_some(atoms)
}

fn parse_mlip_cfg_size(lines: &[&str]) -> Option<usize> {
    lines.windows(2).find_map(|pair| {
        pair[0]
            .trim()
            .eq_ignore_ascii_case("Size")
            .then(|| fields(pair[1]).first()?.parse::<usize>().ok())
            .flatten()
    })
}

fn mlip_cfg_symbol_for_type(value: &str) -> String {
    let normalized = normalize_element_symbol(value);
    if is_element_symbol(&normalized) {
        return normalized;
    }
    match value.trim() {
        "0" => "C".to_string(),
        "1" => "H".to_string(),
        _ => "C".to_string(),
    }
}

fn parse_atomeye_cfg_atom_count(lines: &[&str]) -> Option<usize> {
    lines.iter().find_map(|line| {
        line.trim()
            .strip_prefix("Number of particles")
            .and_then(|rest| rest.split('=').nth(1))
            .and_then(|value| value.trim().parse::<usize>().ok())
    })
}

fn parse_atomeye_cfg_scale(lines: &[&str]) -> Option<f64> {
    lines.iter().find_map(|line| {
        line.trim()
            .strip_prefix("A =")
            .and_then(|value| fields(value).first()?.parse::<f64>().ok())
    })
}

fn parse_atomeye_cfg_entry_count(lines: &[&str]) -> Option<usize> {
    lines.iter().find_map(|line| {
        line.trim()
            .strip_prefix("entry_count")
            .and_then(|rest| rest.split('=').nth(1))
            .and_then(|value| value.trim().parse::<usize>().ok())
    })
}

fn parse_atomeye_cfg_h0(lines: &[&str]) -> Option<[[f64; 3]; 3]> {
    let mut h0 = [[0.0; 3]; 3];
    let mut seen = 0;
    for line in lines {
        let trimmed = line.trim();
        let Some(rest) = trimmed.strip_prefix("H0(") else {
            continue;
        };
        let Some((indices, value_rest)) = rest.split_once(')') else {
            continue;
        };
        let value_text = value_rest.trim_start().strip_prefix('=')?;
        let mut index_parts = indices.split(',');
        let row = index_parts
            .next()?
            .trim()
            .parse::<usize>()
            .ok()?
            .checked_sub(1)?;
        let column = index_parts
            .next()?
            .trim()
            .parse::<usize>()
            .ok()?
            .checked_sub(1)?;
        if row >= 3 || column >= 3 {
            continue;
        }
        let value = fields(value_text).first()?.parse::<f64>().ok()?;
        h0[row][column] = value;
        seen += 1;
    }
    (seen == 9).then_some(h0)
}

fn parse_lammps_data_atoms(lines: &[&str]) -> Option<Vec<Atom>> {
    let masses = parse_lammps_masses(lines);
    let mut in_atoms = false;
    let mut atoms = Vec::new();
    for line in lines {
        let clean_line = strip_inline_comment(line);
        let parts = fields(&clean_line);
        let Some(first) = parts.first() else {
            continue;
        };
        if first.eq_ignore_ascii_case("atoms") {
            in_atoms = true;
            continue;
        }
        if in_atoms
            && first
                .chars()
                .next()
                .is_some_and(|character| character.is_ascii_alphabetic())
        {
            break;
        }
        if !in_atoms || parts.len() < 5 {
            continue;
        }
        let Some((x, y, z)) = lammps_data_coordinates(&parts, &masses) else {
            continue;
        };
        let symbol = lammps_data_atom_symbol(&parts, &masses);
        atoms.push(Atom { symbol, x, y, z });
    }
    (!atoms.is_empty()).then_some(atoms)
}

fn parse_lammps_masses(lines: &[&str]) -> std::collections::HashMap<String, String> {
    let mut in_masses = false;
    let mut masses = std::collections::HashMap::new();
    for line in lines {
        let clean_line = strip_inline_comment(line);
        let parts = fields(&clean_line);
        let Some(first) = parts.first() else {
            continue;
        };
        if first.eq_ignore_ascii_case("masses") {
            in_masses = true;
            continue;
        }
        if in_masses
            && first
                .chars()
                .next()
                .is_some_and(|character| character.is_ascii_alphabetic())
        {
            break;
        }
        if !in_masses || parts.len() < 2 {
            continue;
        }
        if let Some(symbol) = parts
            .get(2)
            .and_then(|value| element_symbol_from_atom_name(value))
            .or_else(|| {
                parts
                    .get(1)
                    .and_then(|value| lammps_symbol_from_mass(value))
            })
        {
            masses.insert(parts[0].to_string(), symbol);
        }
    }
    masses
}

fn lammps_data_atom_symbol(
    parts: &[&str],
    masses: &std::collections::HashMap<String, String>,
) -> String {
    parts
        .get(1)
        .and_then(|value| masses.get(*value))
        .or_else(|| parts.get(2).and_then(|value| masses.get(*value)))
        .cloned()
        .or_else(|| {
            parts
                .get(1)
                .and_then(|value| element_symbol_from_atom_name(value))
        })
        .or_else(|| {
            parts
                .get(2)
                .and_then(|value| element_symbol_from_atom_name(value))
        })
        .unwrap_or_else(|| "C".to_string())
}

fn lammps_data_coordinates(
    parts: &[&str],
    masses: &std::collections::HashMap<String, String>,
) -> Option<(f64, f64, f64)> {
    let mut starts = Vec::new();
    if parts
        .get(2)
        .is_some_and(|value| masses.contains_key(*value))
    {
        starts.push(4);
    }
    if parts
        .get(1)
        .is_some_and(|value| masses.contains_key(*value))
    {
        starts.extend([3, 2]);
    }
    starts.extend([3, 4, 2]);
    for start in starts {
        if start + 2 >= parts.len() {
            continue;
        }
        let x = parts[start].parse::<f64>().ok();
        let y = parts[start + 1].parse::<f64>().ok();
        let z = parts[start + 2].parse::<f64>().ok();
        if let (Some(x), Some(y), Some(z)) = (x, y, z) {
            return Some((x, y, z));
        }
    }
    None
}

fn lammps_symbol_from_mass(value: &str) -> Option<String> {
    let mass = value.parse::<f64>().ok()?;
    const MASS_SYMBOLS: &[(f64, &str)] = &[
        (1.008, "H"),
        (12.011, "C"),
        (14.007, "N"),
        (15.999, "O"),
        (18.998, "F"),
        (22.990, "Na"),
        (24.305, "Mg"),
        (30.974, "P"),
        (32.06, "S"),
        (35.45, "Cl"),
        (39.098, "K"),
        (40.078, "Ca"),
        (55.845, "Fe"),
        (63.546, "Cu"),
        (65.38, "Zn"),
        (79.904, "Br"),
        (126.904, "I"),
    ];
    MASS_SYMBOLS
        .iter()
        .find(|(reference, _)| (mass - reference).abs() <= 0.35)
        .map(|(_, symbol)| (*symbol).to_string())
}

fn parse_lammps_dump_frames(lines: &[&str]) -> Vec<Vec<Atom>> {
    let mut frames = Vec::new();
    let mut atoms = Vec::new();
    let mut in_atoms = false;
    let mut x_index = None;
    let mut y_index = None;
    let mut z_index = None;
    let mut symbol_index = None;
    let mut type_index = None;
    for line in lines {
        if line.starts_with("ITEM: ") {
            if in_atoms && !atoms.is_empty() {
                frames.push(std::mem::take(&mut atoms));
            }
            in_atoms = false;
            if let Some(rest) = line.strip_prefix("ITEM: ATOMS") {
                let columns: Vec<&str> = rest.split_whitespace().collect();
                x_index = coordinate_column_index(&columns, &["x", "xu", "xs", "xsu"]);
                y_index = coordinate_column_index(&columns, &["y", "yu", "ys", "ysu"]);
                z_index = coordinate_column_index(&columns, &["z", "zu", "zs", "zsu"]);
                symbol_index = coordinate_column_index(&columns, &["element", "symbol", "name"]);
                type_index = coordinate_column_index(&columns, &["type"]);
                in_atoms = x_index.is_some() && y_index.is_some() && z_index.is_some();
            }
            continue;
        }
        if !in_atoms {
            continue;
        }
        let parts = fields(line);
        let x = x_index
            .and_then(|index| parts.get(index))
            .and_then(|value| value.parse::<f64>().ok());
        let y = y_index
            .and_then(|index| parts.get(index))
            .and_then(|value| value.parse::<f64>().ok());
        let z = z_index
            .and_then(|index| parts.get(index))
            .and_then(|value| value.parse::<f64>().ok());
        let (Some(x), Some(y), Some(z)) = (x, y, z) else {
            continue;
        };
        let symbol = symbol_index
            .and_then(|index| parts.get(index))
            .and_then(|value| element_symbol_from_atom_name(value))
            .or_else(|| {
                type_index
                    .and_then(|index| parts.get(index))
                    .and_then(|value| element_symbol_from_atom_name(value))
            })
            .unwrap_or_else(|| "C".to_string());
        atoms.push(Atom { symbol, x, y, z });
    }
    if in_atoms && !atoms.is_empty() {
        frames.push(atoms);
    }
    frames
}

fn coordinate_column_index(columns: &[&str], names: &[&str]) -> Option<usize> {
    columns.iter().position(|column| {
        let lower = column.to_ascii_lowercase();
        names.iter().any(|name| lower == *name)
    })
}

fn parse_xml_position_atoms(text: &str) -> Option<Vec<Atom>> {
    let mut atoms = Vec::new();
    for segment in text.split("<Position").skip(1) {
        let attributes = segment.split('>').next().unwrap_or_default();
        let x = xml_number_attribute(attributes, "x");
        let y = xml_number_attribute(attributes, "y");
        let z = xml_number_attribute(attributes, "z");
        let (Some(x), Some(y), Some(z)) = (x, y, z) else {
            continue;
        };
        atoms.push(Atom {
            symbol: "C".to_string(),
            x,
            y,
            z,
        });
    }
    (!atoms.is_empty()).then_some(atoms)
}

fn parse_hoomd_xml_atoms(text: &str) -> Option<Vec<Atom>> {
    let lower = text.to_ascii_lowercase();
    if !lower.contains("<hoomd_xml") && !lower.contains("<configuration") {
        return None;
    }
    let position_block = xml_text_block(text, "position")?;
    let values = numeric_tokens(position_block);
    if values.len() < 3 {
        return None;
    }
    let symbols: Vec<String> = xml_text_block(text, "type")
        .map(|block| {
            fields(block)
                .iter()
                .map(|value| {
                    element_symbol_from_atom_name(value).unwrap_or_else(|| "C".to_string())
                })
                .collect()
        })
        .unwrap_or_default();
    let mut atoms = Vec::new();
    for index in (0..values.len().saturating_sub(2)).step_by(3) {
        let atom_index = index / 3;
        atoms.push(Atom {
            symbol: symbols
                .get(atom_index)
                .cloned()
                .unwrap_or_else(|| "C".to_string()),
            x: values[index],
            y: values[index + 1],
            z: values[index + 2],
        });
    }
    (!atoms.is_empty()).then_some(atoms)
}

fn xml_text_block<'a>(text: &'a str, tag: &str) -> Option<&'a str> {
    let lower = text.to_ascii_lowercase();
    let open = format!("<{tag}");
    let close = format!("</{tag}>");
    let start = lower.find(&open)?;
    let content_start = text[start..].find('>')? + start + 1;
    let end = lower[content_start..].find(&close)? + content_start;
    Some(&text[content_start..end])
}

fn numeric_tokens(text: &str) -> Vec<f64> {
    fields(text)
        .iter()
        .filter_map(|value| value.parse::<f64>().ok())
        .collect()
}

fn xml_number_attribute(attributes: &str, name: &str) -> Option<f64> {
    for quote in ['"', '\''] {
        let prefix = format!("{name}={quote}");
        if let Some(start) = attributes.find(&prefix) {
            let rest = &attributes[start + prefix.len()..];
            let end = rest.find(quote)?;
            return rest[..end].parse::<f64>().ok();
        }
    }
    None
}

fn element_symbol_from_atom_name(value: &str) -> Option<String> {
    let clean: String = value
        .trim_start_matches(|character: char| character.is_ascii_digit())
        .chars()
        .filter(|character| character.is_ascii_alphabetic())
        .collect();
    if clean.is_empty() {
        return None;
    }
    let two = normalize_element_symbol(&clean.chars().take(2).collect::<String>());
    if is_element_symbol(&two) {
        return Some(two);
    }
    let one = normalize_element_symbol(&clean.chars().take(1).collect::<String>());
    is_element_symbol(&one).then_some(one)
}

fn parse_abinit_atoms(lines: &[&str]) -> Option<Vec<Atom>> {
    let mut atom_count = None;
    let mut atomic_numbers: Vec<usize> = Vec::new();
    let mut type_indices: Vec<usize> = Vec::new();
    let mut coordinate_start = None;

    for (index, line) in lines.iter().enumerate() {
        let clean_line = strip_inline_comment(line);
        let parts = fields(&clean_line);
        let Some(key) = parts.first().map(|value| value.to_ascii_lowercase()) else {
            continue;
        };
        match key.as_str() {
            "natom" => {
                atom_count = parts.get(1).and_then(|value| value.parse::<usize>().ok());
            }
            "znucl" => {
                atomic_numbers.extend(
                    parts
                        .iter()
                        .skip(1)
                        .filter_map(|value| value.parse::<usize>().ok()),
                );
            }
            "typat" => {
                type_indices.extend(
                    parts
                        .iter()
                        .skip(1)
                        .filter_map(|value| value.parse::<usize>().ok()),
                );
            }
            "xangst" => {
                coordinate_start = Some(index + 1);
            }
            _ => {}
        }
    }

    let atom_count = atom_count?;
    let coordinate_start = coordinate_start?;
    if atom_count == 0
        || atomic_numbers.is_empty()
        || type_indices.len() < atom_count
        || coordinate_start + atom_count > lines.len()
    {
        return None;
    }

    let mut atoms = Vec::with_capacity(atom_count);
    for index in 0..atom_count {
        let clean_line = strip_inline_comment(lines[coordinate_start + index]);
        let parts = fields(&clean_line);
        let x = parts.first()?.parse::<f64>().ok()?;
        let y = parts.get(1)?.parse::<f64>().ok()?;
        let z = parts.get(2)?.parse::<f64>().ok()?;
        let type_index = type_indices[index].checked_sub(1)?;
        let atomic_number = *atomic_numbers.get(type_index)?;
        atoms.push(Atom {
            symbol: symbol_for_atomic_number(atomic_number).to_string(),
            x,
            y,
            z,
        });
    }
    (atoms.len() == atom_count).then_some(atoms)
}

fn parse_fdf_atoms(lines: &[&str]) -> Option<Vec<Atom>> {
    let mut species_by_id = std::collections::HashMap::new();
    for row in fdf_block_rows("ChemicalSpeciesLabel", lines) {
        let parts = fields(&row);
        let Some(species_id) = parts.first().and_then(|value| value.parse::<usize>().ok()) else {
            continue;
        };
        let Some(atomic_number) = parts.get(1).and_then(|value| value.parse::<usize>().ok()) else {
            continue;
        };
        let explicit_symbol = parts
            .get(2)
            .map(|value| normalize_element_symbol(value))
            .filter(|symbol| is_element_symbol(symbol));
        let symbol =
            explicit_symbol.unwrap_or_else(|| symbol_for_atomic_number(atomic_number).to_string());
        if !is_element_symbol(&symbol) {
            continue;
        }
        species_by_id.insert(species_id, symbol);
    }
    if species_by_id.is_empty() {
        return None;
    }

    let coordinate_scale = fdf_coordinate_scale(lines);
    let atoms: Vec<Atom> = fdf_block_rows("AtomicCoordinatesAndAtomicSpecies", lines)
        .into_iter()
        .filter_map(|row| {
            let parts = fields(&row);
            let x = parts.first()?.parse::<f64>().ok()?;
            let y = parts.get(1)?.parse::<f64>().ok()?;
            let z = parts.get(2)?.parse::<f64>().ok()?;
            let species_id = parts.get(3)?.parse::<usize>().ok()?;
            let symbol = species_by_id.get(&species_id)?.clone();
            Some(Atom {
                symbol,
                x: x * coordinate_scale,
                y: y * coordinate_scale,
                z: z * coordinate_scale,
            })
        })
        .collect();
    (!atoms.is_empty()).then_some(atoms)
}

fn fdf_block_rows(block_name: &str, lines: &[&str]) -> Vec<String> {
    let normalized_block_name = block_name.to_ascii_lowercase();
    let mut rows = Vec::new();
    let mut inside = false;
    for line in lines {
        let trimmed = strip_inline_comment(line);
        let parts = fields(&trimmed);
        let marker = parts.first().map(|value| value.to_ascii_lowercase());
        let name = parts.get(1).map(|value| value.to_ascii_lowercase());
        if marker.as_deref() == Some("%block")
            && name.as_deref() == Some(normalized_block_name.as_str())
        {
            inside = true;
            continue;
        }
        if marker.as_deref() == Some("%endblock")
            && name.as_deref() == Some(normalized_block_name.as_str())
        {
            break;
        }
        if inside && !trimmed.is_empty() {
            rows.push(trimmed);
        }
    }
    rows
}

fn fdf_coordinate_scale(lines: &[&str]) -> f64 {
    for line in lines {
        let clean_line = strip_inline_comment(line);
        let parts = fields(&clean_line);
        if parts.len() >= 2 && parts[0].eq_ignore_ascii_case("AtomicCoordinatesFormat") {
            return if parts[1].to_ascii_lowercase().contains("bohr") {
                BOHR_TO_ANGSTROM
            } else {
                1.0
            };
        }
    }
    1.0
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
    let blocks = parse_maestro_pdb_blocks(&lines, MAESTRO_PDB_PREVIEW_ATOM_LIMIT)?;
    let best_score = blocks
        .iter()
        .map(|block| maestro_ct_score(&block.ct_type))
        .max()?;

    let mut models = blocks
        .iter()
        .filter(|block| maestro_ct_score(&block.ct_type) == best_score)
        .map(|block| {
            block
                .atoms
                .iter()
                .filter(|atom| !is_maestro_water_atom(atom))
                .cloned()
                .collect::<Vec<_>>()
        })
        .filter(|atoms| !atoms.is_empty())
        .collect::<Vec<_>>();
    let has_non_solvent_primary = !models.is_empty();

    if models.is_empty() {
        models = blocks
            .iter()
            .filter(|block| maestro_ct_score(&block.ct_type) == best_score)
            .map(|block| block.atoms.clone())
            .filter(|atoms| !atoms.is_empty())
            .collect();
    }

    if models.is_empty() {
        return None;
    }

    let data = if models.len() == 1 {
        maestro_atoms_to_pdb(&models[0])
    } else {
        maestro_models_to_pdb(&models)
    };
    let mut staged_entries = Vec::new();
    if has_non_solvent_primary {
        let solvent_atoms = maestro_staged_solvent_atoms(&blocks);
        if !solvent_atoms.is_empty() {
            staged_entries.push(ConvertedStagedEntry {
                label: "Solvent".to_string(),
                data: maestro_atoms_to_pdb(&solvent_atoms).into_bytes(),
                extension: "pdb",
                representation: "solvent-lines",
            });
        }
    }

    Some(ConvertedStructureData {
        data: data.into_bytes(),
        extension: "pdb",
        staged_entries,
    })
}

fn gro_pdb_data_from_text(data: &[u8], label: &str) -> Option<ConvertedStructureData> {
    let decoded = decode_structure_text(data, "gro")?;
    let text = decoded.replace("\r\n", "\n").replace('\r', "\n");
    let lines: Vec<&str> = text.lines().collect();
    let atoms = parse_gro_pdb_atoms(&lines)?;
    if atoms.is_empty() {
        return None;
    }
    let (water_atoms, main_atoms): (Vec<_>, Vec<_>) = atoms
        .into_iter()
        .partition(|atom| atom.residue_name == "HOH");
    let mut pdb = String::new();
    pdb.push_str(&format!("REMARK Converted from {label}\n"));
    for (index, atom) in main_atoms.iter().take(99_999).enumerate() {
        pdb.push_str(&maestro_pdb_atom_line(index + 1, atom));
        pdb.push('\n');
    }
    pdb.push_str("END\n");
    let mut staged_entries = Vec::new();
    if !water_atoms.is_empty() {
        let mut water_pdb = format!("REMARK Water split from {label}\n");
        for (index, atom) in water_atoms.iter().take(99_999).enumerate() {
            water_pdb.push_str(&maestro_pdb_atom_line(index + 1, atom));
            water_pdb.push('\n');
        }
        water_pdb.push_str("END\n");
        staged_entries.push(ConvertedStagedEntry {
            label: "Water".to_string(),
            data: water_pdb.into_bytes(),
            extension: "pdb",
            representation: "solvent-lines",
        });
    }
    Some(ConvertedStructureData {
        data: pdb.into_bytes(),
        extension: "pdb",
        staged_entries,
    })
}

fn parse_gro_pdb_atoms(lines: &[&str]) -> Option<Vec<MaestroAtom>> {
    if lines.len() < 3 {
        return None;
    }
    let atom_count = lines[1].trim().parse::<usize>().ok()?;
    if atom_count == 0 || lines.len() < atom_count + 2 {
        return None;
    }
    let mut atoms = Vec::with_capacity(atom_count);
    for line in &lines[2..2 + atom_count] {
        let Some(atom) =
            parse_gro_fixed_atom_line(line).or_else(|| parse_gro_loose_atom_line(line))
        else {
            continue;
        };
        atoms.push(atom);
    }
    (!atoms.is_empty()).then_some(atoms)
}

fn parse_gro_fixed_atom_line(line: &str) -> Option<MaestroAtom> {
    if line.len() < 44 {
        return None;
    }
    let residue_number = line.get(0..5)?.trim().parse::<i32>().ok()?;
    let residue_name = line.get(5..10)?.trim();
    let atom_name = line.get(10..15)?.trim();
    let x = line.get(20..28)?.trim().parse::<f64>().ok()?;
    let y = line.get(28..36)?.trim().parse::<f64>().ok()?;
    let z = line.get(36..44)?.trim().parse::<f64>().ok()?;
    gro_atom_to_maestro(residue_number, residue_name, atom_name, x, y, z)
}

fn parse_gro_loose_atom_line(line: &str) -> Option<MaestroAtom> {
    let parts: Vec<&str> = line.split_whitespace().collect();
    if parts.len() < 6 {
        return None;
    }
    let (residue_number, residue_name, atom_name, offset) =
        if let Some((number, name)) = split_gro_residue_token(parts[0]) {
            (number, name, parts[1], 3)
        } else {
            (parts[0].parse::<i32>().ok()?, parts[1], parts[2], 4)
        };
    let x = parts.get(offset)?.parse::<f64>().ok()?;
    let y = parts.get(offset + 1)?.parse::<f64>().ok()?;
    let z = parts.get(offset + 2)?.parse::<f64>().ok()?;
    gro_atom_to_maestro(residue_number, residue_name, atom_name, x, y, z)
}

fn split_gro_residue_token(token: &str) -> Option<(i32, &str)> {
    let split_at = token
        .char_indices()
        .find(|(_, ch)| !ch.is_ascii_digit())
        .map(|(index, _)| index)?;
    if split_at == 0 {
        return None;
    }
    Some((token[..split_at].parse::<i32>().ok()?, &token[split_at..]))
}

fn gro_atom_to_maestro(
    residue_number: i32,
    residue_name: &str,
    atom_name: &str,
    x: f64,
    y: f64,
    z: f64,
) -> Option<MaestroAtom> {
    let symbol = gro_element_symbol(atom_name, residue_name)?;
    let residue_name = if is_gro_water_residue(residue_name) {
        "HOH".to_string()
    } else {
        normalize_pdb_residue_name(residue_name)
    };
    Some(MaestroAtom {
        symbol,
        atom_name: normalize_pdb_atom_name(atom_name),
        residue_name: if residue_name.is_empty() {
            "MOL".to_string()
        } else {
            residue_name
        },
        residue_number,
        chain_name: "A".to_string(),
        x: x * 10.0,
        y: y * 10.0,
        z: z * 10.0,
    })
}

fn is_gro_water_residue(residue_name: &str) -> bool {
    matches!(
        residue_name.trim().to_ascii_uppercase().as_str(),
        "SOL"
            | "WAT"
            | "HOH"
            | "H2O"
            | "TIP"
            | "TIP3"
            | "TIP3P"
            | "TIP4"
            | "TIP4P"
            | "TP3"
            | "TP4"
            | "SPC"
            | "SPCE"
    )
}

fn maestro_staged_solvent_atoms(blocks: &[MaestroPdbBlock]) -> Vec<MaestroAtom> {
    let explicit_solvent_atoms = blocks
        .iter()
        .filter(|block| {
            matches!(
                block.ct_type.trim().to_ascii_lowercase().as_str(),
                "solvent" | "ion"
            )
        })
        .flat_map(|block| block.atoms.iter().cloned())
        .map(normalize_maestro_staged_solvent_atom)
        .collect::<Vec<_>>();
    if !explicit_solvent_atoms.is_empty() {
        return explicit_solvent_atoms;
    }

    let full_system_atoms = blocks
        .iter()
        .filter(|block| block.ct_type.trim().eq_ignore_ascii_case("full_system"))
        .flat_map(|block| block.atoms.iter());
    let water_atoms = full_system_atoms
        .filter(|atom| is_maestro_water_atom(atom))
        .cloned()
        .map(normalize_maestro_staged_solvent_atom)
        .collect::<Vec<_>>();
    if !water_atoms.is_empty() {
        return water_atoms;
    }

    blocks
        .iter()
        .flat_map(|block| block.atoms.iter())
        .filter(|atom| is_maestro_water_atom(atom))
        .cloned()
        .map(normalize_maestro_staged_solvent_atom)
        .collect()
}

fn normalize_maestro_staged_solvent_atom(mut atom: MaestroAtom) -> MaestroAtom {
    if is_maestro_water_atom(&atom) {
        atom.residue_name = "HOH".to_string();
    }
    atom
}

fn is_maestro_water_atom(atom: &MaestroAtom) -> bool {
    is_maestro_water_residue(&atom.residue_name)
}

fn is_maestro_water_residue(residue_name: &str) -> bool {
    matches!(
        residue_name.trim().to_ascii_uppercase().as_str(),
        "SOL" | "WAT" | "HOH" | "H2O" | "TIP" | "TP3" | "TP4" | "SPC" | "DOD"
    )
}

fn gro_element_symbol(atom_name: &str, residue_name: &str) -> Option<String> {
    let cleaned = atom_name
        .trim_start_matches(|ch: char| ch.is_ascii_digit())
        .chars()
        .filter(|ch| ch.is_ascii_alphabetic())
        .collect::<String>()
        .to_ascii_uppercase();
    if cleaned.is_empty() {
        return None;
    }
    if is_gro_water_residue(residue_name) {
        return Some(if cleaned.starts_with('H') { "H" } else { "O" }.to_string());
    }
    for (prefix, symbol) in [
        ("CL", "Cl"),
        ("BR", "Br"),
        ("NA", "Na"),
        ("MG", "Mg"),
        ("ZN", "Zn"),
        ("FE", "Fe"),
    ] {
        if cleaned.starts_with(prefix) {
            return Some(symbol.to_string());
        }
    }
    if cleaned.starts_with("CA") && residue_name.trim().eq_ignore_ascii_case("CA") {
        return Some("Ca".to_string());
    }
    Some(normalize_element_symbol(&cleaned[..1]))
}

fn parse_maestro_pdb_atoms(lines: &[&str], atom_limit: usize) -> Option<Vec<MaestroAtom>> {
    parse_maestro_pdb_models(lines, atom_limit).and_then(|mut models| models.drain(..).next())
}

fn parse_maestro_pdb_models(lines: &[&str], atom_limit: usize) -> Option<Vec<Vec<MaestroAtom>>> {
    let blocks = parse_maestro_pdb_blocks(lines, atom_limit)?;
    let best_score = blocks
        .iter()
        .map(|block| maestro_ct_score(&block.ct_type))
        .max()?;
    let models = blocks
        .into_iter()
        .filter(|block| maestro_ct_score(&block.ct_type) == best_score)
        .map(|block| block.atoms)
        .filter(|atoms| !atoms.is_empty())
        .collect::<Vec<_>>();
    (!models.is_empty()).then_some(models)
}

fn parse_maestro_pdb_blocks(lines: &[&str], atom_limit: usize) -> Option<Vec<MaestroPdbBlock>> {
    let mut index = 0;
    let mut current_ct_type = String::new();
    let mut blocks: Vec<MaestroPdbBlock> = Vec::new();
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
            blocks.push(MaestroPdbBlock {
                ct_type: current_ct_type.clone(),
                atoms,
            });
        }
    }
    (!blocks.is_empty()).then_some(blocks)
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
        "full_system" => 4,
        "solute" => 3,
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

fn maestro_models_to_pdb(models: &[Vec<MaestroAtom>]) -> String {
    let mut pdb = String::new();
    for (model_index, atoms) in models.iter().enumerate() {
        pdb.push_str(&format!("MODEL{:>9}\n", model_index + 1));
        for (atom_index, atom) in atoms.iter().enumerate() {
            pdb.push_str(&maestro_pdb_atom_line(atom_index + 1, atom));
            pdb.push('\n');
        }
        push_pdb_conect_lines(&mut pdb, atoms);
        pdb.push_str("ENDMDL\n");
    }
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

fn strip_inline_comment(line: &str) -> String {
    line.split('#')
        .next()
        .unwrap_or_default()
        .trim()
        .to_string()
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
    fn converts_moe_ph4_features_to_pdb_for_molstar() {
        let data = br#"#moe:ph4que 2024.06
#pharmacophore 7 tag t value *
#feature 2 expr tt color ix x r y r z r r r ebits ix gbits ix m ix
Acc df2f2 16.0079479 12.0568863 2.5561313 1 0 400 a64cff Don f20df2 13.7719302 12.1259417 2.9526787 1.4 0 400 a64cff
#constraint 1 expr tt ebits ix ids i*
SAMEAIDX 0 2 1 2
#volumesphere 1 x r y r z r r r
9.572 19.724 -4.435 1.95000002384186
"#;
        let converted = converted_data_from_text(data, "ph4", "abl1_U1.ph4").unwrap();
        let pdb = String::from_utf8(converted.data).unwrap();
        assert_eq!(converted.extension, "pdb");
        assert!(pdb.contains("REMARK Pharmacophore preview converted from abl1_U1.ph4"));
        assert!(pdb.contains(" ACC P   1"));
        assert!(pdb.contains(" DON P   2"));
        assert!(pdb.contains(" VOL Q   1"));
        assert!(pdb.contains("CONECT    1    2"));
    }

    #[test]
    fn converts_pharmit_json_points_to_pdb_for_molstar() {
        let data = br#"{
  "receptor": "ATOM      7  CA  GLY A   1       1.000   2.000   3.000  1.00 10.00           C\nEND\n",
  "ligand": "HETATM   18  C1  LIG B   1       4.000   5.000   6.000  1.00 10.00           C\nEND\n",
  "points": [
    {"name": "HydrogenDonor", "hasvec": true, "svector": {"x": 1, "y": 0, "z": 0}, "x": 9.532, "y": 3.916, "z": 35.82, "radius": 0.5, "enabled": true},
    {"name": "Hydrophobic", "x": 12.17, "y": 4.268, "z": 35.199, "radius": 1.0, "enabled": true}
  ]
}"#;
        let converted =
            converted_data_from_text(data, "json", "4pps_estrogen_receptor.json").unwrap();
        let pdb = String::from_utf8(converted.data).unwrap();
        assert_eq!(converted.extension, "pdb");
        assert!(pdb.contains("DON P"), "{pdb}");
        assert!(pdb.contains("HYD P"), "{pdb}");
        assert!(pdb.contains("ATOM      7  CA  GLY A   1"));
        assert!(pdb.contains("HETATM   18  C1  LIG B   1"));
        assert!(pdb.contains("VEC  VEC V   1"), "{pdb}");
        assert!(pdb.contains("CONECT   19   20"), "{pdb}");
        assert!(pdb.contains("  9.532   3.916  35.820"), "{pdb}");
    }

    #[test]
    fn converts_abinit_xangst_section_to_pdb_for_molstar() {
        let data = br#"
# Caffeine fragment
natom 3
znucl 6 7 8
typat 1 2 3
xangst
  8.883879  8.903825  7.568465
  9.329931 10.773719  5.875216
  9.702509  7.924807  8.144454
"#;
        let converted = converted_data_from_text(data, "abi", "caffeine.abi").unwrap();
        let pdb = String::from_utf8(converted.data).unwrap();
        assert!(pdb.starts_with("REMARK Converted from caffeine.abi\nHETATM"));
        assert!(pdb.contains("HETATM    1 C    MOL A   1       8.884   8.904   7.568"));
        assert!(pdb.contains("HETATM    2 N    MOL A   1       9.330  10.774   5.875"));
        assert!(pdb.contains("HETATM    3 O    MOL A   1       9.703   7.925   8.144"));
    }

    #[test]
    fn converts_fdf_atomic_species_blocks_to_pdb_for_molstar() {
        let data = include_bytes!("../../../../../samples/quantum/inputs/caffeine.fdf");
        let converted = converted_data_from_text(data, "fdf", "caffeine.fdf").unwrap();
        let pdb = String::from_utf8(converted.data).unwrap();

        assert_eq!(converted.extension, "pdb");
        assert!(pdb.starts_with("REMARK Converted from caffeine.fdf\nHETATM"));
        assert!(pdb.contains("HETATM    1 C    MOL A   1       8.884   8.904   7.568"));
        assert!(pdb.contains("HETATM    9 N    MOL A   1       9.230   7.014   9.117"));
        assert!(pdb.contains("HETATM   13 O    MOL A   1       7.285   6.042   9.891"));
        assert!(pdb.contains("HETATM   15 H    MOL A   1       8.687  11.468   6.436"));
        assert!(pdb.ends_with("END\n"));
    }

    #[test]
    fn converts_amber_restart_coordinates_to_pdb_for_molstar() {
        let data = br#"Amber restart
3
  0.0000000  0.0000000  0.0000000  1.5200000  0.0000000  0.0000000
  2.1200000  1.0000000  0.0000000
"#;

        let converted = converted_data_from_text(data, "inpcrd", "amber.inpcrd").unwrap();
        let pdb = String::from_utf8(converted.data).unwrap();

        assert_eq!(converted.extension, "pdb");
        assert!(pdb.starts_with("REMARK Converted from amber.inpcrd\nHETATM"));
        assert!(pdb.contains("HETATM    1 C    MOL A   1       0.000   0.000   0.000"));
        assert!(pdb.contains("HETATM    3 C    MOL A   1       2.120   1.000   0.000"));
    }

    #[test]
    fn converts_charmm_coordinates_to_pdb_for_molstar() {
        let data = br#"* CHARMM coordinates
*
    2 EXT
    1    1 MOL  C1     0.000000    0.000000    0.000000 MOL  1  0.00000
    2    1 MOL  O1     1.240000    0.000000    0.000000 MOL  1  0.00000
"#;

        let converted = converted_data_from_text(data, "crd", "charmm.crd").unwrap();
        let pdb = String::from_utf8(converted.data).unwrap();

        assert_eq!(converted.extension, "pdb");
        assert!(pdb.starts_with("REMARK Converted from charmm.crd\nHETATM"));
        assert!(pdb.contains("HETATM    1 C    MOL A   1       0.000   0.000   0.000"));
        assert!(pdb.contains("HETATM    2 O    MOL A   1       1.240   0.000   0.000"));
    }

    #[test]
    fn converts_openmm_state_positions_to_pdb_for_molstar() {
        let data = br#"<State>
  <Positions>
    <Position x="0.0" y="0.0" z="0.0"/>
    <Position x="0.8" y="0.0" z="0.0"/>
  </Positions>
</State>
"#;

        let converted = converted_data_from_text(data, "state", "openmm.state").unwrap();
        let pdb = String::from_utf8(converted.data).unwrap();

        assert_eq!(converted.extension, "pdb");
        assert!(pdb.starts_with("REMARK Converted from openmm.state\nHETATM"));
        assert!(pdb.contains("HETATM    2 C    MOL A   1       0.800   0.000   0.000"));
    }

    #[test]
    fn converts_hoomd_xml_positions_to_pdb_for_molstar() {
        let data = br#"<hoomd_xml version="1.6">
  <configuration time_step="0" dimensions="3" natoms="2">
    <position>
      0.0 0.0 0.0
      1.2 0.0 0.0
    </position>
    <type>
      C O
    </type>
  </configuration>
</hoomd_xml>
"#;
        let converted = converted_data_from_text(data, "xml", "hoomd.xml").unwrap();
        let pdb = String::from_utf8(converted.data).unwrap();

        assert_eq!(converted.extension, "pdb");
        assert!(pdb.starts_with("REMARK Converted from hoomd.xml\nHETATM"));
        assert!(pdb.contains("HETATM    1 C    MOL A   1       0.000   0.000   0.000"));
        assert!(pdb.contains("HETATM    2 O    MOL A   1       1.200   0.000   0.000"));
    }

    #[test]
    fn leaves_non_coordinate_xml_unconverted() {
        let data = br#"<System><Forces/></System>"#;
        assert!(converted_data_from_text(data, "xml", "openmm-system.xml").is_none());
    }

    #[test]
    fn converts_lammps_dump_frames_to_xyz_for_molstar() {
        let data = br#"ITEM: TIMESTEP
0
ITEM: NUMBER OF ATOMS
2
ITEM: BOX BOUNDS pp pp pp
0 10
0 10
0 10
ITEM: ATOMS id element x y z
1 C 0.0 0.0 0.0
2 O 1.2 0.0 0.0
ITEM: TIMESTEP
1
ITEM: NUMBER OF ATOMS
2
ITEM: BOX BOUNDS pp pp pp
0 10
0 10
0 10
ITEM: ATOMS id element x y z
1 C 0.5 0.0 0.0
2 O 1.7 0.0 0.0
"#;
        let converted = converted_data_from_text(data, "lammpstrj", "dump.lammpstrj").unwrap();
        let xyz = String::from_utf8(converted.data).unwrap();

        assert_eq!(converted.extension, "xyz");
        assert!(xyz.starts_with("2\nConverted from dump.lammpstrj frame 1\n"));
        assert!(xyz.contains("O 1.200000 0.000000 0.000000\n"));
        assert!(xyz.contains("2\nConverted from dump.lammpstrj frame 2\n"));
        assert!(xyz.contains("O 1.700000 0.000000 0.000000\n"));
    }

    #[test]
    fn converts_lammps_pos_dump_to_xyz_for_molstar() {
        let data = br#"ITEM: TIMESTEP
0
ITEM: NUMBER OF ATOMS
2
ITEM: BOX BOUNDS pp pp pp
0 10
0 10
0 10
ITEM: ATOMS id type x y z
1 1 8.39336 5.60135 4.68858
2 1 8.39378 4.31559 5.23490
"#;
        let converted = converted_data_from_text(data, "pos", "c60.0.pos").unwrap();
        let xyz = String::from_utf8(converted.data).unwrap();

        assert_eq!(converted.extension, "xyz");
        assert!(xyz.starts_with("2\nConverted from c60.0.pos frame 1\n"));
        assert!(xyz.contains("C 8.393360 5.601350 4.688580\n"));
    }

    #[test]
    fn converts_atomeye_cfg_fractional_atoms_to_pdb_for_molstar() {
        let data = br#"Number of particles = 2
A = 1 Angstrom (basic length-scale)
H0(1,1) = 10 A
H0(1,2) = 0 A
H0(1,3) = 0 A
H0(2,1) = 0 A
H0(2,2) = 10 A
H0(2,3) = 0 A
H0(3,1) = 0 A
H0(3,2) = 0 A
H0(3,3) = 10 A
.NO_VELOCITY.
entry_count = 3
12.010700
C
0.839336 0.560135 0.468858
12.010700
C
0.839378 0.431559 0.52349
"#;
        let converted = converted_data_from_text(data, "cfg", "c60.0.cfg").unwrap();
        let pdb = String::from_utf8(converted.data).unwrap();

        assert_eq!(converted.extension, "pdb");
        assert!(pdb.starts_with("REMARK Converted from c60.0.cfg\nHETATM"));
        assert!(pdb.contains("HETATM    1 C    MOL A   1       8.393   5.601   4.689"));
        assert!(pdb.contains("HETATM    2 C    MOL A   1       8.394   4.316   5.235"));
    }

    #[test]
    fn converts_lammps_data_atoms_to_pdb_for_molstar() {
        let data = br#"#Coord for fullerene
3 atoms
1 atom types

0 10.00000 xlo xhi
0 10.00000 ylo yhi
0 10.00000 zlo zhi

Masses

1 12.0107

Atoms

1 1 0  8.393362 5.601346 4.688575
2 1 0  8.393783 4.315589 5.234898
3 1 0  1.506611 5.601348 4.688592
"#;
        let converted = converted_data_from_text(data, "data", "C60.data").unwrap();
        let pdb = String::from_utf8(converted.data).unwrap();

        assert_eq!(converted.extension, "pdb");
        assert!(pdb.starts_with("REMARK Converted from C60.data\nHETATM"));
        assert!(pdb.contains("HETATM    1 C    MOL A   1       8.393   5.601   4.689"));
        assert!(pdb.contains("HETATM    3 C    MOL A   1       1.507   5.601   4.689"));
    }

    #[test]
    fn converts_lammps_write_data_charge_header_without_charge_column() {
        let data =
            br#"LAMMPS data file via write_data, version 22 Jul 2025, timestep = 1100, units = real

4 atoms
2 atom types

0 8 xlo xhi
0 8 ylo yhi
0 8 zlo zhi

Masses

1 12.01
2 1.007

Atoms # charge

1 2  6.193684336440899 5.2106946071299465 3.955151023204197
2 1  5.216866494753594 4.7243488996052125 3.953587843496973
3 1  5.196836789231362 3.310398668452587 4.001097697877303
4 2  6.130830857558428 2.7226726888119903 4.001339694268381
"#;
        let converted = converted_data_from_text(data, "data", "benz_flat_centered.data").unwrap();
        let pdb = String::from_utf8(converted.data).unwrap();

        assert_eq!(converted.extension, "pdb");
        assert!(pdb.starts_with("REMARK Converted from benz_flat_centered.data\nHETATM"));
        assert!(pdb.contains("HETATM    1 H    MOL A   1       6.194   5.211   3.955"));
        assert!(pdb.contains("HETATM    2 C    MOL A   1       5.217   4.724   3.954"));
        assert!(pdb.contains("HETATM    4 H    MOL A   1       6.131   2.723   4.001"));
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
    fn converts_gro_without_box_boundary_overlay() {
        let data = br#"GRO box fixture
2
    1MOL      C    1   1.000   2.000   3.000
    2TP3      O    2   0.100   0.200   0.300
   1.00000   2.00000   3.00000   0.10000   0.20000   0.30000   0.40000   0.50000   0.60000
"#;

        let converted = converted_data_from_text(data, "gro", "box.gro").unwrap();
        let pdb = String::from_utf8(converted.data).unwrap();

        assert!(pdb.starts_with("REMARK Converted from box.gro\n"));
        assert!(!pdb.contains("CRYST1"));
        assert!(pdb.contains("REMARK Converted from box.gro\nHETATM    1 C    MOL A   1"));
        assert!(!pdb.contains("BOX Z9999"));
        assert_eq!(converted.staged_entries.len(), 1);
        assert_eq!(converted.staged_entries[0].representation, "solvent-lines");
    }

    #[test]
    fn rejects_truncated_cube_without_coordinate_fallback() {
        let data = br#"broken cube
generated
2 0.0 0.0 0.0
1 1.0 0.0 0.0
1 0.0 1.0 0.0
1 0.0 0.0 1.0
8 0.0 0.000 0.000 0.000
"#;

        assert!(xyz_data_from_text(data, "cube", "broken.cube").is_none());
        assert!(converted_data_from_text(data, "cube", "broken.cube").is_none());
    }

    #[test]
    fn converts_quantum_espresso_atomic_positions_until_block_end() {
        let data = br#"
&CONTROL
/
ATOMIC_POSITIONS angstrom
C 0.000 0.000 0.000
O 1.200 0.000 0.000
K_POINTS automatic
1 1 1 0 0 0
"#;

        let xyz = String::from_utf8(xyz_data_from_text(data, "in", "qe.in").unwrap()).unwrap();

        assert!(xyz.starts_with("2\nConverted from qe.in\n"));
        assert!(xyz.contains("C 0.000000 0.000000 0.000000"));
        assert!(xyz.contains("O 1.200000 0.000000 0.000000"));
        assert!(!xyz.contains("K_POINTS"));
    }

    #[test]
    fn falls_back_to_best_coordinate_block_for_plain_logs() {
        let data = br#"
header
C 0.000 0.100 0.200
not coordinates
O -1.000 0.000 0.000
H -1.500 0.750 0.000
footer
"#;

        let xyz =
            String::from_utf8(xyz_data_from_text(data, "log", "coords.log").unwrap()).unwrap();

        assert!(xyz.starts_with("2\nConverted from coords.log\n"));
        assert!(!xyz.contains("C 0.000000 0.100000 0.200000"));
        assert!(xyz.contains("O -1.000000 0.000000 0.000000"));
        assert!(xyz.contains("H -1.500000 0.750000 0.000000"));
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
    fn converts_equal_rank_maestro_cts_to_pdb_models() {
        let data = br#"
f_m_ct {
  s_ffio_ct_type
  :::
  full_system
  m_atom[2] {
    i_m_mmod_type
    i_m_atomic_number
    r_m_x_coord
    r_m_y_coord
    r_m_z_coord
    s_m_pdb_residue_name
    s_m_pdb_atom_name
    i_m_residue_number
    s_m_chain_name
    :::
    1 6 1.000000 2.000000 3.000000 "ALA " " CA " 10 "A"
    1 8 2.000000 3.000000 4.000000 "MOL " " O1 " 1 "L"
    :::
  }
}
f_m_ct {
  s_ffio_ct_type
  :::
  full_system
  m_atom[2] {
    i_m_mmod_type
    i_m_atomic_number
    r_m_x_coord
    r_m_y_coord
    r_m_z_coord
    s_m_pdb_residue_name
    s_m_pdb_atom_name
    i_m_residue_number
    s_m_chain_name
    :::
    1 6 5.000000 6.000000 7.000000 "ALA " " CA " 10 "A"
    1 8 6.000000 7.000000 8.000000 "MOL " " O1 " 1 "L"
    :::
  }
}
"#;
        let converted = converted_data_from_text(data, "mae", "poses.mae").unwrap();
        let pdb = String::from_utf8(converted.data).unwrap();

        assert!(pdb.contains("MODEL        1\n"));
        assert!(pdb.contains("MODEL        2\n"));
        assert_eq!(pdb.matches("ENDMDL\n").count(), 2);
        assert!(pdb.contains("   1.000   2.000   3.000"));
        assert!(pdb.contains("   5.000   6.000   7.000"));
        assert!(pdb.ends_with("END\n"));
    }

    #[test]
    fn prefers_full_system_maestro_ct_over_solute() {
        let data = br#"
f_m_ct {
  s_ffio_ct_type
  :::
  full_system
  m_atom[2] {
    i_m_mmod_type
    i_m_atomic_number
    r_m_x_coord
    r_m_y_coord
    r_m_z_coord
    s_m_pdb_residue_name
    s_m_pdb_atom_name
    i_m_residue_number
    s_m_chain_name
    :::
    1 6 1.000000 2.000000 3.000000 "ALA " " CA " 10 "A"
    1 8 2.000000 3.000000 4.000000 "POPC" " O1 " 1 "M"
    :::
  }
}
f_m_ct {
  s_ffio_ct_type
  :::
  solute
  m_atom[1] {
    i_m_mmod_type
    i_m_atomic_number
    r_m_x_coord
    r_m_y_coord
    r_m_z_coord
    s_m_pdb_residue_name
    s_m_pdb_atom_name
    i_m_residue_number
    s_m_chain_name
    :::
    1 6 9.000000 9.000000 9.000000 "ALA " " CA " 10 "A"
    :::
  }
}
"#;
        let converted = converted_data_from_text(data, "cms", "system.cms").unwrap();
        let pdb = String::from_utf8(converted.data).unwrap();

        assert!(pdb.contains("   1.000   2.000   3.000"));
        assert!(pdb.contains(" POP M   1"));
        assert!(!pdb.contains("   9.000   9.000   9.000"));
    }

    #[test]
    fn splits_maestro_solvent_ct_into_staged_lines() {
        let data = br#"
f_m_ct {
  s_ffio_ct_type
  :::
  solute
  m_atom[1] {
    i_m_mmod_type
    i_m_atomic_number
    r_m_x_coord
    r_m_y_coord
    r_m_z_coord
    s_m_pdb_residue_name
    s_m_pdb_atom_name
    i_m_residue_number
    s_m_chain_name
    :::
    1 6 1.000000 2.000000 3.000000 "ALA " " CA " 10 "A"
    :::
  }
}
f_m_ct {
  s_ffio_ct_type
  :::
  solvent
  m_atom[2] {
    i_m_mmod_type
    i_m_atomic_number
    r_m_x_coord
    r_m_y_coord
    r_m_z_coord
    s_m_pdb_residue_name
    s_m_pdb_atom_name
    i_m_residue_number
    s_m_chain_name
    :::
    1 8 4.000000 5.000000 6.000000 "WAT " " O  " 20 "W"
    1 1 4.700000 5.000000 6.000000 "WAT " " H1 " 20 "W"
    :::
  }
}
"#;
        let converted = converted_data_from_text(data, "cms", "system.cms").unwrap();
        let pdb = String::from_utf8(converted.data).unwrap();

        assert!(pdb.contains(" ALA A  10"));
        assert!(!pdb.contains("   4.000   5.000   6.000"));
        assert_eq!(converted.staged_entries.len(), 1);
        assert_eq!(converted.staged_entries[0].label, "Solvent");
        assert_eq!(converted.staged_entries[0].representation, "solvent-lines");
        let solvent_pdb = String::from_utf8(converted.staged_entries[0].data.clone()).unwrap();
        assert!(solvent_pdb.contains(" HOH W  20"));
        assert!(solvent_pdb.contains("   4.000   5.000   6.000"));
        assert!(solvent_pdb.ends_with("END\n"));
    }

    #[test]
    fn keeps_large_maestro_full_system_beyond_legacy_preview_limit() {
        let mut data = String::from(
            r#"
f_m_ct {
  s_ffio_ct_type
  :::
  full_system
  m_atom[30001] {
    i_m_mmod_type
    i_m_atomic_number
    r_m_x_coord
    r_m_y_coord
    r_m_z_coord
    s_m_pdb_residue_name
    s_m_pdb_atom_name
    i_m_residue_number
    s_m_chain_name
    :::
"#,
        );
        for index in 0..30_001 {
            data.push_str(&format!(
                "    1 6 {x:.6} 0.000000 0.000000 \"POPC\" \" C1 \" {residue} \"M\"\n",
                x = index as f64 * 0.01,
                residue = index + 1
            ));
        }
        data.push_str(
            r#"    :::
  }
}
"#,
        );

        let converted =
            converted_data_from_text(data.as_bytes(), "cms", "large-system.cms").unwrap();
        let pdb = String::from_utf8(converted.data).unwrap();

        assert_eq!(pdb.matches("\nHETATM").count(), 30_000);
        assert!(pdb.starts_with("HETATM    1"));
        assert!(pdb.contains("HETATM30001"));
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
