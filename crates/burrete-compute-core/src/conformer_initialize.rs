//! Deterministic reference for the GPU conformer-coordinate initializer.

const UINT24_SCALE: f32 = 1.0 / 16_777_216.0;

pub fn initialize_conformer_positions(seed_words: [u32; 4], atom_count: u32) -> Vec<[f32; 4]> {
    (0..atom_count)
        .map(|atom| {
            std::array::from_fn(|dimension| {
                let counter = atom
                    .wrapping_mul(4)
                    .wrapping_add(u32::try_from(dimension).expect("four dimensions"));
                unit_signed(hash32(
                    seed_words[dimension]
                        ^ counter.wrapping_mul(0x9e37_79b9)
                        ^ (dimension as u32).wrapping_mul(0x85eb_ca6b),
                ))
            })
        })
        .collect()
}

fn hash32(mut value: u32) -> u32 {
    value ^= value >> 16;
    value = value.wrapping_mul(0x7feb_352d);
    value ^= value >> 15;
    value = value.wrapping_mul(0x846c_a68b);
    value ^ (value >> 16)
}

fn unit_signed(value: u32) -> f32 {
    ((value >> 8) as f32 * UINT24_SCALE).mul_add(2.0, -1.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn initialization_is_deterministic_bounded_and_prefix_stable() {
        let seed = [1, 2, 3, 4];
        let short = initialize_conformer_positions(seed, 2);
        let long = initialize_conformer_positions(seed, 5);
        assert_eq!(short, long[..2]);
        assert!(long
            .iter()
            .flatten()
            .all(|coordinate| (-1.0..1.0).contains(coordinate)));
        assert_ne!(long[0], long[1]);
        assert_ne!(long, initialize_conformer_positions([1, 2, 3, 5], 5));
    }
}
