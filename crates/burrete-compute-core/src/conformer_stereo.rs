const TETRAHEDRAL_VOLUME_TOLERANCE: f32 = 0.3;

pub const STEREO_FAILURE_CHIRAL_VOLUME: u32 = 1 << 0;
pub const STEREO_FAILURE_TETRAHEDRAL_GEOMETRY: u32 = 1 << 1;
pub const STEREO_FAILURE_NONFINITE_POSITION: u32 = 1 << 2;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ChiralVolumeConstraint {
    pub atoms: [u32; 4],
    pub lower: f32,
    pub upper: f32,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct TetrahedralConstraint {
    /// Center followed by four vertices. For three-coordinate centers the
    /// fourth vertex is the center itself, matching RDKit's ChiralSet shape.
    pub atoms: [u32; 5],
    pub in_fused_small_ring: bool,
}

pub fn validate_conformer_stereo(
    positions: &[[f32; 4]],
    chiral: &[ChiralVolumeConstraint],
    tetrahedral: &[TetrahedralConstraint],
) -> Result<u32, ConformerStereoError> {
    if positions.is_empty() {
        return Err(ConformerStereoError::new(
            "stereo validation requires at least one atom",
        ));
    }
    validate_constraints(positions.len(), chiral, tetrahedral)?;
    if positions.iter().flatten().any(|value| !value.is_finite()) {
        return Ok(STEREO_FAILURE_NONFINITE_POSITION);
    }

    let mut failures = 0;
    for constraint in chiral {
        let volume = signed_volume(positions, constraint.atoms);
        if volume < constraint.lower || volume > constraint.upper {
            failures |= STEREO_FAILURE_CHIRAL_VOLUME;
        }
    }
    for constraint in tetrahedral {
        let [_, first, second, third, fourth] = constraint.atoms;
        let volume = signed_volume(positions, [first, second, third, fourth]);
        if volume.abs() < TETRAHEDRAL_VOLUME_TOLERANCE {
            failures |= STEREO_FAILURE_TETRAHEDRAL_GEOMETRY;
        }
    }
    Ok(failures)
}

pub fn validate_stereo_constraints(
    atom_count: usize,
    chiral: &[ChiralVolumeConstraint],
    tetrahedral: &[TetrahedralConstraint],
) -> Result<(), ConformerStereoError> {
    validate_constraints(atom_count, chiral, tetrahedral)
}

fn validate_constraints(
    atom_count: usize,
    chiral: &[ChiralVolumeConstraint],
    tetrahedral: &[TetrahedralConstraint],
) -> Result<(), ConformerStereoError> {
    for constraint in chiral {
        if constraint
            .atoms
            .iter()
            .any(|atom| *atom as usize >= atom_count)
            || !constraint.lower.is_finite()
            || !constraint.upper.is_finite()
            || constraint.upper < constraint.lower
        {
            return Err(ConformerStereoError::new(
                "chiral volume constraint is outside the supported domain",
            ));
        }
    }
    for constraint in tetrahedral {
        if constraint
            .atoms
            .iter()
            .any(|atom| *atom as usize >= atom_count)
        {
            return Err(ConformerStereoError::new(
                "tetrahedral constraint is outside the supported atom range",
            ));
        }
    }
    Ok(())
}

fn signed_volume(positions: &[[f32; 4]], atoms: [u32; 4]) -> f32 {
    let [first, second, third, fourth] = atoms.map(|atom| positions[atom as usize]);
    let a = [
        first[0] - fourth[0],
        first[1] - fourth[1],
        first[2] - fourth[2],
    ];
    let b = [
        second[0] - fourth[0],
        second[1] - fourth[1],
        second[2] - fourth[2],
    ];
    let c = [
        third[0] - fourth[0],
        third[1] - fourth[1],
        third[2] - fourth[2],
    ];
    a[0] * (b[1] * c[2] - b[2] * c[1])
        + a[1] * (b[2] * c[0] - b[0] * c[2])
        + a[2] * (b[0] * c[1] - b[1] * c[0])
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ConformerStereoError {
    message: String,
}

impl ConformerStereoError {
    fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }
}

impl std::fmt::Display for ConformerStereoError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for ConformerStereoError {}

#[cfg(test)]
mod tests {
    use super::*;

    const TETRAHEDRON: [[f32; 4]; 4] = [
        [1.0, 1.0, 1.0, 0.0],
        [1.0, -1.0, -1.0, 0.0],
        [-1.0, 1.0, -1.0, 0.0],
        [-1.0, -1.0, 1.0, 0.0],
    ];

    #[test]
    fn validates_signed_chirality_and_nonplanar_geometry() {
        let volume = signed_volume(&TETRAHEDRON, [0, 1, 2, 3]);
        let chiral = [ChiralVolumeConstraint {
            atoms: [0, 1, 2, 3],
            lower: volume - 0.1,
            upper: volume + 0.1,
        }];
        let tetrahedral = [TetrahedralConstraint {
            atoms: [0, 0, 1, 2, 3],
            in_fused_small_ring: false,
        }];
        assert_eq!(
            validate_conformer_stereo(&TETRAHEDRON, &chiral, &tetrahedral),
            Ok(0)
        );

        let wrong_sign = [ChiralVolumeConstraint {
            lower: -volume - 0.1,
            upper: -volume + 0.1,
            ..chiral[0]
        }];
        assert_eq!(
            validate_conformer_stereo(&TETRAHEDRON, &wrong_sign, &tetrahedral),
            Ok(STEREO_FAILURE_CHIRAL_VOLUME)
        );
    }

    #[test]
    fn rejects_planar_and_nonfinite_positions_with_stable_bits() {
        let planar = [
            [0.0, 0.0, 0.0, 0.0],
            [1.0, 0.0, 0.0, 0.0],
            [0.0, 1.0, 0.0, 0.0],
            [1.0, 1.0, 0.0, 0.0],
        ];
        let tetrahedral = [TetrahedralConstraint {
            atoms: [0, 0, 1, 2, 3],
            in_fused_small_ring: true,
        }];
        assert_eq!(
            validate_conformer_stereo(&planar, &[], &tetrahedral),
            Ok(STEREO_FAILURE_TETRAHEDRAL_GEOMETRY)
        );
        let mut nonfinite = planar;
        nonfinite[0][0] = f32::NAN;
        assert_eq!(
            validate_conformer_stereo(&nonfinite, &[], &tetrahedral),
            Ok(STEREO_FAILURE_NONFINITE_POSITION)
        );
    }
}
